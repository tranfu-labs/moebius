import { describe, expect, it } from "vitest";

import {
  parseTeamRequest,
  planTeamListLoad,
  selectExecutionBinding,
  selectMemberSlugs,
  toListItem,
} from "../src/team-service-plan.js";
import type { TeamSnapshot } from "../src/team-store.js";

describe("team service plan", () => {
  it("parses ownership and plans loading", () => {
    expect(parseTeamRequest({ teamId: "development", ownership: "system" }))
      .toEqual({ teamId: "development", ownership: "system" });
    expect(planTeamListLoad(true)).toBe("loading");
  });

  it("selects member and profile fallbacks", () => {
    expect(selectExecutionBinding({
      binding: undefined,
      recommendation: null,
      defaultProfile: { cli: "codex", model: "gpt-5.6-sol", effort: "high" },
    })).toMatchObject({ source: "explicit" });
    expect(selectMemberSlugs({
      location: { dataRoot: "/data", id: "team", directory: "/team", ownership: "user" },
      definition: null,
      members: [{ slug: "manager", directory: "", agentFile: "", agentMarkdown: "", displayName: "", description: "" }],
      status: "needs-repair",
      canCreateConversation: false,
      issues: [],
    })).toEqual(["manager"]);
  });

  it("carries an upstream repository fallback onto the presented list item", () => {
    const snapshot: TeamSnapshot = {
      location: { dataRoot: "/data", id: "team", directory: "/team", ownership: "user" },
      definition: null,
      members: [],
      status: "usable",
      canCreateConversation: true,
      issues: [],
    };
    expect(toListItem(snapshot, { definition: null, upstreamRepository: "someone/moebius-team" }))
      .toMatchObject({ upstreamRepository: "someone/moebius-team" });
    expect(toListItem(snapshot, { definition: null }).upstreamRepository).toBeUndefined();
    expect(toListItem(snapshot).upstreamRepository).toBeUndefined();
  });
});
