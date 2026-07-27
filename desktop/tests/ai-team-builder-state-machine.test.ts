import { describe, expect, it } from "vitest";
import {
  acceptAiTeamBuilderProposal,
  assignAiTeamBuilderExecutionProfile,
  beginAiTeamBuilderCommit,
  beginAiTeamBuilderTurn,
  createAiTeamBuilderDraft,
} from "../src/ai-team-builder/state-machine.js";

const proposal = {
  team: { name: "团队", purpose: "用途" },
  members: [
    {
      slug: "lead",
      name: "负责人",
      role: "负责收尾",
      responsibilities: ["拆解"],
      constraints: ["不修改其他成员负责的交付物"],
      handoffs: ["writer"],
    },
    {
      slug: "writer",
      name: "作者",
      role: "负责内容",
      responsibilities: ["写作"],
      constraints: ["不修改其他成员负责的交付物"],
      handoffs: ["lead"],
    },
  ],
  primaryAgentSlug: "lead",
  relayBeats: [{ speakerSlug: "lead", message: "派工" }],
};

describe("AI team builder state machine", () => {
  it("assigns an execution profile once and keeps it frozen", () => {
    const assigned = assignAiTeamBuilderExecutionProfile(
      createAiTeamBuilderDraft("draft"),
      { cli: "kimi", model: "kimi-for-coding", effort: "high" },
    );
    expect(assignAiTeamBuilderExecutionProfile(
      assigned,
      { cli: "codex", model: "gpt", effort: "medium" },
    )).toBe(assigned);
    expect(assigned).toMatchObject({
      version: 3,
      executionProfile: { cli: "kimi", model: "kimi-for-coding", effort: "high" },
      externalSessionId: null,
    });
  });

  it("accepts only the current proposal revision for commit", () => {
    const running = beginAiTeamBuilderTurn(createAiTeamBuilderDraft("draft"), "目标", {
      appendUserMessage: true,
    });
    const current = acceptAiTeamBuilderProposal(running, proposal, "thread");

    expect(() => beginAiTeamBuilderCommit(current, 0)).toThrowError(
      expect.objectContaining({ staleCode: "AI_TEAM_BUILDER_STALE_REVISION" }),
    );
    expect(beginAiTeamBuilderCommit(current, 1)).toMatchObject({
      phase: "committing",
      proposalRevision: 1,
    });
  });
});
