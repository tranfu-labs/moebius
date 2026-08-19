import { describe, expect, it } from "vitest";

import {
  GITHUB_DEFAULT_BRANCH_BASELINE_VERSION,
  planGithubTeamDetach,
  planGithubTeamInstallation,
} from "../src/github-team-install-plan.js";
import { DEFAULT_TEAM_EXECUTION_PROFILE } from "../src/team-execution-profile.js";
import type { GithubTeamSnapshot } from "../src/github-team-snapshot.js";
import { computeOfficialTeamContentFingerprintFromContent, recommendationFingerprint } from "../src/team-official-plan.js";

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
  it("blocks the same GitHub repository while allowing a different source", () => {
    const duplicate = planGithubTeamInstallation({
      teamId: "team-new",
      snapshot,
      existingRecords: [{
        id: "team-existing",
        upstream: {
          provider: "github",
          repository: snapshot.repository.repository,
          defaultBranch: "main",
        },
      }],
    });

    expect(duplicate).toEqual({ status: "duplicate", existingTeamId: "team-existing" });

    const differentSource = planGithubTeamInstallation({
      teamId: "team-new",
      snapshot: {
        ...snapshot,
        repository: { ...snapshot.repository, repository: "tranfu-labs/another-team" },
      },
      existingRecords: [{
        id: "team-existing",
        upstream: {
          provider: "github",
          repository: snapshot.repository.repository,
          defaultBranch: "main",
        },
      }],
    });

    expect(differentSource.status).toBe("install");
  });

  it("plans a verified full baseline and member execution bindings", () => {
    const result = planGithubTeamInstallation({
      teamId: "team-new",
      snapshot,
      existingRecords: [],
    });

    expect(result).toMatchObject({
      status: "install",
      teamId: "team-new",
      upstream: {
        provider: "github",
        repository: snapshot.repository.repository,
        defaultBranch: "main",
      },
      officialState: {
        appliedOfficialVersion: GITHUB_DEFAULT_BRANCH_BASELINE_VERSION,
        baselineConfidence: "verified",
        appliedContentSnapshot: snapshot.content,
      },
      executionBindings: {
        dev: { source: "recommended" },
        qa: { source: "explicit", profile: DEFAULT_TEAM_EXECUTION_PROFILE },
      },
    });
    if (result.status !== "install") return;
    expect(result.officialState.appliedContentFingerprint).toBe(
      computeOfficialTeamContentFingerprintFromContent(snapshot.content),
    );
    expect(result.officialState.appliedRecommendationFingerprint).toBe(
      recommendationFingerprint(snapshot.recommendations),
    );
  });
});

describe("planGithubTeamDetach", () => {
  const records = [
    { id: "team-following", upstream: { provider: "github" as const, repository: "someone/moebius-team", defaultBranch: "main" } },
    { id: "team-local" },
  ];

  it("detaches a team that follows an upstream repository", () => {
    expect(planGithubTeamDetach(records, "team-following")).toEqual({ status: "detach" });
  });

  it("refuses to detach a team with no upstream", () => {
    expect(planGithubTeamDetach(records, "team-local")).toEqual({ status: "not-following" });
  });

  it("reports a missing team as not-found", () => {
    expect(planGithubTeamDetach(records, "team-unknown")).toEqual({ status: "not-found" });
  });
});
