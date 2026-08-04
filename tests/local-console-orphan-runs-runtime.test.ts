import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { createSqliteLocalConsoleStore } from "../src/local-console/store.js";
import { LocalConsoleRuntime } from "../src/local-console/runtime.js";
import type { CodexRunOptions, CodexRunResult } from "../src/codex.js";
import { LOCAL_CONSOLE_DEFAULT_SESSION_ID } from "../src/local-console/types.js";
import { ORPHAN_RUN_STUCK_REASON } from "../src/local-console/orphan-runs.js";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});

async function makeRoot(): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "moebius-orphan-runs-"));
  roots.push(root);
  return root;
}

async function runCodexUnexpected(_options: CodexRunOptions): Promise<CodexRunResult> {
  throw new Error("runCodex should not be invoked by init() catch-up");
}

describe("runtime startup catch-up: orphan run reconciliation", () => {
  it("coalesces concurrent close calls behind managed cleanup", async () => {
    const root = await makeRoot();
    const store = await createSqliteLocalConsoleStore({ sqlitePath: path.join(root, ".state", "local-console.sqlite") });
    let releaseCleanup!: () => void;
    const cleanupGate = new Promise<void>((resolve) => { releaseCleanup = resolve; });
    let cleanupCalls = 0;
    const runtime = new LocalConsoleRuntime({
      store,
      listAgentFiles: async () => [],
      runCodex: runCodexUnexpected,
      makeRunDir: (count) => path.join(root, "runs", String(count)),
      projectRoot: root,
      workdirRoot: path.join(root, "workdir"),
      beforeStoreClose: async () => {
        cleanupCalls += 1;
        await cleanupGate;
      },
    });
    await runtime.init();

    const first = runtime.close();
    const second = runtime.close();
    await Promise.resolve();
    expect(cleanupCalls).toBe(1);
    releaseCleanup();
    await Promise.all([first, second]);
    expect(cleanupCalls).toBe(1);
  });

  it("重启后遗留的 running 消息被落成 stuck 并释放 cursor", async () => {
    const root = await makeRoot();
    const sqlitePath = path.join(root, ".state", "local-console.sqlite");

    // 上一进程:留下一条 running 消息(SQLite 状态矛盾:已 claim 但没落终态)
    const priorStore = await createSqliteLocalConsoleStore({ sqlitePath });
    await priorStore.init();
    const user = await priorStore.appendUserMessage({
      sessionId: LOCAL_CONSOLE_DEFAULT_SESSION_ID,
      body: "@dev implement",
      now: "2026-07-23T00:00:00.000Z",
    });
    await priorStore.claimNextPendingMessage({
      sessionId: LOCAL_CONSOLE_DEFAULT_SESSION_ID,
      runId: "orphan-run-1",
      now: "2026-07-23T00:00:01.000Z",
    });
    expect(await priorStore.hasRunningMessage(LOCAL_CONSOLE_DEFAULT_SESSION_ID)).toBe(true);
    await priorStore.close();

    // 新进程:同一 sqlite 打开,新建 runtime 调 init()
    const store = await createSqliteLocalConsoleStore({ sqlitePath });
    const runtime = new LocalConsoleRuntime({
      store,
      listAgentFiles: async () => [],
      runCodex: runCodexUnexpected,
      makeRunDir: (count) => path.join(root, "runs", String(count)),
      projectRoot: root,
      workdirRoot: path.join(root, "workdir"),
      now: () => new Date("2026-07-23T00:05:00.000Z"),
    });
    try {
      await runtime.init();

      // 断言:原用户消息不再 running
      const messages = await store.listMessages(LOCAL_CONSOLE_DEFAULT_SESSION_ID);
      const userMessage = messages.find((m) => m.id === user.id);
      expect(userMessage?.status).toBe("stuck");

      // 断言:追加了一条可见的系统事件(run-stuck),reason 含 orphaned-by-restart
      const stuckSystemRecord = messages.find(
        (m) => m.speaker === "system" && m.systemEventKind === "run-stuck" && m.runId === "orphan-run-1",
      );
      expect(stuckSystemRecord).toBeDefined();
      expect(stuckSystemRecord?.error ?? "").toContain(ORPHAN_RUN_STUCK_REASON);

      // 断言:session cursor 已释放(不再有 running 消息)
      expect(await store.hasRunningMessage(LOCAL_CONSOLE_DEFAULT_SESSION_ID)).toBe(false);
    } finally {
      await runtime.close();
    }
  });

  it("孤儿清算幂等:已 stuck 的消息不重复写系统记录", async () => {
    const root = await makeRoot();
    const sqlitePath = path.join(root, ".state", "local-console.sqlite");

    const priorStore = await createSqliteLocalConsoleStore({ sqlitePath });
    await priorStore.init();
    await priorStore.appendUserMessage({
      sessionId: LOCAL_CONSOLE_DEFAULT_SESSION_ID,
      body: "@dev implement",
      now: "2026-07-23T00:00:00.000Z",
    });
    await priorStore.claimNextPendingMessage({
      sessionId: LOCAL_CONSOLE_DEFAULT_SESSION_ID,
      runId: "orphan-run-2",
      now: "2026-07-23T00:00:01.000Z",
    });
    await priorStore.close();

    const store = await createSqliteLocalConsoleStore({ sqlitePath });
    const buildRuntime = () =>
      new LocalConsoleRuntime({
        store,
        listAgentFiles: async () => [],
        runCodex: runCodexUnexpected,
        makeRunDir: (count) => path.join(root, "runs", String(count)),
        projectRoot: root,
        workdirRoot: path.join(root, "workdir"),
        now: () => new Date("2026-07-23T00:05:00.000Z"),
      });

    // 第一次 init:孤儿被落 stuck,追加一条 run-stuck 系统记录
    const runtimeA = buildRuntime();
    await runtimeA.init();
    const afterFirst = await store.listMessages(LOCAL_CONSOLE_DEFAULT_SESSION_ID);
    const firstStuckCount = afterFirst.filter(
      (m) => m.speaker === "system" && m.systemEventKind === "run-stuck",
    ).length;
    expect(firstStuckCount).toBe(1);
    await runtimeA.close();

    // 第二次 init:所有消息都不是 running 了,不应再追加系统记录
    const runtimeB = buildRuntime();
    await runtimeB.init();
    const afterSecond = await store.listMessages(LOCAL_CONSOLE_DEFAULT_SESSION_ID);
    const secondStuckCount = afterSecond.filter(
      (m) => m.speaker === "system" && m.systemEventKind === "run-stuck",
    ).length;
    expect(secondStuckCount).toBe(1);
    await runtimeB.close();
  });
});
