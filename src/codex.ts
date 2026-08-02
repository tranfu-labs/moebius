import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import { createWriteStream } from "node:fs";
import path from "node:path";
import { once } from "node:events";
import { CODEX_EXEC_OPTIONS } from "./config.js";
import {
  createProviderToolProjectionState,
  projectCodexToolLifecycle,
  selectCodexExecutionProgress,
  executionInterruptionActor,
  executionInterruptionCause,
  type ExecutionInterruptionCause,
  type ExecutionFailureTerminal,
  type ExecutionProgressEvent,
  type ExecutionTerminal,
} from "./execution-contract.js";
import {
  planExecutionFailureTerminal,
  type CodexRunFailure,
} from "./execution-failure-plan.js";
import {
  createRunSupervisorState,
  observeRunProgress,
} from "./run-supervisor.js";

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
  toolTimeoutMs?: number;
  maxDurationMs?: number;
  onVisibleAgentMarkdown?: (text: string) => void;
  onProcessStarted?: () => void | Promise<void>;
  onStructuredActivity?: (event: unknown) => void;
  onExecutionProgress?: (event: ExecutionProgressEvent) => void;
  onThreadStarted?: (threadId: string) => void | Promise<void>;
}

export type CodexWatchdogKind = "idle" | "tool" | "max-duration";

export interface CodexRunWatchdogs {
  recordActivity(): void;
  setToolInFlight(inFlight: boolean): void;
  clear(): void;
}

// 单次 run 的可选双看门狗：idle 只由调用方记录的语义进展重置，并可在工具
// 在途时暂停；max-duration 无视活动，保留给显式启用硬截止的调用方。
// 至多触发一次回调；clear 后不再触发。
export function createRunWatchdogs(options: {
  idleTimeoutMs?: number;
  toolTimeoutMs?: number;
  maxDurationMs?: number;
  onTimeout: (kind: CodexWatchdogKind) => void;
}): CodexRunWatchdogs {
  let settled = false;
  let idleSuspended = false;
  let idleTimer: NodeJS.Timeout | null = null;
  let toolTimer: NodeJS.Timeout | null = null;
  let maxDurationTimer: NodeJS.Timeout | null = null;

  const fire = (kind: CodexWatchdogKind) => {
    if (settled) {
      return;
    }
    settled = true;
    options.onTimeout(kind);
  };

  const armIdleTimer = () => {
    if (options.idleTimeoutMs === undefined || idleSuspended) {
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
      if (settled || idleSuspended || options.idleTimeoutMs === undefined) {
        return;
      }
      if (idleTimer !== null) clearTimeout(idleTimer);
      armIdleTimer();
    },
    setToolInFlight(suspended) {
      if (settled || idleSuspended === suspended) return;
      idleSuspended = suspended;
      if (idleTimer !== null) {
        clearTimeout(idleTimer);
        idleTimer = null;
      }
      if (suspended) {
        if (options.toolTimeoutMs !== undefined) {
          toolTimer = setTimeout(() => fire("tool"), options.toolTimeoutMs);
          toolTimer.unref();
        }
      } else {
        if (toolTimer !== null) {
          clearTimeout(toolTimer);
          toolTimer = null;
        }
        armIdleTimer();
      }
    },
    clear() {
      settled = true;
      if (idleTimer !== null) {
        clearTimeout(idleTimer);
      }
      if (toolTimer !== null) {
        clearTimeout(toolTimer);
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
      completionKind?: "visible-text" | "terminal-tool-result";
      threadId: string | null;
      cachedInputTokens: number | null;
      runDir: string;
      stdoutPath: string;
      stderrPath: string;
      terminal?: Extract<ExecutionTerminal, { kind: "completed" }>;
    }
  | {
      ok: false;
      reason: string;
      failure?: CodexRunFailure;
      threadId?: string | null;
      runDir: string;
      stdoutPath: string;
      stderrPath: string;
      terminal?: ExecutionFailureTerminal;
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
      terminal: {
        kind: "interrupted",
        actor: executionInterruptionActor(signal.reason),
        cause: executionInterruptionCause(signal.reason),
        partialText: "",
      },
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
  let visibleMarkdown = "";
  let progressSequence = 0;
  let progressSupervisor = createRunSupervisorState(Date.now());
  let toolProjection = createProviderToolProjectionState();
  let threadStartedCallback: Promise<void> = Promise.resolve();
  let processStartedCallback: Promise<void> = Promise.resolve();
  let threadStartedCallbackError: string | null = null;
  let threadIdentityError: string | null = null;
  const failureState: { classified: CodexRunFailure | null } = { classified: null };
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
    ...(options.toolTimeoutMs === undefined ? {} : { toolTimeoutMs: options.toolTimeoutMs }),
    ...(maxDurationMs === undefined ? {} : { maxDurationMs }),
    onTimeout: (kind) => {
      if (abortReason !== null) {
        return;
      }
      timeoutReason = kind === "idle"
        ? `idle-timeout:${String(idleTimeoutMs)}ms`
        : kind === "tool"
          ? `tool-timeout:${String(options.toolTimeoutMs)}ms`
          : `max-duration-timeout:${String(maxDurationMs)}ms`;
      beginTermination();
    },
  });
  const handleStreamEvent = (event: unknown) => {
    failureState.classified = classifyCodexFailure(event) ?? failureState.classified;
    const sequence = ++progressSequence;
    const toolLifecycle = projectCodexToolLifecycle(event, sequence, toolProjection);
    toolProjection = toolLifecycle.state;
    const progress = selectCodexExecutionProgress(toolLifecycle.progress, event, sequence);
    if (progress !== null) {
      const supervision = observeRunProgress(progressSupervisor, progress, Date.now());
      progressSupervisor = supervision.state;
      if (supervision.kind === "progress-observed") {
        watchdogs.setToolInFlight(progressSupervisor.activeToolIds.size > 0);
        if (progressSupervisor.activeToolIds.size === 0) watchdogs.recordActivity();
      }
      try {
        options.onExecutionProgress?.(progress);
      } catch (error) {
        stderrFile.write(`[moebius] codex-progress-callback-failed:${formatUnknownError(error)}\n`);
      }
    }
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
              beginTermination();
            });
          } catch (error) {
            threadStartedCallbackError = formatUnknownError(error);
            beginTermination();
          }
        }
      } else if (observedThreadId !== threadId) {
        threadIdentityError = `conflicting-thread-id:${observedThreadId}:${threadId}`;
        beginTermination();
      }
    }

    const markdown = extractVisibleAgentMarkdown(event);
    if (markdown === null) {
      return;
    }
    visibleMarkdown = markdown;
    if (options.onVisibleAgentMarkdown === undefined) return;
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
  child.stdout.on("data", handleVisibleStdout);

  child.stdout.pipe(stdoutFile, { end: false });
  child.stderr.pipe(stderrFile, { end: false });

  const exit = await exitPromise;

  watchdogs.clear();
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
      terminal: crashedTerminal("codex-thread-identity-invalid", visibleMarkdown),
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
    return {
      ok: false,
      reason: `thread-start-callback-failed:${threadStartedCallbackError}`,
      terminal: crashedTerminal("codex-thread-link-unavailable", visibleMarkdown),
      threadId: observedThreadId,
      runDir,
      stdoutPath,
      stderrPath,
    };
  }

  if (abortReason !== null) {
    return {
      ok: false,
      reason: abortReason,
      terminal: {
        kind: "interrupted",
        actor: executionInterruptionActor(signal?.reason),
        cause: executionInterruptionCause(signal?.reason),
        partialText: visibleMarkdown,
      },
      runDir,
      stdoutPath,
      stderrPath,
    };
  }

  const settledTimeoutReason = timeoutReason as string | null;
  if (settledTimeoutReason !== null) {
    return {
      ok: false,
      reason: settledTimeoutReason,
      terminal: {
        kind: "timeout",
        basis: settledTimeoutReason.startsWith("max-duration-timeout:")
          ? "max"
          : settledTimeoutReason.startsWith("tool-timeout:")
            ? "tool"
            : "idle",
        partialText: visibleMarkdown,
      },
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
      terminal: crashedTerminal("codex-forced-settle", visibleMarkdown),
      runDir,
      stdoutPath,
      stderrPath,
    };
  }

  if ("error" in exit) {
    return {
      ok: false,
      reason: `spawn-error:${exit.error.message}`,
      terminal: crashedTerminal("codex-spawn-error", visibleMarkdown),
      runDir,
      stdoutPath,
      stderrPath,
    };
  }

  if (exit.code !== 0) {
    const detail = exit.signal ? `signal-${exit.signal}` : `exit-code-${exit.code}`;
    if (failureState.classified !== null) {
      return {
        ok: false,
        reason: failureState.classified.code,
        failure: failureState.classified,
        terminal: planExecutionFailureTerminal(failureState.classified, visibleMarkdown),
        runDir,
        stdoutPath,
        stderrPath,
      };
    }
    return {
      ok: false,
      reason: detail,
      terminal: crashedTerminal("codex-process-exited", visibleMarkdown),
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
      terminal: crashedTerminal("codex-no-complete-result", visibleMarkdown),
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
    terminal: {
      kind: "completed",
      externalSessionId: output.threadId,
      finalText: output.finalText,
    },
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

function classifyCodexFailure(event: unknown): CodexRunFailure | null {
  const message = readCodexFailureMessage(event);
  if (message === null || !message.includes("requires a newer version of Codex")) {
    return null;
  }
  const match = message.match(/The '([^']+)' model requires a newer version of Codex/u);
  const model = match?.[1]?.trim();
  const safeModel = model !== undefined && /^[A-Za-z0-9._:/-]{1,120}$/u.test(model)
    ? model
    : null;
  return {
    code: "codex-cli-upgrade-required",
    message: safeModel === null
      ? "Codex 版本过旧，无法运行当前模型。请升级当前 Codex 后再重试。"
      : `Codex 版本过旧，无法运行模型 ${safeModel}。请升级当前 Codex 后再重试。`,
  };
}

function readCodexFailureMessage(event: unknown): string | null {
  if (!isRecord(event)) {
    return null;
  }
  if (event.type === "error" && typeof event.message === "string") {
    return event.message;
  }
  if (
    event.type === "turn.failed"
    && isRecord(event.error)
    && typeof event.error.message === "string"
  ) {
    return event.error.message;
  }
  return null;
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
  if (reason === "claude-timeout") {
    return "idle";
  }
  if (reason.startsWith("idle-timeout:")) {
    return "idle";
  }
  if (reason.startsWith("tool-timeout:")) {
    return "tool";
  }

  if (reason.startsWith("max-duration-timeout:")) {
    return "max-duration";
  }

  return null;
}

export function executionTimeoutKind(result: CodexRunResult): CodexWatchdogKind | null {
  if (result.ok) return null;
  if (result.terminal?.kind === "timeout") {
    return result.terminal.basis === "max"
      ? "max-duration"
      : result.terminal.basis;
  }
  // Compatibility for injected legacy runners and pre-contract fixtures. Production
  // adapters always attach terminal and no new control flow may emit this shape.
  return result.terminal === undefined ? codexTimeoutKind(result.reason) : null;
}

export function isInterruptedCodexRunResult(
  result: CodexRunResult,
): result is Extract<CodexRunResult, { ok: false }> & {
  reason: `interrupted:${string}` | "claude-cancelled";
} {
  return !result.ok && (
    result.terminal?.kind === "interrupted"
    || (
      result.terminal === undefined
      && (result.reason.startsWith("interrupted:") || result.reason === "claude-cancelled")
    )
  );
}

export function executionInterruptionCauseForResult(
  result: Extract<CodexRunResult, { ok: false }>,
): ExecutionInterruptionCause | null {
  if (result.terminal?.kind === "interrupted") {
    return result.terminal.cause;
  }
  // Compatibility for injected legacy runners and pre-contract fixtures.
  return result.terminal === undefined && isInterruptedCodexRunResult(result)
    ? executionInterruptionCause(result.reason)
    : null;
}

function crashedTerminal(safeCode: string, partialText: string): ExecutionFailureTerminal {
  return { kind: "crashed", partialText, safeCode };
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
