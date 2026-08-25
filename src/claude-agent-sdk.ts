import os from "node:os";
import fs from "node:fs/promises";
import path from "node:path";

import {
  query as defaultQuery,
  type Options as ClaudeAgentSdkOptions,
  type Query,
  type SDKMessage,
  type SDKResultError,
  type SDKResultMessage,
  type SDKResultSuccess,
} from "@anthropic-ai/claude-agent-sdk";

import {
  isSupportedClaudeCliVersion,
  MINIMUM_CLAUDE_CLI_VERSION,
} from "./claude-cli-version.js";
import {
  createRunWatchdogs,
  type CodexRunWatchdogs,
  type CodexWatchdogKind,
} from "./codex.js";
import {
  ClaudeExecutableError,
  resolveClaudeExecutable,
} from "./claude-executable.js";
import type { CodexRunFailure } from "./execution-failure-plan.js";
import type { ManagedProcessMcpInvocation, LocalExecutionMode } from "./local-console/execution-driver.js";
import { ClaudeVersionError, runClaudeVersion } from "./claude-version.js";

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

export type ClaudeAgentSdkQuery = (input: {
  prompt: string;
  options: ClaudeAgentSdkOptions;
}) => Query;

export type ClaudeAgentSdkProfile =
  | {
      kind: "ordinary";
      model: string;
      effort: string;
      permissionMode?: "auto" | "dontAsk";
      disallowedTools?: readonly string[];
    }
  | {
      kind: "ai-team-builder";
      model: string;
      effort: string;
      outputFormat: NonNullable<ClaudeAgentSdkOptions["outputFormat"]>;
    };

export interface ClaudeAgentSdkRunOptions {
  prompt: string;
  runDir: string;
  cwd: string;
  profile: ClaudeAgentSdkProfile;
  mode: LocalExecutionMode;
  signal?: AbortSignal;
  executablePath?: string;
  resolveExecutable?: typeof resolveClaudeExecutable;
  runVersion?: typeof runClaudeVersion;
  versionTimeoutMs?: number;
  mcpServer?: ManagedProcessMcpInvocation | null;
  query?: ClaudeAgentSdkQuery;
  onStructuredActivity?: (event: SDKMessage) => void;
  onProcessStarted?: () => void | Promise<void>;
  onSessionStarted?: (sessionId: string) => void | Promise<void>;
  idleTimeoutMs?: number;
  maxDurationMs?: number;
  /** The local-console execution driver owns this invocation's capability. */
  closeMcpServer?: boolean;
}

export interface ClaudeAgentSdkUsage {
  usage: SDKResultMessage["usage"];
  modelUsage: SDKResultMessage["modelUsage"];
  totalCostUsd: number;
  cachedInputTokens: number | null;
}

export type ClaudeAgentSdkRunResult =
  | {
      ok: true;
      finalText: string;
      structuredOutput: unknown;
      sessionId: string;
      usage: ClaudeAgentSdkUsage;
      runDir: string;
      stdoutPath: string;
      stderrPath: string;
    }
  | {
      ok: false;
      reason: string;
      failure: CodexRunFailure;
      sessionId: string | null;
      partialText: string;
      runDir: string;
      stdoutPath: string;
      stderrPath: string;
    };

const DEFAULT_VERSION_TIMEOUT_MS = 5_000;
const MANAGED_MCP_SERVER_NAME = "moebius_managed";

export function buildClaudeAgentSdkOptions(input: {
  executablePath: string;
  cwd: string;
  profile: ClaudeAgentSdkProfile;
  mode: LocalExecutionMode;
  abortController: AbortController;
  mcpServer?: ManagedProcessMcpInvocation | null;
}): ClaudeAgentSdkOptions {
  const base: ClaudeAgentSdkOptions = {
    abortController: input.abortController,
    cwd: path.resolve(input.cwd),
    effort: input.profile.effort as ClaudeAgentSdkOptions["effort"],
    model: input.profile.model,
    pathToClaudeCodeExecutable: input.executablePath,
    persistSession: true,
    permissionMode: input.profile.kind === "ai-team-builder"
      ? "dontAsk"
      : input.profile.permissionMode ?? "auto",
    ...(input.mode.kind === "resume" ? { resume: input.mode.externalSessionId } : {}),
    ...(input.mcpServer === null || input.mcpServer === undefined
      ? {}
      : {
          mcpServers: {
            [MANAGED_MCP_SERVER_NAME]: {
              type: "stdio" as const,
              command: input.mcpServer.command,
              args: [...input.mcpServer.args],
              env: { ...input.mcpServer.env },
            },
          },
        }),
  };

  if (input.profile.kind === "ai-team-builder") {
    return {
      ...base,
      outputFormat: input.profile.outputFormat,
      settingSources: [],
      strictMcpConfig: true,
      tools: ["Read", "Glob", "Grep"],
    };
  }

  return {
    ...base,
    disallowedTools: [
      ...input.profile.disallowedTools ?? CLAUDE_INTERNAL_AGENT_TOOLS,
    ],
  };
}

export async function runClaudeAgentSdk(
  input: ClaudeAgentSdkRunOptions,
): Promise<ClaudeAgentSdkRunResult> {
  const runDir = path.resolve(input.runDir);
  const stdoutPath = path.join(runDir, "claude-sdk.jsonl");
  const stderrPath = path.join(runDir, "claude-sdk-stderr.log");
  await fs.mkdir(runDir, { recursive: true, mode: 0o700 });
  await fs.writeFile(stderrPath, "", { encoding: "utf8", mode: 0o600 });

  const fail = (
    failure: CodexRunFailure,
    sessionId: string | null,
    partialText: string,
  ): ClaudeAgentSdkRunResult => ({
    ok: false,
    reason: failure.message,
    failure,
    sessionId,
    partialText,
    runDir,
    stdoutPath,
    stderrPath,
  });

  if (input.signal?.aborted === true) {
    return fail(cancelledFailure(), null, "");
  }

  let executablePath: string;
  try {
    executablePath = input.executablePath ?? await (input.resolveExecutable ?? resolveClaudeExecutable)({
      pathValue: process.env.PATH,
      cwd: input.cwd,
      homeDir: os.homedir(),
    });
  } catch (error) {
    if (error instanceof ClaudeExecutableError) return fail({ code: error.code, message: error.safeMessage }, null, "");
    return fail({ code: "claude-cli-spawn-failed", message: "暂时无法启动 Claude Code。" }, null, "");
  }

  try {
    const version = await (input.runVersion ?? runClaudeVersion)(
      executablePath,
      input.versionTimeoutMs ?? DEFAULT_VERSION_TIMEOUT_MS,
      input.signal,
    );
    if (!isSupportedClaudeCliVersion(version)) {
      return fail({
        code: "claude-cli-unsupported-version",
        message: `Claude Code 版本过旧，需要 ${MINIMUM_CLAUDE_CLI_VERSION} 或更高版本。`,
        action: "update-claude",
      }, null, "");
    }
  } catch (error) {
    if (isSignalAborted(input.signal) || error instanceof ClaudeVersionError && error.safeMessage.includes("取消")) {
      return fail(cancelledFailure(), null, "");
    }
    return fail({
      code: "claude-cli-spawn-failed",
      message: error instanceof ClaudeVersionError ? error.safeMessage : "暂时无法检查 Claude Code 版本。",
    }, null, "");
  }

  const abortController = new AbortController();
  const abort = (): void => abortController.abort(input.signal?.reason);
  input.signal?.addEventListener("abort", abort, { once: true });
  let query: Query | null = null;
  let observedSessionId: string | null = null;
  let partialText = "";
  let resultMessage: SDKResultMessage | null = null;
  let streamError: unknown = null;
  let sessionStartedNotified = false;
  let timeoutKind: CodexWatchdogKind | null = null;
  let watchdogs: CodexRunWatchdogs | null = null;
  const observeSession = async (sessionId: string): Promise<void> => {
    if (input.mode.kind === "resume" && sessionId !== input.mode.externalSessionId) {
      throw new ClaudeSessionIdentityError("原 Claude 执行已经无法继续。");
    }
    observedSessionId = sessionId;
    if (!sessionStartedNotified && input.onSessionStarted !== undefined) {
      sessionStartedNotified = true;
      await input.onSessionStarted(sessionId);
    }
  };
  try {
    await input.mcpServer?.preflight?.();
    const options = buildClaudeAgentSdkOptions({
      executablePath,
      cwd: input.cwd,
      profile: input.profile,
      mode: input.mode,
      abortController,
      mcpServer: input.mcpServer,
    });
    query = (input.query ?? defaultQuery)({ prompt: input.prompt, options });
    await input.onProcessStarted?.();
    watchdogs = createRunWatchdogs({
      ...(input.idleTimeoutMs === undefined ? {} : { idleTimeoutMs: input.idleTimeoutMs }),
      ...(input.maxDurationMs === undefined ? {} : { maxDurationMs: input.maxDurationMs }),
      onTimeout: (kind) => {
        if (timeoutKind !== null) return;
        timeoutKind = kind;
        query?.close();
        abortController.abort(new ClaudeAgentSdkTimeoutError(kind));
      },
    });
    for await (const message of query) {
      watchdogs.recordActivity();
      await appendSdkMessage(stdoutPath, message);
      input.onStructuredActivity?.(message);
      if (message.type === "system" && message.subtype === "init") {
        await observeSession(message.session_id);
      }
      if (message.type === "assistant") {
        partialText += assistantText(message);
      }
      if (message.type === "result") {
        await observeSession(message.session_id);
        resultMessage = message;
      }
    }
  } catch (error) {
    streamError = error;
  } finally {
    watchdogs?.clear();
    if (query !== null && streamError !== null) query.close();
    input.signal?.removeEventListener("abort", abort);
    if (input.closeMcpServer !== false) {
      try {
        await input.mcpServer?.close?.();
      } catch (error) {
        if (streamError === null) streamError = error;
      }
    }
  }

  if (timeoutKind !== null && !isSignalAborted(input.signal)) {
    return fail(timeoutFailure(timeoutKind), observedSessionId, partialText);
  }
  if (resultMessage !== null) {
    if (resultMessage.subtype === "success" && resultMessage.is_error === false) {
      return {
        ok: true,
        finalText: resultMessage.result,
        structuredOutput: resultMessage.structured_output,
        sessionId: resultMessage.session_id,
        usage: normalizeUsage(resultMessage),
        runDir,
        stdoutPath,
        stderrPath,
      };
    }
    if (isSignalAborted(input.signal) || abortController.signal.aborted) {
      return fail(cancelledFailure(), observedSessionId, partialText);
    }
    return fail(classifySdkResult(resultMessage), observedSessionId, partialText);
  }

  if (isSignalAborted(input.signal) || abortController.signal.aborted) {
    return fail(cancelledFailure(), observedSessionId, partialText);
  }
  return fail(
    streamError === null
      ? { code: "claude-protocol-invalid", message: "Claude Code 没有返回完整执行结果。" }
      : classifySdkError(streamError),
    observedSessionId,
    partialText,
  );
}

function timeoutFailure(kind: CodexWatchdogKind): CodexRunFailure {
  return {
    code: "claude-timeout",
    message: kind === "max-duration"
      ? "Claude 执行超时，请重试。"
      : "Claude 执行空闲超时，请重试。",
  };
}

function normalizeUsage(message: SDKResultMessage): ClaudeAgentSdkUsage {
  return {
    usage: message.usage,
    modelUsage: message.modelUsage,
    totalCostUsd: message.total_cost_usd,
    cachedInputTokens: readNumber(message.usage.cache_read_input_tokens),
  };
}

function assistantText(message: Extract<SDKMessage, { type: "assistant" }>): string {
  if (!Array.isArray(message.message.content)) return "";
  return message.message.content
    .map((part) => part.type === "text" ? part.text : "")
    .join("");
}

function classifySdkResult(message: SDKResultError | SDKResultSuccess): CodexRunFailure {
  const details = [
    message.subtype,
    "errors" in message ? message.errors.join(" ") : "",
    "permission_denials" in message ? message.permission_denials.map((item) => item.tool_name).join(" ") : "",
  ].join(" ");
  if (/auth|login|unauthenticated/iu.test(details)) return { code: "claude-auth-required", message: "Claude Code 尚未登录。" };
  if (/rate.?limit|too_many_requests/iu.test(details)) return { code: "claude-rate-limited", message: "Claude 服务当前触发了速率限制，请稍后重试。" };
  if (/billing|credit|payment/iu.test(details)) return { code: "claude-billing-unavailable", message: "Claude 账户当前无法使用推理额度。" };
  if (/permission|tool|denial/iu.test(details)) return { code: "claude-permission-denied", message: "Claude Code 拒绝了当前权限或工具策略。" };
  if (/resume|session/iu.test(details)) return { code: "claude-resume-unavailable", message: "原 Claude 执行已经无法继续。" };
  if (/max_turns|max_budget/iu.test(details)) return { code: "claude-timeout", message: "Claude 执行达到本轮限制。" };
  if (/structured_output/iu.test(details)) return { code: "claude-protocol-invalid", message: "Claude 没有返回符合约定的结构化结果。" };
  return { code: "claude-service-unavailable", message: "Claude Code 本次执行失败，请稍后重试。" };
}

function classifySdkError(error: unknown): CodexRunFailure {
  if (error instanceof ClaudeSessionIdentityError) {
    return { code: "claude-resume-unavailable", message: error.message };
  }
  const message = error instanceof Error ? error.message : String(error);
  if (/auth|login|unauthenticated/iu.test(message)) return { code: "claude-auth-required", message: "Claude Code 尚未登录。" };
  if (/permission|tool|denied/iu.test(message)) return { code: "claude-permission-denied", message: "Claude Code 拒绝了当前权限或工具策略。" };
  if (/resume|session/iu.test(message)) return { code: "claude-resume-unavailable", message: "原 Claude 执行已经无法继续。" };
  return { code: "claude-protocol-invalid", message: "Claude Code 没有返回可用的执行结果。" };
}

function cancelledFailure(): CodexRunFailure {
  return { code: "claude-cancelled", message: "Claude 执行已取消。" };
}

function isSignalAborted(signal: AbortSignal | undefined): boolean {
  return signal?.aborted === true;
}

function readNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

async function appendSdkMessage(pathname: string, message: SDKMessage): Promise<void> {
  await fs.appendFile(pathname, `${JSON.stringify(message)}\n`, { encoding: "utf8", mode: 0o600 });
}

class ClaudeSessionIdentityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ClaudeSessionIdentityError";
  }
}

class ClaudeAgentSdkTimeoutError extends Error {
  constructor(kind: CodexWatchdogKind) {
    super(`Claude Agent SDK ${kind} timeout.`);
    this.name = "ClaudeAgentSdkTimeoutError";
  }
}
