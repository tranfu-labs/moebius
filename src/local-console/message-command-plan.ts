import { assertTextFragments } from "./runtime-domain.js";
import { serializeTextFragmentReferences } from "./session-reference-text.js";
import type {
  LocalConsoleMessage,
  LocalConsoleSessionSummary,
  LocalConsoleTextFragment,
} from "./types.js";
import type { LocalUserMessageDispatch } from "./user-message-routing.js";

export function planSubmittedMessageContent(input: {
  body: string;
  attachmentIds: readonly string[];
  textFragments: readonly LocalConsoleTextFragment[];
}): { trimmed: string; persistedBody: string; attachmentIds: string[] } {
  const trimmed = input.body.trim();
  if (trimmed === "" && input.attachmentIds.length === 0) throw new Error("Message body must not be empty");
  if (new Set(input.attachmentIds).size !== input.attachmentIds.length) {
    throw new Error("Attachment ids must be unique");
  }
  assertTextFragments(input.textFragments);
  return {
    trimmed,
    persistedBody: serializeTextFragmentReferences(trimmed, input.textFragments),
    attachmentIds: [...input.attachmentIds],
  };
}

export function decidePrimaryMessageAdmission(input: {
  activePrimary: boolean;
  persistedPrimary: boolean;
}): { kind: "accept" } | { kind: "busy" } {
  return !input.activePrimary && input.persistedPrimary ? { kind: "busy" } : { kind: "accept" };
}

export function decideSubmittedMessageDispatch(
  session: LocalConsoleSessionSummary,
):
  | { kind: "awaiting-team"; dispatch: { lane: "awaiting-team"; role: null; reason: "no-valid-mention" } }
  | { kind: "resolve" } {
  return session.agentTeamPendingId !== null
    ? { kind: "awaiting-team", dispatch: { lane: "awaiting-team", role: null, reason: "no-valid-mention" } }
    : { kind: "resolve" };
}

export function decideEditResumeRecord(input: {
  resumeRunId: string | undefined;
  link: { role: string } | undefined;
}): { kind: "skip" } | { kind: "record"; targetRunId: string; role: string } {
  return input.resumeRunId === undefined || input.link === undefined
    ? { kind: "skip" }
    : { kind: "record", targetRunId: input.resumeRunId, role: input.link.role };
}

export function decideEditResumeLinkRead(
  resumeRunId: string | undefined,
): { kind: "skip" } | { kind: "read"; runId: string } {
  return resumeRunId === undefined ? { kind: "skip" } : { kind: "read", runId: resumeRunId };
}

export function decideSubmittedMessageWake(
  dispatch: LocalUserMessageDispatch | { lane: "awaiting-team"; role: null; reason: "no-valid-mention" },
): { kind: "worker" } | { kind: "primary" } {
  return dispatch.lane === "worker" ? { kind: "worker" } : { kind: "primary" };
}

export function planPendingMessageUpdate(
  message: LocalConsoleMessage,
): LocalConsoleMessage {
  return message;
}

export function planPersistedPrimaryRun(messages: readonly LocalConsoleMessage[]): boolean {
  return messages.some((message) =>
    message.speaker === "user"
    && message.status === "running"
    && message.dispatchLane !== "worker");
}

export function decideMessageAgentSource<T>(snapshot: T | null | undefined):
  | { kind: "files" }
  | { kind: "snapshot"; snapshot: T } {
  return snapshot == null ? { kind: "files" } : { kind: "snapshot", snapshot };
}

export function planMessagePrimaryAgent(agentNames: readonly string[]):
  | { kind: "missing" }
  | { kind: "found"; primaryAgent: string } {
  const primaryAgent = agentNames[0];
  return primaryAgent === undefined
    ? { kind: "missing" }
    : { kind: "found", primaryAgent };
}

export function decideMessageRecoveryStore<T>(store: T | null):
  | { kind: "unavailable" }
  | { kind: "available"; store: T } {
  return store === null ? { kind: "unavailable" } : { kind: "available", store };
}

export function planMessageResumeLink<
  TExecution extends { runId: string; role: string },
  TCodex extends { runId: string; role: string },
>(
  executionLinks: readonly TExecution[],
  codexLinks: readonly TCodex[],
  runId: string,
): TExecution | TCodex | undefined {
  return executionLinks.find((candidate) => candidate.runId === runId)
    ?? codexLinks.find((candidate) => candidate.runId === runId);
}
