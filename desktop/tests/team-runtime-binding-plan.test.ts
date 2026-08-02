import { describe, expect, it } from "vitest";

import {
  AgentTeamRosterUnavailableError,
  deriveAgentTeamHealth,
  orderPrimaryFirst,
  planRosterReadFailure,
  planSessionAgentSource,
  selectMemberExecutionBinding,
} from "../src/team-runtime-binding-plan.js";

describe("team runtime binding plan", () => {
  it("selects legacy shared agents and orders a bound primary first", () => {
    expect(planSessionAgentSource({ agentTeamOwnership: null, agentTeamId: null })).toBe("shared");
    expect(orderPrimaryFirst({
      definition: { primaryAgentSlug: "manager" },
      members: [{ slug: "dev" }, { slug: "manager" }],
    }).map((member) => member.slug)).toEqual(["manager", "dev"]);
  });

  it("derives repair health and deleted read failures", () => {
    expect(deriveAgentTeamHealth({
      teamId: "development",
      snapshot: {
        location: { dataRoot: "/data", id: "development", directory: "/missing", ownership: "user" },
        definition: null,
        members: [],
        status: "needs-repair",
        canCreateConversation: false,
        issues: [{ code: "team-directory-missing", message: "missing" }],
      },
    })).toEqual({ health: "needs-repair", reason: "missing" });
    expect(planRosterReadFailure(new AgentTeamRosterUnavailableError("development", "deleted")))
      .toBe("deleted");
  });

  it("defaults only members without a recommendation to an explicit profile", () => {
    expect(selectMemberExecutionBinding({ binding: undefined, recommendation: undefined }))
      .toMatchObject({ source: "explicit" });
    expect(selectMemberExecutionBinding({
      binding: undefined,
      recommendation: { cli: "codex", model: "gpt-5.6-sol", effort: "high" },
    })).toEqual({ source: "recommended" });
  });
});
