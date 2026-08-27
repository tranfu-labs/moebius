import { describe, expect, it } from "vitest";

import { planGithubTeamInstallation } from "../src/github-team-install-plan.js";
import { DEFAULT_TEAM_EXECUTION_PROFILE } from "../src/team-execution-profile.js";
import type { GithubTeamSnapshot } from "../src/github-team-snapshot.js";

const snapshot: GithubTeamSnapshot = {
  repository: {
    repository: "tranfu-labs/moebius-team-development",
    name: "开发团队",
    description: "负责软件交付。",
    stars: 12,
    updatedAt: "2026-08-18T00:00:00Z",
    private: false,
    topics: ["moebius-team", "moebius-team-zh"],
    defaultBranch: "main",
    htmlUrl: "https://github.com/tranfu-labs/moebius-team-development",
  },
  definition: {
    name: "开发团队",
    description: "负责软件交付。",
    primaryAgentSlug: "dev",
    memberOrder: ["dev", "qa"],
  },
  members: [
    {
      slug: "dev",
      agentMarkdown: "---\ndisplay_name: 开发\ndescription: 实现功能\n---\n",
      identity: { displayName: "开发", description: "实现功能" },
      recommendedProfile: { cli: "codex", model: "gpt-5.6-sol", effort: "high" },
      readable: true,
      readError: null,
    },
    {
      slug: "qa",
      agentMarkdown: "---\ndisplay_name: 测试\ndescription: 验证功能\n---\n",
      identity: { displayName: "测试", description: "验证功能" },
      recommendedProfile: null,
      readable: true,
      readError: null,
    },
  ],
  recommendations: {
    dev: { cli: "codex", model: "gpt-5.6-sol", effort: "high" },
  },
  recommendationManifest: null,
  officialVersion: null,
  content: {
    "team.json": JSON.stringify({
      name: "开发团队",
      description: "负责软件交付。",
      primaryAgentSlug: "dev",
      memberOrder: ["dev", "qa"],
    }),
    "members/dev/AGENT.md": "---\ndisplay_name: 开发\ndescription: 实现功能\n---\n",
    "members/qa/AGENT.md": "---\ndisplay_name: 测试\ndescription: 验证功能\n---\n",
  },
};

describe("planGithubTeamInstallation", () => {
  it("blocks the same GitHub source for new and legacy records", () => {
    expect(planGithubTeamInstallation({
      teamId: "team-new",
      snapshot,
      existingRecords: [{
        id: "team-existing",
        installationSource: {
          provider: "github",
          repository: snapshot.repository.repository,
          defaultBranch: "main",
        },
      }],
    })).toEqual({ status: "duplicate", existingTeamId: "team-existing" });

    expect(planGithubTeamInstallation({
      teamId: "team-new",
      snapshot,
      existingRecords: [{
        id: "team-legacy",
        upstream: {
          provider: "github",
          repository: snapshot.repository.repository,
          defaultBranch: "main",
        },
      }],
    })).toEqual({ status: "duplicate", existingTeamId: "team-legacy" });
  });

  it("plans a source-only install with explicit materialized profiles", () => {
    const result = planGithubTeamInstallation({
      teamId: "team-new",
      snapshot,
      existingRecords: [],
    });

    expect(result).toEqual({
      status: "install",
      teamId: "team-new",
      installationSource: {
        provider: "github",
        repository: snapshot.repository.repository,
        defaultBranch: "main",
      },
      executionBindings: {
        dev: { source: "explicit", profile: snapshot.recommendations.dev },
        qa: { source: "explicit", profile: DEFAULT_TEAM_EXECUTION_PROFILE },
      },
    });
  });
});
