import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createAgentRevisionService } from "./agent-revision-service.js";
import { createAgentRevisionStore } from "./agent-revision-store.js";
import { createDefaultAgentConfigStore } from "./default-agent-config-store.js";
import { createTeamRevisionIpc } from "./team-revision-ipc.js";
import { resolveTeamLocation } from "./team-store.js";
import { TEAM_MANIFEST_FILE, TEAM_AGENT_FILE } from "./team-model.js";

let tempRoot: string;
let dataRoot: string;

beforeEach(async () => {
  tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "moebius-team-revision-ipc-"));
  dataRoot = path.join(tempRoot, "data");
  const location = resolveTeamLocation({ dataRoot, teamId: "development", ownership: "system" });
  const files: Record<string, string> = {
    [TEAM_MANIFEST_FILE]: JSON.stringify({
      name: "开发团队",
      description: "内置团队",
      primaryAgentSlug: "dev-manager",
      memberOrder: ["dev-manager", "dev", "qa"],
    }),
    "members/dev-manager/AGENT.md": "# 开发经理\n\n负责技术决策。\n",
    "members/dev/AGENT.md": "# 开发\n\n负责实现。\n",
    "members/qa/AGENT.md": "# 测试\n\n负责验收。\n",
  };
  for (const [relativePath, content] of Object.entries(files)) {
    const target = path.join(location.directory, relativePath);
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, content, "utf8");
  }
});

afterEach(async () => {
  await fs.rm(tempRoot, { recursive: true, force: true });
});

function createIpc() {
  const store = createAgentRevisionStore({
    sqlitePath: path.join(dataRoot, ".state", "local-console.sqlite"),
  });
  const defaultAgent = createDefaultAgentConfigStore({ dataRoot });
  const summarize = vi.fn().mockResolvedValue(undefined);
  const service = createAgentRevisionService({ store, summarize });
  return { store, defaultAgent, summarize, ipc: createTeamRevisionIpc({ dataRoot, store, service, defaultAgent }) };
}

const memberRequest = {
  teamId: "development",
  ownership: "system" as const,
  memberSlug: "dev-manager",
};

describe("createTeamRevisionIpc", () => {
  it("rejects malformed list requests", async () => {
    const { ipc } = createIpc();
    await expect(ipc.listMemberRevisions({ teamId: "development", ownership: "system" }))
      .rejects.toThrow();
    await expect(ipc.listMemberRevisions({ ...memberRequest, memberSlug: "" }))
      .rejects.toThrow();
  });

  it("lists revisions newest-first with the latest markers", async () => {
    const { store, ipc } = createIpc();
    await store.createRevision({
      teamStableId: "development",
      memberSlug: "dev-manager",
      content: "# 开发经理\n\n负责技术决策。\n",
      authorKind: "user",
      blockOwnership: [{
        blockIndex: 0,
        authorKind: "user",
        authorLabel: "你",
        timeLabel: "2026-08-01T00:00:00.000Z",
        previousText: null,
      }, {
        blockIndex: 1,
        authorKind: "user",
        authorLabel: "你",
        timeLabel: "2026-08-01T00:00:00.000Z",
        previousText: null,
      }],
      summaryStatus: "pending",
      now: "2026-08-01T00:00:00.000Z",
    });
    const summary = await store.updateSummary(
      (await store.listRevisions("development", "dev-manager"))[0]!.revisionId,
      "这是第一条修订",
      "ready",
    );

    const response = await ipc.listMemberRevisions(memberRequest);
    expect(response.timeline).toHaveLength(1);
    expect(response.timeline[0]).toMatchObject({
      revisionId: summary.revisionId,
      summary: "这是第一条修订",
      summaryStatus: "ready",
      isLatest: true,
    });
    expect(response.recentChange).toEqual({
      summary: "这是第一条修订",
      summaryStatus: "ready",
      authorLabel: "",
      timeLabel: "2026-08-01T00:00:00.000Z",
    });
    expect(response.changeMarkers).toHaveLength(2);
  });

  it("keeps the recent-change line while the summary is still pending", async () => {
    const { store, ipc } = createIpc();
    await store.createRevision({
      teamStableId: "development",
      memberSlug: "dev-manager",
      content: "# 开发经理\n\n新职责。\n",
      authorKind: "user",
      blockOwnership: null,
      summaryStatus: "pending",
      now: "2026-08-01T00:00:00.000Z",
    });

    const response = await ipc.listMemberRevisions(memberRequest);
    expect(response.recentChange).toEqual({
      summary: null,
      summaryStatus: "pending",
      authorLabel: "",
      timeLabel: "2026-08-01T00:00:00.000Z",
    });
    expect(response.recentChange).not.toBeNull();
  });

  it("keeps the recent-change line when the summary failed (unavailable)", async () => {
    const { store, ipc } = createIpc();
    await store.createRevision({
      teamStableId: "development",
      memberSlug: "dev-manager",
      content: "# 开发经理\n\n新职责。\n",
      authorKind: "user",
      blockOwnership: null,
      summaryStatus: "unavailable",
      now: "2026-08-01T00:00:00.000Z",
    });

    const response = await ipc.listMemberRevisions(memberRequest);
    expect(response.recentChange).toEqual({
      summary: null,
      summaryStatus: "unavailable",
      authorLabel: "",
      timeLabel: "2026-08-01T00:00:00.000Z",
    });
  });

  it("returns no recent-change line only before the first revision exists", async () => {
    const { ipc } = createIpc();
    const response = await ipc.listMemberRevisions(memberRequest);
    expect(response.recentChange).toBeNull();
    expect(response.timeline).toEqual([]);
  });

  it("rejects restoring a revision that belongs to another member", async () => {
    const { store, ipc } = createIpc();
    await store.createRevision({
      teamStableId: "development",
      memberSlug: "dev",
      content: "# 开发\n",
      authorKind: "user",
      blockOwnership: null,
      summaryStatus: "unavailable",
      now: "2026-08-01T00:00:00.000Z",
    });
    const foreignRevision = (await store.listRevisions("development", "dev"))[0]!;

    await expect(ipc.restoreMemberRevision({
      ...memberRequest,
      revisionId: foreignRevision.revisionId,
    })).rejects.toThrow("不属于这名成员");
  });

  it("rejects malformed restore requests", async () => {
    const { ipc } = createIpc();
    await expect(ipc.restoreMemberRevision({ ...memberRequest, revisionId: "" }))
      .rejects.toThrow();
    await expect(ipc.restoreMemberRevision({ ...memberRequest, revisionId: "a\nb" }))
      .rejects.toThrow();
    await expect(ipc.restoreMemberRevision({ ...memberRequest }))
      .rejects.toThrow();
  });

  it("restores the target revision to disk and records the restore as a new revision", async () => {
    const { store, ipc } = createIpc();
    const first = await store.createRevision({
      teamStableId: "development",
      memberSlug: "dev-manager",
      content: "# 开发经理\n\n旧版本。\n",
      authorKind: "user",
      blockOwnership: null,
      summaryStatus: "unavailable",
      now: "2026-08-01T00:00:00.000Z",
    });
    await store.createRevision({
      teamStableId: "development",
      memberSlug: "dev-manager",
      content: "# 开发经理\n\n新版本。\n",
      authorKind: "user",
      blockOwnership: null,
      summaryStatus: "unavailable",
      now: "2026-08-02T00:00:00.000Z",
    });

    const response = await ipc.restoreMemberRevision({
      ...memberRequest,
      revisionId: first.revisionId,
    });
    expect(response.agentMarkdown).toBe("# 开发经理\n\n旧版本。\n");

    const location = resolveTeamLocation({ dataRoot, teamId: "development", ownership: "system" });
    const onDisk = await fs.readFile(path.join(location.directory, "members/dev-manager/AGENT.md"), "utf8");
    expect(onDisk).toBe("# 开发经理\n\n旧版本。\n");

    const revisions = await store.listRevisions("development", "dev-manager");
    expect(revisions).toHaveLength(3);
    expect(revisions.at(-1)!.authorKind).toBe("user");
    expect(revisions.at(-1)!.content).toBe("# 开发经理\n\n旧版本。\n");
    expect(response.revision.revisionId).toBe(revisions.at(-1)!.revisionId);
  });

  it("rejects restoring the CURRENT revision (a no-op would fabricate a duplicate revision)", async () => {
    const { store, ipc } = createIpc();
    await store.createRevision({
      teamStableId: "development",
      memberSlug: "dev-manager",
      content: "# 开发经理\n\n版本一。\n",
      authorKind: "user",
      blockOwnership: null,
      summaryStatus: "unavailable",
      now: "2026-08-01T00:00:00.000Z",
    });
    const latest = await store.createRevision({
      teamStableId: "development",
      memberSlug: "dev-manager",
      content: "# 开发经理\n\n版本二。\n",
      authorKind: "user",
      blockOwnership: null,
      summaryStatus: "unavailable",
      now: "2026-08-02T00:00:00.000Z",
    });

    await expect(ipc.restoreMemberRevision({
      ...memberRequest,
      revisionId: latest.revisionId,
    })).rejects.toThrow("当前版本无需回退");

    // And the disk + revision count are untouched by the rejected call: the
    // member file still holds the beforeEach fixture content (revisions alone
    // never write to disk) and no duplicate revision was recorded.
    const location = resolveTeamLocation({ dataRoot, teamId: "development", ownership: "system" });
    const onDisk = await fs.readFile(path.join(location.directory, "members/dev-manager/AGENT.md"), "utf8");
    expect(onDisk).toBe("# 开发经理\n\n负责技术决策。\n");
    expect(await store.listRevisions("development", "dev-manager")).toHaveLength(2);
  });

  it("marks only the newest timeline entry as the current (no-restore) revision", async () => {
    const { store, ipc } = createIpc();
    await store.createRevision({
      teamStableId: "development",
      memberSlug: "dev-manager",
      content: "# 开发经理\n\n版本一。\n",
      authorKind: "official",
      authorLabel: "官方 v1.2",
      blockOwnership: null,
      summaryStatus: "unavailable",
      now: "2026-08-01T00:00:00.000Z",
    });
    await store.createRevision({
      teamStableId: "development",
      memberSlug: "dev-manager",
      content: "# 开发经理\n\n版本二。\n",
      authorKind: "user",
      blockOwnership: null,
      summaryStatus: "pending",
      now: "2026-08-02T00:00:00.000Z",
    });

    const response = await ipc.listMemberRevisions(memberRequest);
    expect(response.timeline.map((entry) => entry.isLatest)).toEqual([true, false]);
    // The earliest revision (index 1) keeps its restore entry — every
    // historical revision, including the very first, can be restored to.
    expect(response.timeline[1]).toMatchObject({ isLatest: false, authorKind: "official" });
  });

  it("returns the built-in recommendation before any save and the saved profile afterwards", async () => {
    const { defaultAgent, ipc } = createIpc();
    const before = await ipc.getDefaultAgent();
    expect(before.saved).toBe(false);
    expect(before.profile).toEqual({ cli: "codex", model: "gpt-5.6-sol", effort: "high" });

    const saved = await ipc.saveDefaultAgent({
      profile: { cli: "claude", model: "sonnet", effort: "high" },
    });
    expect(saved.saved).toBe(true);
    expect(saved.profile).toEqual({ cli: "claude", model: "sonnet", effort: "high" });

    const after = await ipc.getDefaultAgent();
    expect(after.saved).toBe(true);
    expect(after.profile).toEqual({ cli: "claude", model: "sonnet", effort: "high" });
    expect((await defaultAgent.read()).profile).toEqual({ cli: "claude", model: "sonnet", effort: "high" });
  });

  it("rejects malformed default-agent saves", async () => {
    const { ipc } = createIpc();
    await expect(ipc.saveDefaultAgent({})).rejects.toThrow();
    await expect(ipc.saveDefaultAgent({ profile: { cli: "codex", model: "", effort: "high" } }))
      .rejects.toThrow();
    await expect(ipc.saveDefaultAgent({ profile: { cli: "wat", model: "m", effort: "high" } }))
      .rejects.toThrow();
  });
});
