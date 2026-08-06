import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";

import { createSqliteLocalConsoleStore } from "../src/local-console/store.js";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) =>
    fs.rm(root, { recursive: true, force: true })));
});

describe("execution profile schema migration", () => {
  it("rebuilds the old two-CLI CHECK for Claude and Pi transactionally and remains idempotent", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "moebius-claude-schema-"));
    roots.push(root);
    const sqlitePath = path.join(root, "local-console.sqlite");
    const initial = await createSqliteLocalConsoleStore({ sqlitePath });
    await initial.init();
    await initial.close();

    const legacy = new DatabaseSync(sqlitePath);
    try {
      const session = legacy.prepare(
        "SELECT session_id FROM sessions ORDER BY session_id LIMIT 1",
      ).get() as { session_id: string };
      legacy.exec(`
        PRAGMA foreign_keys = OFF;
        DROP TABLE session_agent_team_members;
        CREATE TABLE session_agent_team_members (
          session_id TEXT NOT NULL REFERENCES sessions(session_id) ON DELETE CASCADE,
          slot TEXT NOT NULL CHECK (slot IN ('effective', 'pending')),
          member_name TEXT NOT NULL,
          agent_markdown TEXT NOT NULL,
          sort_order INTEGER NOT NULL,
          execution_cli TEXT CHECK (
            execution_cli IS NULL OR execution_cli IN ('codex', 'kimi')
          ),
          execution_model TEXT,
          execution_effort TEXT,
          PRIMARY KEY(session_id, slot, member_name)
        );
        DELETE FROM schema_migrations
        WHERE version IN (
          'support-claude-cli-session-profile-constraint',
          'support-pi-api-session-profile-v2'
        );
      `);
      legacy.prepare(
        `INSERT INTO session_agent_team_members
          (session_id, slot, member_name, agent_markdown, sort_order,
           execution_cli, execution_model, execution_effort)
         VALUES (?, 'effective', 'manager', '# manager', 0, 'codex', 'gpt', 'high'),
                (?, 'effective', 'legacy', '# legacy', 1, NULL, NULL, NULL)`,
      ).run(session.session_id, session.session_id);
    } finally {
      legacy.close();
    }

    for (let pass = 0; pass < 2; pass += 1) {
      const store = await createSqliteLocalConsoleStore({ sqlitePath });
      await store.init();
      await store.close();
    }

    const database = new DatabaseSync(sqlitePath);
    try {
      const sql = database.prepare(
        "SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'session_agent_team_members'",
      ).get() as { sql: string };
      expect(sql.sql).toContain("'claude'");
      expect(sql.sql).toContain("'pi'");
      expect(sql.sql).toContain("provider_profile_id");
      expect(database.prepare(
        `SELECT member_name, execution_cli, execution_model, execution_effort, sort_order
         FROM session_agent_team_members ORDER BY sort_order`,
      ).all()).toEqual([
        {
          member_name: "manager",
          execution_cli: "codex",
          execution_model: "gpt",
          execution_effort: "high",
          sort_order: 0,
        },
        {
          member_name: "legacy",
          execution_cli: null,
          execution_model: null,
          execution_effort: null,
          sort_order: 1,
        },
      ]);
      expect(database.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
      const session = database.prepare(
        "SELECT session_id FROM sessions ORDER BY session_id LIMIT 1",
      ).get() as { session_id: string };
      expect(() => database.prepare(
        `INSERT INTO session_agent_team_members
          (session_id, slot, member_name, agent_markdown, sort_order,
           execution_cli, execution_model, execution_effort)
         VALUES (?, 'pending', 'claude', '# claude', 0, 'claude', 'fable', 'xhigh')`,
      ).run(session.session_id)).not.toThrow();
      expect(() => database.prepare(
        `INSERT INTO session_agent_team_members
          (session_id, slot, member_name, agent_markdown, sort_order,
           execution_cli, execution_model, execution_effort, provider_id, provider_profile_id)
         VALUES (?, 'pending', 'pi', '# pi', 1, 'pi', 'deepseek-v4-pro', 'high', 'deepseek', 'profile-1')`,
      ).run(session.session_id)).not.toThrow();
    } finally {
      database.close();
    }
  });
});
