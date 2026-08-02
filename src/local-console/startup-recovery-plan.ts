import type {
  LocalCodexRecoveryFacts,
  LocalCodexResumeIntentFact,
  LocalRunSourceDisposition,
} from "./codex-resume.js";
import type { LocalRunExecutionContextFact } from "./execution-context.js";
import type { OrphanRunCandidate } from "./orphan-runs.js";
import { hasPendingStartupControlWork } from "./runtime-domain.js";
import type { LocalConsoleMessage, LocalConsoleSessionSummary } from "./types.js";

export interface LocalStartupRecoverySessionPlan {
  sessionId: string;
  hasProjectedWork: boolean;
}

export type LocalOrphanRecoveryPlan =
  | {
      kind: "graceful-resume";
      placeholderMessageId: number | null;
      sourceMessageId: number;
      sourceDisposition: LocalRunSourceDisposition | null;
      targetRunId: string;
      role: string;
    }
  | { kind: "record-stuck"; orphan: OrphanRunCandidate };

export type LocalLegacyHandoffRepairPlan =
  | { kind: "skip" }
  | { kind: "reject"; reason: string }
  | { kind: "repair" };

export function planStartupRecoverySessions(
  sessions: readonly LocalConsoleSessionSummary[],
  defaultSessionId: string,
): LocalStartupRecoverySessionPlan[] {
  if (sessions.length === 0) return [{ sessionId: defaultSessionId, hasProjectedWork: true }];
  return sessions.map((session) => ({
    sessionId: session.sessionId,
    hasProjectedWork: hasPendingStartupControlWork(session),
  }));
}

export function decideStartupProjectedWork(hasProjectedWork: boolean): { kind: "run" } | { kind: "skip" } {
  return hasProjectedWork ? { kind: "run" } : { kind: "skip" };
}

export function decideStartupRecoveryFactSource(input: {
  hasProjectedWork: boolean;
  storeAvailable: boolean;
}): { kind: "claim-will-read" } | { kind: "read" } | { kind: "unavailable" } {
  if (input.hasProjectedWork) return { kind: "claim-will-read" };
  return input.storeAvailable ? { kind: "read" } : { kind: "unavailable" };
}

export function decideLegacyStartupRepair(input: {
  hasProjectedWork: boolean;
  knownFacts: LocalCodexRecoveryFacts | undefined;
}): { kind: "run" } | { kind: "skip" } {
  if (input.hasProjectedWork) return { kind: "run" };
  const facts = input.knownFacts;
  if (facts === undefined) return { kind: "skip" };
  const candidate = facts.intents.some((intent) =>
    intent.reason === "graceful-shutdown"
    && intent.sourceDisposition === undefined
    && !facts.consumedIntentIds.has(intent.intentId)
    && !facts.repairedIntentIds.has(intent.intentId));
  return candidate ? { kind: "run" } : { kind: "skip" };
}

export function decideRecoveryFactsRead(storeAvailable: boolean): { kind: "read" } | { kind: "empty" } {
  return storeAvailable ? { kind: "read" } : { kind: "empty" };
}

export function planOrphanRecovery(input: {
  orphan: OrphanRunCandidate;
  facts: LocalCodexRecoveryFacts;
}): LocalOrphanRecoveryPlan {
  const gracefulIntent = input.facts.intents.find((intent) =>
    intent.targetRunId === input.orphan.runId
    && intent.reason === "graceful-shutdown"
    && !input.facts.consumedIntentIds.has(intent.intentId));
  if (gracefulIntent === undefined) return { kind: "record-stuck", orphan: input.orphan };
  return {
    kind: "graceful-resume",
    placeholderMessageId: input.orphan.userMessageId === gracefulIntent.sourceMessageId
      ? null
      : input.orphan.userMessageId,
    sourceMessageId: gracefulIntent.sourceMessageId,
    sourceDisposition: gracefulIntent.sourceDisposition ?? null,
    targetRunId: gracefulIntent.targetRunId,
    role: gracefulIntent.role,
  };
}

export function decideOrphanPlaceholderRelease(
  messageId: number | null,
): { kind: "release"; messageId: number } | { kind: "skip" } {
  return messageId === null ? { kind: "skip" } : { kind: "release", messageId };
}

export function decideOrphanResumeRelease(input: {
  plan: Extract<LocalOrphanRecoveryPlan, { kind: "graceful-resume" }>;
  capabilityAvailable: boolean;
}):
  | { kind: "skip" }
  | { kind: "unavailable" }
  | {
      kind: "release";
      sourceMessageId: number;
      sourceDisposition: LocalRunSourceDisposition;
      targetRunId: string;
      role: string;
    } {
  if (input.plan.sourceDisposition === null) return { kind: "skip" };
  if (!input.capabilityAvailable) return { kind: "unavailable" };
  return {
    kind: "release",
    sourceMessageId: input.plan.sourceMessageId,
    sourceDisposition: input.plan.sourceDisposition,
    targetRunId: input.plan.targetRunId,
    role: input.plan.role,
  };
}

export function decideLegacyRepairCapability(input: {
  recoveryStoreAvailable: boolean;
  repairCapabilityAvailable: boolean;
}): { kind: "run" } | { kind: "skip" } {
  return input.recoveryStoreAvailable && input.repairCapabilityAvailable
    ? { kind: "run" }
    : { kind: "skip" };
}

export function decideKnownValueSource(known: boolean): { kind: "known" } | { kind: "read" } {
  return known ? { kind: "known" } : { kind: "read" };
}

export function planUnconsumedGracefulIntents(
  facts: LocalCodexRecoveryFacts,
): LocalCodexResumeIntentFact[] {
  return facts.intents.filter((intent) =>
    intent.reason === "graceful-shutdown" && !facts.consumedIntentIds.has(intent.intentId));
}

export function planLegacyHandoffRepair(input: {
  sessionId: string;
  intent: LocalCodexResumeIntentFact;
  gracefulIntents: readonly LocalCodexResumeIntentFact[];
  repairedIntentIds: ReadonlySet<string>;
  messages: readonly LocalConsoleMessage[];
  runContexts: readonly LocalRunExecutionContextFact[];
  activeRunIds: ReadonlySet<string>;
}): LocalLegacyHandoffRepairPlan {
  const intent = input.intent;
  if (input.repairedIntentIds.has(intent.intentId)) return { kind: "skip" };
  const source = input.messages.find((message) => message.id === intent.sourceMessageId);
  if (source?.status === "displayed") return { kind: "skip" };
  if (intent.sourceDisposition !== undefined && intent.sourceDisposition !== "agent-handoff" && source?.speaker !== "agent") {
    return { kind: "skip" };
  }
  if (intent.sourceDisposition !== undefined && intent.sourceDisposition !== "agent-handoff") {
    return { kind: "reject", reason: "source disposition is not agent-handoff" };
  }
  const competingIntents = input.gracefulIntents.filter((candidate) =>
    candidate.sourceMessageId === intent.sourceMessageId || candidate.targetRunId === intent.targetRunId);
  if (competingIntents.length !== 1 || competingIntents[0]?.intentId !== intent.intentId) {
    return { kind: "reject", reason: "resume intent is not unique for its source and run" };
  }
  if (source === undefined || source.speaker !== "agent" || source.sourceKind !== "local-message" || source.status !== "pending") {
    return { kind: "reject", reason: "exact source is not an Agent pending local message" };
  }
  const relatedContexts = input.runContexts.filter((context) =>
    context.runId === intent.targetRunId || context.sourceMessageId === intent.sourceMessageId);
  const context = relatedContexts[0];
  if (
    relatedContexts.length !== 1
    || context?.sessionId !== input.sessionId
    || context.runId !== intent.targetRunId
    || context.sourceMessageId !== intent.sourceMessageId
    || context.role !== intent.role
  ) {
    return { kind: "reject", reason: "run execution context is missing, conflicting, or not exact" };
  }
  if (input.activeRunIds.has(intent.targetRunId)) {
    return { kind: "reject", reason: "target run is active in this process" };
  }
  return { kind: "repair" };
}

export function planStaleRunningRepair(input: {
  nowMs: number;
  idleTimeoutMs: number | undefined;
  maxDurationMs: number | undefined;
  graceMs: number;
}): { cutoffIso: string; reason: string } {
  const thresholdMs = input.maxDurationMs ?? input.idleTimeoutMs ?? 10 * 60 * 1000;
  return {
    cutoffIso: new Date(input.nowMs - thresholdMs - input.graceMs).toISOString(),
    reason: `stale-running>${String(thresholdMs + input.graceMs)}ms`,
  };
}

export function emptyStartupRecoveryFacts(): LocalCodexRecoveryFacts {
  return { intents: [], consumedIntentIds: new Set<string>(), repairedIntentIds: new Set<string>() };
}

export function assertUserDirectResumeIdentity(input: {
  sourceDisposition: LocalRunSourceDisposition;
  dispatchLane: LocalConsoleMessage["dispatchLane"];
  dispatchRole: string | null;
  requestedRole: string;
}): void {
  if (
    input.sourceDisposition === "user-direct"
    && (input.dispatchLane !== "worker" || input.dispatchRole !== input.requestedRole)
  ) {
    throw new Error("User-direct resume source dispatch does not match the active role");
  }
}
