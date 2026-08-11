import { describe, expect, it } from "vitest";

import type { LocalCodexResumeIntentFact } from "../src/local-console/codex-resume.js";
import type { LocalRunExecutionContextFact } from "../src/local-console/execution-context.js";
import {
  assertUserDirectResumeIdentity,
  decideLegacyStartupRepair,
  planLegacyHandoffRepair,
  planOrphanRecovery,
  planStaleRunningRepair,
} from "../src/local-console/startup-recovery-plan.js";
import type { LocalConsoleMessage } from "../src/local-console/types.js";

describe("local console startup recovery plan", () => {
  it("rejects a user-direct resume whose dispatch identity changed", () => {
    expect(() => assertUserDirectResumeIdentity({
      sourceDisposition: "user-direct",
      dispatchLane: "primary",
      dispatchRole: "dev",
      requestedRole: "dev",
    })).toThrow("User-direct resume source dispatch does not match the active role");
    expect(() => assertUserDirectResumeIdentity({
      sourceDisposition: "primary",
      dispatchLane: "primary",
      dispatchRole: null,
      requestedRole: "dev",
    })).not.toThrow();
  });

  it("distinguishes a graceful orphan from an ordinary stuck orphan", () => {
    const intent = gracefulIntent();
    const graceful = planOrphanRecovery({
      orphan: { userMessageId: 12, runId: "run-1", runDir: "/tmp/worker", role: null },
      facts: { intents: [intent], consumedIntentIds: new Set(), repairedIntentIds: new Set() },
    });
    expect(graceful).toEqual({
      kind: "graceful-resume",
      placeholderMessageId: 12,
      sourceMessageId: 10,
      sourceDisposition: "agent-handoff",
      targetRunId: "run-1",
      role: "qa",
    });
    expect(planOrphanRecovery({
      orphan: { userMessageId: 13, runId: "run-2", runDir: "/tmp/run-2", role: null },
      facts: { intents: [intent], consumedIntentIds: new Set(), repairedIntentIds: new Set() },
    })).toEqual({
      kind: "record-stuck",
      orphan: { userMessageId: 13, runId: "run-2", runDir: "/tmp/run-2", role: null },
    });
  });

  it("repairs only one exact pending Agent handoff footprint", () => {
    const intent = gracefulIntent();
    const source = agentMessage();
    const context = runContext();
    const base = {
      sessionId: "session-1",
      intent,
      gracefulIntents: [intent],
      repairedIntentIds: new Set<string>(),
      messages: [source],
      runContexts: [context],
      activeRunIds: new Set<string>(),
    };
    expect(planLegacyHandoffRepair(base)).toEqual({ kind: "repair" });
    expect(planLegacyHandoffRepair({ ...base, gracefulIntents: [intent, { ...intent, intentId: "duplicate" }] }))
      .toEqual({ kind: "reject", reason: "resume intent is not unique for its source and run" });
    expect(planLegacyHandoffRepair({ ...base, activeRunIds: new Set([intent.targetRunId]) }))
      .toEqual({ kind: "reject", reason: "target run is active in this process" });
  });

  it("limits legacy startup scanning and derives the stale cutoff", () => {
    const intent = { ...gracefulIntent(), sourceDisposition: undefined };
    const facts = { intents: [intent], consumedIntentIds: new Set<string>(), repairedIntentIds: new Set<string>() };
    expect(decideLegacyStartupRepair({ hasProjectedWork: false, knownFacts: facts })).toEqual({ kind: "run" });
    expect(decideLegacyStartupRepair({
      hasProjectedWork: false,
      knownFacts: { ...facts, consumedIntentIds: new Set([intent.intentId]) },
    })).toEqual({ kind: "skip" });
    expect(planStaleRunningRepair({
      nowMs: Date.parse("2026-08-02T01:00:00.000Z"),
      idleTimeoutMs: 1_000,
      maxDurationMs: 5_000,
      graceMs: 500,
    })).toEqual({ cutoffIso: "2026-08-02T00:59:54.500Z", reason: "stale-running>5500ms" });
  });
});

function gracefulIntent(): LocalCodexResumeIntentFact {
  return {
    sessionId: "session-1",
    intentId: "intent-1",
    targetRunId: "run-1",
    sourceMessageId: 10,
    role: "qa",
    reason: "graceful-shutdown",
    sourceDisposition: "agent-handoff",
    createdAt: "2026-08-02T00:00:00.000Z",
  };
}

function agentMessage(): LocalConsoleMessage {
  return {
    id: 10,
    sessionId: "session-1",
    speaker: "agent",
    role: "qa",
    body: "handoff",
    status: "pending",
    sourceKind: "local-message",
    runId: null,
    runDir: null,
    error: null,
    systemEventKind: "other",
    failureCount: 0,
    lastFailureReason: null,
    createdAt: "2026-08-02T00:00:00.000Z",
    updatedAt: "2026-08-02T00:00:00.000Z",
  };
}

function runContext(): LocalRunExecutionContextFact {
  return {
    sessionId: "session-1",
    runId: "run-1",
    sourceMessageId: 10,
    role: "qa",
    engine: "codex",
    profile: null,
    profileFingerprint: "profile",
    agentIdentityFingerprint: "agent",
    contextFingerprint: "context",
    workspace: {
      cwd: "/tmp/work",
      mode: "direct",
      worktreePath: null,
      worktreeUnavailableReason: null,
      branchName: null,
      baseRef: null,
      originalRepoRoot: null,
    },
    team: [],
    recordedAt: "2026-08-02T00:00:00.000Z",
  };
}
