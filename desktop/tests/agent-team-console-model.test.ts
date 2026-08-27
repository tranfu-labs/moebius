import { describe, expect, it } from "vitest";
import type { OperatorAgentTeam } from "@moebius/console-ui";

import type { AgentTeamListItem } from "../src/team-ipc-contract.js";
import {
  planAgentTeamBuilderDraftSource,
  planAgentTeamCatalogLoad,
  planAgentTeamCatalogRemove,
  planAgentTeamFallbackSelection,
  planAgentTeamIdentityMarkdown,
  planAgentTeamMemberRemoval,
  planAgentTeamMemberSummary,
  planAgentTeamReorderChange,
  planAgentTeamReorderOperation,
  planBuilderOperation,
  planBuilderRetry,
  planOperatorAgentTeam,
  planSelectedBuilderTeamId,
} from "../src/console-page/agent-team-console-model.js";

describe("agent team console model", () => {
  it("plans builder ownership without renderer or preload dependencies", () => {
    expect(planAgentTeamBuilderDraftSource("active", "stored")).toBe("current");
    expect(planAgentTeamBuilderDraftSource(null, "safe-id")).toBe("stored");
    expect(planAgentTeamBuilderDraftSource(null, "unsafe id")).toBe("create");
    expect(planBuilderOperation(false)).toBe("unavailable");
    expect(planBuilderRetry(false)).toBe("start");
    expect(planSelectedBuilderTeamId({
      builderCli: null,
      phase: "selected",
      messages: [],
      proposal: null,
      proposalRevision: null,
      error: null,
      actions: [],
      selectedTeamId: "launch-team",
    })).toBe("launch-team");
  });

  it("normalizes catalog loading outcomes before renderer state is committed", () => {
    expect(planAgentTeamCatalogLoad({ status: "loading" }, null)).toEqual({ kind: "retry" });
    expect(planAgentTeamCatalogLoad({ status: "configuration-error" }, null))
      .toEqual({ kind: "configuration-error" });
    expect(planAgentTeamCatalogLoad({
      status: "ready",
      teams: [{
        id: "development",
        ownership: "system",
        definition: null,
        members: [],
        status: "usable",
        canCreateConversation: true,
        issues: [],
      }],
    }, { ownership: "system", teamId: "development" })).toMatchObject({
      kind: "ready",
      lastUsedTeamKey: "system:development",
      state: { status: "ready" },
    });
  });

  it("preserves a usable fallback after team and member deletion decisions", () => {
    const state = {
      status: "ready" as const,
      teams: [
        operatorTeam("user:first", "first", "lead"),
        operatorTeam("user:second", "second", "editor"),
      ],
    };
    const remaining = planAgentTeamCatalogRemove(state, "user:first");
    expect(planAgentTeamFallbackSelection(remaining.status === "ready" ? remaining.teams : []))
      .toEqual({ teamKey: "user:second", memberSlug: "editor" });
    expect(planAgentTeamMemberRemoval(state.teams[0], "lead", true)).toBe("primary");
    expect(planAgentTeamMemberRemoval(state.teams[0], "writer", true)).toBe("remove");
    expect(planAgentTeamMemberRemoval(state.teams[0], "writer", false)).toBe("unavailable");
  });

  it("merges a saved Markdown identity without dropping the member execution profile", () => {
    const team = operatorTeam("user:first", "first", "lead");
    team.members[0] = {
      ...team.members[0]!,
      executionProfile: {
        effectiveProfile: { cli: "kimi", model: "kimi-for-coding", effort: "high" },
        recommendation: null,
        binding: {
          source: "override",
          profile: { cli: "kimi", model: "kimi-for-coding", effort: "high" },
        },
      },
    };

    const state = planAgentTeamMemberSummary(
      { status: "ready", teams: [team] },
      team.teamKey,
      {
        slug: "lead",
        displayName: "新的负责人",
        description: "新的说明",
        agentMarkdown: "---\ndisplay_name: 新的负责人\n---\n",
      },
    );

    expect(state).toMatchObject({
      status: "ready",
      teams: [{
        members: [{
          slug: "lead",
          displayName: "新的负责人",
          description: "新的说明",
          available: true,
          executionProfile: {
            effectiveProfile: { cli: "kimi", model: "kimi-for-coding", effort: "high" },
            binding: { source: "override" },
          },
        }],
      }],
    });
  });

  it("plans a reorder only when the member set stays intact and the order actually changes", () => {
    const team: OperatorAgentTeam = {
      ...operatorTeam("user:dev", "dev", "manager"),
      memberOrder: ["manager", "developer"],
      members: [
        { slug: "manager", displayName: "开发经理", description: "", available: true },
        { slug: "developer", displayName: "开发", description: "", available: true },
      ],
    };
    expect(planAgentTeamReorderChange(team, ["developer", "manager"])).toBe("save");
    expect(planAgentTeamReorderOperation(team, ["developer", "manager"], true)).toBe("save");
    expect(planAgentTeamReorderOperation(team, ["developer", "manager"], false)).toBe("skip");
    // No change, a different member set, or a missing team are all skips.
    expect(planAgentTeamReorderChange(team, ["manager", "developer"])).toBe("skip");
    expect(planAgentTeamReorderChange(team, ["manager", "developer", "intruder"])).toBe("skip");
    expect(planAgentTeamReorderChange(team, ["manager"])).toBe("skip");
    expect(planAgentTeamReorderChange(undefined, ["manager", "developer"])).toBe("skip");
  });

  it("rewrites identity edits into the draft frontmatter and keeps the body intact", () => {
    const canonical = `---
display_name: 开发经理
description: 默认接单
---

# 开发经理

正文。
`;
    expect(planAgentTeamIdentityMarkdown(canonical, { displayName: "新经理" })).toBe(`---
display_name: 新经理
description: 默认接单
---

# 开发经理

正文。
`);
    expect(planAgentTeamIdentityMarkdown(canonical, { description: "新说明" })).toBe(`---
display_name: 开发经理
description: 新说明
---

# 开发经理

正文。
`);
    // Editing only one field must not leave the identity split across two sources.
    const legacy = "# 开发经理\n\n默认接单\n";
    expect(planAgentTeamIdentityMarkdown(legacy, { displayName: "新经理" })).toBe(`---
display_name: 新经理
description: 默认接单
---

# 开发经理

默认接单
`);
  });

  it("maps the installation source onto the operator team view", () => {
    const base: AgentTeamListItem = {
      id: "team",
      ownership: "user",
      definition: null,
      members: [],
      status: "usable",
      canCreateConversation: true,
      issues: [],
    };
    expect(planOperatorAgentTeam({
      ...base,
      installationSource: {
        provider: "github",
        repository: "someone/moebius-team",
        defaultBranch: "main",
      },
    }).installationSource).toEqual({
      provider: "github",
      repository: "someone/moebius-team",
      defaultBranch: "main",
    });
    expect(planOperatorAgentTeam(base).installationSource).toBeUndefined();
  });
});

function operatorTeam(teamKey: string, id: string, primaryAgentSlug: string): OperatorAgentTeam {
  return {
    teamKey,
    id,
    ownership: "user" as const,
    name: id,
    description: null,
    primaryAgentSlug,
    memberOrder: [primaryAgentSlug],
    members: [{ slug: primaryAgentSlug, displayName: primaryAgentSlug, description: "", available: true }],
    status: "usable" as const,
    canCreateConversation: true,
    canEditContent: true,
    canDeleteTeam: true,
    issues: [],
  };
}
