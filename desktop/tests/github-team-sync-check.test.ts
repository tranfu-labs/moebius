import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { checkGithubTeamUpstream } from "../src/github-team-sync-check.js";
import { installGithubTeam } from "../src/github-team-installation.js";
import type { GithubTeamSnapshot } from "../src/github-team-snapshot.js";
import { GithubTeamTransportError, type GithubTeamTransport } from "../src/github-team-transport.js";
import type { GithubApiEnvelope, GithubRepositoryContent } from "../src/github-team-contract.js";

const temporaryRoots: string[] = [];

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
    memberOrder: ["dev"],
  },
  members: [{
    slug: "dev",
    agentMarkdown: "---\ndisplay_name: 开发\ndescription: 实现功能\n---\n\n# 规则\n",
    identity: { displayName: "开发", description: "实现功能" },
    recommendedProfile: { cli: "codex", model: "gpt-5.6-sol", effort: "high" },
    readable: true,
    readError: null,
  }],
  recommendations: {
    dev: { cli: "codex", model: "gpt-5.6-sol", effort: "high" },
  },
  recommendationManifest: null,
  // A real fetch without an official.json in the repository always parses to null;
  // this fixture must match that so install-time and check-time baselines agree.
  officialVersion: null,
  content: {
    "team.json": JSON.stringify({
      name: "开发团队",
      description: "负责软件交付。",
      primaryAgentSlug: "dev",
      memberOrder: ["dev"],
    }),
    "members/dev/AGENT.md": "---\ndisplay_name: 开发\ndescription: 实现功能\n---\n\n# 规则\n",
  },
};

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});

describe("checkGithubTeamUpstream", () => {
  it("reports not-following for a team without an upstream record", async () => {
    const dataRoot = await makeDataRoot();
    const result = await checkGithubTeamUpstream({
      dataRoot,
      teamId: "team-unknown",
      transport: createTransport({ ...snapshot.content }),
    });
    expect(result).toEqual({ status: "not-following" });
  });

  it("reports up-to-date when the remote content matches the installed baseline", async () => {
    const dataRoot = await makeDataRoot();
    const installed = await installGithubTeam({ dataRoot, snapshot });
    expect(installed.status).toBe("installed");
    if (installed.status !== "installed") return;

    const result = await checkGithubTeamUpstream({
      dataRoot,
      teamId: installed.teamId,
      transport: createTransport({ ...snapshot.content }),
    });
    expect(result).toEqual({ status: "up-to-date", recentSync: null, pendingMergeMemberCount: 0 });
  });

  it("reports update-available when the remote content has changed", async () => {
    const dataRoot = await makeDataRoot();
    const installed = await installGithubTeam({ dataRoot, snapshot });
    expect(installed.status).toBe("installed");
    if (installed.status !== "installed") return;

    const changedContent = {
      ...snapshot.content,
      "members/dev/AGENT.md": "---\ndisplay_name: 开发\ndescription: 实现功能\n---\n\n# 新规则\n",
    };
    const result = await checkGithubTeamUpstream({
      dataRoot,
      teamId: installed.teamId,
      transport: createTransport(changedContent),
    });
    expect(result).toEqual({ status: "update-available", recentSync: null, pendingMergeMemberCount: 0 });
  });

  it("reports unreachable when the transport fails", async () => {
    const dataRoot = await makeDataRoot();
    const installed = await installGithubTeam({ dataRoot, snapshot });
    expect(installed.status).toBe("installed");
    if (installed.status !== "installed") return;

    const failingTransport: GithubTeamTransport = {
      async readAuthStatus() {
        return { authenticated: true, cliAvailable: true, login: "someone" };
      },
      async searchRepositories() {
        throw new GithubTeamTransportError("NETWORK_UNAVAILABLE", "offline");
      },
      async readRepository() {
        throw new GithubTeamTransportError("NETWORK_UNAVAILABLE", "offline");
      },
      async readRepositoryContent() {
        throw new GithubTeamTransportError("NETWORK_UNAVAILABLE", "offline");
      },
    };
    const result = await checkGithubTeamUpstream({ dataRoot, teamId: installed.teamId, transport: failingTransport });
    expect(result).toEqual({ status: "unreachable", recentSync: null, pendingMergeMemberCount: 0 });
  });
});

function createTransport(remoteFiles: Record<string, string>): GithubTeamTransport {
  return {
    async readAuthStatus() {
      return { authenticated: true, cliAvailable: true, login: "someone" };
    },
    async searchRepositories() {
      return envelope({ totalCount: 0, incompleteResults: false, items: [] });
    },
    async readRepository() {
      return envelope(snapshot.repository);
    },
    async readRepositoryContent(request): Promise<GithubApiEnvelope<GithubRepositoryContent>> {
      if (request.path.length === 0) {
        return envelope([
          { type: "file" as const, path: "team.json", sha: "team.json", size: remoteFiles["team.json"]!.length },
          { type: "dir" as const, path: "members", sha: "members", size: null },
        ]);
      }
      const content = remoteFiles[request.path];
      if (content === undefined) {
        throw new GithubTeamTransportError("NOT_FOUND", "GitHub file was not found.");
      }
      return envelope({ type: "file" as const, path: request.path, sha: request.path, size: content.length, content });
    },
  };
}

function envelope<T>(data: T): GithubApiEnvelope<T> {
  return { data, rateLimit: null };
}

async function makeDataRoot(): Promise<string> {
  const dataRoot = await fs.mkdtemp(path.join(os.tmpdir(), "moebius-github-team-sync-check-"));
  temporaryRoots.push(dataRoot);
  return dataRoot;
}
