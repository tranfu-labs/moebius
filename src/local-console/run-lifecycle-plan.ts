import type { ExecutionProgressEvent } from "../execution-contract.js";
import type { LocalConsoleRunTiming } from "./types.js";
import type { ActiveLocalRun } from "./active-run.js";
import type { LocalCodexResumeIntentFact } from "./codex-resume.js";

export function planRunStartedPhase(
  resuming: boolean,
): "started" | "resumed" {
  return resuming ? "resumed" : "started";
}

export function planExecutionProgressActivity(
  event: ExecutionProgressEvent,
): { kind: "skip" } | { kind: "record"; action: string } {
  if (event.kind !== "provider-retry") return { kind: "skip" };
  return {
    kind: "record",
    action: event.attempt === undefined
      ? "对方服务繁忙，正在重试"
      : `对方服务繁忙，正在第 ${String(event.attempt)} 次重试`,
  };
}

export function planRunLifecycleRecord(input: {
  phase: "created" | "started" | "paused" | "resumed" | "terminal";
  status: LocalConsoleRunTiming["status"];
  startedAt: string | null;
  elapsedMs: number;
  recordedAt: string;
}): { elapsedMs: number | null; completedAt: string | null } {
  const includeElapsed = input.phase === "paused" || input.phase === "resumed" || input.phase === "terminal";
  return {
    elapsedMs: input.startedAt === null || !includeElapsed ? null : input.elapsedMs,
    completedAt: input.phase === "terminal" && input.status !== "paused" ? input.recordedAt : null,
  };
}

export function decideRunAttemptSource(
  storeAvailable: boolean,
): { kind: "fallback"; attempt: 1 } | { kind: "persisted" } {
  return storeAvailable ? { kind: "persisted" } : { kind: "fallback", attempt: 1 };
}

export function decideRuntimeShutdownStart(closing: boolean): { kind: "skip" } | { kind: "close" } {
  return closing ? { kind: "skip" } : { kind: "close" };
}

export function planGracefulShutdownResume(input: {
  active: ActiveLocalRun;
  intentId: string;
  createdAt: string;
}): { kind: "skip" } | { kind: "record"; intent: LocalCodexResumeIntentFact } {
  if (input.active.threadId === null || input.active.role === null || input.active.role === "") {
    return { kind: "skip" };
  }
  return {
    kind: "record",
    intent: {
      sessionId: input.active.sessionId,
      intentId: input.intentId,
      targetRunId: input.active.runId,
      sourceMessageId: input.active.userMessageId,
      role: input.active.role,
      reason: "graceful-shutdown",
      sourceDisposition: input.active.sourceDisposition,
      createdAt: input.createdAt,
    },
  };
}

export function decideShutdownDrain(input: {
  pending: boolean;
  workers: boolean;
  beforeDeadline: boolean;
}): { kind: "wait" } | { kind: "finish" } {
  return (input.pending || input.workers) && input.beforeDeadline
    ? { kind: "wait" }
    : { kind: "finish" };
}
