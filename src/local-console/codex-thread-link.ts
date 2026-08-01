import type { LocalConsoleMessage } from "./types.js";

export interface LocalCodexThreadLinkFact {
  sessionId: string;
  runId: string;
  sourceMessageId: number;
  role: string;
  threadId: string;
  startedAt: string;
  contextFingerprint?: string | null;
}

export interface LocalProcessPublicAttachment {
  kind: "image" | "file";
  displayName: string;
  mediaType: string;
  byteSize: number;
}

export interface LocalProcessPublicMessage {
  key: string;
  kind: "public-message";
  messageId: number;
  speaker: "user" | "agent";
  role: string | null;
  markdown: string;
  attachments: LocalProcessPublicAttachment[];
  timestamp: string;
}

export function projectCodexThreadLinks(
  values: readonly unknown[],
  sessionId: string,
): LocalCodexThreadLinkFact[] {
  const links = new Map<string, LocalCodexThreadLinkFact>();
  for (const [index, value] of values.entries()) {
    if (!isRecord(value) || value.sessionId !== sessionId) {
      throw new Error(`invalid session fact event ${sessionId} line ${String(index + 1)}`);
    }
    if (value.type !== "codex_thread_link") {
      continue;
    }
    const fact = parseThreadLink(value.payload, sessionId, index + 1);
    const current = links.get(fact.runId);
    if (current !== undefined && !sameThreadLink(current, fact)) {
      throw new Error(`conflicting Codex thread links for run ${fact.runId}`);
    }
    links.set(fact.runId, current ?? fact);
  }
  return [...links.values()].sort(
    (left, right) => left.startedAt.localeCompare(right.startedAt) || left.runId.localeCompare(right.runId),
  );
}

function sameThreadLink(
  left: LocalCodexThreadLinkFact,
  right: LocalCodexThreadLinkFact,
): boolean {
  return left.sessionId === right.sessionId
    && left.runId === right.runId
    && left.sourceMessageId === right.sourceMessageId
    && left.role === right.role
    && left.threadId === right.threadId
    && left.startedAt === right.startedAt
    && left.contextFingerprint === right.contextFingerprint;
}

export function restorePublicInput(
  messages: LocalConsoleMessage[],
  sourceMessageId: number,
  runId: string,
): LocalProcessPublicMessage[] {
  const sourceIndex = messages.findIndex((message) => message.id === sourceMessageId);
  if (sourceIndex < 0) {
    throw new Error(`source message not found: ${String(sourceMessageId)}`);
  }
  return messages
    .slice(0, sourceIndex + 1)
    .filter(
      (message): message is LocalConsoleMessage & { speaker: "user" | "agent" } =>
        (message.speaker === "user" || message.speaker === "agent")
        && message.sourceKind !== "local-worker-run"
        && !(message.speaker === "user" && message.status === "pending"),
    )
    .map((message) => ({
      key: `${runId}:public:${String(message.id)}`,
      kind: "public-message",
      messageId: message.id,
      speaker: message.speaker,
      role: message.role,
      markdown: message.body,
      attachments: (message.attachments ?? []).map((attachment) => ({
        kind: attachment.kind,
        displayName: attachment.displayName,
        mediaType: attachment.mediaType,
        byteSize: attachment.byteSize,
      })),
      timestamp: message.createdAt,
    }));
}

function parseThreadLink(
  value: unknown,
  sessionId: string,
  lineNumber: number,
): LocalCodexThreadLinkFact {
  if (!isRecord(value)) {
    throw new Error(`invalid Codex thread link ${sessionId} line ${String(lineNumber)}`);
  }
  const payloadSessionId = readString(value.sessionId, "sessionId");
  if (payloadSessionId !== sessionId) {
    throw new Error(`invalid Codex thread link session ${sessionId} line ${String(lineNumber)}`);
  }
  return {
    sessionId,
    runId: readString(value.runId, "runId"),
    sourceMessageId: readInteger(value.sourceMessageId, "sourceMessageId"),
    role: readString(value.role, "role"),
    threadId: readString(value.threadId, "threadId"),
    startedAt: readString(value.startedAt, "startedAt"),
    ...(typeof value.contextFingerprint === "string"
      ? { contextFingerprint: value.contextFingerprint }
      : {}),
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`invalid Codex thread link ${field}`);
  }
  return value;
}

function readInteger(value: unknown, field: string): number {
  if (typeof value !== "number" || !Number.isInteger(value)) {
    throw new Error(`invalid Codex thread link ${field}`);
  }
  return value;
}
