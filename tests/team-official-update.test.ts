import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  getAgentTeamsStateRoot,
  getPackagedTeamCacheDirectory,
  readExecutionBindingDocument,
  readOfficialTeamStateDocument,
  readTeamExecutionBindings,
  saveTeamExecutionBinding,
} from "../desktop/src/team-management-store.js";
import {
  commitOfficialTeamUpdate,
  inspectOfficialTeamUpdate,
  prepareOfficialTeamUpdate,
  recoverOfficialTeamUpdateTransactions,
} from "../desktop/src/team-official-update.js";
import {
  listRecordedUserTeamSnapshots,
  USER_TEAM_RECORDS_FILE,
} from "../desktop/src/team-record-store.js";
import { seedBuiltInTeams } from "../desktop/src/team-seed.js";

const temporaryRoots: string[] = [];

afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(temporaryRoots.splice(0).map((root) =>
    fs.rm(root, { recursive: true, force: true })));
});

async function makeRoot(name: string): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), name));
  temporaryRoots.push(root);
  return root;
}

async function writeSeed(input: {
  root: string;
  version: string;
  markdown: string;
  members?: string[];
}): Promise<void> {
  const members = input.members ?? ["dev", "qa"];
  const team = path.join(input.root, "development");
  await fs.rm(team, { recursive: true, force: true });
  for (const slug of members) {
    await fs.mkdir(path.join(team, "members", slug), { recursive: true });
    await fs.writeFile(
      path.join(team, "members", slug, "AGENT.md"),
      `---\ndisplay_name: ${slug}\ndescription: ${slug}\n---\n${input.markdown}`,
    );
  }
  await fs.writeFile(path.join(team, "team.json"), JSON.stringify({
    name: "开发团队",
    description: "说明",
    primaryAgentSlug: members[0],
    memberOrder: members,
  }));
  await fs.writeFile(path.join(team, "official.json"), JSON.stringify({
    schemaVersion: 1,
    officialVersion: input.version,
    members: Object.fromEntries(members.map((slug) => [
      slug,
      {
        recommendedProfile: {
          cli: "codex",
          model: "gpt-5.6-sol",
          effort: "high",
        },
      },
    ])),
  }));
}

async function prepareProtectiveUpdate(): Promise<{
  dataRoot: string;
  plan: Awaited<ReturnType<typeof prepareOfficialTeamUpdate>>;
}> {
  const seedRoot = await makeRoot("moebius-update-seed-");
  const dataRoot = await makeRoot("moebius-update-data-");
  await writeSeed({ root: seedRoot, version: "1", markdown: "# v1\n" });
  await seedBuiltInTeams({ seedTeamsRoot: seedRoot, dataRoot });
  await fs.appendFile(
    path.join(dataRoot, "teams", ".system", "development", "members", "dev", "AGENT.md"),
    "\nuser customization\n",
  );
  await writeSeed({ root: seedRoot, version: "2", markdown: "# v2\n" });
  await seedBuiltInTeams({ seedTeamsRoot: seedRoot, dataRoot });
  return {
    dataRoot,
    plan: await prepareOfficialTeamUpdate({ dataRoot, teamId: "development" }),
  };
}

describe("official team update transaction", () => {
  it.each([
    ["copyTeamId", (plan: Awaited<ReturnType<typeof prepareOfficialTeamUpdate>>) => ({
      ...plan,
      copyTeamId: null,
    })],
    ["action", (plan: Awaited<ReturnType<typeof prepareOfficialTeamUpdate>>) => ({
      ...plan,
      state: { ...plan.state, primaryAction: "update" as const },
    })],
    ["planId", (plan: Awaited<ReturnType<typeof prepareOfficialTeamUpdate>>) => ({
      ...plan,
      planId: "0".repeat(64),
    })],
  ] as const)("rejects a tampered protective %s with zero transaction writes", async (_field, tamper) => {
    const { dataRoot, plan } = await prepareProtectiveUpdate();
    const rename = vi.spyOn(fs, "rename");
    await expect(commitOfficialTeamUpdate({
      dataRoot,
      plan: tamper(plan),
    })).rejects.toMatchObject({ code: "STALE_UPDATE_PLAN" });
    expect(rename).not.toHaveBeenCalled();
    expect(await fs.readFile(
      path.join(dataRoot, "teams", ".system", "development", "members", "dev", "AGENT.md"),
      "utf8",
    )).toContain("user customization");
    await expect(fs.access(path.join(dataRoot, "teams", "development-copy")))
      .rejects.toMatchObject({ code: "ENOENT" });
  });

  it("treats a copy id occupied after prepare as stale, preserves its sentinel, and retries with a new id", async () => {
    const { dataRoot, plan } = await prepareProtectiveUpdate();
    const occupied = path.join(dataRoot, "teams", plan.copyTeamId!);
    await fs.mkdir(occupied);
    await fs.writeFile(path.join(occupied, "sentinel.txt"), "keep");

    await expect(commitOfficialTeamUpdate({ dataRoot, plan })).rejects.toMatchObject({
      code: "STALE_UPDATE_PLAN",
    });
    expect(await fs.readFile(path.join(occupied, "sentinel.txt"), "utf8")).toBe("keep");

    const retryPlan = await prepareOfficialTeamUpdate({ dataRoot, teamId: "development" });
    expect(retryPlan.copyTeamId).toBe("development-copy-2");
    await expect(commitOfficialTeamUpdate({ dataRoot, plan: retryPlan })).resolves.toMatchObject({
      copiedTeamId: "development-copy-2",
    });
    expect(await fs.readFile(path.join(occupied, "sentinel.txt"), "utf8")).toBe("keep");
  });

  it("directly applies a clean update and keeps stable bindings", async () => {
    const seedRoot = await makeRoot("moebius-update-seed-");
    const dataRoot = await makeRoot("moebius-update-data-");
    await writeSeed({ root: seedRoot, version: "1", markdown: "# v1\n" });
    await seedBuiltInTeams({ seedTeamsRoot: seedRoot, dataRoot });
    await saveTeamExecutionBinding({
      dataRoot,
      ownership: "system",
      teamId: "development",
      memberSlug: "dev",
      binding: {
        source: "override",
        profile: { cli: "kimi", model: "kimi-for-coding", effort: "high" },
      },
    });
    await writeSeed({ root: seedRoot, version: "2", markdown: "# v2\n" });
    await seedBuiltInTeams({ seedTeamsRoot: seedRoot, dataRoot });

    expect(await inspectOfficialTeamUpdate({ dataRoot, teamId: "development" })).toMatchObject({
      primaryAction: "update",
      requiresProtectiveCopy: false,
    });
    const result = await commitOfficialTeamUpdate({
      dataRoot,
      plan: await prepareOfficialTeamUpdate({ dataRoot, teamId: "development" }),
    });
    expect(result.copiedTeamId).toBeNull();
    expect(await fs.readFile(
      path.join(dataRoot, "teams", ".system", "development", "members", "dev", "AGENT.md"),
      "utf8",
    )).toContain("# v2");
    expect(await readTeamExecutionBindings({
      dataRoot,
      ownership: "system",
      teamId: "development",
    })).toMatchObject({
      dev: {
        source: "override",
        profile: { cli: "kimi" },
      },
    });
  });

  it("protects customized content and removed overrides in an independent user copy", async () => {
    const seedRoot = await makeRoot("moebius-update-seed-");
    const dataRoot = await makeRoot("moebius-update-data-");
    await writeSeed({ root: seedRoot, version: "1", markdown: "# v1\n" });
    await seedBuiltInTeams({ seedTeamsRoot: seedRoot, dataRoot });
    await saveTeamExecutionBinding({
      dataRoot,
      ownership: "system",
      teamId: "development",
      memberSlug: "qa",
      binding: {
        source: "override",
        profile: { cli: "kimi", model: "saved-but-unavailable", effort: "high" },
      },
    });
    const currentDev = path.join(
      dataRoot,
      "teams",
      ".system",
      "development",
      "members",
      "dev",
      "AGENT.md",
    );
    await fs.appendFile(currentDev, "\nuser customization\n");
    await writeSeed({
      root: seedRoot,
      version: "2",
      markdown: "# v2\n",
      members: ["dev"],
    });
    await seedBuiltInTeams({ seedTeamsRoot: seedRoot, dataRoot });
    const plan = await prepareOfficialTeamUpdate({ dataRoot, teamId: "development" });
    expect(plan).toMatchObject({
      state: {
        primaryAction: "protect-and-update",
        protectedMembers: ["qa"],
      },
    });
    const result = await commitOfficialTeamUpdate({ dataRoot, plan });
    expect(result.copiedTeamId).toBe("development-copy");
    expect(await fs.readFile(
      path.join(dataRoot, "teams", "development-copy", "members", "dev", "AGENT.md"),
      "utf8",
    )).toContain("user customization");
    expect(await readTeamExecutionBindings({
      dataRoot,
      ownership: "user",
      teamId: "development-copy",
    })).toMatchObject({
      qa: {
        source: "explicit",
        profile: { model: "saved-but-unavailable" },
      },
    });
    expect(await readOfficialTeamStateDocument(dataRoot)).toMatchObject({
      teams: {
        development: {
          appliedOfficialVersion: "2",
          baselineConfidence: "verified",
        },
      },
    });
  });

  it("rejects a stale prepared update without changing either version", async () => {
    const seedRoot = await makeRoot("moebius-update-seed-");
    const dataRoot = await makeRoot("moebius-update-data-");
    await writeSeed({ root: seedRoot, version: "1", markdown: "# v1\n" });
    await seedBuiltInTeams({ seedTeamsRoot: seedRoot, dataRoot });
    await writeSeed({ root: seedRoot, version: "2", markdown: "# v2\n" });
    await seedBuiltInTeams({ seedTeamsRoot: seedRoot, dataRoot });
    const plan = await prepareOfficialTeamUpdate({ dataRoot, teamId: "development" });
    const currentDev = path.join(
      dataRoot,
      "teams",
      ".system",
      "development",
      "members",
      "dev",
      "AGENT.md",
    );
    await fs.appendFile(currentDev, "\nlate edit\n");
    await expect(commitOfficialTeamUpdate({ dataRoot, plan })).rejects.toMatchObject({
      code: "STALE_UPDATE_PLAN",
    });
    expect(await fs.readFile(currentDev, "utf8")).toContain("late edit");
    expect(await readOfficialTeamStateDocument(dataRoot)).toMatchObject({
      teams: { development: { appliedOfficialVersion: "1" } },
    });
  });

  it("rolls back a record failure, retries the same plan, and deduplicates its protected copy", async () => {
    const seedRoot = await makeRoot("moebius-update-seed-");
    const dataRoot = await makeRoot("moebius-update-data-");
    await writeSeed({ root: seedRoot, version: "1", markdown: "# v1\n" });
    await seedBuiltInTeams({ seedTeamsRoot: seedRoot, dataRoot });
    const currentDev = path.join(
      dataRoot,
      "teams",
      ".system",
      "development",
      "members",
      "dev",
      "AGENT.md",
    );
    await fs.appendFile(currentDev, "\nuser customization\n");
    await writeSeed({ root: seedRoot, version: "2", markdown: "# v2\n" });
    await seedBuiltInTeams({ seedTeamsRoot: seedRoot, dataRoot });
    const plan = await prepareOfficialTeamUpdate({ dataRoot, teamId: "development" });
    const rename = fs.rename.bind(fs);
    let failed = false;
    const renameSpy = vi.spyOn(fs, "rename").mockImplementation(async (source, destination) => {
      if (!failed && path.basename(String(destination)) === "execution-bindings-v1.json") {
        failed = true;
        throw new Error("injected binding record failure");
      }
      return rename(source, destination);
    });

    await expect(commitOfficialTeamUpdate({ dataRoot, plan })).rejects.toThrow(
      "injected binding record failure",
    );
    renameSpy.mockRestore();
    expect(await fs.readFile(currentDev, "utf8")).toContain("user customization");
    await expect(fs.access(path.join(dataRoot, "teams", "development-copy"))).rejects.toMatchObject({
      code: "ENOENT",
    });
    expect(await readOfficialTeamStateDocument(dataRoot)).toMatchObject({
      teams: { development: { appliedOfficialVersion: "1" } },
    });

    const first = await commitOfficialTeamUpdate({ dataRoot, plan });
    const repeated = await commitOfficialTeamUpdate({ dataRoot, plan });
    expect(first).toEqual(repeated);
    expect(first.copiedTeamId).toBe("development-copy");
    expect((await fs.readdir(path.join(dataRoot, "teams")))
      .filter((entry) => entry.startsWith("development-copy"))).toEqual(["development-copy"]);
  });

  it("rolls back copy, bindings, and user record when the records document cannot commit", async () => {
    const { dataRoot, plan } = await prepareProtectiveUpdate();
    await fs.writeFile(
      path.join(dataRoot, "teams", USER_TEAM_RECORDS_FILE),
      `${JSON.stringify({ version: 2, records: [] })}\n`,
    );
    const rename = fs.rename.bind(fs);
    let failed = false;
    const renameSpy = vi.spyOn(fs, "rename").mockImplementation(async (source, destination) => {
      if (!failed && path.basename(String(destination)) === USER_TEAM_RECORDS_FILE) {
        failed = true;
        throw new Error("injected user team record failure");
      }
      return rename(source, destination);
    });

    await expect(commitOfficialTeamUpdate({ dataRoot, plan })).rejects.toThrow(
      "injected user team record failure",
    );
    renameSpy.mockRestore();
    expect(JSON.parse(await fs.readFile(
      path.join(dataRoot, "teams", USER_TEAM_RECORDS_FILE),
      "utf8",
    ))).toEqual({ version: 2, records: [] });
    await expect(fs.access(path.join(dataRoot, "teams", "development-copy")))
      .rejects.toMatchObject({ code: "ENOENT" });
    expect(await readOfficialTeamStateDocument(dataRoot)).toMatchObject({
      teams: { development: { appliedOfficialVersion: "1" } },
    });
  });

  it("writes the copy record before the receipt and rolls back both when receipt commit fails", async () => {
    const { dataRoot, plan } = await prepareProtectiveUpdate();
    await fs.writeFile(
      path.join(dataRoot, "teams", USER_TEAM_RECORDS_FILE),
      `${JSON.stringify({ version: 2, records: [] })}\n`,
    );
    const rename = fs.rename.bind(fs);
    let sawVisibleCopyBeforeReceipt = false;
    let failed = false;
    const renameSpy = vi.spyOn(fs, "rename").mockImplementation(async (source, destination) => {
      if (!failed && path.basename(String(destination)) === "official-update-receipts-v1.json") {
        const listed = await listRecordedUserTeamSnapshots(dataRoot);
        sawVisibleCopyBeforeReceipt = listed.some(({ snapshot }) =>
          snapshot.location.id === "development-copy" && snapshot.status === "usable");
        failed = true;
        throw new Error("injected receipt failure");
      }
      return rename(source, destination);
    });

    await expect(commitOfficialTeamUpdate({ dataRoot, plan })).rejects.toThrow(
      "injected receipt failure",
    );
    renameSpy.mockRestore();
    expect(sawVisibleCopyBeforeReceipt).toBe(true);
    expect(await listRecordedUserTeamSnapshots(dataRoot)).toHaveLength(0);
    await expect(fs.access(path.join(dataRoot, "teams", "development-copy")))
      .rejects.toMatchObject({ code: "ENOENT" });
  });

  it("recovers a receipt-after-record cleanup crash to one complete visible copy", async () => {
    const { dataRoot, plan } = await prepareProtectiveUpdate();
    await fs.writeFile(
      path.join(dataRoot, "teams", USER_TEAM_RECORDS_FILE),
      `${JSON.stringify({ version: 2, records: [] })}\n`,
    );
    const remove = fs.rm.bind(fs);
    let failed = false;
    const removeSpy = vi.spyOn(fs, "rm").mockImplementation(async (target, options) => {
      if (!failed && path.basename(String(target)) === "backup") {
        failed = true;
        throw new Error("injected post-receipt cleanup crash");
      }
      return remove(target, options);
    });

    await expect(commitOfficialTeamUpdate({ dataRoot, plan })).rejects.toThrow(
      "injected post-receipt cleanup crash",
    );
    removeSpy.mockRestore();
    expect((await listRecordedUserTeamSnapshots(dataRoot)).map(({ snapshot }) =>
      snapshot.location.id)).toEqual(["development-copy"]);

    await recoverOfficialTeamUpdateTransactions(dataRoot);
    await expect(commitOfficialTeamUpdate({ dataRoot, plan })).resolves.toMatchObject({
      copiedTeamId: "development-copy",
    });
    expect((await listRecordedUserTeamSnapshots(dataRoot)).map(({ snapshot }) =>
      snapshot.location.id)).toEqual(["development-copy"]);
  });

  it("leaves the old visible state when protective-copy staging fails and can retry", async () => {
    const seedRoot = await makeRoot("moebius-update-seed-");
    const dataRoot = await makeRoot("moebius-update-data-");
    await writeSeed({ root: seedRoot, version: "1", markdown: "# v1\n" });
    await seedBuiltInTeams({ seedTeamsRoot: seedRoot, dataRoot });
    const currentDev = path.join(
      dataRoot,
      "teams",
      ".system",
      "development",
      "members",
      "dev",
      "AGENT.md",
    );
    await fs.appendFile(currentDev, "\nuser customization\n");
    await writeSeed({ root: seedRoot, version: "2", markdown: "# v2\n" });
    await seedBuiltInTeams({ seedTeamsRoot: seedRoot, dataRoot });
    const plan = await prepareOfficialTeamUpdate({ dataRoot, teamId: "development" });
    const copy = fs.cp.bind(fs);
    let failed = false;
    const copySpy = vi.spyOn(fs, "cp").mockImplementation(async (source, destination, options) => {
      if (!failed && path.basename(String(destination)) === "copy") {
        failed = true;
        throw new Error("injected protective-copy staging failure");
      }
      return copy(source, destination, options);
    });

    await expect(commitOfficialTeamUpdate({ dataRoot, plan })).rejects.toThrow(
      "injected protective-copy staging failure",
    );
    copySpy.mockRestore();
    expect(await fs.readFile(currentDev, "utf8")).toContain("user customization");
    await expect(fs.access(path.join(dataRoot, "teams", "development-copy"))).rejects.toMatchObject({
      code: "ENOENT",
    });
    await expect(commitOfficialTeamUpdate({ dataRoot, plan })).resolves.toMatchObject({
      copiedTeamId: "development-copy",
    });
  });

  it.each(["official-staging", "official-swap", "official-state"] as const)(
    "rolls back an injected %s failure and accepts the same plan on retry",
    async (stage) => {
      const seedRoot = await makeRoot("moebius-update-seed-");
      const dataRoot = await makeRoot("moebius-update-data-");
      await writeSeed({ root: seedRoot, version: "1", markdown: "# v1\n" });
      await seedBuiltInTeams({ seedTeamsRoot: seedRoot, dataRoot });
      await writeSeed({ root: seedRoot, version: "2", markdown: "# v2\n" });
      await seedBuiltInTeams({ seedTeamsRoot: seedRoot, dataRoot });
      const plan = await prepareOfficialTeamUpdate({ dataRoot, teamId: "development" });
      const officialDirectory = path.join(dataRoot, "teams", ".system", "development");
      const copy = fs.cp.bind(fs);
      const rename = fs.rename.bind(fs);
      let failed = false;
      const copySpy = vi.spyOn(fs, "cp").mockImplementation(async (source, destination, options) => {
        if (
          !failed
          && stage === "official-staging"
          && path.basename(String(destination)) === "official"
          && String(destination).includes("official-update-staging")
        ) {
          failed = true;
          throw new Error(`injected ${stage} failure`);
        }
        return copy(source, destination, options);
      });
      const renameSpy = vi.spyOn(fs, "rename").mockImplementation(async (source, destination) => {
        const sourcePath = String(source);
        const destinationPath = String(destination);
        const matchesSwap = stage === "official-swap"
          && path.basename(sourcePath) === "official"
          && sourcePath.includes("official-update-staging")
          && destinationPath === officialDirectory;
        const matchesState = stage === "official-state"
          && path.basename(destinationPath) === "official-state-v1.json";
        if (!failed && (matchesSwap || matchesState)) {
          failed = true;
          throw new Error(`injected ${stage} failure`);
        }
        return rename(source, destination);
      });

      await expect(commitOfficialTeamUpdate({ dataRoot, plan })).rejects.toThrow(
        `injected ${stage} failure`,
      );
      copySpy.mockRestore();
      renameSpy.mockRestore();
      expect(await fs.readFile(
        path.join(officialDirectory, "members", "dev", "AGENT.md"),
        "utf8",
      )).toContain("# v1");
      expect(await readOfficialTeamStateDocument(dataRoot)).toMatchObject({
        teams: { development: { appliedOfficialVersion: "1" } },
      });

      await expect(commitOfficialTeamUpdate({ dataRoot, plan })).resolves.toMatchObject({
        copiedTeamId: null,
      });
      expect(await fs.readFile(
        path.join(officialDirectory, "members", "dev", "AGENT.md"),
        "utf8",
      )).toContain("# v2");
    },
  );

  it("recovers an interrupted post-swap journal to the complete old state on startup", async () => {
    const seedRoot = await makeRoot("moebius-update-seed-");
    const dataRoot = await makeRoot("moebius-update-data-");
    await writeSeed({ root: seedRoot, version: "1", markdown: "# v1\n" });
    await seedBuiltInTeams({ seedTeamsRoot: seedRoot, dataRoot });
    await writeSeed({ root: seedRoot, version: "2", markdown: "# v2\n" });
    await seedBuiltInTeams({ seedTeamsRoot: seedRoot, dataRoot });
    const plan = await prepareOfficialTeamUpdate({ dataRoot, teamId: "development" });
    const stateRoot = getAgentTeamsStateRoot(dataRoot);
    const transactionRoot = path.join(stateRoot, "official-update-staging", plan.planId);
    const officialDirectory = path.join(dataRoot, "teams", ".system", "development");
    const officialStagingDirectory = path.join(transactionRoot, "official");
    const backupDirectory = path.join(transactionRoot, "backup");
    await fs.mkdir(transactionRoot, { recursive: true });
    await fs.cp(
      getPackagedTeamCacheDirectory(dataRoot, "development"),
      officialStagingDirectory,
      { recursive: true },
    );
    await fs.rm(path.join(officialStagingDirectory, "official.json"));
    await fs.writeFile(
      path.join(stateRoot, "official-update-journal-v1.json"),
      JSON.stringify({
        schemaVersion: 1,
        planId: plan.planId,
        teamId: "development",
        copyTeamId: null,
        officialDirectory,
        officialStagingDirectory,
        backupDirectory,
        copyStagingDirectory: null,
        copyPublishedDirectory: null,
        previousOfficialDocument: await readOfficialTeamStateDocument(dataRoot),
        previousBindingDocument: await readExecutionBindingDocument(dataRoot),
      }),
    );
    await fs.rename(officialDirectory, backupDirectory);
    await fs.rename(officialStagingDirectory, officialDirectory);
    expect(await fs.readFile(
      path.join(officialDirectory, "members", "dev", "AGENT.md"),
      "utf8",
    )).toContain("# v2");

    await recoverOfficialTeamUpdateTransactions(dataRoot);

    expect(await fs.readFile(
      path.join(officialDirectory, "members", "dev", "AGENT.md"),
      "utf8",
    )).toContain("# v1");
    expect(await readOfficialTeamStateDocument(dataRoot)).toMatchObject({
      teams: { development: { appliedOfficialVersion: "1" } },
    });
    await expect(fs.access(path.join(stateRoot, "official-update-journal-v1.json")))
      .rejects.toMatchObject({ code: "ENOENT" });
  });

  it("finishes the complete new state when startup recovery finds a committed receipt", async () => {
    const seedRoot = await makeRoot("moebius-update-seed-");
    const dataRoot = await makeRoot("moebius-update-data-");
    await writeSeed({ root: seedRoot, version: "1", markdown: "# v1\n" });
    await seedBuiltInTeams({ seedTeamsRoot: seedRoot, dataRoot });
    await writeSeed({ root: seedRoot, version: "2", markdown: "# v2\n" });
    await seedBuiltInTeams({ seedTeamsRoot: seedRoot, dataRoot });
    const plan = await prepareOfficialTeamUpdate({ dataRoot, teamId: "development" });
    const remove = fs.rm.bind(fs);
    let failed = false;
    const removeSpy = vi.spyOn(fs, "rm").mockImplementation(async (target, options) => {
      if (!failed && path.basename(String(target)) === "backup") {
        failed = true;
        throw new Error("injected committed cleanup interruption");
      }
      return remove(target, options);
    });

    await expect(commitOfficialTeamUpdate({ dataRoot, plan })).rejects.toThrow(
      "injected committed cleanup interruption",
    );
    removeSpy.mockRestore();
    expect(await fs.readFile(
      path.join(dataRoot, "teams", ".system", "development", "members", "dev", "AGENT.md"),
      "utf8",
    )).toContain("# v2");
    expect(await readOfficialTeamStateDocument(dataRoot)).toMatchObject({
      teams: { development: { appliedOfficialVersion: "2" } },
    });

    await recoverOfficialTeamUpdateTransactions(dataRoot);
    await expect(commitOfficialTeamUpdate({ dataRoot, plan })).resolves.toMatchObject({
      teamId: "development",
      copiedTeamId: null,
    });
    await expect(fs.access(path.join(
      getAgentTeamsStateRoot(dataRoot),
      "official-update-journal-v1.json",
    ))).rejects.toMatchObject({ code: "ENOENT" });
  });
});
