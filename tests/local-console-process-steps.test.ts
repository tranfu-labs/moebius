import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";

import { createSqliteLocalConsoleStore } from "../src/local-console/store.js";
import type { LocalConsoleStore } from "../src/local-console/types.js";
import type { LocalRunActivity } from "../src/local-console/run-activity.js";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});

describe("local console message process steps", () => {
  it("freezes the run's steps onto the agent message once at completion and keeps them after restart", async () => {
    const { store, sqlitePath } = await fixtureStore();
    const sessionId = "local:steps";
    await store.createSession({ sessionId, title: "steps", now: "2026-08-01T00:00:00.000Z" });
    const source = await store.appendUserMessage({
      sessionId,
      body: "做一件事",
      now: "2026-08-01T00:00:01.000Z",
    });
    await store.claimNextPendingMessage({
      sessionId,
      runId: "run-steps",
      now: "2026-08-01T00:00:02.000Z",
    });
    const processSteps: readonly LocalRunActivity[] = [
      { cursor: 1, kind: "thinking", phase: "completed", action: "正在思考", object: null, occurredAt: "2026-08-01T00:00:03.000Z" },
      { cursor: 2, kind: "tool", phase: "completed", action: "已完成使用工具", object: "read_file", occurredAt: "2026-08-01T00:00:04.000Z" },
      { cursor: 3, kind: "command", phase: "running", action: "正在运行命令", object: "pnpm test", occurredAt: "2026-08-01T00:00:05.000Z" },
    ];
    await store.recordAgentResponse({
      userMessageId: source.id,
      sessionId,
      role: "dev",
      body: "完成了。",
      runId: "run-steps",
      runDir: "run-steps-dir",
      processSteps,
      now: "2026-08-01T00:00:06.000Z",
    });

    const agentMessage = (await store.listMessages(sessionId)).find((message) => message.speaker === "agent");
    expect(agentMessage?.processSteps).toEqual(processSteps);
    await store.close();

    const reopened = await createSqliteLocalConsoleStore({ sqlitePath });
    await reopened.init();
    const replayed = (await reopened.listMessages(sessionId)).find((message) => message.speaker === "agent");
    expect(replayed?.processSteps).toEqual(processSteps);
    await reopened.close();

    const database = new DatabaseSync(sqlitePath, { readOnly: true });
    try {
      const row = database.prepare(
        "SELECT process_steps_json FROM session_messages WHERE session_id = ? AND speaker = 'agent'",
      ).get(sessionId) as { process_steps_json: string };
      expect(JSON.parse(row.process_steps_json)).toEqual([...processSteps]);
    } finally {
      database.close();
    }
  });

  it("carries the run's member role and steps on terminal records, and leaves run-less notifications unowned", async () => {
    const { store, sqlitePath } = await fixtureStore();
    const sessionId = "local:terminal-role";
    await store.createSession({ sessionId, title: "terminal role", now: "2026-08-01T01:00:00.000Z" });
    const source = await store.appendUserMessage({
      sessionId,
      body: "跑一次",
      now: "2026-08-01T01:00:01.000Z",
    });
    await store.claimNextPendingMessage({
      sessionId,
      runId: "run-failed",
      now: "2026-08-01T01:00:02.000Z",
    });
    const processSteps: readonly LocalRunActivity[] = [
      { cursor: 1, kind: "tool", phase: "completed", action: "已完成使用工具", object: "edit_file", occurredAt: "2026-08-01T01:00:03.000Z" },
    ];
    await store.recordFailure({
      userMessageId: source.id,
      sessionId,
      error: "exit 1",
      runId: "run-failed",
      runDir: null,
      role: "dev",
      processSteps,
      now: "2026-08-01T01:00:04.000Z",
    });
    await store.recordSystemMessage({
      sessionId,
      body: "上下文已经更新。",
      runId: null,
      runDir: null,
      error: null,
      role: null,
      processSteps: [],
      now: "2026-08-01T01:00:05.000Z",
    });

    const terminal = (await store.listMessages(sessionId)).find((message) =>
      message.speaker === "system" && message.systemEventKind === "run-not-started");
    expect(terminal).toMatchObject({ role: "dev" });
    expect(terminal?.processSteps).toEqual(processSteps);
    const neutral = (await store.listMessages(sessionId)).find((message) => message.body === "上下文已经更新。");
    expect(neutral?.role).toBeNull();
    expect(neutral?.processSteps ?? []).toEqual([]);
    await store.close();

    const reopened = await createSqliteLocalConsoleStore({ sqlitePath });
    await reopened.init();
    const replayedTerminal = (await reopened.listMessages(sessionId)).find((message) =>
      message.speaker === "system" && message.systemEventKind === "run-not-started");
    expect(replayedTerminal).toMatchObject({ role: "dev" });
    expect(replayedTerminal?.processSteps).toEqual(processSteps);
    await reopened.close();
  });

  it("keeps live activity facts out of the message until a terminal write freezes steps", async () => {
    const { store } = await fixtureStore();
    const sessionId = "local:live-steps";
    await store.createSession({ sessionId, title: "live steps", now: "2026-08-01T02:00:00.000Z" });
    const source = await store.appendUserMessage({
      sessionId,
      body: "边跑边看",
      now: "2026-08-01T02:00:01.000Z",
    });
    await store.claimNextPendingMessage({
      sessionId,
      runId: "run-live",
      now: "2026-08-01T02:00:02.000Z",
    });
    await store.recordRunActivityEvent!({
      sessionId,
      runId: "run-live",
      activity: { cursor: 1, kind: "tool", phase: "running", action: "正在使用工具", object: "read_file", occurredAt: "2026-08-01T02:00:03.000Z" },
    });

    // The live activity is a separate fact; no message upsert carries it yet.
    const before = (await store.listMessages(sessionId)).find((message) => message.speaker === "user");
    expect(before?.processSteps ?? []).toEqual([]);
    await store.recordAgentResponse({
      userMessageId: source.id,
      sessionId,
      role: "dev",
      body: "跑完了。",
      runId: "run-live",
      runDir: "run-live-dir",
      processSteps: [],
      now: "2026-08-01T02:00:04.000Z",
    });
    const after = (await store.listMessages(sessionId)).find((message) => message.speaker === "agent");
    // No frozen steps were passed, so the agent message stays trail-less; the
    // live trail continues to come from the active-run snapshot instead.
    expect(after?.processSteps ?? []).toEqual([]);
    await store.close();
  });
});

async function fixtureStore(): Promise<{ store: LocalConsoleStore; sqlitePath: string }> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "moebius-process-steps-"));
  roots.push(root);
  const sqlitePath = path.join(root, ".state", "local-console.sqlite");
  const store = await createSqliteLocalConsoleStore({ sqlitePath });
  await store.init();
  return { store, sqlitePath };
}
