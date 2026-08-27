import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

import {
  getTeamsRoot,
  listTeamLocations,
  readTeamSnapshot,
  resolveTeamLocation,
} from "../src/team-store.js";
import { seedBuiltInTeams } from "../src/team-seed.js";
import {
  getExecutionBindingDocumentPath,
  getOfficialTeamStatePath,
  readTeamExecutionBindings,
} from "../src/team-management-store.js";
import { readPersistedUserTeamRecordsDocument } from "../src/team-record-store.js";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const packagedSeedRoot = path.join(repositoryRoot, "seeds", "teams");
const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});

describe("built-in team seed", () => {
  it("installs the packaged team as an ordinary user team with source metadata", async () => {
    const root = await makeTemporaryRoot();
    const dataRoot = path.join(root, "data");

    await expect(seedBuiltInTeams({ seedTeamsRoot: packagedSeedRoot, dataRoot }))
      .resolves.toMatchObject({ status: "seeded", conflicts: [] });

    const user = resolveTeamLocation({ dataRoot, teamId: "general-assistant", ownership: "user" });
    await expect(readTeamSnapshot(user)).resolves.toMatchObject({
      status: "usable",
      canCreateConversation: true,
      definition: {
        name: "通用助手",
        primaryAgentSlug: "assistant",
        memberOrder: ["assistant"],
      },
    });
    expect((await listTeamLocations(dataRoot)).map((location) => [location.id, location.ownership]))
      .toEqual([["general-assistant", "user"]]);
    expect(await readPersistedUserTeamRecordsDocument(dataRoot)).toMatchObject({
      version: 2,
      records: [{
        id: "general-assistant",
        installationSource: { provider: "moebius" },
      }],
    });
    expect(await readTeamExecutionBindings({
      dataRoot,
      ownership: "user",
      teamId: "general-assistant",
    })).toEqual({
      assistant: { source: "explicit", profile: { cli: "codex", model: "gpt-5.6-sol", effort: "high" } },
    });
    await expect(fs.access(path.join(user.directory, "official.json")))
      .rejects.toMatchObject({ code: "ENOENT" });
    await expect(fs.access(getOfficialTeamStatePath(dataRoot)))
      .rejects.toMatchObject({ code: "ENOENT" });
  });

  it("does not overwrite a local team or create a duplicate on rerun", async () => {
    const root = await makeTemporaryRoot();
    const dataRoot = path.join(root, "data");
    const user = resolveTeamLocation({ dataRoot, teamId: "general-assistant", ownership: "user" });
    await writeValidTeamDirectory(user.directory, "本地助手");
    const before = await snapshotFiles(user.directory);

    await expect(seedBuiltInTeams({ seedTeamsRoot: packagedSeedRoot, dataRoot }))
      .resolves.toMatchObject({ status: "skipped" });

    expect(await snapshotFiles(user.directory)).toEqual(before);
    expect(await readPersistedUserTeamRecordsDocument(dataRoot)).toBeNull();
    expect((await listTeamLocations(dataRoot)).filter((location) => location.id === "general-assistant"))
      .toHaveLength(1);
  });

  it("leaves an existing legacy system team untouched and does not seed a user duplicate", async () => {
    const root = await makeTemporaryRoot();
    const dataRoot = path.join(root, "data");
    const legacy = resolveTeamLocation({ dataRoot, teamId: "general-assistant", ownership: "system" });
    await writeValidTeamDirectory(legacy.directory, "旧官方助手");
    const before = await snapshotFiles(legacy.directory);

    await expect(seedBuiltInTeams({ seedTeamsRoot: packagedSeedRoot, dataRoot }))
      .resolves.toMatchObject({ status: "skipped" });

    expect(await snapshotFiles(legacy.directory)).toEqual(before);
    await expect(fs.access(resolveTeamLocation({
      dataRoot,
      teamId: "general-assistant",
      ownership: "user",
    }).directory)).rejects.toMatchObject({ code: "ENOENT" });
    expect((await listTeamLocations(dataRoot)).map((location) => [location.id, location.ownership]))
      .toEqual([["general-assistant", "system"]]);
    await expect(fs.access(getOfficialTeamStatePath(dataRoot)))
      .rejects.toMatchObject({ code: "ENOENT" });
  });

  it("materializes every packaged team as a user installation", async () => {
    const root = await makeTemporaryRoot();
    const seedRoot = path.join(root, "seed");
    const dataRoot = path.join(root, "data");
    await writeTeamSeed(seedRoot, ["development", "writing"], "v1");

    await expect(seedBuiltInTeams({ seedTeamsRoot: seedRoot, dataRoot }))
      .resolves.toMatchObject({ status: "seeded" });

    const locations = await listTeamLocations(dataRoot);
    expect(locations.filter((location) => location.ownership === "user").map((location) => location.id))
      .toEqual(["development", "writing"]);
    const records = await readPersistedUserTeamRecordsDocument(dataRoot);
    expect(records?.records.map((record) => record.installationSource)).toEqual([
      { provider: "moebius" },
      { provider: "moebius" },
    ]);
    await expect(fs.access(getExecutionBindingDocumentPath(dataRoot))).resolves.toBeUndefined();
  });

  it("does not leave a directory or state file when the packaged manifest is invalid", async () => {
    const root = await makeTemporaryRoot();
    const seedRoot = path.join(root, "seed");
    const dataRoot = path.join(root, "data");
    await writeTeamSeed(seedRoot, ["broken"], "v1");
    await fs.rm(path.join(seedRoot, "broken", "official.json"));

    await expect(seedBuiltInTeams({ seedTeamsRoot: seedRoot, dataRoot })).rejects.toThrow();
    await expect(fs.access(path.join(getTeamsRoot(dataRoot), "broken")))
      .rejects.toMatchObject({ code: "ENOENT" });
    await expect(fs.access(path.join(getTeamsRoot(dataRoot), ".agent-team-records.json")))
      .rejects.toMatchObject({ code: "ENOENT" });
    await expect(fs.access(getExecutionBindingDocumentPath(dataRoot)))
      .rejects.toMatchObject({ code: "ENOENT" });
  });

  it("preserves an installed team's local edit when the seed is run again", async () => {
    const root = await makeTemporaryRoot();
    const dataRoot = path.join(root, "data");
    await seedBuiltInTeams({ seedTeamsRoot: packagedSeedRoot, dataRoot });
    const agent = path.join(
      getTeamsRoot(dataRoot),
      "general-assistant",
      "members",
      "assistant",
      "AGENT.md",
    );
    await fs.writeFile(agent, "# 本地修改\n", "utf8");

    await expect(seedBuiltInTeams({ seedTeamsRoot: packagedSeedRoot, dataRoot }))
      .resolves.toMatchObject({ status: "skipped" });
    expect(await fs.readFile(agent, "utf8")).toBe("# 本地修改\n");
  });
});

async function makeTemporaryRoot(): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "moebius-team-seed-"));
  temporaryRoots.push(root);
  return root;
}

async function writeTeamSeed(root: string, teamIds: readonly string[], version: string): Promise<void> {
  for (const teamId of teamIds) {
    const teamRoot = path.join(root, teamId);
    const memberRoot = path.join(teamRoot, "members", "dev");
    await fs.mkdir(memberRoot, { recursive: true });
    await fs.writeFile(path.join(teamRoot, "team.json"), JSON.stringify({
      name: teamId,
      description: `seed ${version}`,
      primaryAgentSlug: "dev",
      memberOrder: ["dev"],
    }, null, 2), "utf8");
    await fs.writeFile(path.join(memberRoot, "AGENT.md"), `# dev\n\n${version}\n`, "utf8");
    await fs.writeFile(path.join(teamRoot, "official.json"), JSON.stringify({
      schemaVersion: 1,
      officialVersion: version,
      members: {
        dev: {
          recommendedProfile: {
            cli: "codex",
            model: "gpt-5.6-sol",
            effort: "high",
          },
        },
      },
    }, null, 2), "utf8");
  }
}

async function writeValidTeamDirectory(root: string, name: string): Promise<void> {
  await fs.mkdir(path.join(root, "members", "assistant"), { recursive: true });
  await fs.writeFile(path.join(root, "team.json"), JSON.stringify({
    name,
    description: "existing team",
    primaryAgentSlug: "assistant",
    memberOrder: ["assistant"],
  }, null, 2), "utf8");
  await fs.writeFile(
    path.join(root, "members", "assistant", "AGENT.md"),
    "---\ndisplay_name: Existing assistant\ndescription: Existing team\n---\n",
    "utf8",
  );
}

async function snapshotFiles(root: string, current = root): Promise<Array<[string, Buffer]>> {
  const entries = await fs.readdir(current, { withFileTypes: true });
  const files: Array<[string, Buffer]> = [];
  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
    const absolutePath = path.join(current, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await snapshotFiles(root, absolutePath)));
    } else if (entry.isFile()) {
      files.push([path.relative(root, absolutePath), await fs.readFile(absolutePath)]);
    }
  }
  return files;
}
