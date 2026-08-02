import {
  buildMoebiusReferenceText,
  plainTextExcerpt,
} from "./session-reference-text.js";
import type {
  LocalConsoleMessage,
  LocalConsoleSessionReferenceScope,
  LocalConsoleSessionSummary,
} from "./types.js";

export function decideSessionSearchCapability(
  available: boolean,
): { kind: "search" } | { kind: "unavailable" } {
  return available ? { kind: "search" } : { kind: "unavailable" };
}

export function decideSessionReferenceRead(
  scope: LocalConsoleSessionReferenceScope,
): { kind: "conversation" } | { kind: "message" } {
  return scope === "message" ? { kind: "message" } : { kind: "conversation" };
}

export function decideSessionReferenceSession(
  session: LocalConsoleSessionSummary | undefined,
): { kind: "missing" } | { kind: "found"; session: LocalConsoleSessionSummary } {
  return session === undefined ? { kind: "missing" } : { kind: "found", session };
}

export function planSessionReferenceRunId(runId: string | null | undefined): string | null {
  return runId ?? null;
}

export function planSessionReferenceTarget(input: {
  scope: LocalConsoleSessionReferenceScope;
  messages: readonly LocalConsoleMessage[];
  runId?: string | null;
  messageId?: number | null;
}): { kind: "conversation" } | { kind: "missing-message" } | { kind: "message"; message: LocalConsoleMessage } {
  if (input.scope === "conversation") return { kind: "conversation" };
  const message = input.messageId == null
    ? [...input.messages].reverse().find((candidate) => candidate.runId === (input.runId ?? null))
    : input.messages.find((candidate) => candidate.id === input.messageId);
  return message === undefined ? { kind: "missing-message" } : { kind: "message", message };
}

export function planSessionReferenceText(input: {
  session: LocalConsoleSessionSummary;
  target: { kind: "conversation" } | { kind: "message"; message: LocalConsoleMessage };
}): string {
  if (input.target.kind === "conversation") {
    return buildMoebiusReferenceText({
      scope: "conversation",
      sessionId: input.session.sessionId,
      title: input.session.title,
    });
  }
  const message = input.target.message;
  return buildMoebiusReferenceText({
    scope: "message",
    sessionId: input.session.sessionId,
    messageId: message.id,
    role: message.role ?? (message.speaker === "user" ? "用户" : "协作者"),
    excerpt: plainTextExcerpt(message.body),
  });
}
