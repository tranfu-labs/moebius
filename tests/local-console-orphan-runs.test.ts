import { describe, expect, it } from "vitest";

import {
  ORPHAN_RUN_STUCK_REASON,
  identifyOrphanRuns,
  type OrphanRunInputMessage,
} from "../src/local-console/orphan-runs.js";

function msg(overrides: Partial<OrphanRunInputMessage> & Pick<OrphanRunInputMessage, "id" | "status">): OrphanRunInputMessage {
  return {
    runId: null,
    runDir: null,
    role: null,
    dispatchRole: null,
    ...overrides,
  };
}

describe("identifyOrphanRuns", () => {
  it("在会话没有对应 activeRun 时把 running 消息判为孤儿", () => {
    const orphans = identifyOrphanRuns({
      sessionId: "s1",
      messages: [msg({ id: 42, status: "running", runId: "r-42", runDir: "/tmp/r-42" })],
      activeSessionIds: new Set<string>(),
    });
    expect(orphans).toEqual([{ userMessageId: 42, runId: "r-42", runDir: "/tmp/r-42", role: null }]);
  });

  it("当前进程正在持有该 session 的 activeRun 时不判为孤儿", () => {
    const orphans = identifyOrphanRuns({
      sessionId: "s1",
      messages: [msg({ id: 42, status: "running" })],
      activeSessionIds: new Set(["s1"]),
    });
    expect(orphans).toEqual([]);
  });

  it("对 stuck / failed / interrupted / completed / pending 幂等跳过", () => {
    const orphans = identifyOrphanRuns({
      sessionId: "s1",
      messages: [
        msg({ id: 1, status: "stuck" }),
        msg({ id: 2, status: "failed" }),
        msg({ id: 3, status: "interrupted" }),
        msg({ id: 4, status: "completed" }),
        msg({ id: 5, status: "pending" }),
        msg({ id: 6, status: "displayed" }),
      ],
      activeSessionIds: new Set<string>(),
    });
    expect(orphans).toEqual([]);
  });

  it("多条 running 混合 non-running 时,只捞 running", () => {
    const orphans = identifyOrphanRuns({
      sessionId: "s1",
      messages: [
        msg({ id: 1, status: "completed" }),
        msg({ id: 7, status: "running", runId: "r-7" }),
        msg({ id: 9, status: "running", runId: null, runDir: null }),
        msg({ id: 10, status: "stuck" }),
      ],
      activeSessionIds: new Set<string>(),
    });
    expect(orphans).toEqual([
      { userMessageId: 7, runId: "r-7", runDir: null, role: null },
      { userMessageId: 9, runId: null, runDir: null, role: null },
    ]);
  });

  it("消息列表为空时返回空", () => {
    expect(
      identifyOrphanRuns({
        sessionId: "s1",
        messages: [],
        activeSessionIds: new Set<string>(),
      }),
    ).toEqual([]);
  });

  it("暴露 stuck 原因常量", () => {
    expect(ORPHAN_RUN_STUCK_REASON).toBe("orphaned-by-restart");
  });
});
