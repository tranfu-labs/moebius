import { isTrustedExecutionProfile } from "../execution-profile-registry.js";
import type { LocalCodexResumeIntentFact } from "./codex-resume.js";
import type { LocalCodexThreadLinkFact } from "./codex-thread-link.js";
import type { LocalExecutionSessionLinkFact, LocalRunExecutionContextFact } from "./execution-context.js";
import type { LocalConsoleExecutionProfile, LocalConsoleMessage } from "./types.js";

export interface RetryExecutionOverride {
  overrideId: string;
  profile: LocalConsoleExecutionProfile;
  scope: "single-run";
}

export interface RetryRecoveryFacts {
  intents: LocalCodexResumeIntentFact[];
  consumedIntentIds: Set<string>;
  repairedIntentIds: Set<string>;
}

export interface RetryRecoveryBundle {
  available: boolean;
  executionLinks: LocalExecutionSessionLinkFact[];
  codexLinks: LocalCodexThreadLinkFact[];
  runContexts: LocalRunExecutionContextFact[];
  recoveryFacts: RetryRecoveryFacts;
}

export interface RetryAdmission {
  sessionId: string;
  targetRunId: string;
  source: LocalConsoleMessage;
  role: string | null;
  recoveryAvailable: boolean;
  recoveryFacts: RetryRecoveryFacts;
  executionOverride?: RetryExecutionOverride;
}

export function decideRetryRequest(
  executionOverride: RetryExecutionOverride | undefined,
): { kind: "valid" } | { kind: "invalid" } {
  return executionOverride === undefined
    || (
      executionOverride.scope === "single-run"
      && executionOverride.overrideId.trim().length > 0
      && isTrustedExecutionProfile(executionOverride.profile)
    )
    ? { kind: "valid" }
    : { kind: "invalid" };
}

export function decideExistingOverrideRetry(input: {
  runId: string;
  executionOverride: RetryExecutionOverride | undefined;
  bundle: RetryRecoveryBundle;
}): { kind: "continue" } | { kind: "already-accepted" } {
  if (input.executionOverride === undefined || !input.bundle.available) return { kind: "continue" };
  return input.bundle.recoveryFacts.intents.some((intent) =>
    intent.targetRunId === input.runId
    && intent.reason === "retry"
    && intent.executionOverride?.overrideId === input.executionOverride?.overrideId)
    ? { kind: "already-accepted" }
    : { kind: "continue" };
}

export function planRetryIdempotencyPreflight(
  executionOverride: RetryExecutionOverride | undefined,
): { kind: "skip" } | { kind: "check"; executionOverride: RetryExecutionOverride } {
  return executionOverride === undefined
    ? { kind: "skip" }
    : { kind: "check", executionOverride };
}

export function planRetryAdmission(input: {
  sessionId: string;
  runId: string;
  messages: readonly LocalConsoleMessage[];
  bundle: RetryRecoveryBundle;
  executionOverride: RetryExecutionOverride | undefined;
}): RetryAdmission | null {
  const terminal = input.messages.find((message) =>
    message.runId === input.runId
    && (message.status === "stuck" || message.status === "failed" || message.status === "interrupted"));
  if (terminal === undefined) return null;
  if (input.executionOverride !== undefined && !hasRetryableStructuredTerminal(input.messages, input.runId)) return null;
  const link = input.bundle.executionLinks.find((candidate) => candidate.runId === input.runId)
    ?? input.bundle.codexLinks.find((candidate) => candidate.runId === input.runId);
  const runContext = input.bundle.runContexts.find((candidate) => candidate.runId === input.runId);
  const linkedRetryIntent = terminal.error === "retry-source-trigger-missing"
    && terminal.sourceKind === "local-retry-intent"
    && terminal.sourceId !== null
    ? input.bundle.recoveryFacts.intents.find((intent) =>
        intent.sessionId === input.sessionId
        && intent.intentId === terminal.sourceId
        && intent.reason === "retry"
        && !input.bundle.recoveryFacts.consumedIntentIds.has(intent.intentId))
    : undefined;
  if (terminal.error === "retry-source-trigger-missing" && linkedRetryIntent === undefined) return null;
  const source = link === undefined
    ? linkedRetryIntent === undefined
      ? runContext === undefined
        ? input.messages.find((message) =>
            message.runId === input.runId
            && message.speaker !== "system"
            && (message.status === "stuck" || message.status === "failed" || message.status === "interrupted"))
        : input.messages.find((message) => message.id === runContext.sourceMessageId && message.speaker !== "system")
      : input.messages.find((message) => message.id === linkedRetryIntent.sourceMessageId && message.speaker !== "system")
    : input.messages.find((message) => message.id === link.sourceMessageId && message.speaker !== "system");
  if (source === undefined) return null;
  const role = link?.role
    ?? linkedRetryIntent?.role
    ?? runContext?.role
    ?? source.dispatchRole
    ?? terminal.role
    ?? source.role;
  return {
    sessionId: input.sessionId,
    targetRunId: linkedRetryIntent?.targetRunId ?? input.runId,
    source,
    role,
    recoveryAvailable: input.bundle.available,
    recoveryFacts: input.bundle.recoveryFacts,
    ...(input.executionOverride === undefined ? {} : { executionOverride: input.executionOverride }),
  };
}

export function planRetryAdmissionKey(admission: RetryAdmission): string {
  return [
    admission.sessionId,
    admission.targetRunId,
    String(admission.source.id),
    admission.role ?? "",
    admission.executionOverride?.overrideId ?? "retry",
  ].join("\u0000");
}

export function decidePendingRetryAdmission(
  pending: Promise<boolean> | undefined,
): { kind: "start" } | { kind: "join"; pending: Promise<boolean> } {
  return pending === undefined ? { kind: "start" } : { kind: "join", pending };
}

export function decideRetryAdmissionRelease(
  current: Promise<boolean> | undefined,
  accepted: Promise<boolean>,
): { kind: "keep" } | { kind: "release" } {
  return current === accepted ? { kind: "release" } : { kind: "keep" };
}

export function planRetryAcceptance(admission: RetryAdmission): {
  matchingIntent: LocalCodexResumeIntentFact | undefined;
  existingIntent: LocalCodexResumeIntentFact | undefined;
  alreadyAccepted: boolean;
  shouldRecordIntent: boolean;
} {
  const matchingIntent = admission.recoveryFacts.intents.find((intent) =>
    intent.targetRunId === admission.targetRunId
    && intent.sourceMessageId === admission.source.id
    && intent.role === admission.role
    && intent.reason === "retry"
    && intent.executionOverride?.overrideId === admission.executionOverride?.overrideId);
  const existingIntent = matchingIntent !== undefined
    && !admission.recoveryFacts.consumedIntentIds.has(matchingIntent.intentId)
    ? matchingIntent
    : undefined;
  return {
    matchingIntent,
    existingIntent,
    alreadyAccepted: admission.executionOverride !== undefined && matchingIntent !== undefined,
    shouldRecordIntent: admission.recoveryAvailable && admission.role !== null && existingIntent === undefined,
  };
}

function hasRetryableStructuredTerminal(messages: readonly LocalConsoleMessage[], runId: string): boolean {
  const terminal = messages.find((message) =>
    message.runId === runId
    && message.speaker === "system"
    && message.terminal !== null
    && message.terminal !== undefined)?.terminal;
  return terminal !== null
    && terminal !== undefined
    && ["interrupted", "timeout", "quota-exhausted", "rate-limited", "auth", "crashed"].includes(terminal.kind);
}

export function emptyRetryRecoveryBundle(): RetryRecoveryBundle {
  return {
    available: false,
    executionLinks: [],
    codexLinks: [],
    runContexts: [],
    recoveryFacts: { intents: [], consumedIntentIds: new Set(), repairedIntentIds: new Set() },
  };
}
