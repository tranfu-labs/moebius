import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { randomUUID } from "node:crypto";
import { createWriteStream } from "node:fs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  isSupportedClaudeCliVersion,
  MINIMUM_CLAUDE_CLI_VERSION,
} from "./claude-cli-version.js";
import {
  ClaudeExecutableError,
  resolveClaudeExecutable,
} from "./claude-executable.js";
import {
  createRunWatchdogs,
  type CodexRunResult,
} from "./codex.js";
import {
  planExecutionFailureTerminal,
  type CodexRunFailure,
} from "./execution-failure-plan.js";
import {
  createClaudeToolProjectionState,
  executionInterruptionCause,
  projectClaudeToolLifecycle,
  selectClaudeExecutionProgress,
  type ExecutionInterruptionCause,
  type ExecutionProgressEvent,
} from "./execution-contract.js";
import {
  createRunSupervisorState,
  observeRunProgress,
} from "./run-supervisor.js";
import type { LocalConsoleExecutionProfile } from "./local-console/types.js";
import type { LocalExecutionMode } from "./local-console/execution-driver.js";
import type { ManagedProcessMcpInvocation } from "./local-console/execution-driver.js";

const DEFAULT_VERSION_TIMEOUT_MS = 5_000;
const DEFAULT_SIGNAL_GRACE_MS = 1_000;
const MAX_JSONL_LINE_BYTES = 1024 * 1024;
const MAX_JSONL_TOTAL_BYTES = 16 * 1024 * 1024;

export const CLAUDE_INTERNAL_AGENT_TOOLS = Object.freeze([
  "Agent",
  "Task",
  "AskUserQuestion",
  "TeamCreate",
  "TeamDelete",
  "SendMessage",
  "TaskCreate",
  "TaskGet",
  "TaskList",
  "TaskUpdate",
  "TaskOutput",
  "TaskStop",
] as const);

export interface ClaudeRunOptions {
  prompt: string;
  runDir: string;
  cwd: string;
  profile: LocalConsoleExecutionProfile & { cli: "claude" };
  mode: LocalExecutionMode;
  signal?: AbortSignal;
  idleTimeoutMs?: number;
  toolTimeoutMs?: number;
  maxDurationMs?: number;
  versionTimeoutMs?: number;
  interruptTerminationDelayMs?: number;
  interruptKillDelayMs?: number;
  executablePath?: string;
  resolveExecutable?: typeof resolveClaudeExecutable;
  runVersion?: typeof runClaudeVersion;
  spawnProcess?: typeof spawnClaudeProcess;
  extraArgs?: readonly string[];
  permissionMode?: "auto" | "dontAsk";
  expectedInitTools?: readonly string[];
  onVisibleAgentMarkdown?: (text: string) => void;
  onProcessStarted?: () => void | Promise<void>;
  onStructuredActivity?: (event: unknown) => void;
  onExecutionProgress?: (event: ExecutionProgressEvent) => void;
  onSessionStarted?: (sessionId: string) => void | Promise<void>;
  mcpServer?: ManagedProcessMcpInvocation | null;
}

export async function runClaude(options: ClaudeRunOptions): Promise<CodexRunResult> {
  const runDir = path.resolve(options.runDir);
  const stdoutPath = path.join(runDir, "claude-stream.jsonl");
  const stderrPath = path.join(runDir, "claude-stderr.log");
  if (options.signal?.aborted === true) {
    return failed(
      "claude-cancelled",
      "Claude 执行已取消。",
      runDir,
      stdoutPath,
      stderrPath,
      undefined,
      undefined,
      "",
      executionInterruptionCause(options.signal?.reason),
    );
  }

  let executable: string;
  try {
    executable = options.executablePath ?? await (options.resolveExecutable ?? resolveClaudeExecutable)({
      pathValue: process.env.PATH,
      cwd: options.cwd,
      homeDir: os.homedir(),
    });
  } catch (error) {
    if (error instanceof ClaudeExecutableError) {
      return failed(error.code, error.safeMessage, runDir, stdoutPath, stderrPath);
    }
    return failed(
      "claude-cli-spawn-failed",
      "暂时无法启动 Claude Code。",
      runDir,
      stdoutPath,
      stderrPath,
    );
  }

  try {
    const version = await (options.runVersion ?? runClaudeVersion)(
      executable,
      options.versionTimeoutMs ?? DEFAULT_VERSION_TIMEOUT_MS,
      options.signal,
    );
    if (!isSupportedClaudeCliVersion(version)) {
      return failed(
        "claude-cli-unsupported-version",
        `Claude Code 版本过旧，需要 ${MINIMUM_CLAUDE_CLI_VERSION} 或更高版本。`,
        runDir,
        stdoutPath,
        stderrPath,
        "update-claude",
      );
    }
  } catch (error) {
    if (isSignalAborted(options.signal)) {
      return failed(
        "claude-cancelled",
        "Claude 执行已取消。",
        runDir,
        stdoutPath,
        stderrPath,
        undefined,
        undefined,
        "",
        executionInterruptionCause(options.signal?.reason),
      );
    }
    return failed(
      "claude-cli-spawn-failed",
      error instanceof ClaudeVersionError ? error.safeMessage : "暂时无法检查 Claude Code 版本。",
      runDir,
      stdoutPath,
      stderrPath,
    );
  }

  if (isSignalAborted(options.signal)) {
    return failed(
      "claude-cancelled",
      "Claude 执行已取消。",
      runDir,
      stdoutPath,
      stderrPath,
      undefined,
      undefined,
      "",
      executionInterruptionCause(options.signal?.reason),
    );
  }

  await fs.mkdir(path.join(runDir, "input-attachments"), { recursive: true });
  const mcpServer = options.mcpServer;
  const mcpConfigPath = mcpServer === null || mcpServer === undefined
    ? null
    : path.join(runDir, "managed-process-mcp.json");
  if (mcpConfigPath !== null && mcpServer !== null && mcpServer !== undefined) {
    await fs.writeFile(mcpConfigPath, JSON.stringify({
      mcpServers: {
        moebius_managed: {
          type: "stdio",
          command: mcpServer.command,
          args: mcpServer.args,
          env: mcpServer.env,
        },
      },
    }), { mode: 0o600 });
  }
  const sessionId = options.mode.kind === "resume"
    ? options.mode.externalSessionId
    : randomUUID();
  const args = buildClaudeArgs({
    ...options,
    extraArgs: [
      ...(mcpConfigPath === null ? [] : ["--mcp-config", mcpConfigPath]),
      ...(options.extraArgs ?? []),
    ],
  }, sessionId);
  const env = buildClaudeEnvironment(process.env);
  const stdoutFile = createWriteStream(stdoutPath, { flags: "a" });
  const stderrFile = createWriteStream(stderrPath, { flags: "a" });
  let child: ChildProcessWithoutNullStreams;
  try {
    child = (options.spawnProcess ?? spawnClaudeProcess)(executable, args, {
      cwd: options.cwd,
      env,
    });
  } catch {
    if (mcpConfigPath !== null) await fs.unlink(mcpConfigPath).catch(() => undefined);
    await Promise.all([finishWritable(stdoutFile), finishWritable(stderrFile)]);
    return failed(
      "claude-cli-spawn-failed",
      "Claude Code 启动失败，请检查安装后重试。",
      runDir,
      stdoutPath,
      stderrPath,
    );
  }

  child.stdout.pipe(stdoutFile, { end: false });
  child.stderr.pipe(stderrFile, { end: false });
  child.stdin.end();
  try {
    return await runClaudeProcess({
      ...options,
      child,
      sessionId,
      args,
      runDir,
      stdoutPath,
      stderrPath,
      stdoutFile,
      stderrFile,
    });
  } finally {
    if (mcpConfigPath !== null) await fs.unlink(mcpConfigPath).catch(() => undefined);
  }
}

export function buildClaudeArgs(
  options: Pick<ClaudeRunOptions, "prompt" | "runDir" | "profile" | "mode" | "extraArgs" | "permissionMode">,
  sessionId: string,
): string[] {
  const args = [
    "-p",
    "--output-format", "stream-json",
    "--verbose",
    "--include-partial-messages",
    ...(options.mode.kind === "resume"
      ? ["--resume", sessionId]
      : ["--session-id", sessionId]),
    "--model", options.profile.model,
    "--effort", options.profile.effort,
    "--permission-mode", options.permissionMode ?? "auto",
    "--disallowedTools", CLAUDE_INTERNAL_AGENT_TOOLS.join(","),
    "--add-dir", path.resolve(options.runDir, "input-attachments"),
    ...(options.extraArgs ?? []),
    "--",
    options.prompt,
  ];
  return args;
}

export function buildClaudeEnvironment(base: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const env = { ...base };
  delete env.CLAUDE_CODE_EFFORT_LEVEL;
  delete env.CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS;
  delete env.CLAUDE_AUTO_BACKGROUND_TASKS;
  delete env.CLAUDE_CODE_FORWARD_SUBAGENT_TEXT;
  env.CLAUDE_CODE_DISABLE_BACKGROUND_TASKS = "1";
  return env;
}

export async function runClaudeVersion(
  executablePath: string,
  timeoutMs: number,
  signal?: AbortSignal,
): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(executablePath, ["--version"], {
      stdio: ["ignore", "pipe", "pipe"],
      shell: false,
      env: process.env,
    });
    let stdout = "";
    let settled = false;
    const finish = (error?: Error): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener("abort", abort);
      if (error !== undefined) reject(error);
      else resolve(stdout.trim());
    };
    const abort = (): void => {
      child.kill("SIGKILL");
      finish(new ClaudeVersionError("Claude Code 版本检查已取消。"));
    };
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      finish(new ClaudeVersionError("Claude Code 版本检查超时。"));
    }, timeoutMs);
    signal?.addEventListener("abort", abort, { once: true });
    child.stdout.on("data", (chunk: Buffer) => {
      if (stdout.length < 4_096) stdout += chunk.toString("utf8");
    });
    child.on("error", () => finish(new ClaudeVersionError("暂时无法检查 Claude Code 版本。")));
    child.on("close", (code) => {
      if (code !== 0 || stdout.trim().length === 0) {
        finish(new ClaudeVersionError("Claude Code 没有返回有效版本。"));
        return;
      }
      finish();
    });
  });
}

function spawnClaudeProcess(
  executablePath: string,
  args: readonly string[],
  options: { cwd: string; env: NodeJS.ProcessEnv },
): ChildProcessWithoutNullStreams {
  return spawn(executablePath, [...args], {
    cwd: options.cwd,
    env: options.env,
    stdio: ["pipe", "pipe", "pipe"],
    shell: false,
  });
}

async function runClaudeProcess(
  options: ClaudeRunOptions & {
    child: ChildProcessWithoutNullStreams;
    sessionId: string;
    args: readonly string[];
    stdoutPath: string;
    stderrPath: string;
    stdoutFile: ReturnType<typeof createWriteStream>;
    stderrFile: ReturnType<typeof createWriteStream>;
  },
): Promise<CodexRunResult> {
  const {
    child,
    sessionId,
    runDir,
    stdoutPath,
    stderrPath,
    stdoutFile,
    stderrFile,
  } = options;
  let finalText = "";
  let initObserved = false;
  let sessionReady = false;
  let resultObserved = false;
  const pendingSessionEvents: unknown[] = [];
  let protocolFailure: CodexRunFailure | null = null;
  let classifiedFailure: CodexRunFailure | null = null;
  let callbackFailure = false;
  let sessionCallback = Promise.resolve();
  let processCallback = Promise.resolve();
  let abortReason: "cancelled" | "idle" | "tool" | "max-duration" | null = null;
  let terminating = false;
  let terminationTimer: NodeJS.Timeout | null = null;
  let killTimer: NodeJS.Timeout | null = null;
  let forceTimer: NodeJS.Timeout | null = null;
  let totalBytes = 0;
  let pending: Buffer<ArrayBufferLike> = Buffer.alloc(0);
  let droppingOversized = false;
  let progressSequence = 0;
  let progressSupervisor = createRunSupervisorState(Date.now());
  let toolProjection = createClaudeToolProjectionState();
  const terminationDelayMs = options.interruptTerminationDelayMs ?? DEFAULT_SIGNAL_GRACE_MS;
  const killDelayMs = options.interruptKillDelayMs ?? DEFAULT_SIGNAL_GRACE_MS;

  type Exit = { code: number | null; signal: NodeJS.Signals | null } | { error: true } | { forced: true };
  let resolveExit: (exit: Exit) => void = () => {};
  const exitPromise = new Promise<Exit>((resolve) => {
    resolveExit = resolve;
  });
  child.once("error", () => resolveExit({ error: true }));
  child.once("close", (code, signal) => resolveExit({ code, signal }));
  child.once("spawn", () => {
    try {
      processCallback = Promise.resolve(options.onProcessStarted?.()).catch(() => undefined);
    } catch {
      processCallback = Promise.resolve();
    }
  });

  const beginTermination = (): void => {
    if (terminating) return;
    terminating = true;
    child.kill("SIGINT");
    terminationTimer = setTimeout(() => {
      child.kill("SIGTERM");
      killTimer = setTimeout(() => {
        child.kill("SIGKILL");
        forceTimer = setTimeout(() => {
          child.stdout.destroy();
          child.stderr.destroy();
          resolveExit({ forced: true });
        }, killDelayMs);
        forceTimer.unref();
      }, killDelayMs);
      killTimer.unref();
    }, terminationDelayMs);
    terminationTimer.unref();
  };
  const failProtocol = (message: string): void => {
    if (protocolFailure !== null) return;
    protocolFailure = {
      code: "claude-protocol-invalid",
      message,
    };
    beginTermination();
  };
  const handleEvent = (event: unknown): void => {
    const sequence = ++progressSequence;
    const toolLifecycle = projectClaudeToolLifecycle(event, sequence, toolProjection);
    toolProjection = toolLifecycle.state;
    const progress = selectClaudeExecutionProgress(toolLifecycle.progress, event, sequence);
    if (progress !== null) {
      const supervision = observeRunProgress(progressSupervisor, progress, Date.now());
      progressSupervisor = supervision.state;
      if (supervision.kind === "progress-observed") {
        watchdogs.setToolInFlight(progressSupervisor.activeToolIds.size > 0);
        if (progressSupervisor.activeToolIds.size === 0) watchdogs.recordActivity();
      }
      try {
        options.onExecutionProgress?.(progress);
      } catch {
        // Supervision callbacks are observational and cannot control protocol state.
      }
    }
    try {
      options.onStructuredActivity?.(event);
    } catch {
      // Renderer-facing activity is observational and cannot control protocol state.
    }
    if (!isRecord(event)) {
      failProtocol("Claude Code 返回了无法识别的协议事件。");
      return;
    }
    if (event.type === "system" && event.subtype === "init") {
      if (typeof event.session_id !== "string" || event.session_id !== sessionId) {
        failProtocol("Claude Code 返回了不匹配的 session id。");
        return;
      }
      if (initObserved) {
        return;
      }
      if (
        !Array.isArray(event.tools)
        || event.tools.some((tool) => typeof tool !== "string")
      ) {
        failProtocol("Claude Code 没有返回可验证的工具清单。");
        return;
      }
      const tools = event.tools as string[];
      if (tools.some((tool) => CLAUDE_INTERNAL_AGENT_TOOLS.includes(
        tool as (typeof CLAUDE_INTERNAL_AGENT_TOOLS)[number],
      ))) {
        failProtocol("Claude Code 未遵守内部 Agent 工具禁用策略。");
        return;
      }
      if (
        options.expectedInitTools !== undefined
        && (
          tools.length !== options.expectedInitTools.length
          || new Set(tools).size !== tools.length
          || tools.some((tool) => !options.expectedInitTools!.includes(tool))
          || options.expectedInitTools.some((tool) => !tools.includes(tool))
        )
      ) {
        failProtocol("Claude Code 未遵守受限工具策略。");
        return;
      }
      initObserved = true;
      try {
        sessionCallback = Promise.resolve(options.onSessionStarted?.(sessionId))
          .then(() => {
            sessionReady = true;
            for (const pendingEvent of pendingSessionEvents.splice(0)) {
              handleEvent(pendingEvent);
            }
          })
          .catch(() => {
            callbackFailure = true;
            pendingSessionEvents.length = 0;
            beginTermination();
          });
      } catch {
        callbackFailure = true;
        beginTermination();
      }
      return;
    }
    if (event.type === "stream_event") {
      if (!initObserved) {
        failProtocol("Claude Code 在 session 初始化前返回了内容。");
        return;
      }
      const streamSessionPending = !sessionReady;
      if (streamSessionPending) {
        pendingSessionEvents.push(event);
        return;
      }
      if (event.parent_tool_use_id != null) return;
      const nested = isRecord(event.event) ? event.event : null;
      const delta = nested !== null && isRecord(nested.delta) ? nested.delta : null;
      if (
        nested?.type === "content_block_delta"
        && delta?.type === "text_delta"
        && typeof delta.text === "string"
      ) {
        finalText += delta.text;
        try {
          options.onVisibleAgentMarkdown?.(finalText);
        } catch {
          // Persistence remains authoritative even if an observer is unavailable.
        }
      }
      return;
    }
    if (event.type === "result") {
      if (!initObserved) {
        failProtocol("Claude Code 在 session 初始化前结束。");
        return;
      }
      const resultSessionPending = !sessionReady;
      if (resultSessionPending) {
        pendingSessionEvents.push(event);
        return;
      }
      if (
        event.session_id !== undefined
        && event.session_id !== sessionId
      ) {
        failProtocol("Claude Code 返回了不匹配的 terminal session id。");
        return;
      }
      resultObserved = true;
      classifiedFailure = classifyClaudeResult(event);
      if (
        classifiedFailure === null
        && finalText.length === 0
        && typeof event.result === "string"
      ) {
        finalText = event.result;
        try {
          options.onVisibleAgentMarkdown?.(finalText);
        } catch {
          // Persistence remains authoritative even if an observer is unavailable.
        }
      }
    }
  };
  const handleChunk = (chunk: Buffer): void => {
    totalBytes += chunk.byteLength;
    if (totalBytes > MAX_JSONL_TOTAL_BYTES) {
      failProtocol("Claude Code 协议输出超过安全上限。");
      return;
    }
    let incoming = chunk;
    if (droppingOversized) {
      const newline = incoming.indexOf(0x0a);
      if (newline < 0) return;
      droppingOversized = false;
      incoming = incoming.subarray(newline + 1);
    }
    let buffered = pending.length === 0 ? incoming : Buffer.concat([pending, incoming]);
    pending = Buffer.alloc(0);
    while (buffered.length > 0) {
      const newline = buffered.indexOf(0x0a);
      if (newline < 0) {
        if (buffered.length > MAX_JSONL_LINE_BYTES) {
          droppingOversized = true;
          failProtocol("Claude Code 协议单行超过安全上限。");
        } else {
          pending = buffered;
        }
        return;
      }
      const line = buffered.subarray(0, newline);
      buffered = buffered.subarray(newline + 1);
      if (line.length === 0) continue;
      if (line.length > MAX_JSONL_LINE_BYTES) {
        failProtocol("Claude Code 协议单行超过安全上限。");
        return;
      }
      try {
        handleEvent(JSON.parse(line.toString("utf8")));
      } catch {
        failProtocol("Claude Code 返回了损坏的协议数据。");
        return;
      }
    }
  };

  const handleAbort = (): void => {
    abortReason = "cancelled";
    beginTermination();
  };
  options.signal?.addEventListener("abort", handleAbort, { once: true });
  const watchdogs = createRunWatchdogs({
    ...(options.idleTimeoutMs === undefined ? {} : { idleTimeoutMs: options.idleTimeoutMs }),
    ...(options.toolTimeoutMs === undefined ? {} : { toolTimeoutMs: options.toolTimeoutMs }),
    ...(options.maxDurationMs === undefined ? {} : { maxDurationMs: options.maxDurationMs }),
    onTimeout: (kind) => {
      if (abortReason !== null) return;
      abortReason = kind;
      beginTermination();
    },
  });
  child.stdout.on("data", handleChunk);
  const exit = await exitPromise;
  watchdogs.clear();
  child.stdout.removeListener("data", handleChunk);
  await Promise.all([sessionCallback, processCallback]);
  options.signal?.removeEventListener("abort", handleAbort);
  if (terminationTimer !== null) clearTimeout(terminationTimer);
  if (killTimer !== null) clearTimeout(killTimer);
  if (forceTimer !== null) clearTimeout(forceTimer);
  await Promise.all([finishWritable(stdoutFile), finishWritable(stderrFile)]);

  if (abortReason === "cancelled") {
    return failed(
      "claude-cancelled",
      "Claude 执行已取消。",
      runDir,
      stdoutPath,
      stderrPath,
      undefined,
      undefined,
      finalText,
      executionInterruptionCause(options.signal?.reason),
    );
  }
  if (abortReason === "idle" || abortReason === "tool" || abortReason === "max-duration") {
    const result = failed(
      "claude-timeout",
      abortReason === "tool"
        ? "Claude 的工具调用运行过久，已停止本次执行。"
        : "Claude 执行超时，请重试。",
      runDir,
      stdoutPath,
      stderrPath,
      undefined,
      undefined,
      finalText,
    );
    if (!result.ok) {
      result.terminal = {
        kind: "timeout",
        basis: abortReason === "max-duration" ? "max" : abortReason,
        partialText: finalText,
      };
    }
    return result;
  }
  const terminalProtocolFailure = protocolFailure as CodexRunFailure | null;
  if (terminalProtocolFailure !== null) {
    return {
      ok: false,
      reason: terminalProtocolFailure.code,
      failure: terminalProtocolFailure,
      terminal: planExecutionFailureTerminal(terminalProtocolFailure, finalText),
      ...(initObserved ? { threadId: sessionId } : {}),
      runDir,
      stdoutPath,
      stderrPath,
    };
  }
  if (callbackFailure) {
    return failed(
      "claude-protocol-invalid",
      "Claude session 无法安全持久化。",
      runDir,
      stdoutPath,
      stderrPath,
      undefined,
      initObserved ? sessionId : undefined,
    );
  }
  if ("error" in exit) {
    return failed(
      "claude-cli-spawn-failed",
      "Claude Code 启动失败，请检查安装后重试。",
      runDir,
      stdoutPath,
      stderrPath,
    );
  }
  const terminalClassifiedFailure = classifiedFailure as CodexRunFailure | null;
  if (terminalClassifiedFailure !== null) {
    return {
      ok: false,
      reason: terminalClassifiedFailure.code,
      failure: terminalClassifiedFailure,
      terminal: planExecutionFailureTerminal(terminalClassifiedFailure, finalText),
      ...(initObserved ? { threadId: sessionId } : {}),
      runDir,
      stdoutPath,
      stderrPath,
    };
  }
  if (!initObserved || !resultObserved || "forced" in exit || exit.code !== 0) {
    return failed(
      options.mode.kind === "resume"
        ? "claude-resume-unavailable"
        : "claude-protocol-invalid",
      options.mode.kind === "resume"
        ? "原 Claude 执行已经无法继续。"
        : "Claude Code 未能完成本次执行。",
      runDir,
      stdoutPath,
      stderrPath,
      undefined,
      initObserved ? sessionId : undefined,
    );
  }
  if (finalText.trim().length === 0) {
    return failed(
      "claude-protocol-invalid",
      "Claude Code 没有返回可显示的回答。",
      runDir,
      stdoutPath,
      stderrPath,
      undefined,
      sessionId,
    );
  }
  return {
    ok: true,
    finalText,
    threadId: sessionId,
    cachedInputTokens: null,
    terminal: {
      kind: "completed",
      externalSessionId: sessionId,
      finalText,
    },
    runDir,
    stdoutPath,
    stderrPath,
  };
}

export function classifyClaudeResult(event: Record<string, unknown>): CodexRunFailure | null {
  if (event.is_error !== true && event.subtype !== "error") {
    return null;
  }
  const codes = collectClaudeMachineCodes(event).join(" ");
  if (/auth|login|unauthenticated/iu.test(codes)) {
    return { code: "claude-auth-required", message: "Claude Code 尚未登录。" };
  }
  if (/rate.?limit|too_many_requests/iu.test(codes)) {
    return { code: "claude-rate-limited", message: "Claude 服务当前触发了速率限制，请稍后重试。" };
  }
  if (/billing|credit|payment/iu.test(codes)) {
    return { code: "claude-billing-unavailable", message: "Claude 账户当前无法使用推理额度。" };
  }
  if (/model|effort/iu.test(codes)) {
    return { code: "claude-profile-invalid", message: "保存的 Claude 模型或思考程度当前不可用。" };
  }
  if (/permission|tool/iu.test(codes)) {
    return { code: "claude-permission-denied", message: "Claude Code 拒绝了当前权限或工具策略。" };
  }
  if (/resume|session/iu.test(codes)) {
    return { code: "claude-resume-unavailable", message: "原 Claude 执行已经无法继续。" };
  }
  if (/service|overload|unavailable/iu.test(codes)) {
    return { code: "claude-service-unavailable", message: "Claude 服务暂时不可用，请稍后重试。" };
  }
  return { code: "claude-service-unavailable", message: "Claude Code 本次执行失败，请稍后重试。" };
}

function collectClaudeMachineCodes(event: Record<string, unknown>): string[] {
  const codes: string[] = [];
  for (const value of [event.subtype, event.code, event.stop_reason]) {
    if (typeof value === "string") codes.push(value);
  }
  if (isRecord(event.error)) {
    for (const value of [event.error.code, event.error.type]) {
      if (typeof value === "string") codes.push(value);
    }
  }
  if (Array.isArray(event.errors)) {
    for (const error of event.errors) {
      if (!isRecord(error)) continue;
      for (const value of [error.code, error.type]) {
        if (typeof value === "string") codes.push(value);
      }
    }
  }
  return codes;
}

function failed(
  code: CodexRunFailure["code"],
  message: string,
  runDir: string,
  stdoutPath: string,
  stderrPath: string,
  action?: CodexRunFailure["action"],
  threadId?: string,
  partialText = "",
  interruptionCause?: ExecutionInterruptionCause,
): CodexRunResult {
  const failure: CodexRunFailure = {
    code,
    message,
    ...(action === undefined ? {} : { action }),
  };
  return {
    ok: false,
    reason: code,
    failure,
    terminal: interruptionCause === undefined
      ? planExecutionFailureTerminal(failure, partialText)
      : {
          kind: "interrupted",
          actor: interruptionCause === "user" ? "user" : "system",
          cause: interruptionCause,
          partialText,
        },
    ...(threadId === undefined ? {} : { threadId }),
    runDir,
    stdoutPath,
    stderrPath,
  };
}

async function finishWritable(stream: ReturnType<typeof createWriteStream>): Promise<void> {
  if (stream.closed) return;
  await new Promise<void>((resolve) => {
    stream.once("close", resolve);
    stream.end();
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isSignalAborted(signal: AbortSignal | undefined): boolean {
  return signal?.aborted === true;
}

export class ClaudeVersionError extends Error {
  constructor(readonly safeMessage: string) {
    super(safeMessage);
    this.name = "ClaudeVersionError";
  }
}
