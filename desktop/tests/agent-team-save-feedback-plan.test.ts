import { describe, expect, it } from "vitest";

import { planAgentTeamSaveFeedback } from "../src/agent-team-save-feedback-plan.js";

describe("Agent team save feedback plan", () => {
  it("reports only successfully persisted items during a partial save", () => {
    expect(planAgentTeamSaveFeedback({
      teamName: "Team A",
      successfulItems: ["AGENT.md", "profile"],
      failedItems: ["team information"],
    })).toMatchObject({ savedItemCount: 2, canApplyToExistingConversation: true });
  });

  it("does not claim success when every mutation failed", () => {
    expect(planAgentTeamSaveFeedback({ teamName: "Team A", successfulItems: [], failedItems: ["AGENT.md"] }))
      .toBeNull();
  });
});
