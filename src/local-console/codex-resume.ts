import fs from "node:fs/promises";
import type { LocalCodexThreadLinkFact } from "./codex-thread-link.js";

export type LocalCodexResumeReason = "graceful-shutdown" | "retry" | "edit-resend";
export type LocalCodexResumeMode = "resume" | "full-fallback" | "unavailable";

export interface LocalCodexResumeIntentFact {
  sessionId: string;
  intentId: string;
  targetRunId: string;
  sourceMessageId: number;
  role: string;
  reason: LocalCodexResumeReason;
  createdAt: string;
}

export interface LocalCodexResumeConsumedFact {
  sessionId: string;
  intentId: string;
  resumedByRunId: string;
  mode: LocalCodexResumeMode;
  reason: string;
  consumedAt: string;
}

export interface LocalCodexRunUsageFact {
  sessionId: string;
  runId: string;
  cachedInputTokens: number | null;
  recordedAt: string;
}

export interface LocalCodexRecoveryFacts {
  intents: LocalCodexResumeIntentFact[];
  consumedIntentIds: Set<string>;
}

export type LocalCodexRecoveryPlan =
  | { kind: "full"; intent: null; reason: "no-resume-intent" }
  | {
      kind: "resume";
      intent: LocalCodexResumeIntentFact;
      threadId: string;
      reason: "compatible";
    }
  | {
      kind: "full-fallback";
      intent: LocalCodexResumeIntentFact;
      reason:
        | "thread-link-missing"
        | "source-mismatch"
        | "role-mismatch"
        | "legacy-thread-link"
        | "context-mismatch"
        | "rollout-unavailable";
    };

export function planLocalCodexRecovery(input: {
  sourceMessageId: number;
  role: string;
  contextFingerprint: string;
  intents: LocalCodexResumeIntentFact[];
  consumedIntentIds: ReadonlySet<string>;
  threadLinks: LocalCodexThreadLinkFact[];
}): LocalCodexRecoveryPlan {
  const intent = [...input.intents]
    .reverse()
    .find((candidate) =>
      candidate.sourceMessageId === input.sourceMessageId
      && !input.consumedIntentIds.has(candidate.intentId));
  if (intent === undefined) {
    return { kind: "full", intent: null, reason: "no-resume-intent" };
  }
  const link = input.threadLinks.find((candidate) => candidate.runId === intent.targetRunId);
  if (link === undefined) {
    return { kind: "full-fallback", intent, reason: "thread-link-missing" };
  }
  if (link.sourceMessageId !== intent.sourceMessageId && intent.reason !== "edit-resend") {
    return { kind: "full-fallback", intent, reason: "source-mismatch" };
  }
  if (link.role !== intent.role || intent.role !== input.role) {
    return { kind: "full-fallback", intent, reason: "role-mismatch" };
  }
  if (link.contextFingerprint == null) {
    return { kind: "full-fallback", intent, reason: "legacy-thread-link" };
  }
  if (link.contextFingerprint !== input.contextFingerprint) {
    return { kind: "full-fallback", intent, reason: "context-mismatch" };
  }
  return { kind: "resume", intent, threadId: link.threadId, reason: "compatible" };
}

export function buildLocalResumePrompt(input: {
  reason: LocalCodexResumeReason;
  correctionBody?: string;
}): string {
  if (input.reason === "edit-resend") {
    return [
      "继续刚才未完成的同一次执行。",
      "用户已修正原指令；下面的新指令覆盖与原指令冲突的部分。先检查当前工作空间状态，避免重复已经完成的副作用。",
      "",
      input.correctionBody?.trim() ?? "",
    ].join("\n");
  }
  return [
    "继续刚才未完成的同一次执行。",
    "先检查当前工作空间状态，从中断处继续，避免重复已经完成的文件或外部副作用。",
  ].join("\n");
}

export async function readLocalCodexRecoveryFacts(
  logPath: string,
  sessionId: string,
): Promise<LocalCodexRecoveryFacts> {
  const events = await readCompleteFactEvents(logPath, sessionId);
  const intents: LocalCodexResumeIntentFact[] = [];
  const consumedIntentIds = new Set<string>();
  for (const event of events) {
    if (event.type === "codex_resume_intent") {
      intents.push(parseResumeIntent(event.payload, sessionId));
    } else if (event.type === "codex_resume_consumed") {
      consumedIntentIds.add(parseResumeConsumed(event.payload, sessionId).intentId);
    }
  }
  return { intents, consumedIntentIds };
}

async function readCompleteFactEvents(
  logPath: string,
  sessionId: string,
): Promise<Array<{ type: string; payload: unknown }>> {
  let content: string;
  try {
    content = await fs.readFile(logPath, "utf8");
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") {
      return [];
    }
    throw error;
  }
  const complete = content.endsWith("\n")
    ? content
    : content.slice(0, Math.max(0, content.lastIndexOf("\n") + 1));
  if (complete.trim() === "") {
    return [];
  }
  return complete.trimEnd().split("\n").map((line, index) => {
    const value = JSON.parse(line) as unknown;
    if (!isRecord(value) || value.sessionId !== sessionId || typeof value.type !== "string") {
      throw new Error(`invalid session fact event ${sessionId} line ${String(index + 1)}`);
    }
    return { type: value.type, payload: value.payload };
  });
}

function parseResumeIntent(value: unknown, sessionId: string): LocalCodexResumeIntentFact {
  if (!isRecord(value) || value.sessionId !== sessionId) {
    throw new Error(`invalid Codex resume intent for ${sessionId}`);
  }
  const reason = readString(value.reason, "reason");
  if (reason !== "graceful-shutdown" && reason !== "retry" && reason !== "edit-resend") {
    throw new Error(`invalid Codex resume reason: ${reason}`);
  }
  return {
    sessionId,
    intentId: readString(value.intentId, "intentId"),
    targetRunId: readString(value.targetRunId, "targetRunId"),
    sourceMessageId: readInteger(value.sourceMessageId, "sourceMessageId"),
    role: readString(value.role, "role"),
    reason,
    createdAt: readString(value.createdAt, "createdAt"),
  };
}

function parseResumeConsumed(value: unknown, sessionId: string): LocalCodexResumeConsumedFact {
  if (!isRecord(value) || value.sessionId !== sessionId) {
    throw new Error(`invalid Codex resume consumed fact for ${sessionId}`);
  }
  const mode = readString(value.mode, "mode");
  if (mode !== "resume" && mode !== "full-fallback" && mode !== "unavailable") {
    throw new Error(`invalid Codex resume mode: ${mode}`);
  }
  return {
    sessionId,
    intentId: readString(value.intentId, "intentId"),
    resumedByRunId: readString(value.resumedByRunId, "resumedByRunId"),
    mode,
    reason: readString(value.reason, "reason"),
    consumedAt: readString(value.consumedAt, "consumedAt"),
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`invalid ${field}`);
  }
  return value;
}

function readInteger(value: unknown, field: string): number {
  if (typeof value !== "number" || !Number.isInteger(value)) {
    throw new Error(`invalid ${field}`);
  }
  return value;
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}
