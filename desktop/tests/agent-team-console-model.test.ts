import { describe, expect, it } from "vitest";
import type { OperatorAgentTeam } from "@moebius/console-ui";

import {
  planAgentTeamBuilderDraftSource,
  planAgentTeamCatalogLoad,
  planAgentTeamCatalogRemove,
  planAgentTeamFallbackSelection,
  planAgentTeamMemberRemoval,
  planAgentTeamMemberSummary,
  planBuilderOperation,
  planBuilderRetry,
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
