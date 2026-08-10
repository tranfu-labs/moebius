import { describe, expect, it, vi } from "vitest";

import type { AgentMarkdownRevision } from "./agent-revision-store.js";
import { createAgentRevisionService } from "./agent-revision-service.js";
import {
  buildSummaryPrompt,
  createAgentRevisionSummaryJob,
  summarizeResultText,
  type AgentRevisionOneShotPort,
} from "./agent-revision-summary-job.js";

function revision(overrides: Partial<AgentMarkdownRevision> = {}): AgentMarkdownRevision {
  return {
    revisionId: "rev-1",
    teamStableId: "development",
    memberSlug: "dev-manager",
    content: "# 开发经理\n\n负责实现。\n",
    authorKind: "user",
    authorLabel: null,
    blockOwnership: [],
    summary: null,
    summaryStatus: "pending",
    batchId: null,
    createdAt: "2026-08-01T00:00:00.000Z",
    ...overrides,
  };
}

describe("createAgentRevisionService", () => {
  it("records a revision immediately and dispatches the summary without awaiting it", async () => {
    const listRevisions = vi.fn().mockResolvedValue([]);
    const createRevision = vi.fn().mockResolvedValue(revision({ revisionId: "rev-new" }));
    const summarize = vi.fn().mockResolvedValue(undefined);
    const service = createAgentRevisionService({ store: { listRevisions, createRevision }, summarize });

    const recorded = await service.recordMemberRevision({
      teamStableId: "development",
      memberSlug: "dev-manager",
      content: "# 开发经理\n\n负责实现。\n",
      authorKind: "user",
      authorLabel: null,
      now: "2026-08-01T00:00:00.000Z",
    });

    expect(recorded.revisionId).toBe("rev-new");
    expect(createRevision).toHaveBeenCalledWith(expect.objectContaining({
      teamStableId: "development",
      memberSlug: "dev-manager",
      content: "# 开发经理\n\n负责实现。\n",
      authorKind: "user",
      summaryStatus: "pending",
    }));
    // The summary job was dispatched (fire-and-forget) with the revision id.
    expect(summarize).toHaveBeenCalledWith(expect.objectContaining({
      revisionId: "rev-new",
      teamStableId: "development",
      memberSlug: "dev-manager",
    }));
  });

  it("reuses the previous revision's content and ownership when planning", async () => {
    const previous = revision({
      revisionId: "rev-1",
      content: "# 开发经理\n\n负责实现。\n",
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
    });
    const listRevisions = vi.fn().mockResolvedValue([previous]);
    const createRevision = vi.fn().mockResolvedValue(revision({ revisionId: "rev-2" }));
    const summarize = vi.fn().mockResolvedValue(undefined);
    const service = createAgentRevisionService({ store: { listRevisions, createRevision }, summarize });

    await service.recordMemberRevision({
      teamStableId: "development",
      memberSlug: "dev-manager",
      content: "# 开发经理\n\n负责实现与验证。\n",
      authorKind: "user",
      authorLabel: null,
      now: "2026-08-02T00:00:00.000Z",
    });

    expect(createRevision).toHaveBeenCalledWith(expect.objectContaining({
      content: "# 开发经理\n\n负责实现与验证。\n",
      blockOwnership: expect.arrayContaining([
        expect.objectContaining({ blockIndex: 0, authorKind: "user", timeLabel: "2026-08-01T00:00:00.000Z" }),
        expect.objectContaining({ blockIndex: 1, authorKind: "user", timeLabel: "2026-08-02T00:00:00.000Z", previousText: "负责实现。\n" }),
      ]),
    }));
  });

  it("a failed summary dispatch never rejects the save path", async () => {
    const listRevisions = vi.fn().mockResolvedValue([]);
    const createRevision = vi.fn().mockResolvedValue(revision({ revisionId: "rev-1" }));
    const summarize = vi.fn().mockRejectedValue(new Error("boom"));
    const service = createAgentRevisionService({ store: { listRevisions, createRevision }, summarize });

    await expect(service.recordMemberRevision({
      teamStableId: "development",
      memberSlug: "dev-manager",
      content: "# 开发经理\n",
      authorKind: "user",
      authorLabel: null,
      now: "2026-08-03T00:00:00.000Z",
    })).resolves.toBeDefined();
  });
});

describe("createAgentRevisionSummaryJob", () => {
  const oneShot: AgentRevisionOneShotPort = {
    run: vi.fn().mockResolvedValue({ ok: true, text: "把返工上限从三轮改成两轮" }),
  };
  const configStore = { read: vi.fn().mockResolvedValue({ schemaVersion: 1, profile: null }) };
  const store = {
    getRevision: vi.fn(),
    updateSummary: vi.fn().mockImplementation(async (_id, summary, summaryStatus) =>
      revision({ summary, summaryStatus })),
  };

  it("writes a ready summary when the one-shot call succeeds", async () => {
    const job = createAgentRevisionSummaryJob({
      store,
      configStore,
      oneShot,
      runDirRoot: "/tmp/summaries",
    });
    await job({
      revisionId: "rev-1",
      teamStableId: "development",
      memberSlug: "dev-manager",
      previousContent: "# 开发经理\n\n三轮。\n",
      content: "# 开发经理\n\n两轮。\n",
    });
    expect(store.updateSummary).toHaveBeenLastCalledWith(
      "rev-1",
      "把返工上限从三轮改成两轮",
      "ready",
    );
  });

  it("downgrades to unavailable without retrying when the provider call fails", async () => {
    const failingOneShot: AgentRevisionOneShotPort = {
      run: vi.fn().mockResolvedValue({ ok: false, reason: "no-login" }),
    };
    const job = createAgentRevisionSummaryJob({
      store,
      configStore,
      oneShot: failingOneShot,
      runDirRoot: "/tmp/summaries",
    });
    await job({
      revisionId: "rev-1",
      teamStableId: "development",
      memberSlug: "dev-manager",
      previousContent: null,
      content: "# 开发经理\n",
    });
    expect(failingOneShot.run).toHaveBeenCalledTimes(1);
    expect(store.updateSummary).toHaveBeenLastCalledWith("rev-1", null, "unavailable");
  });

  it("downgrades to unavailable when the config store itself is broken", async () => {
    const untouchedOneShot: AgentRevisionOneShotPort = {
      run: vi.fn().mockResolvedValue({ ok: true, text: "不会到达" }),
    };
    const brokenConfig = { read: vi.fn().mockRejectedValue(new Error("config unreadable")) };
    const job = createAgentRevisionSummaryJob({
      store,
      configStore: brokenConfig,
      oneShot: untouchedOneShot,
      runDirRoot: "/tmp/summaries",
    });
    await job({
      revisionId: "rev-1",
      teamStableId: "development",
      memberSlug: "dev-manager",
      previousContent: null,
      content: "# 开发经理\n",
    });
    expect(untouchedOneShot.run).not.toHaveBeenCalled();
    expect(store.updateSummary).toHaveBeenLastCalledWith("rev-1", null, "unavailable");
  });

  it("downgrades to unavailable when the provider returns no usable text", async () => {
    const emptyOneShot: AgentRevisionOneShotPort = {
      run: vi.fn().mockResolvedValue({ ok: true, text: "   \n " }),
    };
    const job = createAgentRevisionSummaryJob({
      store,
      configStore,
      oneShot: emptyOneShot,
      runDirRoot: "/tmp/summaries",
    });
    await job({
      revisionId: "rev-1",
      teamStableId: "development",
      memberSlug: "dev-manager",
      previousContent: null,
      content: "# 开发经理\n",
    });
    expect(store.updateSummary).toHaveBeenLastCalledWith("rev-1", null, "unavailable");
  });
});

describe("buildSummaryPrompt / summarizeResultText", () => {
  it("asks for one plain-language sentence and gives both full texts", () => {
    const prompt = buildSummaryPrompt({
      revisionId: "rev-1",
      teamStableId: "development",
      memberSlug: "dev-manager",
      previousContent: "旧内容",
      content: "新内容",
    });
    expect(prompt).toContain("修改前");
    expect(prompt).toContain("旧内容");
    expect(prompt).toContain("修改后");
    expect(prompt).toContain("新内容");
  });

  it("collapses whitespace and truncates overlong summaries", () => {
    expect(summarizeResultText("  一句\n  话  ", 100)).toBe("一句 话");
    expect(summarizeResultText("很长".repeat(200), 10)).toHaveLength(11); // 10 chars + ellipsis
  });
});
