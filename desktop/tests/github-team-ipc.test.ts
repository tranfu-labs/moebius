import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import {
  GITHUB_TEAM_LANGUAGE_TOPICS,
  GITHUB_TEAM_TOPIC,
  type GithubApiEnvelope,
  type GithubRepositoryContent,
  type GithubRepositoryDirectoryEntry,
  type GithubRepositoryMetadata,
} from "../src/github-team-contract.js";
import {
  createGithubTeamIpcService,
  registerGithubTeamIpc,
  type GithubTeamIpcMain,
} from "../src/github-team-ipc.js";
import { GITHUB_TEAM_IPC_CHANNELS } from "../src/github-team-ipc-contract.js";
import { GithubTeamTransportError, type GithubTeamTransport } from "../src/github-team-transport.js";

const temporaryRoots: string[] = [];

function createTestService(input: { dataRoot: string; transport: GithubTeamTransport }) {
  return createGithubTeamIpcService(input);
}

const repository: GithubRepositoryMetadata = {
  repository: "someone/moebius-team",
  name: "Moebius Team",
  description: "A reusable team.",
  stars: 7,
  updatedAt: "2026-08-18T00:00:00Z",
  private: false,
  topics: [GITHUB_TEAM_TOPIC, GITHUB_TEAM_LANGUAGE_TOPICS.en],
  defaultBranch: "main",
  htmlUrl: "https://github.com/someone/moebius-team",
};

const rootEntries: GithubRepositoryDirectoryEntry[] = [
  { type: "file", path: "team.json", sha: "team", size: 100 },
  { type: "dir", path: "members", sha: "members", size: null },
  { type: "file", path: "official.json", sha: "official", size: 100 },
];

const remoteFiles: Record<string, string> = {
  "team.json": JSON.stringify({
    name: "Moebius Team",
    description: "A reusable team.",
    primaryAgentSlug: "dev",
    memberOrder: ["dev", "qa"],
  }),
  "official.json": JSON.stringify({
    schemaVersion: 1,
    officialVersion: "2026.08.18",
    members: {
      dev: { recommendedProfile: { cli: "codex", model: "gpt-5.6-sol", effort: "high" } },
    },
  }),
  "members/dev/AGENT.md": "---\ndisplay_name: Developer\ndescription: Builds features\n---\n\n# Rules\n",
  "members/qa/AGENT.md": "---\ndisplay_name: Tester\ndescription: Verifies features\n---\n\n# Checks\n",
};

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});

describe("GitHub team IPC service", () => {
  it("does not search GitHub for an empty query and maps search results", async () => {
    const calls = { auth: 0, search: 0 };
    const transport = createTransport({
      calls,
      searchResponse: {
        totalCount: 1,
        incompleteResults: false,
        items: [{
          repository: "someone/moebius-team",
          name: "Moebius Team",
          description: "A reusable team.",
          stars: 7,
          updatedAt: repository.updatedAt,
          language: "en",
          private: false,
          topics: [GITHUB_TEAM_TOPIC, GITHUB_TEAM_LANGUAGE_TOPICS.en],
        }],
      },
    });
    const service = createTestService({ dataRoot: "/tmp/moebius-github-ipc-test", transport });

    await expect(service.search({ query: "   ", language: "en" })).resolves.toEqual({
      status: "ready",
      authenticated: true,
      results: [],
    });
    expect(calls).toEqual({ auth: 1, search: 0 });

    await expect(service.search({ query: "reusable", language: "en" })).resolves.toMatchObject({
      status: "ready",
      authenticated: true,
      results: [{ repository: "someone/moebius-team", language: "en" }],
    });
    expect(calls).toEqual({ auth: 2, search: 1 });
  });

  it("returns full preview content and keeps an unreadable member visible but blocked", async () => {
    const transport = createTransport({ unreadableSlug: "qa" });
    const service = createTestService({ dataRoot: "/tmp/moebius-github-ipc-test", transport });

    const response = await service.preview({ repository: "someone/moebius-team" });

    expect(response).toMatchObject({
      status: "ready",
      team: {
        repository: "someone/moebius-team",
        defaultBranch: "main",
        primaryAgentSlug: "dev",
        members: [
          { slug: "dev", markdown: remoteFiles["members/dev/AGENT.md"], readable: true },
          { slug: "qa", readable: false },
        ],
      },
    });
    if (response.status !== "ready") return;
    expect(response.team.members[1]?.readError).toBe("GitHub denied access to this member file.");
  });

  it("installs through the existing atomic installer and reports duplicates", async () => {
    const dataRoot = await fs.mkdtemp(path.join(os.tmpdir(), "moebius-github-ipc-"));
    temporaryRoots.push(dataRoot);
    const service = createTestService({ dataRoot, transport: createTransport() });

    const first = await service.install({ repository: "someone/moebius-team" });
    expect(first).toMatchObject({ status: "installed" });
    if (first.status !== "installed") return;

    const second = await service.install({ repository: "someone/moebius-team" });
    expect(second).toEqual({ status: "duplicate", existingTeamId: first.teamId });
  });

  it("turns malformed renderer requests into safe IPC responses", async () => {
    const handlers = new Map<string, (event: unknown, request: unknown) => Promise<unknown>>();
    const ipcMain: GithubTeamIpcMain = {
      handle(channel, listener) {
        handlers.set(channel, listener);
      },
    };
    const service = createTestService({
      dataRoot: "/tmp/moebius-github-ipc-test",
      transport: createTransport(),
    });
    registerGithubTeamIpc({ ipcMain, service });
    expect([...handlers.keys()]).toEqual([
      GITHUB_TEAM_IPC_CHANNELS.authStatus,
      GITHUB_TEAM_IPC_CHANNELS.search,
      GITHUB_TEAM_IPC_CHANNELS.preview,
      GITHUB_TEAM_IPC_CHANNELS.install,
    ]);

    await expect(handlers.get(GITHUB_TEAM_IPC_CHANNELS.search)!(null, null)).resolves.toEqual({
      status: "error",
      authenticated: false,
      message: "请求无效。",
    });
    await expect(handlers.get(GITHUB_TEAM_IPC_CHANNELS.preview)!(null, { repository: 42 })).resolves.toEqual({
      status: "error",
      repository: "",
      message: "请求无效。",
    });
    await expect(handlers.get(GITHUB_TEAM_IPC_CHANNELS.install)!(null, [])).resolves.toEqual({
      status: "failed",
      message: "请求无效。",
    });
  });
});

function createTransport(input: {
  calls?: { auth: number; search: number };
  unreadableSlug?: string;
  files?: Record<string, string>;
  searchResponse?: {
    totalCount: number;
    incompleteResults: boolean;
    items: Array<{
      repository: string;
      name: string;
      description: string;
      stars: number;
      updatedAt: string;
      language: "zh" | "en" | null;
      private: boolean;
      topics: string[];
    }>;
  };
} = {}): GithubTeamTransport {
  return {
    async readAuthStatus() {
      if (input.calls !== undefined) input.calls.auth += 1;
      return { authenticated: true, cliAvailable: true, login: "someone" };
    },
    async searchRepositories() {
      if (input.calls !== undefined) input.calls.search += 1;
      return envelope(input.searchResponse ?? { totalCount: 0, incompleteResults: false, items: [] });
    },
    async readRepository() {
      return envelope(repository);
    },
    async readRepositoryContent(request): Promise<GithubApiEnvelope<GithubRepositoryContent>> {
      if (request.path.length === 0) return envelope(rootEntries);
      const slug = request.path.split("/")[1];
      if (input.unreadableSlug !== undefined && slug === input.unreadableSlug) {
        throw new GithubTeamTransportError("PERMISSION_DENIED", "GitHub denied access to this member file.");
      }
      const content = (input.files ?? remoteFiles)[request.path];
      if (content === undefined) {
        throw new GithubTeamTransportError("NOT_FOUND", "GitHub file was not found.");
      }
      return envelope({
        type: "file",
        path: request.path,
        sha: request.path,
        size: content.length,
        content,
      });
    },
  };
}

function envelope<T>(data: T): GithubApiEnvelope<T> {
  return { data, rateLimit: null };
}
