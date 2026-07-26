import { describe, expect, it } from "vitest";

import type { OperatorAgentTeam } from "@/console/agent-teams-page";
import {
  canContinueOnboardingEnvironment,
  chooseOnboardingBuilderCli,
  createOnboardingShellState,
  getOnboardingTeamCompatibility,
  reduceOnboardingShell,
  resolveDefaultOnboardingTeamKey,
} from "./onboarding-state";

const builtInDevelopmentTeam: OperatorAgentTeam = {
  teamKey: "system:development",
  id: "development",
  ownership: "system",
  name: "开发团队",
  description: "把目标变成可验证的实现",
  primaryAgentSlug: "dev-manager",
  memberOrder: ["dev-manager"],
  members: [{
    slug: "dev-manager",
    displayName: "技术负责人",
    description: "拆解并收尾",
  }],
  status: "usable",
  canCreateConversation: true,
};

describe("onboarding shell state", () => {
  it("keeps the selected team while moving backward and forward", () => {
    let state = createOnboardingShellState();
    state = reduceOnboardingShell(state, { type: "environment-passed" });
    state = reduceOnboardingShell(state, { type: "next" });
    state = reduceOnboardingShell(state, {
      type: "select-team",
      teamKey: "system:development",
    });
    state = reduceOnboardingShell(state, { type: "next" });
    state = reduceOnboardingShell(state, { type: "next" });
    state = reduceOnboardingShell(state, { type: "back" });
    state = reduceOnboardingShell(state, { type: "back" });

    expect(state).toMatchObject({
      step: 2,
      environmentPassed: true,
      selectedTeamKey: "system:development",
      relayRun: 2,
    });
  });

  it("keeps the AI builder inside step 2 and blocks page navigation while open", () => {
    let state = reduceOnboardingShell(
      { ...createOnboardingShellState(), step: 2 },
      { type: "open-team-builder" },
    );

    state = reduceOnboardingShell(state, { type: "next" });
    expect(state.step).toBe(2);
    expect(state.teamBuilderOpen).toBe(true);

    state = reduceOnboardingShell(state, { type: "close-team-builder" });
    expect(state.teamBuilderOpen).toBe(false);
  });

  it("prefers the usable built-in development team", () => {
    const fallback = {
      ...builtInDevelopmentTeam,
      teamKey: "system:research",
      id: "research",
      name: "研究团队",
    };
    const unavailable = {
      ...builtInDevelopmentTeam,
      canCreateConversation: false,
    };

    expect(resolveDefaultOnboardingTeamKey([
      fallback,
      unavailable,
      builtInDevelopmentTeam,
    ])).toBe("system:development");
  });

  it("allows Codex-only, Kimi-only, and dual readiness but blocks dual failure", () => {
    const missing = { status: "missing" as const, revision: 1 };
    const ready = { status: "ready" as const, revision: 1 };

    expect(canContinueOnboardingEnvironment({ codex: ready, kimi: missing })).toBe(true);
    expect(canContinueOnboardingEnvironment({ codex: missing, kimi: ready })).toBe(true);
    expect(canContinueOnboardingEnvironment({ codex: ready, kimi: ready })).toBe(true);
    expect(canContinueOnboardingEnvironment({ codex: missing, kimi: missing })).toBe(false);
    expect(chooseOnboardingBuilderCli({ codex: missing, kimi: ready })).toBe("kimi");
    expect(chooseOnboardingBuilderCli({ codex: ready, kimi: ready })).toBe("codex");
  });

  it("reports affected members without changing their configured CLI", () => {
    const team: OperatorAgentTeam = {
      ...builtInDevelopmentTeam,
      members: [
        {
          ...builtInDevelopmentTeam.members[0]!,
          executionProfile: {
            binding: { source: "recommended" },
            recommendation: { cli: "codex", model: "gpt", effort: "high" },
            effectiveProfile: { cli: "codex", model: "gpt", effort: "high" },
          },
        },
        {
          slug: "qa",
          displayName: "测试",
          description: "验收",
          executionProfile: {
            binding: {
              source: "explicit",
              profile: { cli: "kimi", model: "kimi", effort: "high" },
            },
            recommendation: null,
            effectiveProfile: { cli: "kimi", model: "kimi", effort: "high" },
          },
        },
      ],
    };
    const result = getOnboardingTeamCompatibility(team, {
      codex: { status: "ready", revision: 1 },
      kimi: { status: "missing", revision: 1 },
    });

    expect(result).toEqual({
      affectedCount: 1,
      clis: ["kimi"],
      copy: "其中 1 名成员仍需完成 Kimi 准备",
    });
    expect(team.members[1]?.executionProfile?.effectiveProfile.cli).toBe("kimi");
  });
});
