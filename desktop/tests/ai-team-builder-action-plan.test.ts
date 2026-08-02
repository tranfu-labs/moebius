import { describe, expect, it } from "vitest";

import {
  planAiTeamBuilderAdjustment,
  planAiTeamBuilderRetry,
  planAiTeamBuilderSubmit,
} from "../src/ai-team-builder/builder-action-plan.js";
import { createAiTeamBuilderDraft } from "../src/ai-team-builder/state-machine.js";

describe("AI team builder action plans", () => {
  it("separates submit and adjustment phases", () => {
    const idle = createAiTeamBuilderDraft("draft-1");

    expect(planAiTeamBuilderSubmit(idle)).toEqual({ kind: "allow" });
    expect(planAiTeamBuilderAdjustment(idle)).toMatchObject({ kind: "reject" });
    expect(planAiTeamBuilderAdjustment({ ...idle, phase: "proposal" })).toEqual({ kind: "allow" });
  });

  it("retries the failed operation without changing its ownership", () => {
    const draft = createAiTeamBuilderDraft("draft-1");

    expect(planAiTeamBuilderRetry({
      ...draft,
      phase: "failed",
      failedFrom: "turn",
      pendingPrompt: "retry this turn",
    })).toEqual({ kind: "turn", prompt: "retry this turn" });
    expect(planAiTeamBuilderRetry({
      ...draft,
      phase: "failed",
      failedFrom: "commit",
      proposal: {} as never,
      proposalRevision: 3,
    })).toEqual({ kind: "commit", proposalRevision: 3 });
  });

  it("fails closed when a failed draft has no retry payload", () => {
    const draft = createAiTeamBuilderDraft("draft-1");

    expect(planAiTeamBuilderRetry(draft)).toMatchObject({ kind: "reject" });
    expect(planAiTeamBuilderRetry({
      ...draft,
      phase: "failed",
      failedFrom: "turn",
      pendingPrompt: null,
    })).toMatchObject({ kind: "reject" });
  });
});
