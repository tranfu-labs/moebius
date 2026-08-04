import { describe, expect, it } from "vitest";

import type { OperatorAgentTeam } from "@/console/agent-teams-page";
import { projectOnboardingTeamList } from "./onboarding-team-list-model";

const builtIn = team({
  teamKey: "system:development",
  ownership: "system",
  name: "开发团队",
  description: "实现和验证产品",
  memberName: "软件测试",
});
const user = team({
  teamKey: "user:launch",
  ownership: "user",
  name: "发布团队",
  description: "准备发布材料",
  memberName: "视觉制作",
});

describe("onboarding team list projection", () => {
  it("filters by team and member copy while preserving ownership groups", () => {
    expect(projectOnboardingTeamList({
      teams: [builtIn, user],
      selectedTeamKey: builtIn.teamKey,
      query: "视觉",
    })).toMatchObject({
      total: 2,
      matched: 1,
      selectedOutsideResults: builtIn,
      builtInTeams: [],
      userTeams: [user],
    });
  });

  it("excludes unavailable teams from counts and results", () => {
    const unavailable = { ...user, teamKey: "user:broken", canCreateConversation: false };
    expect(projectOnboardingTeamList({
      teams: [builtIn, user, unavailable],
      selectedTeamKey: null,
      query: "",
    })).toMatchObject({
      total: 2,
      matched: 2,
      builtInTeams: [builtIn],
      userTeams: [user],
    });
  });
});

function team(input: {
  teamKey: string;
  ownership: "system" | "user";
  name: string;
  description: string;
  memberName: string;
}): OperatorAgentTeam {
  return {
    teamKey: input.teamKey,
    id: input.teamKey.split(":")[1]!,
    ownership: input.ownership,
    name: input.name,
    description: input.description,
    primaryAgentSlug: "lead",
    memberOrder: ["lead"],
    members: [{ slug: "lead", displayName: input.memberName, description: "成员职责" }],
    status: "usable",
    canCreateConversation: true,
  };
}
