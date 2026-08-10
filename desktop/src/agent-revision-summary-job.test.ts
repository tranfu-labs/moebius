import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createAgentRevisionSummaryJob } from "./agent-revision-summary-job.js";

const tempRoots: string[] = [];

async function tempRunDir(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "moebius-revision-summary-job-"));
  tempRoots.push(dir);
  return dir;
}

afterEach(async () => {
  await Promise.all(tempRoots.splice(0).map((dir) =>
    fs.rm(dir, { recursive: true, force: true })));
});

function jobInput(overrides: Partial<{
  revisionId: string;
  teamStableId: string;
  memberSlug: string;
  previousContent: string | null;
  content: string;
}> = {}) {
  return {
    revisionId: "rev-1",
    teamStableId: "development",
    memberSlug: "dev-manager",
    previousContent: null,
    content: "# 开发经理\n\n负责技术决策与质量把关。\n",
    ...overrides,
  };
}

describe("agent revision summary job", () => {
  const settledCreatedAt = "2026-08-01T00:00:00.000Z";

  it("notifies the settled port once with the member identity and revision timestamp after a ready terminal state", async () => {
    const onSettled = vi.fn();
    const updateSummary = vi.fn().mockResolvedValue({ createdAt: settledCreatedAt });
    const job = createAgentRevisionSummaryJob({
      store: {
        getRevision: vi.fn(),
        updateSummary,
      },
      configStore: { read: vi.fn().mockResolvedValue({ schemaVersion: 1, profile: null }) },
      oneShot: { run: vi.fn().mockResolvedValue({ ok: true, text: "你把验收标准改成真机证据为准。" }) },
      runDirRoot: await tempRunDir(),
      onSettled,
    });

    await job(jobInput());

    expect(updateSummary).toHaveBeenCalledWith("rev-1", "你把验收标准改成真机证据为准。", "ready");
    expect(onSettled).toHaveBeenCalledTimes(1);
    expect(onSettled).toHaveBeenCalledWith({
      revisionId: "rev-1",
      teamStableId: "development",
      memberSlug: "dev-manager",
      createdAt: settledCreatedAt,
    });
  });

  it("notifies the settled port with the revision timestamp after an unavailable downgrade (no provider result)", async () => {
    const onSettled = vi.fn();
    const updateSummary = vi.fn().mockResolvedValue({ createdAt: settledCreatedAt });
    const job = createAgentRevisionSummaryJob({
      store: {
        getRevision: vi.fn(),
        updateSummary,
      },
      configStore: { read: vi.fn().mockResolvedValue({ schemaVersion: 1, profile: null }) },
      oneShot: { run: vi.fn().mockResolvedValue({ ok: false, reason: "cli-unavailable" }) },
      runDirRoot: await tempRunDir(),
      onSettled,
    });

    await job(jobInput());

    expect(updateSummary).toHaveBeenCalledWith("rev-1", null, "unavailable");
    expect(onSettled).toHaveBeenCalledTimes(1);
    expect(onSettled).toHaveBeenCalledWith({
      revisionId: "rev-1",
      teamStableId: "development",
      memberSlug: "dev-manager",
      createdAt: settledCreatedAt,
    });
  });

  it("notifies the settled port once when the job itself throws", async () => {
    const onSettled = vi.fn();
    const job = createAgentRevisionSummaryJob({
      store: {
        getRevision: vi.fn(),
        updateSummary: vi.fn().mockResolvedValue({ createdAt: settledCreatedAt }),
      },
      configStore: { read: vi.fn().mockRejectedValue(new Error("config unreadable")) },
      oneShot: { run: vi.fn() },
      runDirRoot: await tempRunDir(),
      onSettled,
    });

    await job(jobInput());

    expect(onSettled).toHaveBeenCalledTimes(1);
    expect(onSettled).toHaveBeenCalledWith({
      revisionId: "rev-1",
      teamStableId: "development",
      memberSlug: "dev-manager",
      createdAt: settledCreatedAt,
    });
  });
});
