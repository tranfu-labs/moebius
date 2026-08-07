import fs from "node:fs/promises";
import type { LocalConsoleExecutionProfile } from "./types.js";
import { readSessionFactLog } from "./session-fact-log.js";

export type LocalCodexResumeReason = "graceful-shutdown" | "retry" | "edit-resend";
export type LocalCodexResumeMode = "resume" | "full-fallback" | "unavailable";
export type LocalRunSourceDisposition = "primary" | "user-direct" | "agent-handoff";

export interface LocalCodexResumeIntentFact {
  sessionId: string;
  intentId: string;
  targetRunId: string;
  sourceMessageId: number;
  role: string;
  reason: LocalCodexResumeReason;
  sourceDisposition?: LocalRunSourceDisposition;
  executionOverride?: {
    overrideId: string;
    profile: LocalConsoleExecutionProfile;
    scope: "single-run";
  };
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
  repairedIntentIds: Set<string>;
}

export async function readLocalCodexRecoveryFacts(
  logPath: string,
  sessionId: string,
): Promise<LocalCodexRecoveryFacts> {
  const events = await readCompleteFactEvents(logPath, sessionId);
  const intents: LocalCodexResumeIntentFact[] = [];
  const consumedIntentIds = new Set<string>();
  const repairedIntentIds = new Set<string>();
  for (const event of events) {
    if (event.type === "codex_resume_intent") {
      intents.push(parseResumeIntent(event.payload, sessionId));
    } else if (event.type === "codex_resume_consumed") {
      consumedIntentIds.add(parseResumeConsumed(event.payload, sessionId).intentId);
    } else if (event.type === "repair_agent_handoff_resume_source") {
      repairedIntentIds.add(parseAgentHandoffRepairIntentId(event.payload, sessionId));
    }
  }
  return { intents, consumedIntentIds, repairedIntentIds };
}

async function readCompleteFactEvents(
  logPath: string,
  sessionId: string,
): Promise<Array<{ type: string; payload: unknown }>> {
  const snapshot = await readSessionFactLog(logPath, sessionId);
  if (snapshot === null) {
    return [];
  }
  return snapshot.values.map((value, index) => {
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
  const sourceDisposition = value.sourceDisposition === undefined
    ? undefined
    : readSourceDisposition(value.sourceDisposition);
  const executionOverride = value.executionOverride === undefined
    ? undefined
    : parseExecutionOverride(value.executionOverride);
  return {
    sessionId,
    intentId: readString(value.intentId, "intentId"),
    targetRunId: readString(value.targetRunId, "targetRunId"),
    sourceMessageId: readInteger(value.sourceMessageId, "sourceMessageId"),
    role: readString(value.role, "role"),
    reason,
    ...(sourceDisposition === undefined ? {} : { sourceDisposition }),
    ...(executionOverride === undefined ? {} : { executionOverride }),
    createdAt: readString(value.createdAt, "createdAt"),
  };
}

function parseExecutionOverride(
  value: unknown,
): NonNullable<LocalCodexResumeIntentFact["executionOverride"]> {
  if (!isRecord(value) || value.scope !== "single-run" || !isRecord(value.profile)) {
    throw new Error("invalid execution override");
  }
  const cli = readString(value.profile.cli, "executionOverride.profile.cli");
  if (cli !== "codex" && cli !== "claude" && cli !== "kimi" && cli !== "pi") {
    throw new Error(`invalid execution override cli: ${cli}`);
  }
  return {
    overrideId: readString(value.overrideId, "executionOverride.overrideId"),
    profile: cli === "pi"
      ? {
          cli,
          providerId: readDeepSeekProviderId(value.profile.providerId),
          providerProfileId: readString(value.profile.providerProfileId, "executionOverride.profile.providerProfileId"),
          model: readString(value.profile.model, "executionOverride.profile.model"),
          effort: readString(value.profile.effort, "executionOverride.profile.effort"),
        }
      : {
          cli,
          model: readString(value.profile.model, "executionOverride.profile.model"),
          effort: readString(value.profile.effort, "executionOverride.profile.effort"),
        },
    scope: "single-run",
  };
}

function readDeepSeekProviderId(value: unknown): "deepseek" {
  if (value !== "deepseek") throw new Error("invalid Pi provider id");
  return value;
}

function parseAgentHandoffRepairIntentId(value: unknown, sessionId: string): string {
  if (!isRecord(value) || value.sessionId !== sessionId) {
    throw new Error(`invalid Agent handoff repair fact for ${sessionId}`);
  }
  return readString(value.intentId, "intentId");
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

function readSourceDisposition(value: unknown): LocalRunSourceDisposition {
  if (value === "primary" || value === "user-direct" || value === "agent-handoff") {
    return value;
  }
  throw new Error(`invalid sourceDisposition: ${String(value)}`);
}

function readInteger(value: unknown, field: string): number {
  if (typeof value !== "number" || !Number.isInteger(value)) {
    throw new Error(`invalid ${field}`);
  }
  return value;
}
