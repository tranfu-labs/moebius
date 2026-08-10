import type { LocalConsoleAgentFile } from "./agent-file.js";
import type { LocalConsoleAgentTeamSnapshot, LocalConsoleMessage } from "./types.js";

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

export function decideWorkerAgentFileSource<T>(snapshot: T | null | undefined):
  | { kind: "fallback" }
  | { kind: "snapshot"; snapshot: T } {
  return snapshot == null ? { kind: "fallback" } : { kind: "snapshot", snapshot };
}

export function planWorkerSnapshotAgents(
  members: LocalConsoleAgentTeamSnapshot["members"],
): LocalConsoleAgentFile[] {
  return members.map((member) => ({
    name: member.name,
    agentMarkdown: member.agentMarkdown,
    executionProfile: member.executionProfile ?? null,
    continuationEnded: member.continuationEnded === true,
  }));
}

export function planWorkerTimelineMessages(messages: readonly LocalConsoleMessage[]): LocalConsoleMessage[] {
  return messages.filter((message) =>
    message.status !== "pending"
    && message.sourceKind !== "local-worker-run");
}

export function decideWorkerAgentMarkdownSource(markdown: string | undefined):
  | { kind: "inline"; markdown: string }
  | { kind: "file" } {
  return markdown === undefined ? { kind: "file" } : { kind: "inline", markdown };
}

export function planWorkerAgentContents(
  agents: readonly LocalConsoleAgentFile[],
  selectedName: string,
  selectedMarkdown: string,
  fileMarkdown: ReadonlyMap<string, string>,
) {
  return agents.map((agent) => ({
    name: agent.name,
    agentMarkdown: agent.name === selectedName
      ? selectedMarkdown
      : agent.agentMarkdown ?? fileMarkdown.get(agent.name)!,
    executionProfile: agent.executionProfile ?? null,
    continuationEnded: agent.continuationEnded === true,
  }));
}

export function decideWorkerAttachmentPreparation(available: boolean): { kind: "prepare" } | { kind: "empty" } {
  return available ? { kind: "prepare" } : { kind: "empty" };
}

export function planWorkerActiveLane(lane: "primary" | "worker" | null | undefined): "primary" | "worker" | null {
  return lane ?? null;
}

/** 主 Agent 派工为该 lane 分配递增序号；用户直达派工不参与覆盖，返回 null。 */
export function planWorkerDispatchSequence(
  current: number | undefined,
  origin: "primary-redirect" | "user-direct",
): number | null {
  return origin === "primary-redirect" ? (current ?? 0) + 1 : null;
}

/** 排队中的旧派工在新派工出现后不得再启动。 */
export function decideWorkerQueuedDispatch(
  latest: number | undefined,
  captured: number | null,
): { kind: "run" } | { kind: "superseded" } {
  return captured !== null && latest !== undefined && latest > captured
    ? { kind: "superseded" }
    : { kind: "run" };
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

export function decideWorkerPreparedRun<T extends { kind: "settled" | "ready" }>(
  preparation: T,
): { kind: "settled" } | { kind: "ready"; preparation: Extract<T, { kind: "ready" }> } {
  return preparation.kind === "settled"
    ? { kind: "settled" }
    : { kind: "ready", preparation: preparation as Extract<T, { kind: "ready" }> };
}

export function decideWorkerSuccessPersistence(
  kind: "processed" | "direct-response" | "detached-response",
): { kind: "processed" } | { kind: "direct" } | { kind: "detached" } {
  return kind === "processed" ? { kind: "processed" } : kind === "direct-response" ? { kind: "direct" } : { kind: "detached" };
}

export function decideWorkerRecoveryPersistence(available: boolean): { kind: "record" } | { kind: "skip" } {
  return available ? { kind: "record" } : { kind: "skip" };
}

export function decideWorkerDetachedCapability(available: boolean): { kind: "record" } | { kind: "missing" } {
  return available ? { kind: "record" } : { kind: "missing" };
}

export function planWorkerGracefulResume(active: { gracefulResumePrepared: boolean } | undefined): boolean {
  return active?.gracefulResumePrepared ?? false;
}

export function planWorkerLastSeenIndex(timeline: readonly { index: number }[]): number {
  return timeline.at(-1)?.index ?? -1;
}

export function decideWorkerStopHandling(input: {
  stopping: boolean;
  origin: "primary-redirect" | "user-direct";
}): { kind: "continue" } | { kind: "stop" } | { kind: "release-and-stop" } {
  if (!input.stopping) return { kind: "continue" };
  return input.origin === "user-direct" ? { kind: "release-and-stop" } : { kind: "stop" };
}

export function decideWorkerTerminalContinuation(
  outcome: "failed" | "succeeded" | "succeeded-directory-unavailable",
): { kind: "stop" } | { kind: "clear-error" } {
  return outcome === "failed" ? { kind: "stop" } : { kind: "clear-error" };
}

export function planWorkerFinalization(active: {
  cwd: string | null;
  terminalRecorded: boolean;
  gracefulResumePrepared: boolean;
} | undefined): {
  cwd: string | null;
  lifecycle: "none" | "pause" | "fail";
} {
  return {
    cwd: active?.cwd ?? null,
    lifecycle: active === undefined || active.terminalRecorded
      ? "none"
      : active.gracefulResumePrepared
        ? "pause"
        : "fail",
  };
}
