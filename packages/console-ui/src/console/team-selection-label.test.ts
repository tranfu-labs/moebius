import { describe, expect, it } from "vitest";

import type { OperatorAgentTeam } from "@/console/agent-teams-page";
import { getAgentTeamSelectionLabel } from "@/console/team-selection-label";

describe("agent team selection labels", () => {
  it("keeps unique names concise and identifies duplicate ownership", () => {
    const official = team({ teamKey: "system:a", ownership: "system", name: "通用助手" });
    const user = team({ teamKey: "user:a", ownership: "user", name: "通用助手" });
    expect(label(official, [official, user])).toBe("通用助手 · 官方来源");
    expect(label(user, [official, user])).toBe("通用助手 · 用户团队");
    expect(label(official, [official])).toBe("通用助手");
  });

  it("uses stable public source names and creation times for same-source duplicates", () => {
    const officialA = team({
      teamKey: "system:a",
      ownership: "system",
      name: "同名",
      officialSourceName: "开发团队",
    });
    const officialB = team({
      teamKey: "system:b",
      ownership: "system",
      name: "同名",
      officialSourceName: "内容生产团队",
    });
    const userA = team({
      teamKey: "user:a",
      ownership: "user",
      name: "用户同名",
      createdAt: "2026-07-29T01:02:03.004Z",
    });
    const userB = team({
      teamKey: "user:b",
      ownership: "user",
      name: "用户同名",
      createdAt: "2026-07-29T01:02:04.005Z",
    });
    expect(label(officialA, [officialA, officialB])).toContain("开发团队");
    expect(label(officialB, [officialA, officialB])).toContain("内容生产团队");
    expect(label(userA, [userA, userB])).not.toBe(label(userB, [userA, userB]));
    expect(label(userA, [userA, userB])).not.toContain("user:a");
  });
});

function label(teamValue: OperatorAgentTeam, teams: OperatorAgentTeam[]): string {
  return getAgentTeamSelectionLabel({
    team: teamValue,
    teams,
    locale: "zh-CN",
    untitledLabel: "未命名团队",
    officialLabel: "官方来源",
    userLabel: "用户团队",
  });
}

function team(overrides: Partial<OperatorAgentTeam> & Pick<OperatorAgentTeam, "teamKey" | "ownership">):
OperatorAgentTeam {
  return {
    id: overrides.teamKey,
    name: "团队",
    description: "",
    primaryAgentSlug: "assistant",
    memberOrder: ["assistant"],
    members: [],
    status: "usable",
    canCreateConversation: true,
    ...overrides,
  };
}
