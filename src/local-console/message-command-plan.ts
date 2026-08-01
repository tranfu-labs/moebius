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
