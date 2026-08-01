import { describe, expect, it } from "vitest";
import {
  planGracefulResumeTarget,
  planGracefulResumeTargets,
} from "../src/local-console/run-recovery-plan.js";
import type { LocalCodexResumeIntentFact } from "../src/local-console/codex-resume.js";

const intent = (input: Partial<LocalCodexResumeIntentFact>): LocalCodexResumeIntentFact => ({
  sessionId: "local:test",
  intentId: "intent-1",
  targetRunId: "run-1",
  sourceMessageId: 1,
  role: "dev",
  reason: "graceful-shutdown",
  createdAt: "2026-01-01T00:00:00.000Z",
  ...input,
});

describe("run recovery plan", () => {
  it("keeps only unconsumed graceful targets that are unambiguous per source", () => {
    const facts = {
      intents: [
        intent({}),
        intent({ intentId: "intent-2", sourceMessageId: 2, targetRunId: "run-2" }),
        intent({ intentId: "intent-3", sourceMessageId: 2, targetRunId: "run-3" }),
        intent({ intentId: "intent-4", sourceMessageId: 3, targetRunId: "run-4", reason: "edit-resend" }),
      ],
      consumedIntentIds: new Set<string>(),
    };
    expect(planGracefulResumeTargets(facts)).toEqual([{ sourceMessageId: 1, targetRunId: "run-1" }]);
  });

  it("selects the latest eligible graceful target for one source", () => {
    const facts = {
      intents: [intent({}), intent({ intentId: "intent-2", targetRunId: "run-2" })],
      consumedIntentIds: new Set(["intent-2"]),
    };
    expect(planGracefulResumeTarget(facts, 1)).toBe("run-1");
    expect(planGracefulResumeTarget(facts, 9)).toBeNull();
  });
});
