import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import { createWriteStream } from "node:fs";
import path from "node:path";
import { once } from "node:events";
import { CODEX_EXEC_OPTIONS } from "./config.js";

export type CodexRunMode = { kind: "full" } | { kind: "resume"; threadId: string };

export interface CodexRunOptions {
  prompt: string;
  runDir: string;
  mode?: CodexRunMode;
  execOptions?: readonly string[];
  cwd?: string;
  signal?: AbortSignal;
  imagePaths?: string[];
  interruptTerminationDelayMs?: number;
  interruptKillDelayMs?: number;
  idleTimeoutMs?: number;
  maxDurationMs?: number;
  onVisibleAgentMarkdown?: (text: string) => void;
  onProcessStarted?: () => void | Promise<void>;
  onStructuredActivity?: (event: unknown) => void;
  onThreadStarted?: (threadId: string) => void | Promise<void>;
}

export type CodexWatchdogKind = "idle" | "max-duration";

export interface CodexRunWatchdogs {
  recordActivity(): void;
  clear(): void;
}

// 单次 codex run 的双看门狗：空闲（stdout 无输出即倒计时，主防线）与总时长硬上限
// （无视输出活动，兜底持续输出的死循环）。至多触发一次回调；clear 后不再触发。
export function createRunWatchdogs(options: {
  idleTimeoutMs?: number;
  maxDurationMs?: number;
  onTimeout: (kind: CodexWatchdogKind) => void;
}): CodexRunWatchdogs {
  let settled = false;
  let idleTimer: NodeJS.Timeout | null = null;
  let maxDurationTimer: NodeJS.Timeout | null = null;

  const fire = (kind: CodexWatchdogKind) => {
    if (settled) {
      return;
    }
    settled = true;
    options.onTimeout(kind);
  };

  const armIdleTimer = () => {
    if (options.idleTimeoutMs === undefined) {
      return;
    }
    idleTimer = setTimeout(() => fire("idle"), options.idleTimeoutMs);
    idleTimer.unref();
  };

  armIdleTimer();
  if (options.maxDurationMs !== undefined) {
    maxDurationTimer = setTimeout(() => fire("max-duration"), options.maxDurationMs);
    maxDurationTimer.unref();
  }

  return {
    recordActivity() {
      if (settled || idleTimer === null) {
        return;
      }
      clearTimeout(idleTimer);
      armIdleTimer();
    },
    clear() {
      settled = true;
      if (idleTimer !== null) {
        clearTimeout(idleTimer);
      }
      if (maxDurationTimer !== null) {
        clearTimeout(maxDurationTimer);
      }
    },
  };
}

export type CodexRunResult =
  | {
      ok: true;
      finalText: string;
      threadId: string | null;
      cachedInputTokens: number | null;
      runDir: string;
      stdoutPath: string;
      stderrPath: string;
    }
  | {
      ok: false;
      reason: string;
      runDir: string;
      stdoutPath: string;
      stderrPath: string;
    };

const INTERRUPT_TERMINATION_DELAY_MS = 5_000;
const INTERRUPT_KILL_DELAY_MS = 5_000;
export const CODEX_JSONL_MAX_LINE_BYTES = 1024 * 1024;

export interface CodexJsonlFramer {
  push(chunk: Buffer | string): unknown[];
  finish(): unknown[];
}

export function createCodexJsonlFramer(options: {
  maxLineBytes?: number;
  onDiagnostic?: (message: string) => void;
} = {}): CodexJsonlFramer {
  const maxLineBytes = options.maxLineBytes ?? CODEX_JSONL_MAX_LINE_BYTES;
  let pending: Buffer<ArrayBufferLike> = Buffer.alloc(0);
  let droppingOverlongLine = false;

  const parseLine = (line: Buffer): unknown[] => {
    const withoutCarriageReturn = line.at(-1) === 0x0d ? line.subarray(0, -1) : line;
    if (withoutCarriageReturn.length === 0) {
      return [];
    }
    if (withoutCarriageReturn.length > maxLineBytes) {
      options.onDiagnostic?.(`codex-jsonl-line-too-large:${withoutCarriageReturn.length}`);
      return [];
    }
    const parsed = parseJsonLine(withoutCarriageReturn.toString("utf8"));
    if (parsed === null) {
      options.onDiagnostic?.("codex-jsonl-malformed-line");
      return [];
    }
    return [parsed];
  };

  const push = (chunk: Buffer | string): unknown[] => {
    let incoming = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk, "utf8");
    const events: unknown[] = [];

    if (droppingOverlongLine) {
      const newlineIndex = incoming.indexOf(0x0a);
      if (newlineIndex < 0) {
        return events;
      }
      droppingOverlongLine = false;
      incoming = incoming.subarray(newlineIndex + 1);
    }

    let buffered = pending.length === 0 ? incoming : Buffer.concat([pending, incoming]);
    pending = Buffer.alloc(0);
    while (buffered.length > 0) {
      const newlineIndex = buffered.indexOf(0x0a);
      if (newlineIndex < 0) {
        if (buffered.length > maxLineBytes) {
          options.onDiagnostic?.(`codex-jsonl-line-too-large:${buffered.length}+`);
          droppingOverlongLine = true;
        } else {
          pending = buffered;
        }
        break;
      }
      events.push(...parseLine(buffered.subarray(0, newlineIndex)));
      buffered = buffered.subarray(newlineIndex + 1);
    }
    return events;
  };

  return {
    push,
    finish() {
      if (droppingOverlongLine || pending.length === 0) {
        pending = Buffer.alloc(0);
        droppingOverlongLine = false;
        return [];
      }
      options.onDiagnostic?.(`codex-jsonl-trailing-partial-line:${pending.length}`);
      pending = Buffer.alloc(0);
      return [];
    },
  };
}

export function extractVisibleAgentMarkdown(event: unknown): string | null {
  if (!isRecord(event) || event.type !== "item.completed" || !isRecord(event.item)) {
    return null;
  }
  if (event.item.type !== "agent_message" || typeof event.item.text !== "string") {
    return null;
  }
  return event.item.text.trim().length > 0 ? event.item.text : null;
}

export function extractCodexThreadId(event: unknown): string | null {
  if (
    !isRecord(event)
    || event.type !== "thread.started"
    || typeof event.thread_id !== "string"
    || event.thread_id.trim() === ""
  ) {
    return null;
  }
  return event.thread_id;
}

export async function run(options: CodexRunOptions): Promise<CodexRunResult> {
  const {
    prompt,
    runDir,
    mode = { kind: "full" },
    execOptions = CODEX_EXEC_OPTIONS,
    cwd,
    signal,
    imagePaths = [],
    idleTimeoutMs,
    maxDurationMs,
  } = options;
  await fs.mkdir(runDir, { recursive: true });
  const stdoutPath = path.join(runDir, "stdout.jsonl");
  const stderrPath = path.join(runDir, "stderr.log");
  if (signal?.aborted === true) {
    return {
      ok: false,
      reason: interruptedReason(signal.reason),
      runDir,
      stdoutPath,
      stderrPath,
    };
  }

  const stdoutFile = createWriteStream(stdoutPath, { flags: "a" });
  const stderrFile = createWriteStream(stderrPath, { flags: "a" });
  const streamFramer = createCodexJsonlFramer({
    onDiagnostic: (message) => {
      stderrFile.write(`[moebius] ${message}\n`);
    },
  });

  const child = spawn("codex", buildCodexArgs(prompt, mode, imagePaths, execOptions), {
    cwd,
    stdio: ["ignore", "pipe", "pipe"],
    env: process.env,
  });
  let abortReason: string | null = null;
  let timeoutReason: string | null = null;
  let terminating = false;
  let terminationTimer: NodeJS.Timeout | null = null;
  let killTimer: NodeJS.Timeout | null = null;
  let forceSettleTimer: NodeJS.Timeout | null = null;
  let observedThreadId: string | null = null;
  let threadStartedCallback: Promise<void> = Promise.resolve();
  let processStartedCallback: Promise<void> = Promise.resolve();
  let threadStartedCallbackError: string | null = null;
  let threadIdentityError: string | null = null;
  const terminationDelayMs = options.interruptTerminationDelayMs ?? INTERRUPT_TERMINATION_DELAY_MS;
  const killDelayMs = options.interruptKillDelayMs ?? INTERRUPT_KILL_DELAY_MS;

  type ExitOutcome = { code: number | null; signal: NodeJS.Signals | null } | { error: Error } | { forced: true };
  let resolveExit: (outcome: ExitOutcome) => void = () => {};
  const exitPromise = new Promise<ExitOutcome>((resolve) => {
    resolveExit = resolve;
  });
  child.once("error", (error) => resolveExit({ error }));
  child.once("close", (code, exitSignal) => resolveExit({ code, signal: exitSignal }));
  child.once("spawn", () => {
    try {
      processStartedCallback = Promise.resolve(options.onProcessStarted?.()).catch((error: unknown) => {
        stderrFile.write(`[moebius] codex-process-started-callback-failed:${formatUnknownError(error)}\n`);
      });
    } catch (error) {
      stderrFile.write(`[moebius] codex-process-started-callback-failed:${formatUnknownError(error)}\n`);
    }
  });

  const beginTermination = () => {
    if (terminating) {
      return;
    }
    terminating = true;
    child.kill("SIGINT");
    terminationTimer = setTimeout(() => {
      child.kill("SIGTERM");
      killTimer = setTimeout(() => {
        child.kill("SIGKILL");
        // 孙进程可能继承并持有 stdio 管道，令 SIGKILL 后 close 事件仍不触发。
        // 终止路径（看门狗与用户中断）必须保证 run() 有限时间内 settle（否则
        // driver pool 名额与 issue job 被永久占住），所以强制脱钩 stdio 并合成退出结果。
        forceSettleTimer = setTimeout(() => {
          child.stdout.destroy();
          child.stderr.destroy();
          resolveExit({ forced: true });
        }, killDelayMs);
        forceSettleTimer.unref();
      }, killDelayMs);
      killTimer.unref();
    }, terminationDelayMs);
    terminationTimer.unref();
  };

  const handleAbort = () => {
    if (timeoutReason === null) {
      abortReason = interruptedReason(signal?.reason);
    }
    beginTermination();
  };

  signal?.addEventListener("abort", handleAbort, { once: true });

  const watchdogs = createRunWatchdogs({
    ...(idleTimeoutMs === undefined ? {} : { idleTimeoutMs }),
    ...(maxDurationMs === undefined ? {} : { maxDurationMs }),
    onTimeout: (kind) => {
      if (abortReason !== null) {
        return;
      }
      timeoutReason =
        kind === "idle" ? `idle-timeout:${String(idleTimeoutMs)}ms` : `max-duration-timeout:${String(maxDurationMs)}ms`;
      beginTermination();
    },
  });
  const recordStdoutActivity = () => {
    watchdogs.recordActivity();
  };
  const handleStreamEvent = (event: unknown) => {
    try {
      options.onStructuredActivity?.(event);
    } catch (error) {
      stderrFile.write(`[moebius] codex-structured-activity-callback-failed:${formatUnknownError(error)}\n`);
    }
    const threadId = extractCodexThreadId(event);
    if (threadId !== null) {
      if (observedThreadId === null) {
        observedThreadId = threadId;
        if (options.onThreadStarted !== undefined) {
          try {
            threadStartedCallback = Promise.resolve(options.onThreadStarted(threadId)).catch((error: unknown) => {
              threadStartedCallbackError = formatUnknownError(error);
            });
          } catch (error) {
            threadStartedCallbackError = formatUnknownError(error);
          }
        }
      } else if (observedThreadId !== threadId) {
        threadIdentityError = `conflicting-thread-id:${observedThreadId}:${threadId}`;
        beginTermination();
      }
    }

    const markdown = extractVisibleAgentMarkdown(event);
    if (markdown === null || options.onVisibleAgentMarkdown === undefined) {
      return;
    }
    try {
      options.onVisibleAgentMarkdown(markdown);
    } catch (error) {
      stderrFile.write(`[moebius] codex-visible-markdown-callback-failed:${formatUnknownError(error)}\n`);
    }
  };
  const handleVisibleStdout = (chunk: Buffer) => {
    for (const event of streamFramer.push(chunk)) {
      handleStreamEvent(event);
    }
  };
  child.stdout.on("data", recordStdoutActivity);
  child.stdout.on("data", handleVisibleStdout);

  child.stdout.pipe(stdoutFile, { end: false });
  child.stderr.pipe(stderrFile, { end: false });

  const exit = await exitPromise;

  watchdogs.clear();
  child.stdout.removeListener("data", recordStdoutActivity);
  child.stdout.removeListener("data", handleVisibleStdout);
  for (const event of streamFramer.finish()) {
    handleStreamEvent(event);
  }
  await threadStartedCallback;
  await processStartedCallback;
  signal?.removeEventListener("abort", handleAbort);
  if (terminationTimer !== null) {
    clearTimeout(terminationTimer);
  }
  if (killTimer !== null) {
    clearTimeout(killTimer);
  }
  if (forceSettleTimer !== null) {
    clearTimeout(forceSettleTimer);
  }

  await Promise.all([finishWritable(stdoutFile), finishWritable(stderrFile)]);

  if (threadIdentityError !== null) {
    return {
      ok: false,
      reason: threadIdentityError,
      runDir,
      stdoutPath,
      stderrPath,
    };
  }
  if (threadStartedCallbackError !== null) {
    await fs.appendFile(
      stderrPath,
      `[moebius] codex-thread-link-unavailable:${threadStartedCallbackError}\n`,
      "utf8",
    );
  }

  if (abortReason !== null) {
    return {
      ok: false,
      reason: abortReason,
      runDir,
      stdoutPath,
      stderrPath,
    };
  }

  if (timeoutReason !== null) {
    return {
      ok: false,
      reason: timeoutReason,
      runDir,
      stdoutPath,
      stderrPath,
    };
  }

  if ("forced" in exit) {
    // 仅看门狗路径会合成 forced 退出，理论上已被上面的 timeoutReason 分支拦截；兜底防御。
    return {
      ok: false,
      reason: "forced-settle-without-reason",
      runDir,
      stdoutPath,
      stderrPath,
    };
  }

  if ("error" in exit) {
    return {
      ok: false,
      reason: `spawn-error:${exit.error.message}`,
      runDir,
      stdoutPath,
      stderrPath,
    };
  }

  if (exit.code !== 0) {
    const detail = exit.signal ? `signal-${exit.signal}` : `exit-code-${exit.code}`;
    return {
      ok: false,
      reason: detail,
      runDir,
      stdoutPath,
      stderrPath,
    };
  }

  const lines = (await fs.readFile(stdoutPath, "utf8")).split(/\r?\n/);
  const output = extractCodexOutput(lines);

  if (output.finalText === null) {
    return {
      ok: false,
      reason: "no-final-message",
      runDir,
      stdoutPath,
      stderrPath,
    };
  }

  return {
    ok: true,
    finalText: output.finalText,
    threadId: output.threadId,
    cachedInputTokens: output.cachedInputTokens,
    runDir,
    stdoutPath,
    stderrPath,
  };
}

function formatUnknownError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function extractFinalAssistant(lines: string[]): string | null {
  return extractCodexOutput(lines).finalText;
}

export interface CodexOutputSummary {
  finalText: string | null;
  threadId: string | null;
  cachedInputTokens: number | null;
}

export function extractCodexOutput(lines: string[]): CodexOutputSummary {
  let finalText: string | null = null;
  let threadId: string | null = null;
  let cachedInputTokens: number | null = null;

  for (const line of lines) {
    if (line.trim() === "") {
      continue;
    }

    const event = parseJsonLine(line);
    if (event === null) {
      continue;
    }

    const nextThreadId = extractThreadId(event);
    if (nextThreadId !== null) {
      threadId = nextThreadId;
    }

    const nextCachedInputTokens = extractCachedInputTokens(event);
    if (nextCachedInputTokens !== null) {
      cachedInputTokens = nextCachedInputTokens;
    }

    if (isAssistantEvent(event)) {
      const text = extractText(event);
      if (text !== null && text.length > 0) {
        finalText = text;
      }
    }
  }

  return {
    finalText,
    threadId,
    cachedInputTokens,
  };
}

export function buildCodexArgs(
  prompt: string,
  mode: CodexRunMode = { kind: "full" },
  imagePaths: string[] = [],
  execOptions: readonly string[] = CODEX_EXEC_OPTIONS,
): string[] {
  const imageArgs = imagePaths.flatMap((imagePath) => ["--image", imagePath]);
  // "--" 必须紧跟在最后一个选项之后：codex exec 的 --image 是贪婪多值选项（<FILE>...），
  // 会把紧随其后的 prompt 位置参数一并吞成图片路径，导致 codex 认为没有 prompt、
  // 转而读取空的 stdin 后以 exit 1 退出。"--" 终止选项解析，保证 prompt（以及 resume
  // 模式下的 threadId）始终落在位置参数上，同时也兼容以 "-" 开头的 prompt。
  if (mode.kind === "resume") {
    const { parentOptions, resumeOptions } = splitResumeParentOptions(execOptions);
    return [
      ...parentOptions,
      "exec",
      "resume",
      ...resumeOptions,
      ...imageArgs,
      "--",
      mode.threadId,
      prompt,
    ];
  }

  return ["exec", ...execOptions, ...imageArgs, "--", prompt];
}

function splitResumeParentOptions(execOptions: readonly string[]): {
  parentOptions: string[];
  resumeOptions: string[];
} {
  const parentOptions: string[] = [];
  const resumeOptions: string[] = [];

  for (let index = 0; index < execOptions.length; index += 1) {
    const option = execOptions[index];
    if (option === "--sandbox" || option === "--cd") {
      const value = execOptions[index + 1];
      if (value !== undefined) {
        parentOptions.push(option, value);
        index += 1;
        continue;
      }
    }
    if (option !== undefined) {
      resumeOptions.push(option);
    }
  }

  return { parentOptions, resumeOptions };
}

export function codexTimeoutKind(reason: string): CodexWatchdogKind | null {
  if (reason.startsWith("idle-timeout:")) {
    return "idle";
  }

  if (reason.startsWith("max-duration-timeout:")) {
    return "max-duration";
  }

  return null;
}

export function isInterruptedCodexRunResult(
  result: CodexRunResult,
): result is Extract<CodexRunResult, { ok: false }> & { reason: `interrupted:${string}` } {
  return !result.ok && result.reason.startsWith("interrupted:");
}

function parseJsonLine(line: string): unknown | null {
  try {
    return JSON.parse(line);
  } catch {
    return null;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isAssistantEvent(value: unknown): boolean {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const record = value as Record<string, unknown>;
  const type = typeof record.type === "string" ? record.type : undefined;
  const role = findRole(record);

  if (role !== undefined) {
    return role === "assistant";
  }

  if (type === "agent_message" || type === "assistant_message" || type === "message") {
    return true;
  }

  for (const key of ["item", "data"]) {
    const nested = record[key];
    if (typeof nested === "object" && nested !== null && isAssistantEvent(nested)) {
      return true;
    }
  }

  return false;
}

function findRole(value: Record<string, unknown>): string | undefined {
  if (typeof value.role === "string") {
    return value.role;
  }

  for (const key of ["message", "item", "data"]) {
    const nested = value[key];
    if (typeof nested === "object" && nested !== null && "role" in nested) {
      const role = (nested as Record<string, unknown>).role;
      if (typeof role === "string") {
        return role;
      }
    }
  }

  return undefined;
}

function extractText(value: unknown): string | null {
  if (typeof value === "string") {
    return value;
  }

  if (Array.isArray(value)) {
    const parts = value.map(extractText).filter((part): part is string => part !== null);
    return parts.length > 0 ? parts.join("") : null;
  }

  if (typeof value !== "object" || value === null) {
    return null;
  }

  const record = value as Record<string, unknown>;
  for (const key of ["message", "content", "text"]) {
    const text = extractText(record[key]);
    if (text !== null) {
      return text;
    }
  }

  for (const key of ["item", "data"]) {
    const text = extractText(record[key]);
    if (text !== null) {
      return text;
    }
  }

  return null;
}

function extractThreadId(value: unknown): string | null {
  if (typeof value !== "object" || value === null) {
    return null;
  }

  const record = value as Record<string, unknown>;
  if (record.type === "thread.started" && typeof record.thread_id === "string") {
    return record.thread_id;
  }

  return null;
}

function extractCachedInputTokens(value: unknown): number | null {
  if (typeof value !== "object" || value === null) {
    return null;
  }

  const record = value as Record<string, unknown>;
  if (record.type !== "turn.completed") {
    return null;
  }

  const usage = record.usage;
  if (typeof usage !== "object" || usage === null) {
    return null;
  }

  const cachedInputTokens = (usage as Record<string, unknown>).cached_input_tokens;
  return typeof cachedInputTokens === "number" && Number.isFinite(cachedInputTokens) ? cachedInputTokens : null;
}

function interruptedReason(reason: unknown): string {
  if (typeof reason === "string" && reason.length > 0) {
    return `interrupted:${reason}`;
  }

  if (reason instanceof Error) {
    return `interrupted:${reason.message}`;
  }

  if (reason === undefined || reason === null) {
    return "interrupted:abort-signal";
  }

  return `interrupted:${String(reason)}`;
}

async function finishWritable(stream: NodeJS.WritableStream): Promise<void> {
  stream.end();
  await once(stream, "finish");
}
