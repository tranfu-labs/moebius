import type { LocalCodexResumeIntentFact } from "./codex-resume.js";
import type { LocalConsoleRunTiming } from "./types.js";

export interface LocalRecoveryFactsPlanInput {
  intents: readonly LocalCodexResumeIntentFact[];
  consumedIntentIds: ReadonlySet<string>;
}

export function decideRecoveryFactSource(input: {
  known: boolean;
  storeAvailable: boolean;
}): { kind: "known" } | { kind: "read" } | { kind: "unavailable" } {
  if (input.known) return { kind: "known" };
  return input.storeAvailable ? { kind: "read" } : { kind: "unavailable" };
}

export function planGracefulResumeTargets(
  facts: LocalRecoveryFactsPlanInput,
): Array<{ sourceMessageId: number; targetRunId: string }> {
  const bySource = new Map<number, Set<string>>();
  for (const intent of facts.intents) {
    if (intent.reason !== "graceful-shutdown" || facts.consumedIntentIds.has(intent.intentId)) continue;
    const targets = bySource.get(intent.sourceMessageId) ?? new Set<string>();
    targets.add(intent.targetRunId);
    bySource.set(intent.sourceMessageId, targets);
  }
  return [...bySource.entries()]
    .filter(([, targetRunIds]) => targetRunIds.size === 1)
    .map(([sourceMessageId, targetRunIds]) => ({ sourceMessageId, targetRunId: [...targetRunIds][0]! }));
}

export function planGracefulResumeTarget(
  facts: LocalRecoveryFactsPlanInput,
  sourceMessageId: number,
): string | null {
  const intent = [...facts.intents].reverse().find((candidate) =>
    candidate.reason === "graceful-shutdown"
    && candidate.sourceMessageId === sourceMessageId
    && !facts.consumedIntentIds.has(candidate.intentId));
  return intent?.targetRunId ?? null;
}

export function decideUnavailableIntentPersistence(
  intent: LocalCodexResumeIntentFact | null,
): { kind: "skip" } | { kind: "record"; intent: LocalCodexResumeIntentFact } {
  return intent === null ? { kind: "skip" } : { kind: "record", intent };
}

export function decideUnavailableTimingPersistence(
  timing: LocalConsoleRunTiming | null,
): { kind: "skip" } | { kind: "record"; timing: LocalConsoleRunTiming } {
  return timing === null ? { kind: "skip" } : { kind: "record", timing };
}

export function decideLifecycleStoreUse(
  available: boolean,
): { kind: "skip" } | { kind: "use" } {
  return available ? { kind: "use" } : { kind: "skip" };
}
