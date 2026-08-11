import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createAgentRevisionStore } from "./agent-revision-store.js";
import {
  computeOfficialTeamContentFingerprint,
  migrateOfficialTeamBaselines,
} from "./team-official-management.js";
import {
  readOfficialTeamStateDocument,
  writeOfficialTeamStateDocument,
} from "./team-management-store.js";
import { resolveTeamLocation } from "./team-store.js";
import { TEAM_MANIFEST_FILE, TEAM_AGENT_FILE } from "./team-model.js";

let tempRoot: string;

beforeEach(async () => {
  tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "moebius-official-migration-"));
});

afterEach(async () => {
  await fs.rm(tempRoot, { recursive: true, force: true });
});

async function writeTeam(dataRoot: string, teamId: string, overrides: Record<string, string> = {}): Promise<void> {
  const location = resolveTeamLocation({ dataRoot, teamId, ownership: "system" });
  const members: Record<string, string> = {
    "members/dev-manager/AGENT.md": "# 开发经理\n\n负责技术决策。\n",
    "members/dev/AGENT.md": "# 开发\n\n负责实现。\n",
    "members/qa/AGENT.md": "# 测试\n\n负责验收。\n",
  };
  const files: Record<string, string> = {
    [TEAM_MANIFEST_FILE]: JSON.stringify({
      name: "开发团队",
      description: "内置团队",
      primaryAgentSlug: "dev-manager",
      memberOrder: ["dev-manager", "dev", "qa"],
    }),
    ...members,
    ...overrides,
  };
  for (const [relativePath, content] of Object.entries(files)) {
    const target = path.join(location.directory, relativePath);
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, content, "utf8");
  }
}

function legacyState(fingerprint: string): Parameters<typeof writeOfficialTeamStateDocument>[1] {
  return {
    schemaVersion: 1,
    teams: {
      development: {
        appliedOfficialVersion: "1.2",
        appliedContentFingerprint: fingerprint,
        appliedRecommendationFingerprint: "legacy-recommendation-fingerprint",
        appliedRecommendations: {
          "dev-manager": { cli: "codex", model: "gpt-5.6-sol", effort: "high" },
          dev: { cli: "codex", model: "gpt-5.6-sol", effort: "high" },
          qa: { cli: "codex", model: "gpt-5.6-sol", effort: "high" },
        },
        baselineConfidence: "verified",
      },
    },
  };
}

describe("migrateOfficialTeamBaselines", () => {
  it("back-fills the snapshot and marks verified when the user never edited the team", async () => {
    const dataRoot = path.join(tempRoot, "data");
    await writeTeam(dataRoot, "development");
    const fingerprint = await computeOfficialTeamContentFingerprint(
      resolveTeamLocation({ dataRoot, teamId: "development", ownership: "system" }).directory,
    );
    await writeOfficialTeamStateDocument(dataRoot, legacyState(fingerprint));
    const store = createAgentRevisionStore({
      sqlitePath: path.join(dataRoot, ".state", "local-console.sqlite"),
    });

    const result = await migrateOfficialTeamBaselines({ dataRoot, revisionStore: store });
    expect(result.migratedTeamIds).toEqual(["development"]);

    const document = await readOfficialTeamStateDocument(dataRoot);
    const team = document.teams.development!;
    expect(team.baselineConfidence).toBe("verified");
    expect(team.appliedContentSnapshot?.["members/dev-manager/AGENT.md"]).toBe("# 开发经理\n\n负责技术决策。\n");
    expect(team.appliedContentSnapshot?.[TEAM_MANIFEST_FILE]).toContain("开发团队");
    expect(await store.listRevisions("development", "dev-manager")).toHaveLength(0);
  });

  it("marks conservative, keeps no snapshot and records one starting revision per member", async () => {
    const dataRoot = path.join(tempRoot, "data");
    await writeTeam(dataRoot, "development", {
      "members/dev-manager/AGENT.md": "# 开发经理\n\n用户改过的内容。\n",
    });
    const fingerprint = await computeOfficialTeamContentFingerprint(
      resolveTeamLocation({ dataRoot, teamId: "development", ownership: "system" }).directory,
    );
    // Legacy fingerprint came from a different (earlier) content.
    await writeOfficialTeamStateDocument(dataRoot, legacyState(`legacy-${fingerprint}`));
    const store = createAgentRevisionStore({
      sqlitePath: path.join(dataRoot, ".state", "local-console.sqlite"),
    });

    const result = await migrateOfficialTeamBaselines({ dataRoot, revisionStore: store });
    expect(result.migratedTeamIds).toEqual(["development"]);

    const document = await readOfficialTeamStateDocument(dataRoot);
    const team = document.teams.development!;
    expect(team.baselineConfidence).toBe("conservative");
    expect(Object.hasOwn(team, "appliedContentSnapshot")).toBe(true);
    expect(team.appliedContentSnapshot).toBeNull();

    const devManagerRevisions = await store.listRevisions("development", "dev-manager");
    expect(devManagerRevisions).toHaveLength(1);
    expect(devManagerRevisions[0]!.authorKind).toBe("user");
    expect(devManagerRevisions[0]!.content).toBe("# 开发经理\n\n用户改过的内容。\n");
    expect(devManagerRevisions[0]!.summaryStatus).toBe("unavailable");
    expect(await store.listRevisions("development", "dev")).toHaveLength(1);
    expect(await store.listRevisions("development", "qa")).toHaveLength(1);
  });

  it("is idempotent: a second run skips migrated teams and does not duplicate revisions", async () => {
    const dataRoot = path.join(tempRoot, "data");
    await writeTeam(dataRoot, "development", {
      "members/dev-manager/AGENT.md": "# 开发经理\n\n用户改过的内容。\n",
    });
    const fingerprint = await computeOfficialTeamContentFingerprint(
      resolveTeamLocation({ dataRoot, teamId: "development", ownership: "system" }).directory,
    );
    await writeOfficialTeamStateDocument(dataRoot, legacyState(`legacy-${fingerprint}`));
    const store = createAgentRevisionStore({
      sqlitePath: path.join(dataRoot, ".state", "local-console.sqlite"),
    });

    await migrateOfficialTeamBaselines({ dataRoot, revisionStore: store });
    const second = await migrateOfficialTeamBaselines({ dataRoot, revisionStore: store });
    expect(second.migratedTeamIds).toEqual([]);
    expect(await store.listRevisions("development", "dev-manager")).toHaveLength(1);
    expect(await store.listRevisions("development", "qa")).toHaveLength(1);
  });

  it("recovers after a crash between revision writes and the document write", async () => {
    const dataRoot = path.join(tempRoot, "data");
    await writeTeam(dataRoot, "development", {
      "members/dev-manager/AGENT.md": "# 开发经理\n\n用户改过的内容。\n",
    });
    const fingerprint = await computeOfficialTeamContentFingerprint(
      resolveTeamLocation({ dataRoot, teamId: "development", ownership: "system" }).directory,
    );
    await writeOfficialTeamStateDocument(dataRoot, legacyState(`legacy-${fingerprint}`));
    const store = createAgentRevisionStore({
      sqlitePath: path.join(dataRoot, ".state", "local-console.sqlite"),
    });

    // Simulate a crash after the starting revisions were written but before the
    // document write: the document is still legacy, the revisions already exist.
    const teamState = (await readOfficialTeamStateDocument(dataRoot)).teams.development!;
    await store.createRevision({
      teamStableId: "development",
      memberSlug: "dev-manager",
      content: "# 开发经理\n\n用户改过的内容。\n",
      authorKind: "user",
      blockOwnership: null,
      summaryStatus: "unavailable",
      now: new Date().toISOString(),
    });
    expect(Object.hasOwn(teamState, "appliedContentSnapshot")).toBe(false);

    const result = await migrateOfficialTeamBaselines({ dataRoot, revisionStore: store });
    expect(result.migratedTeamIds).toEqual(["development"]);
    const document = await readOfficialTeamStateDocument(dataRoot);
    expect(document.teams.development!.baselineConfidence).toBe("conservative");
    // The pre-existing starting revision was not duplicated.
    expect(await store.listRevisions("development", "dev-manager")).toHaveLength(1);
    expect(await store.listRevisions("development", "dev")).toHaveLength(1);
  });

  it("keeps the old document untouched when the team directory cannot be read", async () => {
    const dataRoot = path.join(tempRoot, "data");
    // No team directory is written at all.
    await writeOfficialTeamStateDocument(dataRoot, legacyState("legacy-fingerprint"));
    const store = createAgentRevisionStore({
      sqlitePath: path.join(dataRoot, ".state", "local-console.sqlite"),
    });

    await expect(migrateOfficialTeamBaselines({ dataRoot, revisionStore: store })).rejects.toThrow();

    const document = await readOfficialTeamStateDocument(dataRoot);
    expect(Object.hasOwn(document.teams.development!, "appliedContentSnapshot")).toBe(false);
    expect(document.teams.development!.appliedContentFingerprint).toBe("legacy-fingerprint");
  });
});
