import { describe, expect, it } from "vitest";

import type { LocalCodexResumeIntentFact } from "../src/local-console/codex-resume.js";
import {
  planPendingWorkerDispatches,
  resolveClaimedControlAction,
  selectSourceRetryIntent,
} from "../src/local-console/control-dispatch.js";

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

function message(id: number, role: string) {
  return {
    id,
    speaker: "user" as const,
    status: "pending" as const,
    dispatchLane: "worker" as const,
    dispatchRole: role,
  };
}
