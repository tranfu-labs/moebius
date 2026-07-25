import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  getPackagedTeamCacheDirectory,
  readOfficialTeamStateDocument,
  readTeamExecutionBindings,
} from "../desktop/src/team-management-store.js";
import { seedBuiltInTeams } from "../desktop/src/team-seed.js";

const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((root) =>
    fs.rm(root, { recursive: true, force: true })));
});

async function makeRoot(name: string): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), name));
  temporaryRoots.push(root);
  return root;
}

async function writeSeed(
  seedRoot: string,
  input: { version: string; markdown: string },
): Promise<void> {
  const team = path.join(seedRoot, "development");
  await fs.mkdir(path.join(team, "members", "dev"), { recursive: true });
  await fs.writeFile(path.join(team, "team.json"), JSON.stringify({
    name: "开发团队",
    description: "说明",
    primaryAgentSlug: "dev",
    memberOrder: ["dev"],
  }));
  await fs.writeFile(path.join(team, "members", "dev", "AGENT.md"), input.markdown);
  await fs.writeFile(path.join(team, "onboarding-orchestration.json"), "{}");
  await fs.writeFile(path.join(team, "official.json"), JSON.stringify({
    schemaVersion: 1,
    officialVersion: input.version,
    members: {
      dev: {
        recommendedProfile: {
          cli: "codex",
          model: "gpt-5.6-sol",
          effort: "high",
        },
      },
    },
  }));
}

describe("official team seed registration", () => {
  it("seeds first install without copying official metadata into editable content", async () => {
    const seedRoot = await makeRoot("moebius-team-seed-source-");
    const dataRoot = await makeRoot("moebius-team-seed-data-");
    await writeSeed(seedRoot, { version: "1", markdown: "# v1\n" });
    expect(await seedBuiltInTeams({ seedTeamsRoot: seedRoot, dataRoot })).toMatchObject({
      status: "seeded",
    });
    const editable = path.join(dataRoot, "teams", ".system", "development");
    await expect(fs.access(path.join(editable, "official.json"))).rejects.toMatchObject({
      code: "ENOENT",
    });
    expect(await fs.readFile(path.join(editable, "members", "dev", "AGENT.md"), "utf8")).toBe("# v1\n");
    expect(await readOfficialTeamStateDocument(dataRoot)).toMatchObject({
      teams: {
        development: {
          appliedOfficialVersion: "1",
          baselineConfidence: "verified",
        },
      },
    });
    expect(await readTeamExecutionBindings({
      dataRoot,
      ownership: "system",
      teamId: "development",
    })).toEqual({ dev: { source: "recommended" } });
  });

  it("registers a new packaged version without overwriting user content", async () => {
    const seedRoot = await makeRoot("moebius-team-seed-source-");
    const dataRoot = await makeRoot("moebius-team-seed-data-");
    await writeSeed(seedRoot, { version: "1", markdown: "# v1\n" });
    await seedBuiltInTeams({ seedTeamsRoot: seedRoot, dataRoot });
    const editableAgent = path.join(
      dataRoot,
      "teams",
      ".system",
      "development",
      "members",
      "dev",
      "AGENT.md",
    );
    await fs.writeFile(editableAgent, "# user custom\n");
    await writeSeed(seedRoot, { version: "2", markdown: "# v2\n" });
    expect(await seedBuiltInTeams({ seedTeamsRoot: seedRoot, dataRoot })).toMatchObject({
      status: "skipped",
    });
    expect(await fs.readFile(editableAgent, "utf8")).toBe("# user custom\n");
    expect(await fs.readFile(
      path.join(
        getPackagedTeamCacheDirectory(dataRoot, "development"),
        "members",
        "dev",
        "AGENT.md",
      ),
      "utf8",
    )).toBe("# v2\n");
    expect(await readOfficialTeamStateDocument(dataRoot)).toMatchObject({
      teams: {
        development: {
          appliedOfficialVersion: "1",
        },
      },
    });
  });

  it("marks an existing untracked customization as conservative", async () => {
    const seedRoot = await makeRoot("moebius-team-seed-source-");
    const dataRoot = await makeRoot("moebius-team-seed-data-");
    await writeSeed(seedRoot, { version: "2", markdown: "# v2\n" });
    const existing = path.join(dataRoot, "teams", ".system", "development");
    await fs.mkdir(path.join(existing, "members", "dev"), { recursive: true });
    await fs.writeFile(path.join(existing, "team.json"), JSON.stringify({
      name: "开发团队",
      description: "说明",
      primaryAgentSlug: "dev",
      memberOrder: ["dev"],
    }));
    await fs.writeFile(path.join(existing, "members", "dev", "AGENT.md"), "# old custom\n");
    await seedBuiltInTeams({ seedTeamsRoot: seedRoot, dataRoot });
    expect(await readOfficialTeamStateDocument(dataRoot)).toMatchObject({
      teams: {
        development: {
          baselineConfidence: "conservative",
        },
      },
    });
    expect(await fs.readFile(
      path.join(existing, "members", "dev", "AGENT.md"),
      "utf8",
    )).toBe("# old custom\n");
  });
});
