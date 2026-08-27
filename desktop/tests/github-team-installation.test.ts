import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import {
  installGithubTeam,
  installGithubTeamWithPorts,
  type GithubTeamInstallationPorts,
} from "../src/github-team-installation.js";
import type { GithubTeamSnapshot } from "../src/github-team-snapshot.js";
import {
  getUserTeamRecordsPath,
  readPersistedUserTeamRecordsDocument,
  registerUserTeamSnapshot,
  writeUserTeamRecordsDocument,
} from "../src/team-record-store.js";
import {
  readExecutionBindingDocument,
  readTeamExecutionBindings,
} from "../src/team-management-store.js";
import {
  getTeamsRoot,
  listTeamLocations,
  readTeamSnapshot,
  resolveTeamLocation,
  writeMemberAgentMarkdown,
  writeTeamDefinition,
} from "../src/team-store.js";

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
    memberOrder: ["dev", "qa"],
  },
  members: [
    {
      slug: "dev",
      agentMarkdown: "---\ndisplay_name: 开发\ndescription: 实现功能\n---\n\n# 规则\n",
      identity: { displayName: "开发", description: "实现功能" },
      recommendedProfile: { cli: "codex", model: "gpt-5.6-sol", effort: "high" },
      readable: true,
      readError: null,
    },
    {
      slug: "qa",
      agentMarkdown: "---\ndisplay_name: 测试\ndescription: 验证功能\n---\n\n# 规则\n",
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
  officialVersion: "2026.08.18",
  content: {
    "team.json": JSON.stringify({
      name: "开发团队",
      description: "负责软件交付。",
      primaryAgentSlug: "dev",
      memberOrder: ["dev", "qa"],
    }),
    "members/dev/AGENT.md": "---\ndisplay_name: 开发\ndescription: 实现功能\n---\n\n# 规则\n",
    "members/qa/AGENT.md": "---\ndisplay_name: 测试\ndescription: 验证功能\n---\n\n# 规则\n",
  },
};

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});

describe("installGithubTeam", () => {
  it("writes a source-only user record and explicit member bindings", async () => {
    const dataRoot = await makeDataRoot();

    const result = await installGithubTeam({ dataRoot, snapshot });

    expect(result.status).toBe("installed");
    if (result.status !== "installed") return;
    expect(result.snapshot.status).toBe("usable");
    expect(await fs.readFile(path.join(result.location.directory, "team.json"), "utf8")).toBe(
      snapshot.content["team.json"],
    );

    const records = await readPersistedUserTeamRecordsDocument(dataRoot);
    expect(records?.records).toHaveLength(1);
    expect(records?.records[0]).toMatchObject({
      id: result.teamId,
      installationSource: {
        provider: "github",
        repository: snapshot.repository.repository,
        defaultBranch: "main",
      },
    });
    expect(records?.records[0]?.upstream).toBeUndefined();
    await expect(fs.access(path.join(dataRoot, ".state", "agent-teams", "official-state-v1.json")))
      .rejects.toMatchObject({ code: "ENOENT" });
    expect(await readTeamExecutionBindings({
      dataRoot,
      ownership: "user",
      teamId: result.teamId,
    })).toEqual({
      dev: { source: "explicit", profile: { cli: "codex", model: "gpt-5.6-sol", effort: "high" } },
      qa: { source: "explicit", profile: { cli: "codex", model: "gpt-5.6-sol", effort: "high" } },
    });

    const duplicate = await installGithubTeam({ dataRoot, snapshot });
    expect(duplicate).toEqual({ status: "duplicate", existingTeamId: result.teamId });

    const second = await installGithubTeam({
      dataRoot,
      snapshot: {
        ...snapshot,
        repository: { ...snapshot.repository, repository: "tranfu-labs/moebius-team-writing" },
      },
    });
    expect(second.status).toBe("installed");
    expect((await listTeamLocations(dataRoot)).filter((location) => location.ownership === "user")).toHaveLength(2);
  });

  it("rolls back the directory, record, and binding when the binding write fails", async () => {
    const dataRoot = await makeDataRoot();
    const existingLocation = resolveTeamLocation({ dataRoot, teamId: "team-existing", ownership: "user" });
    await fs.mkdir(getTeamsRoot(dataRoot), { recursive: true });
    await writeTeamDefinition(existingLocation, {
      name: "既有团队",
      description: "保留不变",
      primaryAgentSlug: "dev",
      memberOrder: ["dev"],
    });
    await writeMemberAgentMarkdown(
      existingLocation,
      "dev",
      "---\ndisplay_name: 既有开发\ndescription: 保留\n---\n",
    );
    const existingSnapshot = await readTeamSnapshot(existingLocation);
    expect(existingSnapshot.status).toBe("usable");
    await registerUserTeamSnapshot(existingSnapshot);
    const recordsBefore = JSON.parse(await fs.readFile(getUserTeamRecordsPath(dataRoot), "utf8")) as unknown;

    const ports: GithubTeamInstallationPorts = {
      writeRecords: writeUserTeamRecordsDocument,
      writeExecutionBindings: async () => {
        throw new Error("injected binding write failure");
      },
    };

    await expect(installGithubTeamWithPorts({ dataRoot, snapshot }, ports))
      .rejects.toThrow("injected binding write failure");

    expect(JSON.parse(await fs.readFile(getUserTeamRecordsPath(dataRoot), "utf8")) as unknown).toEqual(recordsBefore);
    expect((await listTeamLocations(dataRoot)).map((location) => location.id)).toEqual(["team-existing"]);
    expect((await readExecutionBindingDocument(dataRoot)).teams).toEqual({});
    expect((await readTeamSnapshot(existingLocation)).status).toBe("usable");
  });

  it("serializes concurrent installs of the same repository into one team", async () => {
    const dataRoot = await makeDataRoot();

    const results = await Promise.all([
      installGithubTeam({ dataRoot, snapshot }),
      installGithubTeam({ dataRoot, snapshot }),
    ]);
    expect(results.map((result) => result.status).sort()).toEqual(["duplicate", "installed"]);
    const records = await readPersistedUserTeamRecordsDocument(dataRoot);
    expect(records).not.toBeNull();
    const matches = (records?.records ?? []).filter(
      (record) => record.installationSource?.provider === "github"
        && record.installationSource.repository === snapshot.repository.repository,
    );
    expect(matches).toHaveLength(1);
    const directories = (await fs.readdir(getTeamsRoot(dataRoot)))
      .filter((name) => !name.startsWith("."));
    expect(directories).toHaveLength(1);
  });
});

async function makeDataRoot(): Promise<string> {
  const dataRoot = await fs.mkdtemp(path.join(os.tmpdir(), "moebius-github-team-install-"));
  temporaryRoots.push(dataRoot);
  return dataRoot;
}
