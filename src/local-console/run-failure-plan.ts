import type { CodexRunResult } from "../codex.js";
import type {
  LocalConsoleExecutionProfile,
  LocalConsoleMessage,
  LocalConsoleSystemEventKind,
  LocalConsoleTerminal,
} from "./types.js";

type FailedResult = Extract<CodexRunResult, { ok: false }>;
type TimeoutKind = "idle" | "tool" | "max-duration" | null;
type InterruptionCause = "user" | "redirect" | "context-unavailable" | "runtime-closing" | "system" | null;

export function planActiveFailureContext(active: {
  runId: string;
  gracefulResumePrepared: boolean;
  liveMarkdown: string | null;
  profile: LocalConsoleExecutionProfile | null;
} | undefined): {
  runId: string | null;
  gracefulResumePrepared: boolean;
  liveMarkdown: string | null;
  profile: LocalConsoleExecutionProfile | null;
} {
  return active === undefined
    ? { runId: null, gracefulResumePrepared: false, liveMarkdown: null, profile: null }
    : active;
}

export type DirectRunFailurePlan =
  | { kind: "skip-graceful" }
  | { kind: "stuck"; logEvent: "local-console-codex-idle-timeout" | "local-console-codex-watchdog-timeout" }
  | { kind: "interrupted"; cause: "context-unavailable" | "redirect" | "user" | "system" }
  | { kind: "failed"; body: string | undefined };

export function planDirectRunFailure(input: {
  result: FailedResult;
  runId: string;
  activeRunId: string | null;
  gracefulResumePrepared: boolean;
  timeoutKind: TimeoutKind;
  interrupted: boolean;
  cause: InterruptionCause;
}): DirectRunFailurePlan {
  if (input.timeoutKind !== null) {
    return {
      kind: "stuck",
      logEvent: input.timeoutKind === "idle"
        ? "local-console-codex-idle-timeout"
        : "local-console-codex-watchdog-timeout",
    };
  }
  if (input.interrupted) {
    if (input.cause === "runtime-closing"
      && input.activeRunId === input.runId
      && input.gracefulResumePrepared) return { kind: "skip-graceful" };
    const cause = input.cause === "context-unavailable"
      ? "context-unavailable"
      : input.cause === "redirect"
        ? "redirect"
        : input.cause === "user" ? "user" : "system";
    return { kind: "interrupted", cause };
  }
  return { kind: "failed", body: input.result.failure?.message };
}

export type DetachedRunFailurePlan =
  | { kind: "release-graceful-placeholder" }
  | { kind: "stuck"; body: string; systemEventKind: "run-stuck"; status: "stuck" }
  | { kind: "interrupted"; body: string; systemEventKind: LocalConsoleSystemEventKind; status: "interrupted" }
  | { kind: "failed"; body: string; systemEventKind: "run-not-started"; status: "failed" };

export function planDetachedRunFailure(input: {
  result: FailedResult;
  gracefulResumePrepared: boolean;
  timeoutKind: TimeoutKind;
  interrupted: boolean;
  cause: InterruptionCause;
}): DetachedRunFailurePlan {
  if (input.cause === "runtime-closing" && input.gracefulResumePrepared) {
    return { kind: "release-graceful-placeholder" };
  }
  if (input.timeoutKind !== null) {
    const toolTimeout = input.result.terminal?.kind === "timeout" && input.result.terminal.basis === "tool";
    return {
      kind: "stuck",
      body: toolTimeout
        ? "这一步的工具调用运行过久，已经停下。你可以直接告诉主理人下一步怎么处理。"
        : "这一步卡住了。你可以直接告诉主理人下一步怎么处理。",
      systemEventKind: "run-stuck",
      status: "stuck",
    };
  }
  if (input.interrupted) {
    const contextUnavailable = input.cause === "context-unavailable";
    const redirected = input.cause === "redirect";
    const systemStopped = input.cause === "runtime-closing" || input.cause === "system";
    return {
      kind: "interrupted",
      body: contextUnavailable
        ? "这一步依赖的项目或团队内容已经不可用，因此已停止。已经产生的文件改动会保留。"
        : redirected
          ? "主理人发来了新的指令，当前这一步已经停下；这个成员会带着新指令重新开始。"
          : systemStopped
            ? "这一步被系统停止了。已经产生的文件改动会保留。"
            : "你让这一步停下了。已经产生的文件改动会保留。",
      systemEventKind: redirected || contextUnavailable || systemStopped ? "other" : "user-stopped",
      status: "interrupted",
    };
  }
  return {
    kind: "failed",
    body: input.result.failure?.message ?? "这一步没跑起来。你可以直接告诉主理人下一步怎么处理。",
    systemEventKind: "run-not-started",
    status: "failed",
  };
}

const START_FAILURE_MAX_ATTEMPTS = 3;

/**
 * PRD boundary: a failure with no agent-visible output is "did not start" —
 * re-running duplicates nothing the user saw, so it may retry silently.
 * Four things force a terminal record instead: visible output (a re-run would
 * duplicate work), a non-user source, an engine-authored diagnostic (that
 * message is actionable; silently retrying would replace it with a generic
 * dead letter), or an already-observed external session — the prompt has been
 * consumed remotely, so an automatic full re-run would double-send it.
 */
export function decideStartFailureRecovery(input: {
  speaker: LocalConsoleMessage["speaker"];
  failureCount: number;
  partialMarkdown: string | null | undefined;
  liveMarkdown: string | null | undefined;
  diagnosticBody: string | undefined;
  observedExternalSessionId: string | null;
  failureRetryLimit: number | undefined;
}): { kind: "terminal" } | { kind: "retry" } | { kind: "dead-letter"; attempt: number } {
  const visibleOutput = (input.partialMarkdown ?? input.liveMarkdown ?? "").trim();
  const forcedTerminal = input.speaker !== "user"
    || visibleOutput !== ""
    || input.diagnosticBody !== undefined
    || input.observedExternalSessionId !== null;
  if (forcedTerminal) return { kind: "terminal" };
  const attempt = input.failureCount + 1;
  const maxAttempts = input.failureRetryLimit ?? START_FAILURE_MAX_ATTEMPTS;
  return attempt < maxAttempts ? { kind: "retry" } : { kind: "dead-letter", attempt };
}

export function planGracefulWorkerPlaceholder(
  messages: readonly LocalConsoleMessage[],
  runId: string,
): { kind: "missing" } | { kind: "release"; messageId: number } {
  const placeholder = messages.find((message) =>
    message.runId === runId && message.sourceKind === "local-worker-run");
  return placeholder === undefined ? { kind: "missing" } : { kind: "release", messageId: placeholder.id };
}

export function planFailureRecordFields(
  body: string | undefined,
  terminal: LocalConsoleTerminal | null | undefined,
): { body?: string; terminal?: LocalConsoleTerminal } {
  return {
    ...(body === undefined ? {} : { body }),
    ...(terminal == null ? {} : { terminal }),
  };
}

export function planTerminalRecordField(
  terminal: LocalConsoleTerminal | null | undefined,
): {} | { terminal: LocalConsoleTerminal } {
  return terminal == null ? {} : { terminal };
}

export function decideDetachedTerminalCapability<T>(capability: T | undefined):
  | { kind: "fallback" }
  | { kind: "record"; capability: T } {
  return capability === undefined
    ? { kind: "fallback" }
    : { kind: "record", capability };
}
