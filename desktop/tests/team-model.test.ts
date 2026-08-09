import { describe, expect, it } from "vitest";
import {
  createInitialAgentMarkdown,
  createUniqueAgentSlug,
  evaluateTeamStatus,
  parseAgentMarkdownIdentity,
  parseTeamDefinitionJson,
  serializeTeamDefinition,
  type TeamDefinition,
} from "../src/team-model.js";

const usableDefinition: TeamDefinition = {
  name: "开发团队",
  description: "负责软件开发任务",
  primaryAgentSlug: "manager",
  memberOrder: ["manager", "developer"],
};

describe("team model", () => {
  it("round-trips only core team identity and runtime membership", () => {
    const encoded = serializeTeamDefinition(usableDefinition);

    expect(JSON.parse(encoded)).toEqual(usableDefinition);
    expect(encoded).not.toContain("displayName");
    expect(encoded).not.toContain("relayBeats");
    expect(parseTeamDefinitionJson(encoded)).toEqual(usableDefinition);
  });

  it("rejects member summary fields in team.json", () => {
    expect(() =>
      parseTeamDefinitionJson(
        JSON.stringify({
          ...usableDefinition,
          members: [{ slug: "manager", displayName: "开发经理" }],
        }),
      ),
    ).toThrow(/unsupported field: members/);
  });

  it("ignores recent embedded relay metadata so presentation data cannot invalidate a team", () => {
    expect(parseTeamDefinitionJson(JSON.stringify({
      ...usableDefinition,
      relayBeats: "damaged presentation data",
    }))).toEqual(usableDefinition);
  });

  it("round-trips member portraits in the app record and omits them when empty", () => {
    const withPortraits: TeamDefinition = {
      ...usableDefinition,
      memberPortraits: { manager: "cat-12", developer: "cat-03" },
    };
    const encoded = serializeTeamDefinition(withPortraits);
    expect(JSON.parse(encoded)).toMatchObject({ memberPortraits: { manager: "cat-12", developer: "cat-03" } });
    expect(parseTeamDefinitionJson(encoded)).toEqual(withPortraits);
    // A team without explicit faces keeps the previous file shape.
    expect(JSON.parse(serializeTeamDefinition(usableDefinition))).not.toHaveProperty("memberPortraits");
  });

  it("drops malformed portrait entries instead of invalidating the team", () => {
    expect(parseTeamDefinitionJson(JSON.stringify({
      ...usableDefinition,
      memberPortraits: {
        manager: "cat-12",
        developer: ["not", "a", "string"],
        "bad/slug": "cat-01",
        "": "cat-02",
        unknown: 42,
        qa: "multi\nline",
      },
    }))).toEqual({
      ...usableDefinition,
      memberPortraits: { manager: "cat-12" },
    });
  });

  it("prefers canonical frontmatter identity over persona prose", () => {
    expect(
      parseAgentMarkdownIdentity(`---
display_name: 开发经理
description: 负责技术决策、架构选型与质量保证。
legacy_field: ignored
---

# 角色

长篇 persona`),
    ).toEqual({
      displayName: "开发经理",
      description: "负责技术决策、架构选型与质量保证。",
    });
  });

  it("keeps the legacy heading and paragraph identity readable", () => {
    expect(parseAgentMarkdownIdentity("# 开发经理\n\n默认接单并组织团队推进\n")).toEqual({
      displayName: "开发经理",
      description: "默认接单并组织团队推进",
    });
  });

  it("rejects partial or invalid canonical identity instead of mixing sources", () => {
    expect(() => parseAgentMarkdownIdentity(`---
display_name: 开发经理
---
# 角色

默认接单`)).toThrow(/requires both display_name and description/);
    expect(() => parseAgentMarkdownIdentity(`---
display_name: 开发经理
description: |
  第一行
  第二行
---
# 角色`)).toThrow(/description must be a non-empty single-line string/);
  });

  it("creates a team-unique slug without coupling it to later display-name edits", () => {
    expect(createUniqueAgentSlug("QA Lead", [])).toBe("qa-lead");
    expect(createUniqueAgentSlug("QA Lead", ["qa-lead", "qa-lead-2"])).toBe("qa-lead-3");
    expect(createUniqueAgentSlug("新 Agent", ["agent"])).toBe("agent-2");
    expect(createInitialAgentMarkdown({ displayName: "新 Agent", description: "描述职责" })).toBe(
      `---
display_name: 新 Agent
description: 描述职责
---

# 角色

请补充这个 Agent 的职责、边界和协作方式。
`,
    );
  });

  it("does not make missing identity prose a structural failure", () => {
    expect(parseAgentMarkdownIdentity("没有一级标题，但仍然是可读的自然语言内容")).toEqual({
      displayName: "",
      description: "",
    });
    expect(evaluateTeamStatus({ definition: usableDefinition })).toMatchObject({ status: "usable" });
  });

  it("marks a valid single-member team usable", () => {
    expect(
      evaluateTeamStatus({
        definition: { ...usableDefinition, memberOrder: ["manager"] },
      }),
    ).toEqual({ status: "usable", canCreateConversation: true, issues: [] });
  });

  it("marks a team without a primary agent as an unfinished draft", () => {
    expect(
      evaluateTeamStatus({
        definition: { ...usableDefinition, primaryAgentSlug: null, memberOrder: [] },
      }),
    ).toEqual({ status: "unfinished-draft", canCreateConversation: false, issues: [] });
  });

  it("normalizes an empty primary slug from disk to the no-primary draft shape", () => {
    const definition = parseTeamDefinitionJson(JSON.stringify({ ...usableDefinition, primaryAgentSlug: "" }));

    expect(definition.primaryAgentSlug).toBeNull();
    expect(evaluateTeamStatus({ definition }).status).toBe("unfinished-draft");
  });

  it("prioritizes repair over draft when slugs are missing or duplicated", () => {
    const result = evaluateTeamStatus({
      definition: {
        ...usableDefinition,
        primaryAgentSlug: null,
        memberOrder: ["developer", "", "developer"],
      },
    });

    expect(result.status).toBe("needs-repair");
    expect(result.canCreateConversation).toBe(false);
    expect(result.issues.map((issue) => issue.code)).toEqual(["member-slug-missing", "member-slug-duplicate"]);
  });

  it("marks a primary agent outside the current members as needing repair", () => {
    expect(
      evaluateTeamStatus({
        definition: { ...usableDefinition, primaryAgentSlug: "reviewer" },
      }),
    ).toMatchObject({
      status: "needs-repair",
      canCreateConversation: false,
      issues: [{ code: "primary-agent-not-member", slug: "reviewer" }],
    });
  });
});
