import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";

import { createSqliteLocalConsoleStore } from "../src/local-console/store.js";
import { projectRoundStates } from "../src/local-console/round-state-projection.js";
import type { LocalConsoleProjectSummary } from "../src/local-console/types.js";

const T0 = "2026-08-10T09:00:00.000Z";

async function makeFixtureRoot(): Promise<string> {
  return await fs.mkdtemp(path.join(os.tmpdir(), "moebius-round-facts-"));
}

function sessionProject(sessionId: string, updatedAt = T0): LocalConsoleProjectSummary {
  return {
    projectId: "p",
    sourceType: "local-folder",
    title: "p",
    folderPath: "/tmp/p",
    worktreeMode: false,
    workspaceCwd: "/tmp/p",
    workspaceMode: "direct",
    worktreePath: null,
    worktreeUnavailableReason: null,
    workspaceUpdatedAt: T0,
    sessions: [{
      sessionId,
      projectId: "p",
      title: "T",
      status: "idle",
      awaitsHumanReason: null,
      unreadSince: null,
      workspaceMode: "direct",
      workspacePendingMode: null,
      runningCount: 0,
      waitingCount: 0,
      stuckCount: 0,
      errorCount: 0,
      interruptedCount: 0,
      createdAt: T0,
      updatedAt,
    }],
    runningCount: 0,
    waitingCount: 0,
    stuckCount: 0,
    errorCount: 0,
  };
}

describe("local console round fact SQLite projection", () => {
  it("persists round terminal and primary closeout through the store and reads them back", async () => {
    const root = await makeFixtureRoot();
    const store = await createSqliteLocalConsoleStore({
      sqlitePath: path.join(root, ".state", "local-console.sqlite"),
      sessionLogRoot: path.join(root, "sessions"),
    });
    await store.init();
    const sessionId = "local:round-index";
    try {
      await store.createSession({ sessionId, title: "round", now: T0 });
      await store.recordRoundTerminal!({
        sessionId,
        roundId: 1,
        outcome: "completed",
        terminalMessageId: 7,
        conversationTitle: "round title",
        occurredAt: T0,
      });
      await store.recordPrimaryCloseout!({
        sessionId,
        messageId: 7,
        role: "dev",
        occurredAt: T0,
      });

      const facts = await store.readRoundFacts!(sessionId);
      expect(facts.lastRoundFact).toMatchObject({
        roundId: 1,
        outcome: "completed",
        terminalMessageId: 7,
        conversationTitle: "round title",
        occurredAt: T0,
        sessionId,
      });
      expect(facts.lastPrimaryCloseout).toMatchObject({ messageId: 7, role: "dev", occurredAt: T0 });
    } finally {
      await store.close();
    }
  });

  it("keeps the round projection after restart without re-scanning the log", async () => {
    const root = await makeFixtureRoot();
    const sqlitePath = path.join(root, ".state", "local-console.sqlite");
    const sessionLogRoot = path.join(root, "sessions");
    const sessionId = "local:round-restart";
    let store = await createSqliteLocalConsoleStore({ sqlitePath, sessionLogRoot });
    await store.init();
    try {
      await store.createSession({ sessionId, title: "round", now: T0 });
      await store.recordRoundTerminal!({
        sessionId,
        roundId: 2,
        outcome: "awaiting-user",
        terminalMessageId: null,
        conversationTitle: "round title",
        occurredAt: T0,
      });
    } finally {
      await store.close();
    }

    store = await createSqliteLocalConsoleStore({ sqlitePath, sessionLogRoot });
    await store.init();
    try {
      const facts = await store.readRoundFacts!(sessionId);
      expect(facts.lastRoundFact).toMatchObject({ roundId: 2, outcome: "awaiting-user" });
    } finally {
      await store.close();
    }
  });

  it("idempotently ignores the same round fact and fails on a conflicting one", async () => {
    const root = await makeFixtureRoot();
    const store = await createSqliteLocalConsoleStore({
      sqlitePath: path.join(root, ".state", "local-console.sqlite"),
      sessionLogRoot: path.join(root, "sessions"),
    });
    await store.init();
    const sessionId = "local:round-conflict";
    try {
      await store.createSession({ sessionId, title: "round", now: T0 });
      await store.recordRoundTerminal!({
        sessionId,
        roundId: 1,
        outcome: "completed",
        terminalMessageId: null,
        conversationTitle: "t",
        occurredAt: T0,
      });
      await expect(store.recordRoundTerminal!({
        sessionId,
        roundId: 1,
        outcome: "completed",
        terminalMessageId: null,
        conversationTitle: "t",
        occurredAt: T0,
      })).resolves.toBeUndefined();
      await expect(store.recordRoundTerminal!({
        sessionId,
        roundId: 1,
        outcome: "silent-closeout",
        terminalMessageId: null,
        conversationTitle: "t",
        occurredAt: T0,
      })).rejects.toThrow(/conflicting round_terminal fact/u);
      const facts = await store.readRoundFacts!(sessionId);
      expect(facts.lastRoundFact?.outcome).toBe("completed");
    } finally {
      await store.close();
    }
  });

  it("falls back to the fact log and lazily rebuilds the index when the checkpoint is stale", async () => {
    const root = await makeFixtureRoot();
    const sqlitePath = path.join(root, ".state", "local-console.sqlite");
    const sessionLogRoot = path.join(root, "sessions");
    const sessionId = "local:round-stale";
    let store = await createSqliteLocalConsoleStore({ sqlitePath, sessionLogRoot });
    await store.init();
    try {
      await store.createSession({ sessionId, title: "round", now: T0 });
      await store.recordRoundTerminal!({
        sessionId,
        roundId: 3,
        outcome: "no-new-content",
        terminalMessageId: null,
        conversationTitle: "t",
        occurredAt: T0,
      });
    } finally {
      await store.close();
    }

    // 模拟旧版数据库：检查点没有轮次索引（round_fact_count = -1），SQLite 表为空。
    const { DatabaseSync } = await import("node:sqlite");
    const database = new DatabaseSync(sqlitePath);
    try {
      database.exec("DELETE FROM local_round_facts");
      database.exec("DELETE FROM local_primary_closeouts");
      database.exec(
        "UPDATE local_session_fact_checkpoints SET round_fact_count = -1, primary_closeout_count = -1",
      );
    } finally {
      database.close();
    }

    store = await createSqliteLocalConsoleStore({ sqlitePath, sessionLogRoot });
    await store.init();
    try {
      const facts = await store.readRoundFacts!(sessionId);
      expect(facts.lastRoundFact).toMatchObject({ roundId: 3, outcome: "no-new-content" });
      // 第二次读取走 SQLite 投影（已重建）。
      const again = await store.readRoundFacts!(sessionId);
      expect(again.lastRoundFact?.roundId).toBe(3);
    } finally {
      await store.close();
    }
  });

  it("rebuilds the round index together with the message index", async () => {
    const root = await makeFixtureRoot();
    const sqlitePath = path.join(root, ".state", "local-console.sqlite");
    const sessionLogRoot = path.join(root, "sessions");
    const sessionId = "local:round-rebuild";
    let store = await createSqliteLocalConsoleStore({ sqlitePath, sessionLogRoot });
    await store.init();
    try {
      await store.createSession({ sessionId, title: "round", now: T0 });
      await store.recordRoundTerminal!({
        sessionId,
        roundId: 4,
        outcome: "silent-closeout",
        terminalMessageId: null,
        conversationTitle: "t",
        occurredAt: T0,
      });
    } finally {
      await store.close();
    }

    store = await createSqliteLocalConsoleStore({ sqlitePath, sessionLogRoot });
    await store.init();
    try {
      await store.rebuildMessageIndex(sessionId);
      const facts = await store.readRoundFacts!(sessionId);
      expect(facts.lastRoundFact).toMatchObject({ roundId: 4, outcome: "silent-closeout" });
    } finally {
      await store.close();
    }
  });

  it("reads the session baseline commit from the log head without parsing the whole log", async () => {
    const root = await makeFixtureRoot();
    const store = await createSqliteLocalConsoleStore({
      sqlitePath: path.join(root, ".state", "local-console.sqlite"),
      sessionLogRoot: path.join(root, "sessions"),
    });
    await store.init();
    const sessionId = "local:baseline-scan";
    try {
      await store.createSession({
        sessionId,
        title: "baseline",
        baselineCommit: "abc123",
        now: T0,
      });
      // 追加大量后续事实，确保读取只依赖日志头部。
      for (let index = 0; index < 50; index += 1) {
        await store.recordProgressEvent({
          sessionId,
          runId: `run-${String(index)}`,
          role: "dev",
          body: `progress ${String(index)}`,
          now: new Date(Date.parse(T0) + index).toISOString(),
        });
      }
      expect(await store.getSessionWorkspace(sessionId)).toMatchObject({ baselineCommit: "abc123" });
      expect(await store.getSessionBaselineCommit!(sessionId)).toBe("abc123");
    } finally {
      await store.close();
    }
  });
});

describe("local console round state projection memo", () => {
  it("reuses the terminal state without re-evaluating unchanged sessions", async () => {
    const scope = "memo-scope-a";
    const evaluateRound = vi.fn(async () => ({
      kind: "terminal" as const,
      roundId: 1,
      fact: { roundId: 1, outcome: "completed" as const, terminalMessageId: null, occurredAt: T0 },
      silentSince: null,
    }));
    const readLastRoundFact = vi.fn(async () => ({
      roundId: 1,
      outcome: "completed" as const,
      terminalMessageId: null,
      occurredAt: T0,
      sessionId: "s",
      conversationTitle: "T",
    }));

    // 已有收束事实且无新活动：首轮就按 planRoundReuse 剪枝，不触发完整评估。
    const first = await projectRoundStates([sessionProject("s")], {
      roundProjectionScope: scope,
      evaluateRound,
      readLastRoundFact,
    } as never);
    expect(first[0]?.sessions[0]?.roundState).toMatchObject({ kind: "terminal", roundId: 1 });
    expect(evaluateRound).toHaveBeenCalledTimes(0);
    expect(readLastRoundFact).toHaveBeenCalledTimes(1);

    // 第二轮命中 memo：不再读事实、不再评估。
    const second = await projectRoundStates([sessionProject("s")], {
      roundProjectionScope: scope,
      evaluateRound,
      readLastRoundFact,
    } as never);
    expect(second[0]?.sessions[0]?.roundState).toMatchObject({ kind: "terminal", roundId: 1 });
    expect(evaluateRound).toHaveBeenCalledTimes(0);
    expect(readLastRoundFact).toHaveBeenCalledTimes(1);
  });

  it("re-evaluates after the silent window elapses for in-progress states", async () => {
    const scope = "memo-scope-b";
    const evaluateRound = vi.fn(async () => ({
      kind: "in-progress" as const,
      roundId: 1,
      fact: null,
      silentSince: T0,
    }));
    const ports = {
      roundProjectionScope: scope,
      evaluateRound,
      readLastRoundFact: vi.fn(async () => null),
    } as never;

    vi.useFakeTimers();
    try {
      vi.setSystemTime(Date.parse(T0));
      const first = await projectRoundStates([sessionProject("s")], ports);
      expect(first[0]?.sessions[0]?.roundState?.kind).toBe("in-progress");
      expect(evaluateRound).toHaveBeenCalledTimes(1);

      // 静默窗口内复用。
      vi.setSystemTime(Date.parse(T0) + 10_000);
      const second = await projectRoundStates([sessionProject("s")], ports);
      expect(second[0]?.sessions[0]?.roundState?.kind).toBe("in-progress");
      expect(evaluateRound).toHaveBeenCalledTimes(1);

      // 窗口过后重评。
      vi.setSystemTime(Date.parse(T0) + 31_000);
      const third = await projectRoundStates([sessionProject("s")], ports);
      expect(third[0]?.sessions[0]?.roundState?.kind).toBe("in-progress");
      expect(evaluateRound).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it("re-evaluates when the session decision inputs change", async () => {
    const scope = "memo-scope-c";
    const evaluateRound = vi.fn(async () => ({
      kind: "in-progress" as const,
      roundId: 1,
      fact: null,
      silentSince: T0,
    }));
    const ports = {
      roundProjectionScope: scope,
      evaluateRound,
      readLastRoundFact: vi.fn(async () => null),
    } as never;

    await projectRoundStates([sessionProject("s", T0)], ports);
    expect(evaluateRound).toHaveBeenCalledTimes(1);
    // updatedAt 变化（新内容活动）→ 决策输入变化 → 重评。
    await projectRoundStates([sessionProject("s", "2026-08-10T09:01:00.000Z")], ports);
    expect(evaluateRound).toHaveBeenCalledTimes(2);
  });

  it("does not share projection state across scopes", async () => {
    const evaluateRound = vi.fn(async () => ({
      kind: "in-progress" as const,
      roundId: 1,
      fact: null,
      silentSince: T0,
    }));
    const readLastRoundFact = vi.fn(async () => null);
    const ports = (scope: string): Parameters<typeof projectRoundStates>[1] => ({
      roundProjectionScope: scope,
      evaluateRound: evaluateRound as never,
      readLastRoundFact: readLastRoundFact as never,
    });

    await projectRoundStates([sessionProject("s")], ports("scope-1"));
    await projectRoundStates([sessionProject("s")], ports("scope-2"));
    expect(evaluateRound).toHaveBeenCalledTimes(2);
  });
});
