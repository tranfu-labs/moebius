import { describe, expect, it } from "vitest";

import {
  planAiTeamStagedValidation,
  planAiTeamWrite,
  planAiTeamWriteCleanupTarget,
} from "../src/ai-team-builder/team-write-plan.js";
import { parseAgentMarkdownIdentity } from "../src/team-model.js";

const proposal = {
  team: { name: "Launch Team", purpose: "持续完成产品发布" },
  members: [
    {
      slug: "launch-lead",
      name: "发布负责人",
      role: "统筹发布并收尾",
      responsibilities: ["拆解工作"],
      constraints: ["不得跳过复核"],
      handoffs: ["content-planner"],
    },
    {
      slug: "content-planner",
      name: "内容策划",
      role: "准备发布内容",
      responsibilities: ["准备渠道素材"],
      constraints: ["不得跳过复核"],
      handoffs: ["launch-lead"],
    },
  ],
  primaryAgentSlug: "launch-lead",
  relayBeats: [
    { speakerSlug: "launch-lead", message: "分派内容工作。" },
    { speakerSlug: "content-planner", message: "提交内容。" },
    { speakerSlug: "launch-lead", message: "复核并收尾。" },
  ],
};

describe("AI team write plans", () => {
  it("normalizes the staged file plan without performing IO", () => {
    const result = planAiTeamWrite(proposal, "ABC-123456789012345");

    expect(result).toMatchObject({
      ok: true,
      teamId: "launch-team-abc123456789",
      definition: {
        name: "Launch Team",
        memberOrder: ["launch-lead", "content-planner"],
      },
      orchestration: { relayBeats: proposal.relayBeats },
    });
    expect(result.ok && result.members[0]?.agentMarkdown).toContain("发布负责人");
  });

  it("rejects invalid proposals before a storage adapter is needed", () => {
    expect(planAiTeamWrite({ ...proposal, members: [] }, "id")).toEqual({
      ok: false,
      reason: "invalid-proposal",
    });
  });

  it("accounts for staged identity, ordering, usability, and device boundaries", () => {
    const write = planAiTeamWrite(proposal, "id");
    expect(write.ok).toBe(true);
    if (!write.ok) return;
    const member = write.members[0]!;
    const input = {
      proposal,
      definition: write.definition,
      orchestration: write.orchestration,
      members: write.members.map((candidate) => ({
        slug: candidate.slug,
        identity: parseAgentMarkdownIdentity(candidate.agentMarkdown),
        agentMarkdown: candidate.agentMarkdown,
      })),
      teamsDevice: 1,
      stagingDevice: 1,
    };

    expect(planAiTeamStagedValidation(input)).toEqual({ ok: true });
    expect(planAiTeamStagedValidation({ ...input, stagingDevice: 2 })).toEqual({
      ok: false,
      reason: "cross-device",
    });
    expect(planAiTeamStagedValidation({
      ...input,
      definition: { ...input.definition, memberOrder: ["someone-else"] },
    })).toMatchObject({ ok: false });
    expect(planAiTeamStagedValidation({
      ...input,
      members: [{ ...input.members[0]!, agentMarkdown: "changed" }],
    })).toEqual({ ok: false, reason: "member-identity", slug: "launch-lead" });
  });

  it("selects the cleanup target from the committed rename state", () => {
    expect(planAiTeamWriteCleanupTarget({
      renamed: false,
      staging: "/staging",
      destination: "/team",
    })).toBe("/staging");
    expect(planAiTeamWriteCleanupTarget({
      renamed: true,
      staging: "/staging",
      destination: "/team",
    })).toBe("/team");
  });
});
