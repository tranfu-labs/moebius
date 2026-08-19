import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import type { AgentRevisionService } from "../src/agent-revision-service.js";
import {
  GITHUB_TEAM_LANGUAGE_TOPICS,
  GITHUB_TEAM_TOPIC,
  type GithubApiEnvelope,
  type GithubRepositoryContent,
  type GithubRepositoryDirectoryEntry,
  type GithubRepositoryMetadata,
} from "../src/github-team-contract.js";
import { installGithubTeam } from "../src/github-team-installation.js";
import { loadGithubTeamSnapshot } from "../src/github-team-remote.js";
import {
  revertGithubTeamSync,
  syncGithubTeamUpstream,
} from "../src/github-team-sync-execute.js";
import type { GithubTeamTransport } from "../src/github-team-transport.js";
import {
  readExecutionBindingDocument,
  readOfficialTeamStateDocument,
} from "../src/team-management-store.js";
import { readOfficialSyncStateDocument } from "../src/team-sync-batch-store.js";
import {
  createTransactionRoot,
  writeJournal,
  type DefaultAgentMergeMember,
} from "../src/team-auto-sync.js";

const temporaryRoots: string[] = [];

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

const mergeMember: DefaultAgentMergeMember = (async () => ({ ok: false })) as DefaultAgentMergeMember;
const revisionService = {
  recordMemberRevision: async () => ({}),
} as unknown as Pick<AgentRevisionService, "recordMemberRevision">;

describe("GitHub team upstream sync executor", () => {
  it("reports not-following for teams without an upstream record", async () => {
    const dataRoot = await fs.mkdtemp(path.join(os.tmpdir(), "moebius-github-sync-exec-"));
    temporaryRoots.push(dataRoot);

    await expect(syncGithubTeamUpstream({
      dataRoot,
      teamId: "team-unknown",
      transport: createTransport(remoteFiles),
      mergeMember,
      revisionService,
    })).resolves.toEqual({ status: "not-following" });
    await expect(revertGithubTeamSync({ dataRoot, teamId: "team-unknown", revisionService }))
      .resolves.toEqual({ status: "none" });
  });

  it("reports unreachable when the upstream no longer parses as a team", async () => {
    const dataRoot = await fs.mkdtemp(path.join(os.tmpdir(), "moebius-github-sync-exec-"));
    temporaryRoots.push(dataRoot);
    const teamId = await install(dataRoot, remoteFiles);
    const broken = { ...remoteFiles, "team.json": "{ not json" };

    await expect(syncGithubTeamUpstream({
      dataRoot,
      teamId,
      transport: createTransport(broken),
      mergeMember,
      revisionService,
    })).resolves.toEqual({ status: "unreachable" });
  });

  it("stays up-to-date when nothing changed since the install", async () => {
    const dataRoot = await fs.mkdtemp(path.join(os.tmpdir(), "moebius-github-sync-exec-"));
    temporaryRoots.push(dataRoot);
    const teamId = await install(dataRoot, remoteFiles);

    await expect(syncGithubTeamUpstream({
      dataRoot,
      teamId,
      transport: createTransport(remoteFiles),
      mergeMember,
      revisionService,
    })).resolves.toEqual({ status: "up-to-date" });
  });

  it("registers when the user's content already matches the latest upstream", async () => {
    const dataRoot = await fs.mkdtemp(path.join(os.tmpdir(), "moebius-github-sync-exec-"));
    temporaryRoots.push(dataRoot);
    const teamId = await install(dataRoot, remoteFiles);
    const teamDirectory = await teamDirectoryOf(dataRoot);
    const userVersion = "---\ndisplay_name: Developer\ndescription: My local edits\n---\n\n# Local\n";
    await fs.writeFile(path.join(teamDirectory, "members/dev/AGENT.md"), userVersion, "utf8");
    // The upstream published a version whose content already matches the
    // user's edit; only the baseline and the recommendation moved.
    const updated = {
      ...remoteFiles,
      "members/dev/AGENT.md": userVersion,
      "official.json": JSON.stringify({
        schemaVersion: 1,
        officialVersion: "2026.09.01",
        members: {
          dev: { recommendedProfile: { cli: "codex", model: "gpt-5.6-sol", effort: "medium" } },
        },
      }),
    };

    await expect(syncGithubTeamUpstream({
      dataRoot,
      teamId,
      transport: createTransport(updated),
      mergeMember,
      revisionService,
    })).resolves.toEqual({ status: "up-to-date" });

    const applied = (await readOfficialTeamStateDocument(dataRoot)).teams[teamId];
    expect(applied?.appliedOfficialVersion).toBe("2026.09.01");
    expect(applied?.appliedRecommendations.dev).toMatchObject({ effort: "medium" });
    expect(await fs.readFile(path.join(teamDirectory, "members/dev/AGENT.md"), "utf8"))
      .toBe(userVersion);
    expect((await readOfficialSyncStateDocument(dataRoot)).batches[teamId]).toBeDefined();
  });

  it("applies a recommendation-only upstream change as one batch", async () => {
    const dataRoot = await fs.mkdtemp(path.join(os.tmpdir(), "moebius-github-sync-exec-"));
    temporaryRoots.push(dataRoot);
    const teamId = await install(dataRoot, remoteFiles);
    const updated = {
      ...remoteFiles,
      "official.json": JSON.stringify({
        schemaVersion: 1,
        officialVersion: "2026.09.01",
        members: {
          dev: { recommendedProfile: { cli: "codex", model: "gpt-5.6-sol", effort: "medium" } },
        },
      }),
    };

    await expect(syncGithubTeamUpstream({
      dataRoot,
      teamId,
      transport: createTransport(updated),
      mergeMember,
      revisionService,
    })).resolves.toEqual({ status: "applied", changedMemberCount: 1, pendingMergeMemberCount: 0 });

    const applied = (await readOfficialTeamStateDocument(dataRoot)).teams[teamId];
    expect(applied?.appliedOfficialVersion).toBe("2026.09.01");
    expect(applied?.appliedRecommendations.dev).toMatchObject({ effort: "medium" });
    const teamDirectory = await teamDirectoryOf(dataRoot);
    expect(await fs.readFile(path.join(teamDirectory, "members/dev/AGENT.md"), "utf8"))
      .toContain("# Rules");
    expect((await readOfficialSyncStateDocument(dataRoot)).batches[teamId]).toBeDefined();
  });

  it("serializes concurrent syncs so the second run observes the first run's result", async () => {
    const dataRoot = await fs.mkdtemp(path.join(os.tmpdir(), "moebius-github-sync-exec-"));
    temporaryRoots.push(dataRoot);
    const teamId = await install(dataRoot, remoteFiles);
    const updated = {
      ...remoteFiles,
      "members/dev/AGENT.md": "---\ndisplay_name: Developer\ndescription: Builds features\n---\n\n# Rules v2\n",
    };
    const slowTransport = createSlowTransport(updated);

    const outcomes = await Promise.all([
      syncGithubTeamUpstream({ dataRoot, teamId, transport: slowTransport, mergeMember, revisionService }),
      syncGithubTeamUpstream({ dataRoot, teamId, transport: slowTransport, mergeMember, revisionService }),
    ]);
    // The first sync applies the upstream update; the second, queued behind the
    // same lock, sees the already-applied content and reports up-to-date.
    expect(outcomes.map((outcome) => outcome.status).sort()).toEqual(["applied", "up-to-date"]);
    const teamDirectory = await teamDirectoryOf(dataRoot);
    expect(await fs.readFile(path.join(teamDirectory, "members/dev/AGENT.md"), "utf8"))
      .toContain("# Rules v2");
  });

  it("recovers an interrupted transaction before the next sync", async () => {
    const dataRoot = await fs.mkdtemp(path.join(os.tmpdir(), "moebius-github-sync-exec-"));
    temporaryRoots.push(dataRoot);
    const teamId = await install(dataRoot, remoteFiles);
    const teamDirectory = await teamDirectoryOf(dataRoot);

    // Simulate a crash mid-apply: the team directory was swapped out and the
    // journal left behind.
    const transaction = createTransactionRoot(dataRoot, "crashed-op");
    await fs.mkdir(transaction.backup, { recursive: true });
    await fs.rename(teamDirectory, transaction.backup);
    await fs.mkdir(teamDirectory, { recursive: true });
    await fs.writeFile(path.join(teamDirectory, "team.json"), "{\"name\":\"Corrupted\"}", "utf8");
    await writeJournal(dataRoot, {
      schemaVersion: 1,
      operationId: "crashed-op",
      kind: "apply",
      teamId,
      officialDirectory: teamDirectory,
      stagingDirectory: transaction.staging,
      backupDirectory: transaction.backup,
      previousOfficialDocument: structuredClone(await readOfficialTeamStateDocument(dataRoot)),
      previousBindingDocument: structuredClone(await readExecutionBindingDocument(dataRoot)),
      previousSyncDocument: structuredClone(await readOfficialSyncStateDocument(dataRoot)),
    });

    await expect(syncGithubTeamUpstream({
      dataRoot,
      teamId,
      transport: createTransport(remoteFiles),
      mergeMember,
      revisionService,
    })).resolves.toEqual({ status: "up-to-date" });

    // The recovery rolled the interrupted transaction back and the team
    // directory is whole again.
    expect(await fs.readFile(path.join(teamDirectory, "team.json"), "utf8")).toContain("Moebius Team");
    await expect(fs.access(transaction.backup)).rejects.toMatchObject({ code: "ENOENT" });
  });
});

async function install(dataRoot: string, files: Record<string, string>): Promise<string> {
  const snapshot = await loadGithubTeamSnapshot(createTransport(files), "someone/moebius-team");
  if (snapshot.status === "invalid") {
    throw new Error("fixture team must parse");
  }
  const result = await installGithubTeam({ dataRoot, snapshot: snapshot.snapshot });
  if (result.status !== "installed") {
    throw new Error("fixture install must succeed");
  }
  return result.teamId;
}

async function teamDirectoryOf(dataRoot: string): Promise<string> {
  const entries = await fs.readdir(path.join(dataRoot, "teams"));
  const name = entries.find((candidate) => !candidate.startsWith("."));
  if (name === undefined) {
    throw new Error("fixture team directory missing");
  }
  return path.join(dataRoot, "teams", name);
}

function createSlowTransport(files: Record<string, string>): GithubTeamTransport {
  const base = createTransport(files);
  return {
    ...base,
    async readRepositoryContent(request) {
      await new Promise((resolve) => setTimeout(resolve, 60));
      return base.readRepositoryContent(request);
    },
  };
}

function createTransport(files: Record<string, string>): GithubTeamTransport {
  return {
    async readAuthStatus() {
      return { authenticated: true, cliAvailable: true, login: "someone" };
    },
    async searchRepositories() {
      return { data: { totalCount: 0, incompleteResults: false, items: [] }, rateLimit: null };
    },
    async readRepository() {
      return { data: repository, rateLimit: null };
    },
    async readRepositoryContent(request): Promise<GithubApiEnvelope<GithubRepositoryContent>> {
      if (request.path.length === 0) {
        return { data: rootEntries, rateLimit: null };
      }
      const content = files[request.path];
      if (content === undefined) {
        throw new Error(`fixture file missing: ${request.path}`);
      }
      return {
        data: { type: "file", path: request.path, sha: request.path, size: content.length, content },
        rateLimit: null,
      };
    },
  };
}
