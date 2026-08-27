import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { serializeTeamDefinition, type TeamDefinition } from "../src/team-model.js";
import {
  USER_TEAM_RECORDS_FILE,
  createTeamIdentityFingerprint,
  listRecordedUserTeamSnapshots,
  relocateUserTeamRecord,
  removeUserTeamRecord,
  resolveRecordedTeamLocation,
} from "../src/team-record-store.js";
import { readTeamSnapshot, resolveTeamLocation } from "../src/team-store.js";

const temporaryRoots: string[] = [];
const definition: TeamDefinition = {
  name: "开发团队",
  description: "负责软件开发任务",
  primaryAgentSlug: "manager",
  memberOrder: ["manager"],
};

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});

describe("user team application records", () => {
  it("preserves and reloads descriptive installation source metadata without an official state file", async () => {
    const dataRoot = await makeDataRoot();
    const location = resolveTeamLocation({ dataRoot, teamId: "github-team", ownership: "user" });
    await createTeamDirectory(location.directory, definition, "# 开发经理\n\n默认接单\n");
    await fs.mkdir(path.join(dataRoot, "teams"), { recursive: true });
    await fs.writeFile(path.join(dataRoot, "teams", USER_TEAM_RECORDS_FILE), `${JSON.stringify({
      version: 2,
      records: [{
        id: "github-team",
        location: { kind: "managed", directoryName: "github-team" },
        identityFingerprint: null,
        lastKnownDefinition: definition,
        installationSource: {
          provider: "github",
          repository: "owner/repository",
          defaultBranch: "main",
        },
      }],
    }, null, 2)}\n`, "utf8");

    const [recorded] = await listRecordedUserTeamSnapshots(dataRoot);
    expect(recorded?.record.installationSource).toEqual({
      provider: "github",
      repository: "owner/repository",
      defaultBranch: "main",
    });
    await expect(fs.access(path.join(dataRoot, ".state", "agent-teams", "official-state-v1.json"))).rejects.toMatchObject({ code: "ENOENT" });
  });
  it("keeps a renamed team visible, rejects a different team, and relinks the matching valid location", async () => {
    const dataRoot = await makeDataRoot();
    const original = resolveTeamLocation({ dataRoot, teamId: "my-team", ownership: "user" });
    await createTeamDirectory(original.directory, definition, "# 开发经理\n\n默认接单\n");

    const [recorded] = await listRecordedUserTeamSnapshots(dataRoot);
    expect(recorded?.snapshot.status).toBe("usable");

    const renamedDirectory = path.join(dataRoot, "relocated", "renamed-team");
    await fs.mkdir(path.dirname(renamedDirectory), { recursive: true });
    await fs.rename(original.directory, renamedDirectory);
    const [missing] = await listRecordedUserTeamSnapshots(dataRoot);
    expect(missing).toMatchObject({
      record: {
        id: "my-team",
        location: { kind: "managed", directoryName: "my-team" },
        lastKnownDefinition: definition,
      },
      snapshot: {
        status: "needs-repair",
        canCreateConversation: false,
        issues: [{ code: "team-directory-missing" }],
      },
    });

    const differentDirectory = path.join(dataRoot, "teams", "different-team");
    await createTeamDirectory(differentDirectory, { ...definition, name: "另一支团队" }, "# 另一位经理\n\n接其他任务\n");
    await expect(relocateUserTeamRecord({
      dataRoot,
      teamId: "my-team",
      directory: differentDirectory,
    })).rejects.toMatchObject({
      code: "TEAM_RELOCATION_REJECTED",
      message: expect.stringContaining("与原记录不一致"),
    });
    await expect(resolveRecordedTeamLocation(dataRoot, "my-team")).resolves.toMatchObject({
      directory: original.directory,
    });

    await expect(relocateUserTeamRecord({
      dataRoot,
      teamId: "my-team",
      directory: renamedDirectory,
    })).resolves.toMatchObject({ status: "usable", canCreateConversation: true });
    await expect(resolveRecordedTeamLocation(dataRoot, "my-team")).resolves.toMatchObject({
      id: "my-team",
      directory: renamedDirectory,
    });
    const records = JSON.parse(await fs.readFile(
      path.join(dataRoot, "teams", USER_TEAM_RECORDS_FILE),
      "utf8",
    )) as { version: number; records: Array<{ location: unknown }> };
    expect(records).toMatchObject({
      version: 2,
      records: [{ location: { kind: "external", absolutePath: renamedDirectory } }],
    });
  });

  it("migrates v1 directory records to managed v2 locations without retaining member summaries", async () => {
    const dataRoot = await makeDataRoot();
    const location = resolveTeamLocation({ dataRoot, teamId: "legacy-team", ownership: "user" });
    await createTeamDirectory(location.directory, definition, "# 开发经理\n\n默认接单\n");
    await fs.writeFile(path.join(dataRoot, "teams", USER_TEAM_RECORDS_FILE), JSON.stringify({
      version: 1,
      records: [{
        id: "legacy-team",
        directoryName: "legacy-team",
        identityFingerprint: null,
        lastKnownDefinition: definition,
        lastKnownMembers: [{ slug: "manager", displayName: "旧名称", description: "旧摘要" }],
      }],
    }), "utf8");

    await expect(resolveRecordedTeamLocation(dataRoot, "legacy-team")).resolves.toMatchObject({
      directory: location.directory,
    });
    const migrated = JSON.parse(await fs.readFile(
      path.join(dataRoot, "teams", USER_TEAM_RECORDS_FILE),
      "utf8",
    )) as Record<string, unknown>;
    expect(migrated).toMatchObject({
      version: 2,
      records: [{ id: "legacy-team", location: { kind: "managed", directoryName: "legacy-team" } }],
    });
    expect(JSON.stringify(migrated)).not.toContain("lastKnownMembers");
  });

  it("loads a v2 cached team definition that predates relay metadata", async () => {
    const dataRoot = await makeDataRoot();
    const location = resolveTeamLocation({ dataRoot, teamId: "pre-relay-team", ownership: "user" });
    await createTeamDirectory(location.directory, definition, "# 开发经理\n\n默认接单\n");
    await fs.writeFile(path.join(dataRoot, "teams", USER_TEAM_RECORDS_FILE), `${JSON.stringify({
      version: 2,
      records: [{
        id: "pre-relay-team",
        location: { kind: "managed", directoryName: "pre-relay-team" },
        identityFingerprint: null,
        lastKnownDefinition: definition,
      }],
    }, null, 2)}\n`, "utf8");

    await expect(listRecordedUserTeamSnapshots(dataRoot)).resolves.toMatchObject([{
      record: { lastKnownDefinition: definition },
      snapshot: { status: "usable", canCreateConversation: true },
    }]);
  });

  it("accepts a legacy relay-inclusive fingerprint once and converges it to the core fingerprint", async () => {
    const dataRoot = await makeDataRoot();
    const location = resolveTeamLocation({ dataRoot, teamId: "relay-era-team", ownership: "user" });
    const agentMarkdown = "# 开发经理\n\n默认接单\n";
    const legacyRelayBeats = [{ speakerSlug: "manager", message: "拆解任务" }];
    await createTeamDirectory(location.directory, definition, agentMarkdown);
    const snapshot = await readTeamSnapshot(location);
    const legacyFingerprint = createTeamIdentityFingerprint(snapshot, legacyRelayBeats);
    const coreFingerprint = createTeamIdentityFingerprint(snapshot);
    await fs.writeFile(path.join(dataRoot, "teams", USER_TEAM_RECORDS_FILE), `${JSON.stringify({
      version: 2,
      records: [{
        id: "relay-era-team",
        location: { kind: "managed", directoryName: "relay-era-team" },
        identityFingerprint: legacyFingerprint,
        lastKnownDefinition: { ...definition, relayBeats: legacyRelayBeats },
      }],
    }, null, 2)}\n`, "utf8");
    const relocatedDirectory = path.join(dataRoot, "relocated", "relay-era-team");
    await fs.mkdir(path.dirname(relocatedDirectory), { recursive: true });
    await fs.rename(location.directory, relocatedDirectory);

    await listRecordedUserTeamSnapshots(dataRoot);
    const stillCompatible = JSON.parse(await fs.readFile(
      path.join(dataRoot, "teams", USER_TEAM_RECORDS_FILE),
      "utf8",
    )) as { records: Array<{ lastKnownDefinition: Record<string, unknown> }> };
    expect(stillCompatible.records[0]?.lastKnownDefinition).toHaveProperty("relayBeats", legacyRelayBeats);

    await expect(relocateUserTeamRecord({
      dataRoot,
      teamId: "relay-era-team",
      directory: relocatedDirectory,
    })).resolves.toMatchObject({ status: "usable" });

    const converged = JSON.parse(await fs.readFile(
      path.join(dataRoot, "teams", USER_TEAM_RECORDS_FILE),
      "utf8",
    )) as {
      records: Array<{
        identityFingerprint: string;
        lastKnownDefinition: Record<string, unknown>;
      }>;
    };
    expect(converged.records[0]?.identityFingerprint).toBe(coreFingerprint);
    expect(converged.records[0]?.lastKnownDefinition).not.toHaveProperty("relayBeats");
  });

  it("removes only the invalid application record and leaves team files and session history untouched", async () => {
    const dataRoot = await makeDataRoot();
    const location = resolveTeamLocation({ dataRoot, teamId: "broken-team", ownership: "user" });
    await createTeamDirectory(location.directory, definition, "# 开发经理\n\n默认接单\n");
    await listRecordedUserTeamSnapshots(dataRoot);
    await fs.writeFile(path.join(location.directory, "team.json"), serializeTeamDefinition({
      ...definition,
      memberOrder: ["manager", "manager"],
    }), "utf8");
    const teamFilesBefore = await readFileTree(location.directory);
    const sessionHistory = path.join(dataRoot, ".state", "local-console.sqlite");
    await fs.mkdir(path.dirname(sessionHistory), { recursive: true });
    await fs.writeFile(sessionHistory, "session-history-sentinel", "utf8");

    await removeUserTeamRecord({ dataRoot, teamId: "broken-team" });

    expect(await readFileTree(location.directory)).toEqual(teamFilesBefore);
    expect(await fs.readFile(sessionHistory, "utf8")).toBe("session-history-sentinel");
    await expect(listRecordedUserTeamSnapshots(dataRoot)).resolves.toEqual([]);
  });

  it("automatically clears repair after a missing AGENT.md is restored and records are rechecked", async () => {
    const dataRoot = await makeDataRoot();
    const location = resolveTeamLocation({ dataRoot, teamId: "repairable", ownership: "user" });
    await createTeamDirectory(location.directory, definition, "# 开发经理\n\n默认接单\n");
    await listRecordedUserTeamSnapshots(dataRoot);
    const agentFile = path.join(location.directory, "members", "manager", "AGENT.md");
    await fs.rm(agentFile);

    await expect(listRecordedUserTeamSnapshots(dataRoot)).resolves.toMatchObject([
      { snapshot: { status: "needs-repair", canCreateConversation: false } },
    ]);

    await fs.writeFile(agentFile, "# 开发经理\n\n默认接单\n", "utf8");
    await expect(listRecordedUserTeamSnapshots(dataRoot)).resolves.toMatchObject([
      { snapshot: { status: "usable", canCreateConversation: true, issues: [] } },
    ]);
  });
});

async function makeDataRoot(): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "moebius-team-record-"));
  temporaryRoots.push(root);
  return root;
}

async function createTeamDirectory(directory: string, teamDefinition: TeamDefinition, markdown: string): Promise<void> {
  await fs.mkdir(path.join(directory, "members", "manager"), { recursive: true });
  await fs.writeFile(path.join(directory, "team.json"), serializeTeamDefinition(teamDefinition), "utf8");
  await fs.writeFile(path.join(directory, "members", "manager", "AGENT.md"), markdown, "utf8");
}

async function readFileTree(root: string): Promise<Record<string, string>> {
  const result: Record<string, string> = {};
  const visit = async (directory: string): Promise<void> => {
    for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
      const absolutePath = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        await visit(absolutePath);
      } else {
        result[path.relative(root, absolutePath)] = await fs.readFile(absolutePath, "utf8");
      }
    }
  };
  await visit(root);
  return result;
}
