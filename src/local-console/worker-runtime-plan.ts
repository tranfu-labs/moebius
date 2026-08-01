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

export function decideWorkerOriginEffect(
  origin: "primary-redirect" | "user-direct",
): { kind: "direct" } | { kind: "detached" } {
  return origin === "user-direct" ? { kind: "direct" } : { kind: "detached" };
}

export function decideWorkerLifecycleCreation(resuming: boolean): { kind: "skip" } | { kind: "record" } {
  return resuming ? { kind: "skip" } : { kind: "record" };
}

export function planWorkerSourceDisposition(
  origin: "primary-redirect" | "user-direct",
): "user-direct" | "agent-handoff" {
  return origin === "user-direct" ? "user-direct" : "agent-handoff";
}

export function planWorkerProfile<T>(profile: T | null | undefined): T | null {
  return profile ?? null;
}

export function decideWorkerPreparation<T extends { kind: "settled-unavailable" | "ready" }>(
  preparation: T,
): { kind: "settled" } | { kind: "continue"; preparation: Extract<T, { kind: "ready" }> } {
  return preparation.kind === "settled-unavailable"
    ? { kind: "settled" }
    : { kind: "continue", preparation: preparation as Extract<T, { kind: "ready" }> };
}

export function decideWorkerProviderInvocation<T extends { kind: "stopped" | "completed" }>(
  invocation: T,
): { kind: "stopped" } | { kind: "completed"; invocation: Extract<T, { kind: "completed" }> } {
  return invocation.kind === "stopped"
    ? { kind: "stopped" }
    : { kind: "completed", invocation: invocation as Extract<T, { kind: "completed" }> };
}
