import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  getAgentTeamsStateRoot,
  getPackagedTeamCacheDirectory,
  readExecutionBindingDocument,
  readOfficialTeamStateDocument,
  teamBindingKey,
  writeExecutionBindingDocument,
  writeOfficialTeamStateDocument,
} from "../src/team-management-store.js";
import {
  createOfficialTeamAutoSyncService,
  type OfficialTeamAutoSyncService,
} from "../src/team-auto-sync.js";
import { readOfficialSyncStateDocument } from "../src/team-sync-batch-store.js";
import {
  resolveTeamLocation,
} from "../src/team-store.js";
import { computeOfficialTeamContentFingerprint } from "../src/team-official-management.js";
import type { AgentRevisionService } from "../src/agent-revision-service.js";
import type { AgentRevisionOneShotPort } from "../src/agent-revision-summary-job.js";
import type { DefaultAgentConfigStore } from "../src/default-agent-config-store.js";
import type { ExecutionProfile, ExecutionProfileBinding } from "../src/team-execution-profile.js";

const codexProfile: ExecutionProfile = { cli: "codex", model: "gpt-5.6-sol", effort: "high" };
const kimiProfile: ExecutionProfile = { cli: "kimi", model: "kimi-for-coding", effort: "high" };

const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((root) =>
    fs.rm(root, { recursive: true, force: true })));
});

async function makeDataRoot(): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "moebius-auto-sync-"));
  temporaryRoots.push(root);
  await fs.mkdir(path.join(root, ".state", "agent-teams"), { recursive: true });
  await fs.mkdir(path.join(root, "teams", ".system"), { recursive: true });
  return root;
}

async function writeTeamDirectory(
  dataRoot: string,
  teamId: string,
  content: Record<string, string>,
): Promise<void> {
  const location = resolveTeamLocation({ dataRoot, teamId, ownership: "system" });
  for (const [relativePath, text] of Object.entries(content)) {
    const target = path.join(location.directory, ...relativePath.split("/"));
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, text, "utf8");
  }
}

function teamJson(overrides: Partial<Record<string, unknown>> = {}): string {
  return JSON.stringify({
    name: "开发团队",
    description: "内置团队",
    primaryAgentSlug: "manager",
    memberOrder: ["manager", "dev", "qa"],
    ...overrides,
  });
}

function contentV1(): Record<string, string> {
  return {
    "team.json": teamJson(),
    "members/manager/AGENT.md": "# 开发经理\n\n负责技术决策。\n",
    "members/dev/AGENT.md": "# 开发\n\n负责实现。\n",
    "members/qa/AGENT.md": "# 测试\n\n负责验收。\n",
    "onboarding-orchestration.json": "{\"v\":1}",
  };
}

function contentV2(): Record<string, string> {
  return {
    ...contentV1(),
    "members/manager/AGENT.md": "# 开发经理\n\n负责技术决策与质量。\n",
  };
}

async function installPackagedTeam(
  dataRoot: string,
  teamId: string,
  version: string,
  content: Record<string, string>,
  members: Record<string, ExecutionProfile> = { manager: codexProfile, dev: codexProfile, qa: codexProfile },
): Promise<void> {
  const directory = getPackagedTeamCacheDirectory(dataRoot, teamId);
  await fs.mkdir(directory, { recursive: true });
  for (const [relativePath, text] of Object.entries(content)) {
    const target = path.join(directory, ...relativePath.split("/"));
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, text, "utf8");
  }
  await fs.writeFile(path.join(directory, "official.json"), JSON.stringify({
    schemaVersion: 1,
    officialVersion: version,
    members: Object.fromEntries(Object.entries(members).map(([slug, recommendedProfile]) => [
      slug,
      { recommendedProfile },
    ])),
  }, null, 2));
}

async function installBaseline(dataRoot: string, teamId: string, content: Record<string, string>): Promise<void> {
  const document = await readOfficialTeamStateDocument(dataRoot);
  document.teams[teamId] = {
    appliedOfficialVersion: "1",
    appliedContentFingerprint: await computeOfficialTeamContentFingerprint(
      resolveTeamLocation({ dataRoot, teamId, ownership: "system" }).directory,
    ),
    appliedRecommendationFingerprint: "rec-1",
    appliedRecommendations: { manager: codexProfile, dev: codexProfile, qa: codexProfile },
    baselineConfidence: "verified",
    appliedContentSnapshot: content,
  };
  await writeOfficialTeamStateDocument(dataRoot, document);
}

function makeService(input: {
  oneShot?: AgentRevisionOneShotPort;
  revisions?: Pick<AgentRevisionService, "recordMemberRevision">;
} = {}): {
  service: OfficialTeamAutoSyncService;
  oneShot: AgentRevisionOneShotPort;
  revisions: { recordMemberRevision: ReturnType<typeof vi.fn> };
} {
  const revisions = {
    recordMemberRevision: vi.fn().mockResolvedValue({ revisionId: "rev" }),
  };
  const oneShot = input.oneShot ?? {
    run: async () => ({ ok: true as const, text: "# 合并结果\n" }),
  };
  const defaultAgent: Pick<DefaultAgentConfigStore, "read"> = {
    read: async () => ({ schemaVersion: 1, profile: null }),
  };
  const service = createOfficialTeamAutoSyncService({
    revisionService: input.revisions ?? revisions,
    defaultAgent,
    oneShot: input.oneShot ?? oneShot,
    runDirRoot: path.join(os.tmpdir(), "moebius-auto-sync-runs"),
  });
  return { service, oneShot, revisions };
}

async function readTeamFile(dataRoot: string, teamId: string, relativePath: string): Promise<string> {
  const location = resolveTeamLocation({ dataRoot, teamId, ownership: "system" });
  return fs.readFile(path.join(location.directory, ...relativePath.split("/")), "utf8");
}

describe("official team auto-sync executor", () => {
  it("applies a clean upgrade at startup, records the batch and official revisions, and is idempotent on the next run", async () => {
    const dataRoot = await makeDataRoot();
    await writeTeamDirectory(dataRoot, "development", contentV1());
    await installPackagedTeam(dataRoot, "development", "2", contentV2());
    await installBaseline(dataRoot, "development", contentV1());
    const { service, revisions } = makeService();

    const outcome = await service.runForTeam({ dataRoot, teamId: "development", mode: "auto", now: "2026-08-11T00:00:00.000Z" });
    expect(outcome.kind).toBe("applied");
    if (outcome.kind !== "applied") return;
    expect(outcome.memberChanges.added).toEqual([]);

    expect(await readTeamFile(dataRoot, "development", "members/manager/AGENT.md"))
      .toBe("# 开发经理\n\n负责技术决策与质量。\n");
    // The non-fingerprint file survives the swap untouched.
    expect(await readTeamFile(dataRoot, "development", "onboarding-orchestration.json")).toBe("{\"v\":1}");

    const syncDocument = await readOfficialSyncStateDocument(dataRoot);
    expect(syncDocument.batches["development"]?.status).toBe("active");
    expect(syncDocument.pendingMerges["development"]).toBeUndefined();

    // Official revision recorded for the changed member.
    expect(revisions.recordMemberRevision).toHaveBeenCalledTimes(1);
    expect(revisions.recordMemberRevision).toHaveBeenCalledWith(expect.objectContaining({
      teamStableId: "development",
      memberSlug: "manager",
      authorKind: "official",
      authorLabel: "2",
    }));

    // Second startup: nothing to do (idempotent).
    const second = await service.runForTeam({ dataRoot, teamId: "development", mode: "auto", now: "2026-08-12T00:00:00.000Z" });
    expect(second).toMatchObject({ kind: "none" });
  });

  it("keeps the user's diverged member and marks it pending when the default Agent merge fails, then merges on retry", async () => {
    const dataRoot = await makeDataRoot();
    const userV1 = contentV1();
    userV1["members/dev/AGENT.md"] = "# 开发\n\n按方案实现并自测。\n";
    await writeTeamDirectory(dataRoot, "development", userV1);
    await installBaseline(dataRoot, "development", contentV1());
    const v2 = contentV2();
    v2["members/dev/AGENT.md"] = "# 开发\n\n按方案实现。\n";
    await installPackagedTeam(dataRoot, "development", "2", v2);
    let fail = true;
    const { service } = makeService({
      oneShot: {
        run: async () => fail
          ? { ok: false as const, reason: "no agent" }
          : { ok: true as const, text: "# 开发\n\n按方案实现并自测，同时引入官方补充。\n" },
      },
    });

    const first = await service.runForTeam({ dataRoot, teamId: "development", mode: "auto", now: "2026-08-11T00:00:00.000Z" });
    expect(first.kind).toBe("applied");
    if (first.kind !== "applied") return;
    expect(first.pendingMergeMembers).toEqual(["dev"]);
    // The user's diverged content is never overwritten by a failed merge.
    expect(await readTeamFile(dataRoot, "development", "members/dev/AGENT.md"))
      .toBe("# 开发\n\n按方案实现并自测。\n");
    // Manager's one-sided official change still applied.
    expect(await readTeamFile(dataRoot, "development", "members/manager/AGENT.md"))
      .toBe("# 开发经理\n\n负责技术决策与质量。\n");

    const pending = await service.readTeamSyncViews({ dataRoot, teamId: "development" });
    expect(pending.pendingMerge?.reason).toBe("DEFAULT_AGENT_UNAVAILABLE");
    expect(pending.pendingMerge?.pendingMemberSlugs).toEqual(["dev"]);

    fail = false;
    const retry = await service.runForTeam({ dataRoot, teamId: "development", mode: "auto", now: "2026-08-12T00:00:00.000Z" });
    expect(retry.kind).toBe("applied");
    if (retry.kind !== "applied") return;
    expect(retry.pendingMergeMembers).toEqual([]);
    expect(await readTeamFile(dataRoot, "development", "members/dev/AGENT.md"))
      .toBe("# 开发\n\n按方案实现并自测，同时引入官方补充。");
    const cleared = await service.readTeamSyncViews({ dataRoot, teamId: "development" });
    expect(cleared.pendingMerge).toBeNull();
  });

  it("reverts a sync to the pre-sync content and bindings, and never re-merges the reverted version", async () => {
    const dataRoot = await makeDataRoot();
    await writeTeamDirectory(dataRoot, "development", contentV1());
    await installPackagedTeam(dataRoot, "development", "2", contentV2());
    await installBaseline(dataRoot, "development", contentV1());
    const { service } = makeService();
    await service.runForTeam({ dataRoot, teamId: "development", mode: "auto", now: "2026-08-11T00:00:00.000Z" });

    const reverted = await service.revertLatestSync({ dataRoot, teamId: "development", now: "2026-08-11T01:00:00.000Z" });
    expect(reverted).toMatchObject({ kind: "reverted", officialVersion: "2" });
    expect(await readTeamFile(dataRoot, "development", "members/manager/AGENT.md"))
      .toBe("# 开发经理\n\n负责技术决策。\n");

    const syncDocument = await readOfficialSyncStateDocument(dataRoot);
    expect(syncDocument.batches["development"]?.status).toBe("reverted");
    expect(syncDocument.suppressedVersions["development"]).toContain("2");

    // Startup after revert: the same packaged version is not re-merged.
    const next = await service.runForTeam({ dataRoot, teamId: "development", mode: "auto", now: "2026-08-12T00:00:00.000Z" });
    expect(next).toMatchObject({ kind: "none" });
  });

  it("keeps official teams out of the merge when their content is unreadable", async () => {
    const dataRoot = await makeDataRoot();
    await writeTeamDirectory(dataRoot, "development", contentV1());
    await installBaseline(dataRoot, "development", contentV1());
    await installPackagedTeam(dataRoot, "development", "2", contentV2());
    // Make the editable team directory unreadable by removing it.
    const location = resolveTeamLocation({ dataRoot, teamId: "development", ownership: "system" });
    await fs.rm(location.directory, { recursive: true, force: true });
    const { service } = makeService();
    const outcome = await service.runForTeam({ dataRoot, teamId: "development", mode: "auto", now: "2026-08-11T00:00:00.000Z" });
    expect(outcome).toMatchObject({ kind: "skipped" });
  });

  it("defers conservative baselines and performs the one-time explicit merge on request", async () => {
    const dataRoot = await makeDataRoot();
    const userContent = contentV1();
    userContent["members/dev/AGENT.md"] = "# 开发\n\n用户改过，基线不可考。\n";
    await writeTeamDirectory(dataRoot, "development", userContent);
    await installPackagedTeam(dataRoot, "development", "2", contentV2());
    const document = await readOfficialTeamStateDocument(dataRoot);
    document.teams["development"] = {
      appliedOfficialVersion: "1",
      appliedContentFingerprint: "legacy-fp",
      appliedRecommendationFingerprint: "rec-1",
      appliedRecommendations: { manager: codexProfile, dev: codexProfile, qa: codexProfile },
      baselineConfidence: "conservative",
    };
    await writeOfficialTeamStateDocument(dataRoot, document);

    const { service } = makeService({
      oneShot: { run: async () => ({ ok: true as const, text: "# 开发\n\n用户改过，基线不可考，合并官方补充。\n" }) },
    });
    const auto = await service.runForTeam({ dataRoot, teamId: "development", mode: "auto", now: "2026-08-11T00:00:00.000Z" });
    expect(auto).toEqual({ kind: "deferred", reason: "CONSERVATIVE_BASELINE" });

    const explicit = await service.runForTeam({ dataRoot, teamId: "development", mode: "explicit", now: "2026-08-11T00:00:00.000Z" });
    expect(explicit.kind).toBe("applied");
    if (explicit.kind !== "applied") return;
    expect(explicit.pendingMergeMembers).toEqual([]);
    const views = await service.readTeamSyncViews({ dataRoot, teamId: "development" });
    expect(views.pendingMerge).toBeNull();
    // The baseline is now established: a subsequent startup goes the automatic path.
    const officialDocument = await readOfficialTeamStateDocument(dataRoot);
    expect(officialDocument.teams["development"]?.baselineConfidence).toBe("verified");
  });

  it("does not create a sync batch when the one-time conservative merge changed nothing", async () => {
    const dataRoot = await makeDataRoot();
    // B already equals C: the explicit merge has nothing to change.
    await writeTeamDirectory(dataRoot, "development", contentV2());
    await installPackagedTeam(dataRoot, "development", "2", contentV2());
    const document = await readOfficialTeamStateDocument(dataRoot);
    document.teams["development"] = {
      appliedOfficialVersion: "1",
      appliedContentFingerprint: "legacy-fp",
      appliedRecommendationFingerprint: "rec-1",
      appliedRecommendations: { manager: codexProfile, dev: codexProfile, qa: codexProfile },
      baselineConfidence: "conservative",
    };
    await writeOfficialTeamStateDocument(dataRoot, document);

    const { service } = makeService();
    const explicit = await service.runForTeam({ dataRoot, teamId: "development", mode: "explicit", now: "2026-08-11T00:00:00.000Z" });
    expect(explicit.kind).toBe("applied");
    const views = await service.readTeamSyncViews({ dataRoot, teamId: "development" });
    // No banner, no recent-sync panel and no revert entry for a no-op merge.
    expect(views.banner).toBeNull();
    expect(views.recent).toBeNull();
    expect(views.hasUnseen).toBe(false);
    const officialDocument = await readOfficialTeamStateDocument(dataRoot);
    expect(officialDocument.teams["development"]?.appliedOfficialVersion).toBe("2");
    expect(officialDocument.teams["development"]?.baselineConfidence).toBe("verified");
  });

  it("migrates follow-recommendation bindings and keeps overrides during an upgrade", async () => {
    const dataRoot = await makeDataRoot();
    await writeTeamDirectory(dataRoot, "development", contentV1());
    await installPackagedTeam(
      dataRoot,
      "development",
      "2",
      contentV2(),
      { manager: kimiProfile, dev: codexProfile, qa: codexProfile },
    );
    await installBaseline(dataRoot, "development", contentV1());
    const bindingDocument = await readExecutionBindingDocument(dataRoot);
    bindingDocument.teams[teamBindingKey("system", "development")] = {
      ownership: "system",
      members: {
        manager: { source: "recommended" },
        dev: { source: "recommended" },
        qa: { source: "override", profile: kimiProfile },
      } as Record<string, ExecutionProfileBinding>,
    };
    await writeExecutionBindingDocument(dataRoot, bindingDocument);

    const { service } = makeService();
    await service.runForTeam({ dataRoot, teamId: "development", mode: "auto", now: "2026-08-11T00:00:00.000Z" });

    const after = await readExecutionBindingDocument(dataRoot);
    const members = after.teams[teamBindingKey("system", "development")]?.members ?? {};
    expect(members.manager).toEqual({ source: "recommended" });
    expect(members.qa).toEqual({ source: "override", profile: kimiProfile });
    // The packaged recommendation fingerprint is now applied.
    const officialDocument = await readOfficialTeamStateDocument(dataRoot);
    expect(officialDocument.teams["development"]?.appliedOfficialVersion).toBe("2");
    expect(officialDocument.teams["development"]?.appliedContentSnapshot?.["members/manager/AGENT.md"])
      .toBe("# 开发经理\n\n负责技术决策与质量。\n");
  });
});
