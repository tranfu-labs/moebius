import type { ExecutionProgressEvent } from "../execution-contract.js";
import type { LocalConsoleRunTiming } from "./types.js";
import type { ActiveLocalRun } from "./active-run.js";
import type { LocalCodexResumeIntentFact } from "./codex-resume.js";
import {
  chooseLatestRunActivity,
  type LocalRunActivity,
} from "./run-activity.js";
import type { LocalRunLifecycleActiveRun } from "./run-lifecycle-contracts.js";

export function planRunsForSession(
  runs: Iterable<LocalRunLifecycleActiveRun>,
  sessionId: string,
): LocalRunLifecycleActiveRun[] {
  return [...runs]
    .filter((active) => active.sessionId === sessionId)
    .sort((left, right) => left.createdAt.localeCompare(right.createdAt) || left.runId.localeCompare(right.runId));
}

export function planRunForLane(
  runs: readonly LocalRunLifecycleActiveRun[],
  lane: LocalRunLifecycleActiveRun["lane"],
): LocalRunLifecycleActiveRun | undefined {
  return runs.find((active) => active.lane === lane);
}

export function planRunForRole(
  runs: readonly LocalRunLifecycleActiveRun[],
  role: string,
): LocalRunLifecycleActiveRun | undefined {
  return runs.find((active) => active.role === role);
}

export function planRunElapsedMs(
  active: LocalRunLifecycleActiveRun,
  nowMs: number,
): number {
  const segmentElapsedMs = active.segmentStartedAt === null
    ? 0
    : Math.max(0, nowMs - Date.parse(active.segmentStartedAt));
  return active.accumulatedMs + segmentElapsedMs;
}

export function planRunSnapshotElapsedMs(
  active: LocalRunLifecycleActiveRun,
  nowMs: number,
): number | null {
  return active.startedAt === null ? null : planRunElapsedMs(active, nowMs);
}

export function planLongRunActivity(input: {
  reported: boolean;
  elapsedMs: number | null;
  reportMs: number;
  cursor: number;
  previousActivity: LocalRunActivity | null;
  occurredAt: string;
}): { kind: "skip" } | { kind: "record"; activity: LocalRunActivity } {
  if (input.reported || input.elapsedMs === null || input.elapsedMs < input.reportMs) return { kind: "skip" };
  const elapsedMinutes = Math.max(1, Math.floor(input.elapsedMs / 60_000));
  return {
    kind: "record",
    activity: {
      cursor: input.cursor,
      kind: "progress",
      phase: "running",
      action: `已经运行 ${String(elapsedMinutes)} 分钟，${input.previousActivity?.action ?? "仍在继续"}`,
      object: input.previousActivity?.object ?? null,
      occurredAt: input.occurredAt,
    },
  };
}

export function decideActiveRun<T>(active: T | undefined): { kind: "skip" } | { kind: "use"; active: T } {
  return active === undefined ? { kind: "skip" } : { kind: "use", active };
}

export function decideProjectedActivity<T>(activity: T | null): { kind: "skip" } | { kind: "use"; activity: T } {
  return activity === null ? { kind: "skip" } : { kind: "use", activity };
}

export function planActivityChange(
  current: LocalRunActivity | null,
  candidate: LocalRunActivity,
): { kind: "skip" } | { kind: "record"; activity: LocalRunActivity } {
  const next = chooseLatestRunActivity(current, candidate);
  return next === current ? { kind: "skip" } : { kind: "record", activity: next };
}

export function decideLifecycleStore<T>(store: T | null): { kind: "skip" } | { kind: "use"; store: T } {
  return store === null ? { kind: "skip" } : { kind: "use", store };
}

export function decideRunStart(
  active: LocalRunLifecycleActiveRun | undefined,
): { kind: "skip" } | { kind: "start"; active: LocalRunLifecycleActiveRun } {
  return active === undefined || active.segmentStartedAt !== null
    ? { kind: "skip" }
    : { kind: "start", active };
}

export function decideRunTerminal(
  active: LocalRunLifecycleActiveRun | undefined,
): { kind: "skip" } | { kind: "record"; active: LocalRunLifecycleActiveRun } {
  return active === undefined || active.terminalRecorded
    ? { kind: "skip" }
    : { kind: "record", active };
}

export function decideResumeTimingLookup<T>(
  resumeExisting: boolean,
  store: T | null,
): { kind: "skip" } | { kind: "lookup"; store: T } {
  return resumeExisting && store !== null ? { kind: "lookup", store } : { kind: "skip" };
}

export function decideReusableRunTiming(
  timing: LocalConsoleRunTiming | null,
  stepId: string,
): { kind: "new" } | { kind: "reuse"; timing: LocalConsoleRunTiming } {
  return timing !== null && timing.stepId === stepId
    ? { kind: "reuse", timing }
    : { kind: "new" };
}

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
