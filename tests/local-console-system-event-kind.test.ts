import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";

import { createSqliteLocalConsoleStore } from "../src/local-console/store.js";
import type { LocalConsoleStore } from "../src/local-console/types.js";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});

describe("local console persisted system event kinds", () => {
  it("persists every terminal fact and defaults neutral records to other", async () => {
    const { store } = await fixtureStore();
    try {
      await recordTerminal(store, "failed", (input) => store.recordFailure({ ...input, error: "exit 1" }));
      await recordTerminal(store, "retryable", (input) => store.recordRetryableFailure({ ...input, error: "exit 2" }));
      await recordTerminal(store, "stuck", (input) => store.recordStuck({ ...input, reason: "idle" }));
      await recordTerminal(store, "stopped", (input) => store.recordInterrupted({ ...input, reason: "user-stop", interruptionKind: "user" }));
      await recordTerminal(store, "dead-letter", (input) => store.recordDeadLetter({ ...input, error: "again", failureCount: 5 }));
      await store.recordSystemMessage({
        sessionId: "local:neutral",
        body: "上下文已经更新。",
        runId: null,
        runDir: null,
        error: null,
        now: "2026-07-22T00:10:00.000Z",
      });

      const systemMessages = (await Promise.all(
        ["failed", "retryable", "stuck", "stopped", "dead-letter", "neutral"]
          .map((name) => store.listMessages(`local:${name}`)),
      )).flat().filter((message) => message.speaker === "system");
      expect(systemMessages.map((message) => message.systemEventKind)).toEqual([
        "run-not-started",
        "run-not-started",
        "run-stuck",
        "user-stopped",
        "retry-exhausted",
        "other",
      ]);
      expect(systemMessages.every((message) => message.systemEventKind !== null)).toBe(true);
    } finally {
      await store.close();
    }
  });

  it("clears legacy attention values, maps old system rows to neutral, preserves unbound legacy sessions, and is idempotent", async () => {
    const { store, sqlitePath } = await fixtureStore();
    for (const [index, reason] of ["exception", "answer", "confirmation", "acceptance"].entries()) {
      await store.createSession({
        sessionId: `local:legacy-${String(index)}`,
        title: `legacy ${reason}`,
        now: `2026-07-22T00:0${String(index)}:00.000Z`,
      });
    }
    await store.recordSystemMessage({
      sessionId: "local:legacy-0",
      body: "旧系统记录",
      runId: null,
      runDir: null,
      error: null,
      now: "2026-07-22T00:05:00.000Z",
    });
    await store.close();

    const database = new DatabaseSync(sqlitePath);
    try {
      for (const [index, reason] of ["exception", "answer", "confirmation", "acceptance"].entries()) {
        database.prepare(
          "UPDATE sessions SET awaits_human_reason = ?, agent_team_ownership = NULL, agent_team_id = NULL WHERE session_id = ?",
        ).run(reason, `local:legacy-${String(index)}`);
      }
    } finally {
      database.close();
    }

    for (let pass = 0; pass < 2; pass += 1) {
      const reopened = await createSqliteLocalConsoleStore({ sqlitePath });
      await reopened.init();
      const legacy = (await reopened.listSessions()).filter((session) => session.sessionId.startsWith("local:legacy-"));
      expect(legacy).toHaveLength(4);
      expect(legacy.every((session) => session.awaitsHumanReason === null)).toBe(true);
      expect(legacy.every((session) => session.agentTeamOwnership === null && session.agentTeamId === null)).toBe(true);
      expect((await reopened.listMessages("local:legacy-0")).find((message) => message.speaker === "system"))
        .toMatchObject({ systemEventKind: "other" });
      await reopened.close();
    }
  });

  it("upgrades the legacy CHECK constraint before rebuilding resume-unavailable facts", async () => {
    const { store, sqlitePath } = await fixtureStore();
    const sessionId = "local:legacy-resume-unavailable";
    await store.createSession({
      sessionId,
      title: "legacy resume unavailable",
      now: "2026-07-27T00:00:00.000Z",
    });
    const userMessage = await store.appendUserMessage({
      sessionId,
      body: "继续原执行",
      now: "2026-07-27T00:00:01.000Z",
    });
    await store.claimNextPendingMessage({
      sessionId,
      runId: "run-legacy-resume",
      now: "2026-07-27T00:00:02.000Z",
    });
    await store.recordFailure({
      userMessageId: userMessage.id,
      sessionId,
      error: "resume-unavailable:session-link-conflict",
      body: "原执行已经无法继续。",
      systemEventKind: "other",
      runId: "run-legacy-resume",
      runDir: null,
      now: "2026-07-27T00:00:03.000Z",
    });
    await store.close();

    const legacyDatabase = new DatabaseSync(sqlitePath);
    try {
      legacyDatabase.prepare(
        `INSERT INTO local_attachment_blobs
          (blob_id, kind, display_name, media_type, byte_size, sha256, storage_key, created_at)
         VALUES (?, 'file', 'evidence.txt', 'text/plain', 4, ?, ?, ?)`,
      ).run("blob-legacy-resume", "sha256-legacy-resume", "legacy/resume/evidence.txt", "2026-07-27T00:00:04.000Z");
      legacyDatabase.prepare(
        `INSERT INTO local_attachment_refs
          (attachment_id, blob_id, draft_key, message_id, position, created_at, updated_at)
         VALUES (?, ?, NULL, ?, 0, ?, ?)`,
      ).run(
        "attachment-legacy-resume",
        "blob-legacy-resume",
        userMessage.id,
        "2026-07-27T00:00:04.000Z",
        "2026-07-27T00:00:04.000Z",
      );
    } finally {
      legacyDatabase.close();
    }
    rewriteSessionMessagesWithLegacyCheck(sqlitePath);

    for (let pass = 0; pass < 2; pass += 1) {
      const reopened = await createSqliteLocalConsoleStore({ sqlitePath });
      await reopened.init();
      await expect(reopened.listMessages(sessionId)).resolves.toContainEqual(
        expect.objectContaining({
          speaker: "system",
          error: "resume-unavailable:session-link-conflict",
          systemEventKind: "resume-unavailable",
        }),
      );
      await reopened.close();
    }

    const database = new DatabaseSync(sqlitePath, { readOnly: true });
    try {
      const schema = database
        .prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'session_messages'")
        .get() as { sql: string };
      expect(schema.sql).toContain("'resume-unavailable'");
      expect(database.prepare("SELECT 1 AS found FROM schema_migrations WHERE version = ?")
        .get("local-console-system-event-resume-unavailable")).toBeDefined();
      expect(database.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
      expect(database.prepare("SELECT message_id FROM local_attachment_refs WHERE attachment_id = ?")
        .get("attachment-legacy-resume")).toEqual({ message_id: userMessage.id });
    } finally {
      database.close();
    }
  });
});

async function fixtureStore(): Promise<{ store: LocalConsoleStore; sqlitePath: string }> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "moebius-system-events-"));
  roots.push(root);
  const sqlitePath = path.join(root, ".state", "local-console.sqlite");
  const store = await createSqliteLocalConsoleStore({ sqlitePath });
  await store.init();
  return { store, sqlitePath };
}

async function recordTerminal(
  store: LocalConsoleStore,
  name: string,
  finish: (input: {
    userMessageId: number;
    sessionId: string;
    runId: string;
    runDir: string | null;
    now: string;
  }) => Promise<unknown>,
): Promise<void> {
  const sessionId = `local:${name}`;
  await store.createSession({ sessionId, title: name, now: "2026-07-22T00:00:00.000Z" });
  const message = await store.appendUserMessage({ sessionId, body: "开始", now: "2026-07-22T00:00:01.000Z" });
  await store.claimNextPendingMessage({ sessionId, runId: `run-${name}`, now: "2026-07-22T00:00:02.000Z" });
  await finish({
    userMessageId: message.id,
    sessionId,
    runId: `run-${name}`,
    runDir: null,
    now: "2026-07-22T00:00:03.000Z",
  });
}

function rewriteSessionMessagesWithLegacyCheck(sqlitePath: string): void {
  const database = new DatabaseSync(sqlitePath);
  database.exec("PRAGMA foreign_keys = OFF");
  try {
    database.exec(`
      BEGIN IMMEDIATE;
      CREATE TABLE session_messages_legacy_check (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id TEXT NOT NULL,
        speaker TEXT NOT NULL,
        role TEXT,
        body TEXT NOT NULL,
        status TEXT NOT NULL,
        run_id TEXT,
        run_dir TEXT,
        error TEXT,
        system_event_kind TEXT NOT NULL DEFAULT 'other' CHECK (
          system_event_kind IN ('run-not-started', 'run-stuck', 'user-stopped', 'retry-exhausted', 'other')
        ),
        failure_count INTEGER NOT NULL DEFAULT 0,
        last_failure_reason TEXT,
        source_kind TEXT,
        source_id TEXT,
        activated_at TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      INSERT INTO session_messages_legacy_check (
        id,
        session_id,
        speaker,
        role,
        body,
        status,
        run_id,
        run_dir,
        error,
        system_event_kind,
        failure_count,
        last_failure_reason,
        source_kind,
        source_id,
        activated_at,
        created_at,
        updated_at
      )
      SELECT
        id,
        session_id,
        speaker,
        role,
        body,
        status,
        run_id,
        run_dir,
        error,
        system_event_kind,
        failure_count,
        last_failure_reason,
        source_kind,
        source_id,
        activated_at,
        created_at,
        updated_at
      FROM session_messages;
      DROP TABLE session_messages;
      ALTER TABLE session_messages_legacy_check RENAME TO session_messages;
      CREATE INDEX idx_session_messages_session_id_id ON session_messages(session_id, id);
      CREATE INDEX idx_session_messages_session_status_id ON session_messages(session_id, status, id);
      COMMIT;
    `);
  } catch (error) {
    if (database.isTransaction) {
      database.exec("ROLLBACK");
    }
    throw error;
  } finally {
    database.exec("PRAGMA foreign_keys = ON");
    database.close();
  }
}
