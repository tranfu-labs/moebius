import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { createWriteStream } from "node:fs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  DATA_ROOT,
  KIMI_CLI_SPAWN_TIMEOUT_MS,
  LOCAL_PROVIDER_BUSY_TIMEOUT_MS,
  KIMI_MANAGED_TOOL_SETTLE_TIMEOUT_MS,
} from "./config.js";
import {
  type CodexRunResult,
} from "./codex.js";
import {
  planExecutionFailureTerminal,
  type CodexRunFailure,
} from "./execution-failure-plan.js";
import {
  createProviderToolProjectionState,
  projectKimiToolLifecycle,
  selectKimiExecutionProgress,
  executionInterruptionActor,
  executionInterruptionCause,
  type ExecutionProgressEvent,
} from "./execution-contract.js";
import {
  createRunSupervisorState,
  observeRunProgress,
} from "./run-supervisor.js";
import {
  KimiExecutableError,
  resolveKimiExecutable,
} from "./kimi-executable.js";
import {
  MANAGED_PROCESS_TOOL_NAMES,
  MOEBIUS_MANAGED_MCP_SERVER_NAME,
} from "./local-console/managed-process-tools.js";
import {
  KimiRuntimeIsolationError,
  prepareKimiRuntimeHome,
  resolveKimiRuntimeHomePaths,
  type KimiRuntimeHomePaths,
  withManagedKimiHome,
} from "./kimi-runtime-home.js";
import type {
  LocalConsoleExecutionProfile,
} from "./local-console/types.js";
import type { LocalExecutionMode } from "./local-console/execution-driver.js";
import type { ManagedProcessMcpInvocation } from "./local-console/execution-driver.js";

const ACP_PROTOCOL_VERSION = 1;
const MAX_ACP_LINE_BYTES = 4 * 1024 * 1024;
const DEFAULT_SIGNAL_GRACE_MS = 1_000;
const KIMI_SPAWN_FAILED_MESSAGE = "Kimi CLI 启动失败。请确认安装完整后重试。";
const KIMI_EXITED_MESSAGE =
  "Kimi CLI 启动后提前退出。请先在终端运行 Kimi 检查登录或配置，然后重试。";
const KIMI_TIMEOUT_MESSAGE = "Kimi CLI 启动后没有及时响应。请检查 Kimi 状态后重试。";
const KIMI_EMPTY_RESPONSE_MESSAGE =
  "Kimi 没有返回可用回复。请在终端直接运行 kimi 查看详细错误，然后重试。";

export interface KimiAcpRunOptions {
  prompt: string;
  runDir: string;
  cwd: string;
  profile: LocalConsoleExecutionProfile & { cli: "kimi" };
  mode: LocalExecutionMode;
  signal?: AbortSignal;
  imagePaths?: string[];
  idleTimeoutMs?: number;
  toolTimeoutMs?: number;
  maxDurationMs?: number;
  runtimeHomePaths?: KimiRuntimeHomePaths;
  workspaceAccess?: "read-write" | "read-only";
  permissionMode?: string;
  onVisibleAgentMarkdown?: (text: string) => void;
  onProcessStarted?: () => void | Promise<void>;
  onStructuredActivity?: (event: unknown) => void;
  onExecutionProgress?: (event: ExecutionProgressEvent) => void;
  onSessionStarted?: (sessionId: string) => void | Promise<void>;
  onExecutionTraceReady?: (sessionId: string) => void | Promise<void>;
  transportFactory?: (input: {
    cwd: string;
    readRoots: string[];
    stdoutPath: string;
    stderrPath: string;
    env: NodeJS.ProcessEnv;
    allowWrites: boolean;
  }) => Promise<KimiAcpTransport>;
  mcpServer?: ManagedProcessMcpInvocation | null;
}

export interface KimiAcpTransport {
  request(method: string, params: unknown): Promise<unknown>;
  notify(method: string, params: unknown): void;
  waitForConfigUpdate(
    sessionId: string,
    optionId: string,
    expectedValue: string,
    timeoutMs: number,
  ): Promise<KimiConfigUpdateConfirmation | null>;
  onSessionUpdate(listener: (update: unknown) => void): () => void;
  close(): Promise<void>;
  interrupt(): void;
  terminate(): void;
  kill(): void;
}

interface KimiConfigUpdateConfirmation {
  configOptions: readonly unknown[] | null;
}

export async function runKimiAcp(options: KimiAcpRunOptions): Promise<CodexRunResult> {
  const runDir = path.resolve(options.runDir);
  await fs.mkdir(runDir, { recursive: true });
  const stdoutPath = path.join(runDir, "kimi-acp.jsonl");
  const stderrPath = path.join(runDir, "kimi-stderr.log");
  let transport: KimiAcpTransport | null = null;
  try {
    const runtimeHomes = options.runtimeHomePaths ?? resolveKimiRuntimeHomePaths({
      dataRoot: DATA_ROOT,
      env: process.env,
    });
    await prepareKimiRuntimeHome(runtimeHomes);
    transport = await (options.transportFactory ?? createKimiProcessTransport)({
      cwd: options.cwd,
      readRoots: [options.cwd, path.join(runDir, "input-attachments")],
      stdoutPath,
      stderrPath,
      env: {
        ...withManagedKimiHome(process.env, runtimeHomes.managedHome),
      },
      allowWrites: options.workspaceAccess !== "read-only",
    });
    await options.onProcessStarted?.();
    return await runKimiAcpWithTransport(transport, {
      ...options,
      runDir,
      stdoutPath,
      stderrPath,
    });
  } catch (error) {
    await appendKimiFailureDiagnostic(stderrPath, error).catch(() => undefined);
    const failure = classifyKimiFailure(error);
    const partialText = readKimiPartialText(error);
    const terminal = failure === null
      ? { kind: "crashed" as const, partialText, safeCode: "kimi-unknown" }
      : planExecutionFailureTerminal(failure, partialText);
    if (
      terminal.kind === "timeout"
      && error instanceof KimiAcpError
      && (
        error.diagnostics?.timeoutBasis === "max"
        || error.diagnostics?.timeoutBasis === "tool"
      )
    ) {
      terminal.basis = error.diagnostics.timeoutBasis;
    }
    if (
      terminal.kind === "interrupted"
      && error instanceof KimiAcpError
    ) {
      if (
        error.diagnostics?.interruptionActor === "user"
        || error.diagnostics?.interruptionActor === "system"
      ) {
        terminal.actor = error.diagnostics.interruptionActor;
      }
      if (
        error.diagnostics?.interruptionCause === "user"
        || error.diagnostics?.interruptionCause === "runtime-closing"
        || error.diagnostics?.interruptionCause === "redirect"
        || error.diagnostics?.interruptionCause === "context-unavailable"
        || error.diagnostics?.interruptionCause === "system"
      ) {
        terminal.cause = error.diagnostics.interruptionCause;
      }
    }
    return {
      ok: false,
      reason: failure?.code ?? safeKimiError(error),
      ...(failure === null ? {} : { failure }),
      terminal,
      runDir,
      stdoutPath,
      stderrPath,
    };
  } finally {
    await transport?.close().catch(() => undefined);
  }
}

export async function runKimiAcpWithTransport(
  transport: KimiAcpTransport,
  options: KimiAcpRunOptions & {
    stdoutPath?: string;
    stderrPath?: string;
  },
): Promise<CodexRunResult> {
  const runDir = path.resolve(options.runDir);
  const stdoutPath = options.stdoutPath ?? path.join(runDir, "kimi-acp.jsonl");
  const stderrPath = options.stderrPath ?? path.join(runDir, "kimi-stderr.log");
  let finalText = "";
  let progressSequence = 0;
  let progressSupervisor = createRunSupervisorState(Date.now());
  let toolProjection = createProviderToolProjectionState();
  const managedToolCallIds = new Set<string>();
  const terminalEvidence: KimiTerminalEvidence = {
    hasVisibleText: false,
    terminalToolCallIds: new Set(),
  };
  let settled = false;
  let sessionId: string | null = null;
  let traceReadyQueued = false;
  let traceReadyError: unknown = null;
  let traceReadyTail = Promise.resolve();
  let stopLifecycle!: (error: Error) => void;
  const lifecycleStopped = new Promise<never>((_resolve, reject) => {
    stopLifecycle = reject;
  });
  let escalationStarted = false;
  let escalationCompletion: Promise<void> | null = null;
  let interruptGraceTimer: NodeJS.Timeout | null = null;
  let terminateGraceTimer: NodeJS.Timeout | null = null;
  const raceLifecycle = async <T>(operation: Promise<T>): Promise<T> =>
    Promise.race([operation, lifecycleStopped]);
  const cancelAndEscalate = (
    reason: "abort" | "idle" | "tool" | "max-duration" | "provider-busy" | "managed-tool-settle",
  ): void => {
    if (settled || escalationStarted) return;
    escalationStarted = true;
    if (sessionId !== null) {
      try {
        transport.notify("session/cancel", { sessionId });
      } catch {
        // Process escalation below remains authoritative.
      }
    }
    try {
      transport.interrupt();
    } catch {
      // Continue the bounded escalation even if a signal cannot be sent.
    }
    escalationCompletion = new Promise((resolve) => {
      interruptGraceTimer = setTimeout(() => {
        try {
          transport.terminate();
        } catch {
          // Continue to the final bounded kill.
        }
        terminateGraceTimer = setTimeout(() => {
          try {
            transport.kill();
          } catch {
            // The lifecycle still settles after the bounded final attempt.
          }
          resolve();
        }, DEFAULT_SIGNAL_GRACE_MS);
      }, DEFAULT_SIGNAL_GRACE_MS);
    });
    stopLifecycle(
      reason === "abort"
        ? new KimiAcpError(
            "KIMI_ACP_INTERRUPTED",
            "Kimi 执行已中止。",
            {
              interruptionActor: executionInterruptionActor(options.signal?.reason),
              interruptionCause: executionInterruptionCause(options.signal?.reason),
            },
          )
        : reason === "provider-busy"
          ? new KimiAcpError(
              "KIMI_ACP_BUSY_TIMEOUT",
              "Kimi 服务持续繁忙，已停止本次运行。",
            )
          : new KimiAcpError(
              "KIMI_ACP_TIMEOUT",
              reason === "tool"
                ? "Kimi 的工具调用运行过久，已停止本次执行。"
                : reason === "managed-tool-settle"
                  ? "Kimi 的托管进程工具已完成，但本轮没有正常结束。"
                : KIMI_TIMEOUT_MESSAGE,
              {
                timeoutBasis: reason === "max-duration"
                  ? "max"
                  : reason === "tool"
                    ? "tool"
                    : "idle",
              },
            ),
    );
  };
  let idleTimer: NodeJS.Timeout | null = null;
  let toolTimer: NodeJS.Timeout | null = null;
  let maxTimer: NodeJS.Timeout | null = null;
  let busyTimer: NodeJS.Timeout | null = null;
  let managedSettleTimer: NodeJS.Timeout | null = null;
  let managedSettlementActive = false;
  const armManagedSettle = (): void => {
    if (!managedSettlementActive || settled || escalationStarted) return;
    if (managedSettleTimer !== null) clearTimeout(managedSettleTimer);
    managedSettleTimer = setTimeout(
      () => cancelAndEscalate("managed-tool-settle"),
      KIMI_MANAGED_TOOL_SETTLE_TIMEOUT_MS,
    );
  };
  const clearManagedSettleTimer = (): void => {
    if (managedSettleTimer === null) return;
    clearTimeout(managedSettleTimer);
    managedSettleTimer = null;
  };
  const clearManagedCompletion = options.mcpServer?.onToolCompletion?.(() => {
    managedSettlementActive = true;
    armManagedSettle();
  }) ?? (() => undefined);
  const clearIdle = (): void => {
    if (idleTimer === null) return;
    clearTimeout(idleTimer);
    idleTimer = null;
  };
  const resetIdle = (): void => {
    if (options.idleTimeoutMs === undefined || settled || escalationStarted) return;
    clearIdle();
    idleTimer = setTimeout(
      () => cancelAndEscalate("idle"),
      options.idleTimeoutMs,
    );
  };
  const setToolInFlight = (inFlight: boolean): void => {
    if (settled || escalationStarted) return;
    if (inFlight) {
      clearIdle();
      if (toolTimer === null && options.toolTimeoutMs !== undefined) {
        toolTimer = setTimeout(
          () => cancelAndEscalate("tool"),
          options.toolTimeoutMs,
        );
      }
      return;
    }
    if (toolTimer !== null) {
      clearTimeout(toolTimer);
      toolTimer = null;
    }
    resetIdle();
  };
  const queueExecutionTraceReady = (): void => {
    if (traceReadyQueued || !hasKimiTerminalEvidence(terminalEvidence)) return;
    traceReadyQueued = true;
    traceReadyTail = traceReadyTail
      .then(async () => {
        if (sessionId === null) {
          throw new Error("kimi-execution-trace-ready-before-session");
        }
        await options.onExecutionTraceReady?.(sessionId);
      })
      .catch((error: unknown) => {
        traceReadyError = error;
      });
  };
  const clearUpdate = transport.onSessionUpdate((update) => {
    const managedUpdate = readKimiManagedToolUpdate(update);
    if (managedUpdate?.managed === true) managedToolCallIds.add(managedUpdate.toolCallId);
    if (managedUpdate?.completed === true && managedToolCallIds.has(managedUpdate.toolCallId)) {
      managedSettlementActive = true;
      armManagedSettle();
    } else if (managedSettlementActive) {
      const toolActivity = readKimiToolActivity(update);
      if (toolActivity === "in-flight") {
        clearManagedSettleTimer();
      } else if (toolActivity === "settled" || isKimiSemanticPostToolProgress(update)) {
        armManagedSettle();
      }
    }
    options.onStructuredActivity?.(update);
    const sequence = ++progressSequence;
    const toolLifecycle = projectKimiToolLifecycle(update, sequence, toolProjection);
    toolProjection = toolLifecycle.state;
    const progress = selectKimiExecutionProgress(toolLifecycle.progress, update, sequence);
    if (progress !== null) {
      const supervision = observeRunProgress(progressSupervisor, progress, Date.now());
      progressSupervisor = supervision.state;
      if (supervision.kind === "progress-observed") {
        setToolInFlight(progressSupervisor.activeToolIds.size > 0);
        if (busyTimer !== null) {
          clearTimeout(busyTimer);
          busyTimer = null;
        }
      } else if (supervision.kind === "busy-retry-observed" && busyTimer === null) {
        // Once the provider explicitly reports a busy phase, its dedicated
        // bounded gate is more informative than the generic idle watchdog.
        clearIdle();
        busyTimer = setTimeout(
          () => cancelAndEscalate("provider-busy"),
          LOCAL_PROVIDER_BUSY_TIMEOUT_MS,
        );
      }
      options.onExecutionProgress?.(progress);
    }
    const text = readAgentTextChunk(update);
    if (text !== null) {
      finalText += text;
      if (text.trim().length > 0) {
        terminalEvidence.hasVisibleText = true;
      }
      options.onVisibleAgentMarkdown?.(finalText);
    }
    const terminalToolCallId = readTerminalToolCallId(update);
    if (terminalToolCallId !== null) {
      terminalEvidence.terminalToolCallIds.add(terminalToolCallId);
    }
    queueExecutionTraceReady();
  });
  resetIdle();
  if (options.maxDurationMs !== undefined) {
    maxTimer = setTimeout(
      () => cancelAndEscalate("max-duration"),
      options.maxDurationMs,
    );
  }
  const abort = (): void => cancelAndEscalate("abort");
  options.signal?.addEventListener("abort", abort, { once: true });
  if (options.signal?.aborted === true) {
    abort();
  }
  try {
    const initialize = await raceLifecycle(transport.request("initialize", {
      protocolVersion: ACP_PROTOCOL_VERSION,
      clientInfo: { name: "moebius", version: "1" },
      clientCapabilities: {
        fs: kimiClientFsCapabilities(options.workspaceAccess),
        terminal: false,
      },
    }));
    if (
      !isRecord(initialize)
      || (
        initialize.protocolVersion !== undefined
        && initialize.protocolVersion !== ACP_PROTOCOL_VERSION
      )
    ) {
      throw new KimiAcpError("KIMI_ACP_INITIALIZE_FAILED", "Kimi ACP 初始化失败。");
    }
    if (readAuthMethodIds(initialize).includes("login")) {
      await raceLifecycle(transport.request("authenticate", { methodId: "login" }));
    }

    const sessionResult = await raceLifecycle(transport.request(
      options.mode.kind === "resume" ? "session/resume" : "session/new",
      options.mode.kind === "resume"
        ? {
            sessionId: options.mode.externalSessionId,
            cwd: path.resolve(options.cwd),
            mcpServers: kimiMcpServers(options.mcpServer),
          }
        : {
            cwd: path.resolve(options.cwd),
            mcpServers: kimiMcpServers(options.mcpServer),
          },
    ));
    const reportedSessionId = readOptionalSessionId(sessionResult);
    if (options.mode.kind === "resume") {
      if (
        reportedSessionId !== null
        && reportedSessionId !== options.mode.externalSessionId
      ) {
        throw new KimiAcpError(
          "KIMI_ACP_SESSION_FAILED",
          "Kimi 返回了与请求不一致的 session。",
        );
      }
      sessionId = options.mode.externalSessionId;
    } else {
      if (reportedSessionId === null) {
        throw new KimiAcpError(
          "KIMI_ACP_SESSION_FAILED",
          "Kimi 没有返回 session id。",
        );
      }
      sessionId = reportedSessionId;
    }
    const guardedTransport = {
      request: (method: string, params: unknown) =>
        raceLifecycle(transport.request(method, params)),
      waitForConfigUpdate: (
        expectedSessionId: string,
        optionId: string,
        expectedValue: string,
        timeoutMs: number,
      ) => raceLifecycle(transport.waitForConfigUpdate(
        expectedSessionId,
        optionId,
        expectedValue,
        timeoutMs,
      )),
    };
    await confirmRuntimeConfig(
      guardedTransport,
      sessionId,
      readConfigOptions(sessionResult),
      options.profile.model,
      options.profile.effort,
      options.permissionMode ?? "auto",
    );
    await raceLifecycle(Promise.resolve(options.onSessionStarted?.(sessionId)));

    const content = await raceLifecycle(buildPromptContent(options.prompt, options.imagePaths ?? []));
    const promptResult = await raceLifecycle(transport.request("session/prompt", {
      sessionId,
      prompt: content,
    }));
    const resultText = readPromptResultText(promptResult);
    if (resultText !== null && !finalText.trim().endsWith(resultText.trim())) {
      finalText += resultText;
      if (resultText.trim().length > 0) {
        terminalEvidence.hasVisibleText = true;
      }
      options.onVisibleAgentMarkdown?.(finalText);
    }
    const stopReason = readPromptStopReason(promptResult);
    if (stopReason === "cancelled" || stopReason === "canceled") {
      const failure: CodexRunFailure = {
        code: "kimi-acp-interrupted",
        message: "Kimi 执行已中止。",
      };
      settled = true;
      return {
        ok: false,
        reason: failure.code,
        failure,
        terminal: {
          kind: "interrupted",
          actor: options.signal?.aborted === true
            ? executionInterruptionActor(options.signal.reason)
            : "system",
          cause: options.signal?.aborted === true
            ? executionInterruptionCause(options.signal.reason)
            : "system",
          partialText: finalText,
        },
        threadId: sessionId,
        runDir,
        stdoutPath,
        stderrPath,
      };
    }
    queueExecutionTraceReady();
    await traceReadyTail;
    if (traceReadyError !== null) {
      throw traceReadyError;
    }
    if (!hasKimiTerminalEvidence(terminalEvidence)) {
      throw new KimiAcpError(
        "KIMI_EMPTY_RESPONSE",
        KIMI_EMPTY_RESPONSE_MESSAGE,
        {
          stopReason,
          visibleTextBytes: Buffer.byteLength(finalText, "utf8"),
          terminalToolCount: terminalEvidence.terminalToolCallIds.size,
        },
      );
    }
    if (
      stopReason !== null && stopReason !== "end_turn"
    ) {
      const failure: CodexRunFailure = {
        code: "kimi-no-complete-result",
        message: "Kimi 没有返回完整结果，可能是额度或服务问题。",
      };
      settled = true;
      return {
        ok: false,
        reason: failure.code,
        failure,
        terminal: planExecutionFailureTerminal(failure, finalText),
        threadId: sessionId,
        runDir,
        stdoutPath,
        stderrPath,
      };
    }
    settled = true;
    return {
      ok: true,
      finalText,
      completionKind: terminalEvidence.hasVisibleText
        ? "visible-text"
        : "terminal-tool-result",
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
  } catch (error) {
    if (error instanceof KimiAcpError) {
      throw new KimiAcpError(
        error.code,
        error.safeMessage,
        {
          ...(error.diagnostics ?? {}),
          partialText: finalText,
        },
      );
    }
    throw error;
  } finally {
    settled = true;
    clearUpdate();
    if (idleTimer !== null) clearTimeout(idleTimer);
    if (toolTimer !== null) clearTimeout(toolTimer);
    if (maxTimer !== null) clearTimeout(maxTimer);
    if (busyTimer !== null) clearTimeout(busyTimer);
    if (managedSettleTimer !== null) clearTimeout(managedSettleTimer);
    clearManagedCompletion();
    options.signal?.removeEventListener("abort", abort);
    if (escalationCompletion !== null) {
      await escalationCompletion;
    } else {
      if (interruptGraceTimer !== null) clearTimeout(interruptGraceTimer);
      if (terminateGraceTimer !== null) clearTimeout(terminateGraceTimer);
    }
  }
}

function kimiMcpServers(server: ManagedProcessMcpInvocation | null | undefined): unknown[] {
  if (server === null || server === undefined) return [];
  return [{
    name: "moebius_managed",
    command: server.command,
    args: [...server.args],
    env: Object.entries(server.env)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([name, value]) => ({ name, value })),
  }];
}

const kimiManagedToolNames = new Set<string>(MANAGED_PROCESS_TOOL_NAMES);

function readKimiManagedToolUpdate(value: unknown): { toolCallId: string; managed: boolean; completed: boolean } | null {
  if (!isRecord(value)) return null;
  const update = isRecord(value.update) ? value.update : value;
  const kind = firstString(update.sessionUpdate, update.session_update, update.type);
  if (kind !== "tool_call" && kind !== "tool_call_update") return null;
  const toolCallId = firstString(update.toolCallId, update.tool_call_id);
  if (toolCallId === null) return null;
  const title = firstString(update.title, update.name) ?? "";
  const status = firstString(update.status);
  // Tool-set driven: only the injected Moebius bridge tools count as managed.
  // The `mcp__<server>__` prefix is the Kimi ACP convention for MCP tools; the
  // tool name itself must be a member of the shared capability face so renames
  // in managed-process-tools.ts propagate instead of silently breaking.
  const serverPrefix = `mcp__${MOEBIUS_MANAGED_MCP_SERVER_NAME}__`;
  const toolName = title.startsWith(serverPrefix) ? title.slice(serverPrefix.length) : null;
  return {
    toolCallId,
    managed: toolName !== null && kimiManagedToolNames.has(toolName),
    completed: status === "completed" || status === "failed",
  };
}

function isKimiSemanticPostToolProgress(value: unknown): boolean {
  if (!isRecord(value)) return false;
  const update = isRecord(value.update) ? value.update : value;
  const kind = firstString(update.sessionUpdate, update.session_update, update.type) ?? "";
  if (kind !== "agent_message_chunk" && kind !== "agent_thought_chunk" && kind !== "plan") return false;
  const content = isRecord(update.content) ? update.content : null;
  return firstString(content?.text, update.text) !== null;
}

function readKimiToolActivity(value: unknown): "in-flight" | "settled" | null {
  if (!isRecord(value)) return null;
  const update = isRecord(value.update) ? value.update : value;
  const kind = firstString(update.sessionUpdate, update.session_update, update.type);
  if (kind !== "tool_call" && kind !== "tool_call_update") return null;
  const status = firstString(update.status);
  return status === "completed" || status === "failed" ? "settled" : "in-flight";
}

export async function confirmRuntimeConfig(
  transport: Pick<KimiAcpTransport, "request" | "waitForConfigUpdate">,
  sessionId: string,
  configOptions: readonly unknown[],
  expectedModel: string,
  expectedEffort: string,
  expectedPermissionMode = "auto",
): Promise<void> {
  let activeOptions = configOptions;
  const model = findConfigOption(activeOptions, "model");
  if (model === null) {
    throw new KimiAcpError(
      "KIMI_ACP_CONFIG_UNCONFIRMED",
      "Kimi 没有提供可核验的模型、思考程度与权限模式配置。",
    );
  }
  const modelChanged = model.currentValue !== expectedModel;
  const modelConfirmation = await setAndConfirm(
    model,
    expectedModel,
    "模型",
    modelChanged,
  );
  if (modelChanged) {
    const refreshedOptions = modelConfirmation?.configOptions;
    if (refreshedOptions === null || refreshedOptions === undefined) {
      throw new KimiAcpError(
        "KIMI_ACP_CONFIG_UNCONFIRMED",
        "Kimi 没有提供切换模型后的可核验配置。",
      );
    }
    activeOptions = refreshedOptions;
  }
  const effort = findConfigOption(activeOptions, "effort");
  const mode = findConfigOption(activeOptions, "mode");
  if (effort === null || mode === null) {
    throw new KimiAcpError(
      "KIMI_ACP_CONFIG_UNCONFIRMED",
      "Kimi 没有提供可核验的模型、思考程度与权限模式配置。",
    );
  }
  await setAndConfirm(effort, expectedEffort, "思考程度");
  await setAndConfirm(mode, expectedPermissionMode, "权限模式");

  async function setAndConfirm(
    option: { id: string; currentValue: string | null; values: string[] },
    expectedValue: string,
    label: string,
    requireConfigOptions = false,
  ): Promise<KimiConfigUpdateConfirmation | null> {
    if (!option.values.includes(expectedValue)) {
      throw new KimiAcpError(
        "KIMI_ACP_CONFIG_MISMATCH",
        `Kimi session 不支持已保存的${label}。`,
      );
    }
    if (option.currentValue === expectedValue) {
      return null;
    }
    const response = await transport.request("session/set_config_option", {
      sessionId,
      configId: option.id,
      value: expectedValue,
    });
    const responseOptions = readConfigOptions(response);
    const responseConfirmed = responseConfirmsConfig(response, option.id, expectedValue);
    if (responseConfirmed && (!requireConfigOptions || responseOptions.length > 0)) {
      return { configOptions: responseOptions.length > 0 ? responseOptions : null };
    }
    const update = await transport.waitForConfigUpdate(
      sessionId,
      option.id,
      expectedValue,
      2_000,
    );
    if (update !== null) {
      return update;
    }
    if (responseConfirmed) {
      return { configOptions: null };
    }
    throw new KimiAcpError(
      "KIMI_ACP_CONFIG_UNCONFIRMED",
      `Kimi 没有确认已采用保存的${label}。`,
    );
  }
}

export function kimiClientFsCapabilities(
  workspaceAccess: KimiAcpRunOptions["workspaceAccess"] = "read-write",
): { readTextFile: true; writeTextFile: boolean } {
  return {
    readTextFile: true,
    writeTextFile: workspaceAccess !== "read-only",
  };
}

async function buildPromptContent(prompt: string, imagePaths: readonly string[]): Promise<unknown[]> {
  const content: unknown[] = [{ type: "text", text: prompt }];
  for (const imagePath of imagePaths) {
    const extension = path.extname(imagePath).toLowerCase();
    const mimeType = extension === ".png"
      ? "image/png"
      : extension === ".jpg" || extension === ".jpeg"
        ? "image/jpeg"
        : extension === ".gif"
          ? "image/gif"
          : extension === ".webp"
            ? "image/webp"
            : null;
    if (mimeType === null) {
      throw new KimiAcpError("KIMI_IMAGE_UNSUPPORTED", "Kimi 无法读取这张图片的格式。");
    }
    content.push({
      type: "image",
      data: (await fs.readFile(imagePath)).toString("base64"),
      mimeType,
    });
  }
  return content;
}

export async function createKimiProcessTransport(input: {
  cwd: string;
  readRoots: string[];
  stdoutPath: string;
  stderrPath: string;
  env: NodeJS.ProcessEnv;
  allowWrites: boolean;
  homeDir?: string;
  spawnTimeoutMs?: number;
  spawnProcess?: typeof spawn;
}): Promise<KimiAcpTransport> {
  const executable = await resolveKimiExecutable({
    pathValue: input.env.PATH,
    cwd: input.cwd,
    homeDir: input.homeDir ?? os.homedir(),
  });
  const spawnProcess = input.spawnProcess ?? spawn;
  const child = spawnProcess(executable, ["acp"], {
    cwd: input.cwd,
    env: input.env,
    shell: false,
    stdio: ["pipe", "pipe", "pipe"],
  });
  const stdoutLog = createWriteStream(input.stdoutPath, { flags: "a" });
  const stderrLog = createWriteStream(input.stderrPath, { flags: "a" });
  child.stderr.pipe(stderrLog);
  const transport = new ProcessKimiAcpTransport(
    child,
    input.cwd,
    input.readRoots,
    input.allowWrites,
    stdoutLog,
    stderrLog,
  );
  try {
    await waitForKimiSpawn(
      child,
      input.spawnTimeoutMs ?? KIMI_CLI_SPAWN_TIMEOUT_MS,
    );
    return transport;
  } catch (error) {
    await transport.close().catch(() => undefined);
    throw error;
  }
}

class ProcessKimiAcpTransport implements KimiAcpTransport {
  private readonly pending = new Map<number, {
    resolve(value: unknown): void;
    reject(error: Error): void;
  }>();
  private readonly updateListeners = new Set<(update: unknown) => void>();
  private readonly configWaiters = new Set<{
    sessionId: string;
    optionId: string;
    expectedValue: string;
    resolve(value: KimiConfigUpdateConfirmation | null): void;
  }>();
  private readonly latestConfigOptions = new Map<string, readonly unknown[]>();
  private nextId = 1;
  private buffer = "";
  private closed = false;
  private terminalError: Error | null = null;
  private shutdownStage: "none" | "interrupt" | "terminate" | "kill" = "none";
  private closePromise: Promise<void> | null = null;

  constructor(
    private readonly child: ChildProcessWithoutNullStreams,
    private readonly cwd: string,
    private readonly readRoots: string[],
    private readonly allowWrites: boolean,
    private readonly stdoutLog: ReturnType<typeof createWriteStream>,
    private readonly stderrLog: ReturnType<typeof createWriteStream>,
  ) {
    child.stdout.on("data", (chunk: Buffer) => {
      stdoutLog.write(chunk);
      this.buffer += chunk.toString("utf8");
      if (Buffer.byteLength(this.buffer, "utf8") > MAX_ACP_LINE_BYTES) {
        this.protocolFailure();
        return;
      }
      this.drainLines();
    });
    child.on("error", () => this.failAll(new KimiAcpError(
      "KIMI_CLI_SPAWN_FAILED",
      KIMI_SPAWN_FAILED_MESSAGE,
    )));
    child.on("exit", (code, signal) => {
      if (!this.closed) {
        this.failAll(new KimiAcpError(
          "KIMI_CLI_EXITED",
          KIMI_EXITED_MESSAGE,
          { exitCode: code, signal },
        ));
      }
    });
  }

  request(method: string, params: unknown): Promise<unknown> {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.write({ jsonrpc: "2.0", id, method, params });
    });
  }

  notify(method: string, params: unknown): void {
    this.write({ jsonrpc: "2.0", method, params });
  }

  waitForConfigUpdate(
    sessionId: string,
    optionId: string,
    expectedValue: string,
    timeoutMs: number,
  ): Promise<KimiConfigUpdateConfirmation | null> {
    const latest = this.latestConfigOptions.get(sessionId);
    if (
      latest !== undefined
      && responseConfirmsConfig({ configOptions: latest }, optionId, expectedValue)
    ) {
      return Promise.resolve({ configOptions: latest });
    }
    return new Promise((resolve) => {
      const waiter = { sessionId, optionId, expectedValue, resolve };
      this.configWaiters.add(waiter);
      setTimeout(() => {
        if (this.configWaiters.delete(waiter)) resolve(null);
      }, timeoutMs);
    });
  }

  onSessionUpdate(listener: (update: unknown) => void): () => void {
    this.updateListeners.add(listener);
    return () => this.updateListeners.delete(listener);
  }

  async close(): Promise<void> {
    this.closePromise ??= this.closeOnce();
    await this.closePromise;
  }

  private async closeOnce(): Promise<void> {
    this.closed = true;
    this.failAll(new KimiAcpError("KIMI_ACP_CLOSED", "Kimi ACP 已关闭。"));
    this.child.stdin.end();
    if (!this.hasExited()) {
      this.terminate();
      if (!(await this.waitForExit(DEFAULT_SIGNAL_GRACE_MS))) {
        this.kill();
        await this.waitForExit(DEFAULT_SIGNAL_GRACE_MS);
      }
    }
    await Promise.all([
      new Promise<void>((resolve) => this.stdoutLog.end(resolve)),
      new Promise<void>((resolve) => this.stderrLog.end(resolve)),
    ]);
  }

  private hasExited(): boolean {
    return this.child.exitCode !== null || this.child.signalCode !== null;
  }

  private async waitForExit(timeoutMs: number): Promise<boolean> {
    if (this.hasExited()) return true;
    return await new Promise<boolean>((resolve) => {
      let settled = false;
      const finish = (exited: boolean): void => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        this.child.removeListener("exit", onExit);
        resolve(exited);
      };
      const onExit = (): void => finish(true);
      const timer = setTimeout(() => finish(this.hasExited()), timeoutMs);
      this.child.once("exit", onExit);
    });
  }

  interrupt(): void {
    if (this.shutdownStage !== "none") return;
    this.shutdownStage = "interrupt";
    this.child.kill("SIGINT");
  }

  terminate(): void {
    if (this.shutdownStage === "terminate" || this.shutdownStage === "kill") return;
    this.shutdownStage = "terminate";
    this.child.kill("SIGTERM");
  }

  kill(): void {
    if (this.shutdownStage === "kill") return;
    this.shutdownStage = "kill";
    this.child.kill("SIGKILL");
  }

  private drainLines(): void {
    for (;;) {
      const newline = this.buffer.indexOf("\n");
      if (newline < 0) return;
      const line = this.buffer.slice(0, newline).trim();
      this.buffer = this.buffer.slice(newline + 1);
      if (line.length === 0) continue;
      let message: unknown;
      try {
        message = JSON.parse(line) as unknown;
      } catch {
        this.protocolFailure();
        return;
      }
      if (!isRecord(message)) {
        this.protocolFailure();
        return;
      }
      void this.handleMessage(message);
    }
  }

  private async handleMessage(value: unknown): Promise<void> {
    if (!isRecord(value)) return;
    if (typeof value.id === "number" && typeof value.method === "string") {
      await this.handleReverseRequest(value.id, value.method, value.params);
      return;
    }
    if (typeof value.id === "number") {
      const pending = this.pending.get(value.id);
      if (pending === undefined) return;
      this.pending.delete(value.id);
      if (value.error !== undefined) {
        const responseError = readKimiResponseError(value.error);
        pending.reject(new KimiAcpError(
          "KIMI_ACP_REQUEST_FAILED",
          "Kimi ACP 请求失败。",
          responseError,
        ));
      } else {
        pending.resolve(value.result);
      }
      return;
    }
    if (value.method === "session/update") {
      const update = isRecord(value.params) ? value.params : value;
      for (const listener of this.updateListeners) listener(update);
      const updateSessionId = readConfigUpdateSessionId(update);
      const configOptions = readConfigOptionsFromUpdate(update);
      if (updateSessionId !== null && configOptions.length > 0) {
        this.latestConfigOptions.set(updateSessionId, configOptions);
      }
      const confirmation = readConfigConfirmation(update);
      for (const waiter of this.configWaiters) {
        const fullOptionsConfirm = updateSessionId === waiter.sessionId
          && configOptions.length > 0
          && responseConfirmsConfig(
            { configOptions },
            waiter.optionId,
            waiter.expectedValue,
          );
        const directUpdateConfirms = confirmation !== null
          && waiter.sessionId === confirmation.sessionId
          && waiter.optionId === confirmation.optionId
          && waiter.expectedValue === confirmation.value;
        if (fullOptionsConfirm || directUpdateConfirms) {
          this.configWaiters.delete(waiter);
          waiter.resolve({
            configOptions: configOptions.length > 0 ? configOptions : null,
          });
        }
      }
    }
  }

  private async handleReverseRequest(id: number, method: string, params: unknown): Promise<void> {
    try {
      if (method === "fs/read_text_file") {
        const filePath = await this.resolveAllowedPath(readParamString(params, "path"), false);
        this.write({ jsonrpc: "2.0", id, result: { content: await fs.readFile(filePath, "utf8") } });
        return;
      }
      if (method === "fs/write_text_file") {
        if (!this.allowWrites) {
          this.write({
            jsonrpc: "2.0",
            id,
            error: { code: -32601, message: "Method not allowed" },
          });
          return;
        }
        const filePath = await this.resolveAllowedPath(readParamString(params, "path"), true);
        const content = readParamString(params, "content");
        await fs.writeFile(filePath, content, "utf8");
        this.write({ jsonrpc: "2.0", id, result: {} });
        return;
      }
      if (method === "session/request_permission") {
        this.write({ jsonrpc: "2.0", id, result: { outcome: "cancelled" } });
        return;
      }
      this.write({
        jsonrpc: "2.0",
        id,
        error: { code: -32601, message: "Method not allowed" },
      });
    } catch {
      this.write({
        jsonrpc: "2.0",
        id,
        error: { code: -32000, message: "Workspace access denied" },
      });
    }
  }

  private async resolveAllowedPath(rawPath: string, write: boolean): Promise<string> {
    return resolveKimiFileRequestPath({
      cwd: this.cwd,
      readRoots: this.readRoots,
      rawPath,
      write,
    });
  }

  private write(message: unknown): void {
    if (this.closed || !this.child.stdin.writable) {
      throw this.terminalError
        ?? new KimiAcpError("KIMI_ACP_CLOSED", "Kimi ACP 已关闭。");
    }
    this.child.stdin.write(`${JSON.stringify(message)}\n`);
  }

  private failAll(error: Error): void {
    this.terminalError ??= error;
    for (const pending of this.pending.values()) pending.reject(error);
    this.pending.clear();
    for (const waiter of this.configWaiters) waiter.resolve(null);
    this.configWaiters.clear();
  }

  private protocolFailure(): void {
    this.buffer = "";
    this.failAll(new KimiAcpError("KIMI_ACP_PROTOCOL_FAILED", "Kimi ACP 协议输入无效。"));
    this.kill();
  }
}

function readOptionalSessionId(value: unknown): string | null {
  if (!isRecord(value)) {
    throw new KimiAcpError("KIMI_ACP_SESSION_FAILED", "Kimi session 创建失败。");
  }
  const sessionId = typeof value.sessionId === "string"
    ? value.sessionId
    : typeof value.session_id === "string"
      ? value.session_id
      : null;
  if (sessionId !== null && sessionId.trim().length === 0) {
    throw new KimiAcpError("KIMI_ACP_SESSION_FAILED", "Kimi 没有返回 session id。");
  }
  return sessionId;
}

function readConfigOptions(value: unknown): unknown[] {
  if (!isRecord(value)) return [];
  return Array.isArray(value.configOptions)
    ? value.configOptions
    : Array.isArray(value.config_options)
      ? value.config_options
      : [];
}

function findConfigOption(
  options: readonly unknown[],
  kind: "model" | "effort" | "mode",
): { id: string; currentValue: string | null; values: string[] } | null {
  for (const option of options) {
    if (!isRecord(option)) continue;
    const id = firstString(option.id, option.configId, option.config_id);
    if (id === null) continue;
    const normalized = id.toLowerCase();
    const matches = kind === "model"
      ? normalized.includes("model")
      : kind === "effort"
        ? normalized.includes("thinking") || normalized.includes("effort")
        : normalized === "mode" || normalized.includes("permission");
    if (!matches) continue;
    const rawValues = Array.isArray(option.options)
      ? option.options
      : Array.isArray(option.values)
        ? option.values
        : [];
    const values = rawValues.flatMap((candidate): string[] => {
      if (typeof candidate === "string") return [candidate];
      if (!isRecord(candidate)) return [];
      const value = firstString(candidate.value, candidate.id);
      return value === null ? [] : [value];
    });
    return {
      id,
      currentValue: firstString(option.currentValue, option.current_value, option.value),
      values,
    };
  }
  return null;
}

function readAuthMethodIds(value: unknown): string[] {
  if (!isRecord(value)) return [];
  const methods = Array.isArray(value.authMethods)
    ? value.authMethods
    : Array.isArray(value.auth_methods)
      ? value.auth_methods
      : [];
  return methods.flatMap((method): string[] => {
    if (typeof method === "string") return [method];
    if (!isRecord(method)) return [];
    const id = firstString(method.id, method.methodId, method.method_id);
    return id === null ? [] : [id];
  });
}

function responseConfirmsConfig(value: unknown, optionId: string, expectedValue: string): boolean {
  if (!isRecord(value)) return false;
  const directId = firstString(value.id, value.configId, value.config_id);
  const directValue = firstString(value.currentValue, value.current_value, value.value);
  if (directId === optionId && directValue === expectedValue) return true;
  return readConfigOptions(value).some((option) => {
    if (!isRecord(option)) return false;
    return firstString(option.id, option.configId, option.config_id) === optionId
      && firstString(option.currentValue, option.current_value, option.value) === expectedValue;
  });
}

function readConfigConfirmation(value: unknown): {
  sessionId: string;
  optionId: string;
  value: string;
} | null {
  if (!isRecord(value)) return null;
  const update = isRecord(value.update) ? value.update : value;
  const kind = firstString(update.sessionUpdate, update.session_update, update.type);
  if (kind !== "config_option_update") return null;
  const sessionId = firstString(value.sessionId, value.session_id, update.sessionId, update.session_id);
  const optionId = firstString(update.configId, update.config_id, update.id);
  const selected = firstString(update.value, update.currentValue, update.current_value);
  return sessionId === null || optionId === null || selected === null
    ? null
    : { sessionId, optionId, value: selected };
}

function readConfigUpdateSessionId(value: unknown): string | null {
  if (!isRecord(value)) return null;
  const update = isRecord(value.update) ? value.update : value;
  return firstString(value.sessionId, value.session_id, update.sessionId, update.session_id);
}

function readConfigOptionsFromUpdate(value: unknown): unknown[] {
  if (!isRecord(value)) return [];
  const update = isRecord(value.update) ? value.update : value;
  return readConfigOptions(update);
}

function readAgentTextChunk(value: unknown): string | null {
  if (!isRecord(value)) return null;
  const update = isRecord(value.update) ? value.update : value;
  const kind = firstString(update.sessionUpdate, update.session_update, update.type);
  if (kind !== "agent_message_chunk") return null;
  const content = isRecord(update.content) ? update.content : update;
  // Every text chunk participates in accumulation, including whitespace-only
  // ones: kimi streams markdown boundary whitespace (" ", "\n", "\n\n") as
  // standalone chunks, and dropping them would break headings, list items and
  // paragraph breaks. Whether the accumulated text counts as visible evidence
  // is decided at the accumulation site (hasVisibleText).
  return typeof content.text === "string" ? content.text : null;
}

function readPromptResultText(value: unknown): string | null {
  if (!isRecord(value)) return null;
  for (const candidate of [value.text, value.finalText, value.final_text]) {
    if (typeof candidate === "string") return candidate;
  }
  return null;
}

function readPromptStopReason(value: unknown): string | null {
  if (!isRecord(value)) return null;
  return firstString(value.stopReason, value.stop_reason);
}

function readKimiResponseError(value: unknown): Readonly<Record<string, unknown>> {
  if (!isRecord(value)) {
    return { rawType: typeof value };
  }
  const code = typeof value.code === "number" || typeof value.code === "string"
    ? value.code
    : null;
  const message = typeof value.message === "string"
    ? value.message.slice(0, 2_000)
    : null;
  const data = sanitizeKimiDiagnosticData(value.data);
  return {
    ...(code === null ? {} : { jsonRpcCode: code }),
    ...(message === null ? {} : { jsonRpcMessage: message }),
    ...(data === undefined ? {} : { jsonRpcData: data }),
  };
}

function sanitizeKimiDiagnosticData(value: unknown): unknown {
  if (
    value === null
    || typeof value === "boolean"
    || typeof value === "number"
  ) {
    return value;
  }
  if (typeof value === "string") return value.slice(0, 4_000);
  if (Array.isArray(value)) {
    return value.slice(0, 20).map(sanitizeKimiDiagnosticData);
  }
  if (!isRecord(value)) return undefined;
  return Object.fromEntries(
    Object.entries(value)
      .slice(0, 30)
      .map(([key, item]) => [key.slice(0, 100), sanitizeKimiDiagnosticData(item)]),
  );
}

interface KimiTerminalEvidence {
  hasVisibleText: boolean;
  terminalToolCallIds: Set<string>;
}

function hasKimiTerminalEvidence(evidence: KimiTerminalEvidence): boolean {
  return evidence.hasVisibleText || evidence.terminalToolCallIds.size > 0;
}

function readTerminalToolCallId(value: unknown): string | null {
  if (!isRecord(value)) return null;
  const update = isRecord(value.update) ? value.update : value;
  const kind = firstString(update.sessionUpdate, update.session_update, update.type);
  if (kind !== "tool_call" && kind !== "tool_call_update") return null;
  const status = firstString(update.status);
  if (status !== "completed" && status !== "failed") return null;
  return firstString(update.toolCallId, update.tool_call_id);
}

function readParamString(value: unknown, field: string): string {
  if (!isRecord(value) || typeof value[field] !== "string") {
    throw new Error(`missing ${field}`);
  }
  return value[field];
}

function firstString(...values: unknown[]): string | null {
  for (const value of values) {
    if (typeof value === "string" && value.trim().length > 0) return value.trim();
  }
  return null;
}

function safeKimiError(error: unknown): string {
  return error instanceof KimiAcpError || error instanceof KimiRuntimeIsolationError
    ? error.safeMessage
    : "Kimi 执行失败；未改用其他执行引擎。";
}

function classifyKimiFailure(error: unknown): CodexRunFailure | null {
  if (error instanceof KimiExecutableError) {
    return {
      code: error.code,
      message: error.safeMessage,
    };
  }
  if (!(error instanceof KimiAcpError)) {
    return null;
  }
  switch (error.code) {
    case "KIMI_CLI_SPAWN_FAILED":
      return {
        code: "kimi-cli-spawn-failed",
        message: error.safeMessage,
      };
    case "KIMI_CLI_EXITED":
      return {
        code: "kimi-cli-exited",
        message: error.safeMessage,
      };
    case "KIMI_ACP_TIMEOUT":
      return {
        code: "kimi-acp-timeout",
        message: error.safeMessage,
      };
    case "KIMI_ACP_INTERRUPTED":
      return {
        code: "kimi-acp-interrupted",
        message: error.safeMessage,
      };
    case "KIMI_ACP_BUSY_TIMEOUT":
      return {
        code: "kimi-rate-limited",
        message: error.safeMessage,
      };
    case "KIMI_ACP_REQUEST_FAILED": {
      const signal = JSON.stringify(error.diagnostics ?? {});
      const retryable = readDiagnosticRetryable(error.diagnostics);
      if (
        retryable === false
        && /403|billing|quota|usage.?limit|credit/iu.test(signal)
      ) {
        return {
          code: "kimi-quota-exhausted",
          message: "Kimi 已确认当前账户的推理额度不可用。",
        };
      }
      if (/429|overload|busy|rate.?limit|too.?many.?requests/iu.test(signal)) {
        return {
          code: "kimi-rate-limited",
          message: "Kimi 服务持续繁忙，已停止本次运行。",
        };
      }
      return {
        code: "kimi-no-complete-result",
        message: "Kimi 没有返回完整结果，可能是额度或服务问题。",
      };
    }
    case "KIMI_EMPTY_RESPONSE":
      return {
        code: "kimi-empty-response",
        message: error.safeMessage,
      };
    default:
      return null;
  }
}

function readDiagnosticRetryable(
  diagnostics: Readonly<Record<string, unknown>> | undefined,
): boolean | null {
  if (diagnostics === undefined) return null;
  const data = diagnostics.jsonRpcData;
  if (isRecord(data) && typeof data.retryable === "boolean") {
    return data.retryable;
  }
  return typeof diagnostics.retryable === "boolean" ? diagnostics.retryable : null;
}

function readKimiPartialText(error: unknown): string {
  if (
    error instanceof KimiAcpError
    && typeof error.diagnostics?.partialText === "string"
  ) {
    return error.diagnostics.partialText;
  }
  return "";
}

async function appendKimiFailureDiagnostic(
  stderrPath: string,
  error: unknown,
): Promise<void> {
  const diagnostic = error instanceof Error
    ? {
        name: error.name,
        message: error.message,
        ...("code" in error && typeof error.code === "string" ? { code: error.code } : {}),
        ...(error instanceof KimiAcpError && error.diagnostics !== undefined
          ? { diagnostics: error.diagnostics }
          : {}),
      }
    : { value: String(error) };
  await fs.appendFile(stderrPath, `${JSON.stringify({
    event: "kimi-run-failed",
    error: diagnostic,
  })}\n`, "utf8");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export class KimiAcpError extends Error {
  constructor(
    readonly code:
      | "KIMI_ACP_INITIALIZE_FAILED"
      | "KIMI_ACP_SESSION_FAILED"
      | "KIMI_ACP_CONFIG_MISMATCH"
      | "KIMI_ACP_CONFIG_UNCONFIRMED"
      | "KIMI_ACP_REQUEST_FAILED"
      | "KIMI_ACP_CLOSED"
      | "KIMI_ACP_PROTOCOL_FAILED"
      | "KIMI_ACP_INTERRUPTED"
      | "KIMI_ACP_TIMEOUT"
      | "KIMI_ACP_BUSY_TIMEOUT"
      | "KIMI_EMPTY_RESPONSE"
      | "KIMI_CLI_SPAWN_FAILED"
      | "KIMI_CLI_EXITED"
      | "KIMI_IMAGE_UNSUPPORTED",
    readonly safeMessage: string,
    readonly diagnostics?: Readonly<Record<string, unknown>>,
  ) {
    super(safeMessage);
    this.name = "KimiAcpError";
  }
}

export function waitForKimiSpawn(
  child: ChildProcessWithoutNullStreams,
  timeoutMs: number,
): Promise<void> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (error?: Error): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      child.removeListener("spawn", onSpawn);
      child.removeListener("error", onError);
      child.removeListener("exit", onExit);
      if (error === undefined) {
        resolve();
      } else {
        reject(error);
      }
    };
    const onSpawn = (): void => finish();
    const onError = (error: Error): void => finish(new KimiAcpError(
      "KIMI_CLI_SPAWN_FAILED",
      KIMI_SPAWN_FAILED_MESSAGE,
      {
        errorName: error.name,
        errorMessage: error.message,
        ...("code" in error && typeof error.code === "string" ? { errorCode: error.code } : {}),
      },
    ));
    const onExit = (code: number | null, signal: NodeJS.Signals | null): void => finish(
      new KimiAcpError(
        "KIMI_CLI_EXITED",
        KIMI_EXITED_MESSAGE,
        { exitCode: code, signal },
      ),
    );
    const timeout = setTimeout(() => {
      try {
        child.kill("SIGTERM");
      } catch {
        // The bounded failure remains authoritative when the process cannot be signalled.
      }
      finish(new KimiAcpError(
        "KIMI_CLI_SPAWN_FAILED",
        KIMI_SPAWN_FAILED_MESSAGE,
        { timeoutMs },
      ));
    }, timeoutMs);
    timeout.unref();
    child.once("spawn", onSpawn);
    child.once("error", onError);
    child.once("exit", onExit);
  });
}

function pathWithin(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return relative === "" || (
    relative !== ".."
    && !relative.startsWith(`..${path.sep}`)
    && !path.isAbsolute(relative)
  );
}

export async function resolveKimiFileRequestPath(input: {
  cwd: string;
  readRoots: string[];
  rawPath: string;
  write: boolean;
}): Promise<string> {
  const candidate = path.resolve(input.cwd, input.rawPath);
  const allowedRoots = input.write ? [input.cwd] : input.readRoots;
  const allowed = await Promise.all(
    allowedRoots.map(async (root) => fs.realpath(root).catch(() => null)),
  );
  const realCandidate = input.write
    ? await realPathForKimiWrite(candidate)
    : await fs.realpath(candidate);
  if (!allowed.some((root) => root !== null && pathWithin(root, realCandidate))) {
    throw new Error("outside workspace");
  }
  return candidate;
}

async function realPathForKimiWrite(candidate: string): Promise<string> {
  try {
    await fs.lstat(candidate);
  } catch (error) {
    if (!isMissingPathError(error)) {
      throw error;
    }
    const realParent = await fs.realpath(path.dirname(candidate));
    return path.join(realParent, path.basename(candidate));
  }
  return fs.realpath(candidate);
}

function isMissingPathError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}
