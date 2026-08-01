export function decideWorkerClaimCapability(available: boolean): { kind: "dispatch" } | { kind: "skip" } {
  return available ? { kind: "dispatch" } : { kind: "skip" };
}

export function decideWorkerWakeCheckpoint(input: {
  stopping: boolean;
  workspaceAvailable?: boolean;
}): { kind: "continue" } | { kind: "stop" } {
  return input.stopping || input.workspaceAvailable === false ? { kind: "stop" } : { kind: "continue" };
}

export function decideWorkerClaimRelease(stopping: boolean): { kind: "keep" } | { kind: "release" } {
  return stopping ? { kind: "release" } : { kind: "keep" };
}

export function decideWorkerRedirectAbort(input: {
  origin: "primary-redirect" | "user-direct";
  activeLane: "primary" | "worker" | null;
}): { kind: "abort" } | { kind: "keep" } {
  return input.origin === "primary-redirect" && input.activeLane === "worker"
    ? { kind: "abort" }
    : { kind: "keep" };
}

export function decideWorkerTaskRelease<T>(current: T | undefined, task: T): { kind: "release" } | { kind: "keep" } {
  return current === task ? { kind: "release" } : { kind: "keep" };
}

export function decideWorkerContextFailureReport(stopping: boolean): { kind: "report" } | { kind: "ignore" } {
  return stopping ? { kind: "ignore" } : { kind: "report" };
}

export function decideWorkerOutstandingWork(wakeCount: number, laneCount: number): { kind: "pending" } | { kind: "idle" } {
  return wakeCount > 0 || laneCount > 0 ? { kind: "pending" } : { kind: "idle" };
}

export function decideWorkerRunId(resumeRunId: string | null): { kind: "resume"; runId: string } | { kind: "fresh" } {
  return resumeRunId === null ? { kind: "fresh" } : { kind: "resume", runId: resumeRunId };
}

export function planWorkerActiveLane(lane: "primary" | "worker" | null | undefined): "primary" | "worker" | null {
  return lane ?? null;
}

export function planPreviousWorkerTask<T>(current: T | undefined, idle: T): T {
  return current ?? idle;
}
