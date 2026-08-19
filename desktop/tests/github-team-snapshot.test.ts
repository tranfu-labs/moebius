import { describe, expect, it } from "vitest";

import {
  GITHUB_TEAM_LANGUAGE_TOPICS,
  GITHUB_TEAM_TOPIC,
  type GithubRepositoryDirectoryEntry,
  type GithubRepositoryMetadata,
} from "../src/github-team-contract.js";
import {
  parseGithubTeamSnapshot,
  type GithubTeamRemoteFileRead,
  type GithubTeamSnapshotInput,
} from "../src/github-team-snapshot.js";

const repository: GithubRepositoryMetadata = {
  repository: "tranfu-labs/moebius-team-development",
  name: "开发团队",
  description: "负责软件交付。",
  stars: 12,
  updatedAt: "2026-08-18T00:00:00Z",
  private: false,
  topics: [GITHUB_TEAM_TOPIC, GITHUB_TEAM_LANGUAGE_TOPICS.zh],
  defaultBranch: "main",
  htmlUrl: "https://github.com/tranfu-labs/moebius-team-development",
};

const definition = {
  name: "开发团队",
  description: "负责软件交付。",
  primaryAgentSlug: "dev",
  memberOrder: ["dev", "qa"],
};

function rootEntries(includeOfficial = true): GithubRepositoryDirectoryEntry[] {
  return [
    { type: "file", path: "team.json", sha: "team", size: 100 },
    { type: "dir", path: "members", sha: "members", size: null },
    ...(includeOfficial ? [{ type: "file" as const, path: "official.json", sha: "official", size: 100 }] : []),
  ];
}

function file(content: string): GithubTeamRemoteFileRead {
  return { content };
}

function baseInput(overrides: Partial<GithubTeamSnapshotInput> = {}): GithubTeamSnapshotInput {
  return {
    repository,
    rootEntries: rootEntries(),
    files: {
      "team.json": file(JSON.stringify(definition)),
      "official.json": file(JSON.stringify({
        schemaVersion: 1,
        officialVersion: "2026.08.18",
        members: {
          dev: { recommendedProfile: { cli: "codex", model: "gpt-5.6-sol", effort: "high" } },
          qa: { recommendedProfile: { cli: "pi", providerId: "deepseek", providerProfileId: "team", model: "deepseek-chat", effort: "medium" }, renamedFrom: "old-qa" },
        },
      })),
      "members/dev/AGENT.md": file("---\ndisplay_name: 开发\ndescription: 实现功能\n---\n\n# 规则\n"),
      "members/qa/AGENT.md": file("---\ndisplay_name: 测试\ndescription: 验证功能\n---\n\n# 规则\n"),
    },
    ...overrides,
  };
}

describe("parseGithubTeamSnapshot", () => {
  it("builds a complete preview snapshot and preserves core content", () => {
    const result = parseGithubTeamSnapshot(baseInput());

    expect(result.status).toBe("ready");
    if (result.status !== "ready") return;
    expect(result.snapshot.definition).toEqual(definition);
    expect(result.snapshot.members.map((member) => member.slug)).toEqual(["dev", "qa"]);
    expect(result.snapshot.members[0]?.identity).toEqual({ displayName: "开发", description: "实现功能" });
    expect(result.snapshot.members[1]?.recommendedProfile).toEqual({
      cli: "pi",
      providerId: "deepseek",
      providerProfileId: "team",
      model: "deepseek-chat",
      effort: "medium",
    });
    expect(result.snapshot.officialVersion).toBe("2026.08.18");
    expect(result.snapshot.recommendationManifest?.members.qa?.renamedFrom).toBe("old-qa");
    expect(Object.keys(result.snapshot.content).sort()).toEqual([
      "members/dev/AGENT.md",
      "members/qa/AGENT.md",
      "team.json",
    ]);
  });

  it("allows the core team format without an optional recommendation manifest", () => {
    const result = parseGithubTeamSnapshot(baseInput({
      rootEntries: rootEntries(false),
      files: {
        "team.json": file(JSON.stringify(definition)),
        "members/dev/AGENT.md": file("# 开发\n\n实现功能\n"),
        "members/qa/AGENT.md": file("# 测试\n\n验证功能\n"),
      },
    }));

    expect(result.status).toBe("ready");
    if (result.status !== "ready") return;
    expect(result.snapshot.officialVersion).toBeNull();
    expect(result.snapshot.members.every((member) => member.recommendedProfile === null)).toBe(true);
  });

  it("keeps unreadable member files in the snapshot for a blocked preview", () => {
    const result = parseGithubTeamSnapshot(baseInput({
      files: {
        ...baseInput().files,
        "members/qa/AGENT.md": { content: null, error: "GitHub returned 403 for qa/AGENT.md" },
      },
    }));

    expect(result.status).toBe("ready");
    if (result.status !== "ready") return;
    expect(result.snapshot.members[0]?.readable).toBe(true);
    expect(result.snapshot.members[1]).toMatchObject({
      slug: "qa",
      readable: false,
      agentMarkdown: null,
      readError: "GitHub returned 403 for qa/AGENT.md",
    });
    expect(result.issues).toContainEqual(expect.objectContaining({
      code: "member-agent-unreadable",
      slug: "qa",
    }));
  });

  it("rejects a repository that does not satisfy the topic and root contract", () => {
    const result = parseGithubTeamSnapshot(baseInput({
      repository: { ...repository, topics: [] },
      rootEntries: [{ type: "file", path: "team.json", sha: "team", size: 100 }],
    }));

    expect(result.status).toBe("invalid");
    if (result.status !== "invalid") return;
    expect(result.issues.map((issue) => issue.code)).toEqual(expect.arrayContaining([
      "team-topic-missing",
      "team-language-topic-missing",
      "members-directory-missing",
    ]));
  });

  it("rejects malformed team structure before attempting member reads", () => {
    const result = parseGithubTeamSnapshot(baseInput({
      files: {
        ...baseInput().files,
        "team.json": file(JSON.stringify({ ...definition, primaryAgentSlug: null, memberOrder: [] })),
      },
    }));

    expect(result.status).toBe("invalid");
    if (result.status !== "invalid") return;
    expect(result.issues.map((issue) => issue.code)).toEqual(expect.arrayContaining([
      "team-members-empty",
      "team-primary-missing",
    ]));
  });

  it("rejects an invalid recommendation manifest instead of silently dropping it", () => {
    const result = parseGithubTeamSnapshot(baseInput({
      files: {
        ...baseInput().files,
        "official.json": file(JSON.stringify({
          schemaVersion: 1,
          officialVersion: "1",
          members: { unknown: { recommendedProfile: { cli: "codex", model: "x", effort: "high" } } },
        })),
      },
    }));

    expect(result.status).toBe("invalid");
    if (result.status !== "invalid") return;
    expect(result.issues[0]).toMatchObject({ code: "official-manifest-invalid" });
  });
});
