import { describe, expect, it } from "vitest";
import type { LocalCodexResumeIntentFact } from "../src/local-console/codex-resume.js";
import {
  decideExistingOverrideRetry,
  decidePendingRetryAdmission,
  decideRetryAdmissionRelease,
  decideRetryRecoveryStore,
  decideRetryRequest,
  emptyRetryRecoveryBundle,
  planRetryAcceptance,
  planRetryAdmission,
  planRetryAdmissionKey,
  planRetryIdempotencyPreflight,
  type RetryAdmission,
  type RetryExecutionOverride,
  type RetryRecoveryBundle,
} from "../src/local-console/run-retry-plan.js";
import type { LocalConsoleMessage } from "../src/local-console/types.js";

const executionOverride: RetryExecutionOverride = {
  overrideId: "override-1",
  profile: { cli: "codex", model: "gpt-5.6-sol", effort: "high" },
  scope: "single-run",
};

describe("run retry plan", () => {
  it("selects retry recovery persistence only when its port is available", () => {
    const store = { getSessionFactLogPath: () => "/tmp/facts.jsonl" };
    expect(decideRetryRecoveryStore(null)).toEqual({ kind: "unavailable" });
    expect(decideRetryRecoveryStore(store)).toEqual({ kind: "available", store });
  });

  it("rejects malformed overrides and recognizes a previously accepted override", () => {
    expect(decideRetryRequest(undefined)).toEqual({ kind: "valid" });
    expect(decideRetryRequest(executionOverride)).toEqual({ kind: "valid" });
    expect(decideRetryRequest({ ...executionOverride, overrideId: " " })).toEqual({ kind: "invalid" });
    expect(decideRetryRequest({
      ...executionOverride,
      profile: { ...executionOverride.profile, model: "untrusted" },
    })).toEqual({ kind: "invalid" });
    expect(planRetryIdempotencyPreflight(undefined)).toEqual({ kind: "skip" });
    expect(planRetryIdempotencyPreflight(executionOverride))
      .toEqual({ kind: "check", executionOverride });

    const bundle = recoveryBundle({ intents: [retryIntent({ executionOverride })] });
    expect(decideExistingOverrideRetry({ runId: "run-1", executionOverride, bundle }))
      .toEqual({ kind: "already-accepted" });
    expect(decideExistingOverrideRetry({ runId: "run-2", executionOverride, bundle }))
      .toEqual({ kind: "continue" });
  });

  it("selects the linked source and role while requiring a structured terminal for overrides", () => {
    const messages = [
      message({ id: 7, speaker: "user", status: "completed", runId: null, role: "user" }),
      message({
        id: 8,
        speaker: "system",
        status: "interrupted",
        role: "qa",
        terminal: structuredTerminal(),
      }),
    ];
    const bundle = recoveryBundle({
      executionLinks: [{
        sessionId: "session-1",
        runId: "run-1",
        sourceMessageId: 7,
        role: "dev",
        engine: "codex",
        externalSessionId: "external-1",
        profileFingerprint: "profile",
        contextFingerprint: "context",
        startedAt: "2026-08-01T00:00:00.000Z",
      }],
    });

    expect(planRetryAdmission({
      sessionId: "session-1",
      runId: "run-1",
      messages,
      bundle,
      executionOverride,
    })).toMatchObject({ targetRunId: "run-1", source: { id: 7 }, role: "dev", executionOverride });
    expect(planRetryAdmission({
      sessionId: "session-1",
      runId: "run-1",
      messages: messages.map((entry) => ({ ...entry, terminal: null })),
      bundle,
      executionOverride,
    })).toBeNull();
  });

  it("recovers a missing retry trigger only from its unconsumed source intent", () => {
    const source = message({ id: 5, speaker: "user", status: "completed", runId: null });
    const terminal = message({
      id: 6,
      speaker: "system",
      status: "failed",
      error: "retry-source-trigger-missing",
      sourceKind: "local-retry-intent",
      sourceId: "intent-1",
    });
    const sourceIntent = retryIntent({ sourceMessageId: 5, role: "qa", targetRunId: "run-original" });
    const bundle = recoveryBundle({ intents: [sourceIntent] });

    expect(planRetryAdmission({
      sessionId: "session-1",
      runId: "run-1",
      messages: [source, terminal],
      bundle,
      executionOverride: undefined,
    })).toMatchObject({ source: { id: 5 }, role: "qa", targetRunId: "run-original" });
    expect(planRetryAdmission({
      sessionId: "session-1",
      runId: "run-1",
      messages: [source, terminal],
      bundle: recoveryBundle({ intents: [sourceIntent], consumedIntentIds: new Set(["intent-1"]) }),
      executionOverride: undefined,
    })).toBeNull();
  });

  it("plans retry-intent persistence without duplicating an eligible existing intent", () => {
    const admission = retryAdmission();
    expect(planRetryAcceptance(admission)).toMatchObject({
      matchingIntent: undefined,
      existingIntent: undefined,
      alreadyAccepted: false,
      shouldRecordIntent: true,
    });

    const existing = retryIntent({ sourceMessageId: admission.source.id, role: "dev" });
    expect(planRetryAcceptance({
      ...admission,
      recoveryFacts: { ...admission.recoveryFacts, intents: [existing] },
    })).toMatchObject({
      matchingIntent: existing,
      existingIntent: existing,
      alreadyAccepted: false,
      shouldRecordIntent: false,
    });
  });

  it("deduplicates only the same admission promise and releases only its current owner", async () => {
    const admission = retryAdmission();
    expect(planRetryAdmissionKey(admission)).toBe("session-1\u00001");
    const accepted = Promise.resolve(true);
    const replacement = Promise.resolve(false);
    expect(decidePendingRetryAdmission(undefined)).toEqual({ kind: "start" });
    expect(decidePendingRetryAdmission(accepted)).toEqual({ kind: "join", pending: accepted });
    expect(decideRetryAdmissionRelease(accepted, accepted)).toEqual({ kind: "release" });
    expect(decideRetryAdmissionRelease(replacement, accepted)).toEqual({ kind: "keep" });
  });
});

function message(input: Partial<LocalConsoleMessage>): LocalConsoleMessage {
  return {
    id: 1,
    sessionId: "session-1",
    speaker: "system",
    role: null,
    body: "",
    status: "failed",
    runId: "run-1",
    runDir: null,
    error: null,
    systemEventKind: "other",
    failureCount: 0,
    lastFailureReason: null,
    createdAt: "2026-08-01T00:00:00.000Z",
    updatedAt: "2026-08-01T00:00:00.000Z",
    ...input,
  };
}

function structuredTerminal(): NonNullable<LocalConsoleMessage["terminal"]> {
  return {
    kind: "interrupted",
    subkind: null,
    safeCode: null,
    retryable: true,
    partialMarkdown: "",
    contentIncomplete: true,
    actualProfile: null,
  };
}

function retryIntent(input: Partial<LocalCodexResumeIntentFact> = {}): LocalCodexResumeIntentFact {
  return {
    sessionId: "session-1",
    intentId: "intent-1",
    targetRunId: "run-1",
    sourceMessageId: 1,
    role: "dev",
    reason: "retry",
    createdAt: "2026-08-01T00:00:00.000Z",
    ...input,
  };
}

function recoveryBundle(input: Partial<RetryRecoveryBundle["recoveryFacts"]> & Partial<RetryRecoveryBundle> = {}): RetryRecoveryBundle {
  return {
    ...emptyRetryRecoveryBundle(),
    available: true,
    ...input,
    recoveryFacts: {
      intents: input.intents ?? input.recoveryFacts?.intents ?? [],
      consumedIntentIds: input.consumedIntentIds ?? input.recoveryFacts?.consumedIntentIds ?? new Set(),
      repairedIntentIds: input.repairedIntentIds ?? input.recoveryFacts?.repairedIntentIds ?? new Set(),
    },
  };
}

function retryAdmission(): RetryAdmission {
  return {
    sessionId: "session-1",
    targetRunId: "run-1",
    source: message({ id: 1, speaker: "user", status: "completed", runId: null }),
    role: "dev",
    recoveryAvailable: true,
    recoveryFacts: { intents: [], consumedIntentIds: new Set(), repairedIntentIds: new Set() },
  };
}
