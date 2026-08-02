import { describe, expect, it } from "vitest";
import {
  planAwaitingDispatchResolution,
  planPendingSessionContextPromotion,
} from "../src/local-console/pending-session-context-plan.js";
import type { LocalConsoleMessage } from "../src/local-console/types.js";

const message = (input: Partial<LocalConsoleMessage>): LocalConsoleMessage => ({
  id: 1,
  sessionId: "local:test",
  speaker: "user",
  role: null,
  body: "hello",
  status: "pending",
  createdAt: "2026-01-01T00:00:00.000Z",
  completedAt: null,
  runId: null,
  runDir: null,
  error: null,
  ...input,
} as LocalConsoleMessage);

describe("pending session context plan", () => {
  it("blocks promotion while a run or worker dispatch is active", () => {
    expect(planPendingSessionContextPromotion({ hasActiveRun: true, hasScheduledWorker: false, messages: [] }))
      .toEqual({ kind: "blocked" });
    expect(planPendingSessionContextPromotion({
      hasActiveRun: false,
      hasScheduledWorker: false,
      messages: [message({ dispatchLane: "worker" })],
    })).toEqual({ kind: "blocked" });
  });

  it("promotes and resolves only messages waiting for the effective team", () => {
    const awaiting = message({ id: 2, body: "@qa check", dispatchLane: "awaiting-team" });
    const promotion = planPendingSessionContextPromotion({
      hasActiveRun: false,
      hasScheduledWorker: false,
      messages: [awaiting],
    });
    expect(promotion).toEqual({ kind: "promote-and-resolve", awaiting: [awaiting] });
    expect(planAwaitingDispatchResolution([awaiting], ["dev-manager", "qa"])).toEqual({
      kind: "resolve",
      dispatches: [{ messageId: 2, lane: "worker", role: "qa", reason: "single-valid-mention" }],
    });
    expect(planAwaitingDispatchResolution([awaiting], [])).toEqual({ kind: "skip" });
  });
});
