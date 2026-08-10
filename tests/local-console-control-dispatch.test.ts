import { describe, expect, it } from "vitest";

import type { LocalCodexResumeIntentFact } from "../src/local-console/codex-resume.js";
import {
  decideHandoffDispatchRecording,
  decideHandoffStaleOutcome,
  decideHandoffStaleness,
  decideWorkerReplyStalenessCheck,
  planHandoffDispatchGeneration,
  planHandoffDispatchState,
  planPendingWorkerDispatches,
  resolveClaimedControlAction,
  selectSourceRetryIntent,
} from "../src/local-console/control-dispatch.js";
import {
  decideLocalRouteFailure,
  planLocalRouteAction,
  planLocalRouteAdmission,
} from "../src/local-console/local-route-plan.js";
import type { LocalConsoleMessage } from "../src/local-console/types.js";

function retryIntent(
  intentId: string,
  sourceMessageId: number,
  reason: LocalCodexResumeIntentFact["reason"] = "retry",
): LocalCodexResumeIntentFact {
  return {
    sessionId: "session-a",
    intentId,
    targetRunId: `run:${intentId}`,
    sourceMessageId,
    role: "dev",
    reason,
    createdAt: "2026-08-01T00:00:00.000Z",
  };
}

describe("local claimed control planning", () => {
  it("classifies the legacy route admission, result, and retry boundary", () => {
    const user = { speaker: "user", body: "please continue with dev" } as LocalConsoleMessage;
    expect([
      planLocalRouteAdmission(user.speaker).kind,
      planLocalRouteAction("APPEND").kind,
      planLocalRouteAction("NO_ACTION").kind,
      decideLocalRouteFailure(user, ["dev"]).kind,
      decideLocalRouteFailure({ ...user, body: "ordinary update" }, ["dev"]).kind,
    ]).toEqual(["route", "append", "no-action", "retry", "fail-open"]);
  });

  it.each([
    {
      name: "routes every user source to the available primary",
      input: {
        source: { speaker: "user" as const, role: null },
        primaryAgent: "manager",
        explicitTrigger: { kind: "skip" as const, reason: "no-trigger" as const },
        availableAgentNames: ["manager", "dev"],
        retryIntent: null,
      },
      expected: { kind: "run-primary", role: "manager" },
    },
    {
      name: "returns a non-primary Agent without a mention to the primary",
      input: {
        source: { speaker: "agent" as const, role: "dev" },
        primaryAgent: "manager",
        explicitTrigger: { kind: "skip" as const, reason: "no-trigger" as const },
        availableAgentNames: ["manager", "dev"],
        retryIntent: null,
      },
      expected: { kind: "run-primary", role: "manager" },
    },
    {
      name: "completes a primary Agent source without a mention",
      input: {
        source: { speaker: "agent" as const, role: "manager" },
        primaryAgent: "manager",
        explicitTrigger: { kind: "skip" as const, reason: "no-trigger" as const },
        availableAgentNames: ["manager", "dev"],
        retryIntent: null,
      },
      expected: { kind: "complete-source" },
    },
    {
      name: "schedules an explicit Agent handoff on a worker lane",
      input: {
        source: { speaker: "agent" as const, role: "manager" },
        primaryAgent: "manager",
        explicitTrigger: { kind: "run-agent" as const, role: "dev", reason: "mention" as const },
        availableAgentNames: ["manager", "dev"],
        retryIntent: null,
      },
      expected: { kind: "schedule-worker", role: "dev" },
    },
    {
      name: "keeps the legacy route fallback only when no primary exists",
      input: {
        source: { speaker: "user" as const, role: null },
        primaryAgent: null,
        explicitTrigger: { kind: "skip" as const, reason: "no-trigger" as const },
        availableAgentNames: [],
        retryIntent: null,
      },
      expected: { kind: "route-without-primary-agent" },
    },
    {
      name: "fails when the trigger target is absent from the frozen team",
      input: {
        source: { speaker: "agent" as const, role: "manager" },
        primaryAgent: "manager",
        explicitTrigger: { kind: "run-agent" as const, role: "qa", reason: "mention" as const },
        availableAgentNames: ["manager", "dev"],
        retryIntent: null,
      },
      expected: { kind: "fail-missing-agent", role: "qa" },
    },
  ])("$name", ({ input, expected }) => {
    expect(resolveClaimedControlAction(input)).toEqual(expected);
  });

  it("records a source-scoped retry failure instead of completing the Agent source", () => {
    const intent = retryIntent("retry-a", 7);
    expect(resolveClaimedControlAction({
      source: { speaker: "agent", role: "manager" },
      primaryAgent: "manager",
      explicitTrigger: { kind: "skip", reason: "no-trigger" },
      availableAgentNames: ["manager"],
      retryIntent: intent,
    })).toEqual({ kind: "record-retry-trigger-missing", intent });
  });
});

describe("source-scoped retry selection", () => {
  it.each([
    [["a", "b"], 10, "b"],
    [["b", "a"], 10, "a"],
    [["a", "other", "b"], 10, "b"],
  ] as const)("uses the latest unconsumed retry in order %j", (order, sourceMessageId, expected) => {
    const intents = order.map((id) => retryIntent(id, id === "other" ? 99 : sourceMessageId));
    expect(selectSourceRetryIntent({
      sourceMessageId,
      intents,
      consumedIntentIds: new Set(),
    })?.intentId).toBe(expected);
  });

  it("ignores consumed and non-retry intents", () => {
    expect(selectSourceRetryIntent({
      sourceMessageId: 10,
      intents: [retryIntent("consumed", 10), retryIntent("graceful", 10, "graceful-shutdown")],
      consumedIntentIds: new Set(["consumed"]),
    })).toBeNull();
  });
});

describe("pending worker lane planning", () => {
  it("keeps one FIFO head per idle role and skips active or queued roles", () => {
    const messages = [
      message(1, "qa"),
      message(2, "qa"),
      message(3, "dev"),
      message(4, "design"),
      { ...message(5, "ignored"), status: "running" as const },
      { ...message(6, "ignored-primary"), dispatchLane: "primary" as const },
      { ...message(7, "ignored-null"), dispatchRole: null },
    ];
    expect(planPendingWorkerDispatches({
      messages,
      activeRoles: new Set(["dev"]),
      queuedRoles: new Set(["design"]),
    })).toEqual([{ message: messages[0], role: "qa" }]);
  });
});

describe("handoff generation staleness planning", () => {
  it("marks a reply stale only when its run generation falls behind the role latest", () => {
    expect(decideHandoffStaleness({ runGeneration: 1, latestGeneration: 2 })).toEqual({ kind: "stale" });
    expect(decideHandoffStaleness({ runGeneration: 2, latestGeneration: 2 })).toEqual({ kind: "current" });
    expect(decideHandoffStaleness({ runGeneration: null, latestGeneration: 2 })).toEqual({ kind: "current" });
    expect(decideHandoffStaleness({ runGeneration: 1, latestGeneration: null })).toEqual({ kind: "current" });
  });

  it("checks only non-primary agent replies that would continue the flow", () => {
    const base = {
      speaker: "agent" as const,
      role: "qa",
      primaryAgent: "manager",
      runId: "run-1",
      actionKind: "schedule-worker",
      handoffStateAvailable: true,
    };
    expect(decideWorkerReplyStalenessCheck(base)).toEqual({ kind: "check", role: "qa", runId: "run-1" });
    expect(decideWorkerReplyStalenessCheck({ ...base, actionKind: "run-primary" })).toEqual({ kind: "check", role: "qa", runId: "run-1" });
    expect(decideWorkerReplyStalenessCheck({ ...base, actionKind: "record-retry-trigger-missing" })).toEqual({ kind: "check", role: "qa", runId: "run-1" });
    expect(decideWorkerReplyStalenessCheck({ ...base, actionKind: "complete-source" })).toEqual({ kind: "skip" });
    expect(decideWorkerReplyStalenessCheck({ ...base, role: "manager" })).toEqual({ kind: "skip" });
    expect(decideWorkerReplyStalenessCheck({ ...base, speaker: "user" })).toEqual({ kind: "skip" });
    expect(decideWorkerReplyStalenessCheck({ ...base, runId: null })).toEqual({ kind: "skip" });
    expect(decideWorkerReplyStalenessCheck({ ...base, handoffStateAvailable: false })).toEqual({ kind: "skip" });
  });

  it("decides the complete-source override and the recording capability", () => {
    expect(decideHandoffStaleOutcome({ stale: true })).toEqual({ kind: "complete-source" });
    expect(decideHandoffStaleOutcome({ stale: false })).toEqual({ kind: "keep" });
    const record = async () => 1;
    expect(decideHandoffDispatchRecording({ record }).kind).toBe("record");
    expect(decideHandoffDispatchRecording({ record: undefined })).toEqual({ kind: "skip" });
  });

  it("assigns monotonically increasing generations per role", () => {
    const dispatch = (role: string, generation: number) => ({
      type: "handoff_dispatch",
      payload: { sessionId: "session-a", role, generation, runId: `run-${role}-${generation}`, sourceMessageId: 1, createdAt: "2026-08-01T00:00:00.000Z" },
    });
    expect(planHandoffDispatchGeneration([], { sessionId: "session-a", role: "qa" })).toBe(1);
    expect(planHandoffDispatchGeneration(
      [dispatch("qa", 1), dispatch("qa", 3), dispatch("dev", 5)],
      { sessionId: "session-a", role: "qa" },
    )).toBe(4);
    expect(planHandoffDispatchGeneration(
      [dispatch("qa", 1)],
      { sessionId: "session-a", role: "dev" },
    )).toBe(1);
    expect(planHandoffDispatchGeneration(
      [dispatch("qa", 1), { type: "handoff_dispatch", payload: { sessionId: "session-a", role: "qa", generation: "bad" } }],
      { sessionId: "session-a", role: "qa" },
    )).toBe(2);
  });

  it("projects the run generation and role latest from dispatch facts", () => {
    const dispatch = (role: string, generation: number, runId: string) => ({
      type: "handoff_dispatch",
      payload: { sessionId: "session-a", role, generation, runId, sourceMessageId: 1, createdAt: "2026-08-01T00:00:00.000Z" },
    });
    const events = [dispatch("qa", 1, "run-a"), dispatch("qa", 2, "run-b"), dispatch("dev", 1, "run-c")];
    expect(planHandoffDispatchState(events, { sessionId: "session-a", role: "qa", runId: "run-a" }))
      .toEqual({ runGeneration: 1, latestGeneration: 2 });
    expect(planHandoffDispatchState(events, { sessionId: "session-a", role: "qa", runId: "run-c" }))
      .toEqual({ runGeneration: null, latestGeneration: 2 });
    expect(planHandoffDispatchState(events, { sessionId: "session-a", role: "dev", runId: "run-c" }))
      .toEqual({ runGeneration: 1, latestGeneration: 1 });
    expect(planHandoffDispatchState([], { sessionId: "session-a", role: "qa", runId: "run-a" }))
      .toEqual({ runGeneration: null, latestGeneration: null });
  });
});

function message(id: number, role: string) {
  return {
    id,
    speaker: "user" as const,
    status: "pending" as const,
    dispatchLane: "worker" as const,
    dispatchRole: role,
  };
}
