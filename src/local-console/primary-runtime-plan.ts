import type { LocalConsoleAgentFile } from "./agent-file.js";

export function planPrimaryProfile<T>(profile: T | null | undefined): T | null {
  return profile ?? null;
}

export function decidePrimaryAgentMarkdownSource(markdown: string | undefined):
  | { kind: "inline"; markdown: string }
  | { kind: "file" } {
  return markdown === undefined ? { kind: "file" } : { kind: "inline", markdown };
}

export function planPrimaryAgentContents(
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
  }));
}

export function decidePrimaryAttachmentPreparation(available: boolean): { kind: "prepare" } | { kind: "empty" } {
  return available ? { kind: "prepare" } : { kind: "empty" };
}

export function decidePrimaryAgentFileSource<T>(snapshot: T | null | undefined):
  | { kind: "fallback" }
  | { kind: "snapshot"; snapshot: T } {
  return snapshot == null ? { kind: "fallback" } : { kind: "snapshot", snapshot };
}

export function planPrimarySnapshotAgents(
  members: readonly {
    name: string;
    agentMarkdown: string;
    executionProfile?: LocalConsoleAgentFile["executionProfile"];
  }[],
): LocalConsoleAgentFile[] {
  return members.map((member) => ({
    name: member.name,
    agentMarkdown: member.agentMarkdown,
    executionProfile: member.executionProfile ?? null,
  }));
}

export function decidePrimaryRecoveryFactSource<T>(store: T | null):
  | { kind: "skip" }
  | { kind: "read"; store: T } {
  return store === null ? { kind: "skip" } : { kind: "read", store };
}

export function decidePrimaryAnalysisContract(input: {
  analysisGateEnabled: boolean;
  role: string;
  primaryAgent: string | null;
}): { kind: "include" } | { kind: "omit" } {
  return input.analysisGateEnabled && input.role === input.primaryAgent ? { kind: "include" } : { kind: "omit" };
}

export function decidePrimaryPreparation<T extends { kind: "settled-unavailable" | "ready" }>(
  preparation: T,
): { kind: "settled" } | { kind: "ready"; preparation: Extract<T, { kind: "ready" }> } {
  return preparation.kind === "settled-unavailable"
    ? { kind: "settled" }
    : { kind: "ready", preparation: preparation as Extract<T, { kind: "ready" }> };
}

export function decidePrimaryLifecycleCreation(resuming: boolean): { kind: "record" } | { kind: "skip" } {
  return resuming ? { kind: "skip" } : { kind: "record" };
}

export function decidePrimaryInactive(inactive: boolean): { kind: "stop" } | { kind: "continue" } {
  return inactive ? { kind: "stop" } : { kind: "continue" };
}

export function decidePrimaryProviderInvocation<T extends { kind: "stopped" | "completed" }>(
  invocation: T,
): { kind: "invalid-stop" } | { kind: "completed"; invocation: Extract<T, { kind: "completed" }> } {
  return invocation.kind === "stopped"
    ? { kind: "invalid-stop" }
    : { kind: "completed", invocation: invocation as Extract<T, { kind: "completed" }> };
}

export function decidePrimaryAnalysisHandling<T extends {
  analysisGateEnabled: boolean;
  role: string;
  primaryAgent: string | null;
  result: { ok: boolean; completionKind?: string };
}>(input: T): { kind: "skip" } | { kind: "apply"; result: T["result"] } {
  return input.analysisGateEnabled
    && input.role === input.primaryAgent
    && input.result.ok
    && input.result.completionKind !== "terminal-tool-result"
    ? { kind: "apply", result: input.result }
    : { kind: "skip" };
}

export function decidePrimaryAnalysisControl(
  control: { action: "proposal" | "confirm"; version: string } | null | undefined,
):
  | { kind: "proposal"; version: string }
  | { kind: "confirm"; version: string }
  | { kind: "skip" } {
  if (control?.action === "proposal") return { kind: "proposal", version: control.version };
  if (control?.action === "confirm") return { kind: "confirm", version: control.version };
  return { kind: "skip" };
}

export function decidePrimaryAnalysisConfirmation(input: {
  currentVersion: string | null;
  confirmedVersion: string;
  observedExternalSessionId: string | null;
  resultExternalSessionId: string | null;
}): { kind: "reject" } | { kind: "execute"; externalSessionId: string } {
  const externalSessionId = input.observedExternalSessionId ?? input.resultExternalSessionId;
  return input.currentVersion === input.confirmedVersion && externalSessionId !== null
    ? { kind: "execute", externalSessionId }
    : { kind: "reject" };
}

export function decidePrimaryResumedSession(
  observedExternalSessionId: string,
  expectedExternalSessionId: string,
): { kind: "accept" } | { kind: "reject" } {
  return observedExternalSessionId === expectedExternalSessionId
    ? { kind: "accept" }
    : { kind: "reject" };
}

export function decidePrimaryRecoveryPersistence(
  available: boolean,
): { kind: "record" } | { kind: "skip" } {
  return available ? { kind: "record" } : { kind: "skip" };
}

export function decidePrimarySuccessPersistence(
  kind: "processed" | "direct-response" | "detached-response",
): { kind: "processed" } | { kind: "response" } {
  return kind === "processed" ? { kind: "processed" } : { kind: "response" };
}

export function planPrimaryGracefulResume(
  active: { gracefulResumePrepared: boolean } | undefined,
): boolean {
  return active?.gracefulResumePrepared ?? false;
}

export function planPrimaryLastSeenIndex(timeline: readonly { index: number }[]): number {
  return timeline.at(-1)?.index ?? -1;
}

export function decidePrimaryClaim<T>(message: T | null): { kind: "stop" } | { kind: "claimed"; message: T } {
  return message === null ? { kind: "stop" } : { kind: "claimed", message };
}

export function planPrimaryRunId(
  targets: readonly { sourceMessageId: number; targetRunId: string }[],
  sourceMessageId: number,
  freshRunId: string,
): string {
  return targets.find((target) => target.sourceMessageId === sourceMessageId)?.targetRunId ?? freshRunId;
}

export function planPrimaryAgentName(agents: readonly { name: string }[]): string | null {
  return agents[0]?.name ?? null;
}

export function planPrimaryTimelineMessages<T extends { status: string; sourceKind?: string | null }>(
  messages: readonly T[],
): T[] {
  return messages.filter((message) => message.status !== "pending" && message.sourceKind !== "local-worker-run");
}

export function planPrimaryControlAction<T>(action: T): T {
  return action;
}

export function decidePrimaryControlRetryLookup(input: {
  actionKind: string;
  sourceSpeaker: string;
}): { kind: "read" } | { kind: "skip" } {
  return input.actionKind === "complete-source" && input.sourceSpeaker === "agent"
    ? { kind: "read" }
    : { kind: "skip" };
}

export function decidePrimaryRouteResult(kind: string): { kind: "stop" } | { kind: "continue" } {
  return kind === "retry" ? { kind: "stop" } : { kind: "continue" };
}

export function planPrimaryProposalVersion(version: string | null | undefined): string | null {
  return version ?? null;
}

export function decidePrimaryDispatchContinuation<T extends { kind: "stop" | "continue" | "run" }>(
  outcome: T,
):
  | { kind: "stop" }
  | { kind: "continue" }
  | { kind: "run"; outcome: Extract<T, { kind: "run" }> } {
  if (outcome.kind === "stop") return { kind: "stop" };
  if (outcome.kind === "continue") return { kind: "continue" };
  return { kind: "run", outcome: outcome as Extract<T, { kind: "run" }> };
}

export function decidePrimaryExecutionPreparation<T extends { kind: "settled" | "ready" }>(
  preparation: T,
): { kind: "stop" } | { kind: "run"; preparation: Extract<T, { kind: "ready" }> } {
  return preparation.kind === "settled"
    ? { kind: "stop" }
    : { kind: "run", preparation: preparation as Extract<T, { kind: "ready" }> };
}

export function decidePrimaryTerminalContinuation(
  outcome: "failed" | "succeeded" | "succeeded-directory-unavailable",
): { kind: "continue" } | { kind: "stop" } {
  return outcome === "succeeded" ? { kind: "continue" } : { kind: "stop" };
}

export function planPrimaryFailurePersistence<T>(input: {
  message: T | null;
  runId: string | null;
  runDir: string | null;
}): { kind: "skip" } | { kind: "record"; message: T; runId: string; runDir: string | null } {
  return input.message === null || input.runId === null
    ? { kind: "skip" }
    : { kind: "record", message: input.message, runId: input.runId, runDir: input.runDir };
}

export function planPrimaryFinalization<T extends {
  cwd: string | null;
  terminalRecorded: boolean;
  gracefulResumePrepared: boolean;
}>(input: {
  runId: string | null;
  active: T | undefined;
}):
  | { kind: "skip" }
  | { kind: "finalize"; runId: string; cwd: string | null; lifecycle: "none" | "pause" | "fail" } {
  if (input.runId === null) return { kind: "skip" };
  const active = input.active;
  const lifecycle = active === undefined || active.terminalRecorded
    ? "none"
    : active.gracefulResumePrepared
      ? "pause"
      : "fail";
  return { kind: "finalize", runId: input.runId, cwd: active?.cwd ?? null, lifecycle };
}
