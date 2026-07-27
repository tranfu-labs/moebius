import { describe, expect, it } from "vitest";
import {
  parseAndValidateAiTeamBuilderOutput,
  renderAiTeamMemberMarkdown,
  validateAiTeamBuilderOutput,
  type AiTeamBuilderProposalOutput,
} from "../src/ai-team-builder/validator.js";
import { parseAgentMarkdownIdentity } from "../src/team-model.js";

const validProposal: AiTeamBuilderProposalOutput = {
  phase: "proposal",
  team: { name: "产品发布团队", purpose: "持续完成产品发布" },
  members: [
    {
      slug: "launch-lead",
      name: "发布负责人",
      role: "统筹发布目标并最终收尾",
      responsibilities: ["拆解工作", "核对交付证据"],
      constraints: ["不修改其他成员负责的交付物"],
      handoffs: ["content-planner"],
    },
    {
      slug: "content-planner",
      name: "内容策划",
      role: "产出发布内容",
      responsibilities: ["提炼叙事", "准备渠道素材"],
      constraints: ["不修改其他成员负责的交付物"],
      handoffs: ["launch-lead"],
    },
  ],
  primaryAgentSlug: "launch-lead",
  relayBeats: [
    { speakerSlug: "launch-lead", message: "拆解目标并交给内容策划。" },
    { speakerSlug: "content-planner", message: "提交内容与证据。" },
    { speakerSlug: "launch-lead", message: "核对证据并收尾。" },
  ],
};

describe("AI team builder validator", () => {
  it("accepts a valid proposal and generates parseable AGENT.md frontmatter", () => {
    const result = validateAiTeamBuilderOutput(validProposal);
    expect(result).toMatchObject({ ok: true, value: { phase: "proposal" } });
    const markdown = renderAiTeamMemberMarkdown(validProposal.members[0]);
    expect(parseAgentMarkdownIdentity(markdown)).toEqual({
      displayName: "发布负责人",
      description: "统筹发布目标并最终收尾",
    });
    expect(markdown).toContain("@content-planner");
  });

  it("accepts exactly one clarifying question field", () => {
    expect(parseAndValidateAiTeamBuilderOutput(JSON.stringify({
      phase: "clarifying",
      question: "内容主要面向专业用户还是大众用户？",
    }))).toEqual({
      ok: true,
      value: {
        phase: "clarifying",
        question: "内容主要面向专业用户还是大众用户？",
      },
    });
    expect(validateAiTeamBuilderOutput({
      phase: "clarifying",
      question: "面向谁？",
      extra: true,
    })).toMatchObject({ ok: false, issues: [{ code: "invalid-shape" }] });
  });

  it("narrows the nullable structured-output envelope into the typed union", () => {
    expect(validateAiTeamBuilderOutput({
      phase: "clarifying",
      question: "主要发布到哪些渠道？",
      team: null,
      members: null,
      primaryAgentSlug: null,
      relayBeats: null,
    })).toEqual({
      ok: true,
      value: {
        phase: "clarifying",
        question: "主要发布到哪些渠道？",
      },
    });
    expect(validateAiTeamBuilderOutput({
      ...validProposal,
      question: null,
    })).toEqual({
      ok: true,
      value: validProposal,
    });
  });

  it("rejects member counts outside 2-6", () => {
    const result = validateAiTeamBuilderOutput({
      ...validProposal,
      members: [validProposal.members[0]],
    });
    expect(result).toMatchObject({
      ok: false,
      issues: expect.arrayContaining([expect.objectContaining({ code: "member-count" })]),
    });
  });

  it("rejects invalid and duplicate stable slugs", () => {
    const result = validateAiTeamBuilderOutput({
      ...validProposal,
      members: [
        { ...validProposal.members[0], slug: "Launch Lead" },
        { ...validProposal.members[1], slug: "launch-lead" },
        { ...validProposal.members[1], slug: "launch-lead" },
      ],
      primaryAgentSlug: "launch-lead",
      relayBeats: [{ speakerSlug: "launch-lead", message: "工作" }],
    });
    expect(result).toMatchObject({
      ok: false,
      issues: expect.arrayContaining([
        expect.objectContaining({ code: "invalid-slug" }),
        expect.objectContaining({ code: "duplicate-slug" }),
      ]),
    });
  });

  it("rejects a primary Agent reference outside the member set", () => {
    expect(validateAiTeamBuilderOutput({
      ...validProposal,
      primaryAgentSlug: "missing",
    })).toMatchObject({ ok: false, issues: [{ code: "primary-agent-reference" }] });
  });

  it("rejects handoff references outside the member set", () => {
    expect(validateAiTeamBuilderOutput({
      ...validProposal,
      members: [
        { ...validProposal.members[0], handoffs: ["missing"] },
        validProposal.members[1],
      ],
    })).toMatchObject({
      ok: false,
      issues: expect.arrayContaining([expect.objectContaining({ code: "handoff-reference" })]),
    });
  });

  it("rejects relay speakers outside the member set", () => {
    expect(validateAiTeamBuilderOutput({
      ...validProposal,
      relayBeats: [{ speakerSlug: "missing", message: "越界" }],
    })).toMatchObject({ ok: false, issues: [{ code: "relay-reference" }] });
  });

  it("rejects member identity fields that cannot form valid frontmatter", () => {
    expect(validateAiTeamBuilderOutput({
      ...validProposal,
      members: [
        { ...validProposal.members[0], name: "发布\n负责人" },
        validProposal.members[1],
      ],
    })).toMatchObject({ ok: false, issues: [{ code: "invalid-shape" }] });
  });

  it("rejects malformed JSON and unsupported fields without throwing", () => {
    expect(parseAndValidateAiTeamBuilderOutput("{")).toMatchObject({
      ok: false,
      issues: [{ code: "invalid-json" }],
    });
    expect(validateAiTeamBuilderOutput({ ...validProposal, threadId: "secret" })).toMatchObject({
      ok: false,
      issues: [{ code: "invalid-shape" }],
    });
  });
});
