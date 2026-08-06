import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";

import { finalizeAgentTeamSnapshot } from "../src/local-console/session-team-snapshot.js";
import { createSqliteLocalConsoleStore } from "../src/local-console/store.js";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});

type LegacyMember = {
  slot: "effective" | "pending";
  name: string;
  markdown: string;
  order: number;
  cli: "codex" | "claude" | "kimi" | null;
  model: string | null;
  effort: string | null;
};

const fixtures: Array<{
  name: string;
  members: LegacyMember[];
  effectiveBinding: ["system" | "user", string] | null;
  pendingBinding: ["system" | "user", string] | null;
  messages?: "pending-and-running";
}> = [
  {
    name: "effective Codex snapshot",
    members: [member("effective", "manager", 0, "codex")],
    effectiveBinding: ["system", "development"],
    pendingBinding: null,
  },
  {
    name: "pending Kimi switch",
    members: [member("pending", "kimi-lead", 0, "kimi")],
    effectiveBinding: ["system", "development"],
    pendingBinding: ["user", "next-team"],
  },
  {
    name: "ordered Claude and NULL profiles",
    members: [
      member("effective", "lead", 0, "claude"),
      member("effective", "legacy", 1, null),
    ],
    effectiveBinding: ["user", "mixed-team"],
    pendingBinding: null,
  },
  {
    name: "effective and pending slots together",
    members: [
      member("effective", "old", 0, "codex"),
      member("pending", "new", 0, "kimi"),
    ],
    effectiveBinding: ["user", "old-team"],
    pendingBinding: ["user", "new-team"],
  },
  {
    name: "pending and running dispatch state",
    members: [member("effective", "lead", 0, "codex")],
    effectiveBinding: ["user", "dispatch-team"],
    pendingBinding: null,
    messages: "pending-and-running",
  },
];

describe("Agent team snapshot traceability schema migration", () => {
  it.each(fixtures)("migrates $name twice without inventing historical fields", async (fixture) => {
    const { root, sqlitePath, sessionId } = await createLegacyFixture(fixture);
    roots.push(root);

    for (let pass = 0; pass < 2; pass += 1) {
      const store = await createSqliteLocalConsoleStore({ sqlitePath, sessionLogRoot: path.join(root, "sessions") });
      await store.init();
      if (pass === 0) {
        const effective = fixture.members.filter((row) => row.slot === "effective");
        const snapshot = await store.listSessionAgentTeamSnapshot!(sessionId);
        expect(snapshot?.members ?? []).toEqual(effective.map((row) => ({
          name: row.name,
          displayName: null,
          description: null,
          agentMarkdown: row.markdown,
          executionProfile: row.cli === null ? null : {
            cli: row.cli,
            model: row.model,
            effort: row.effort,
          },
          continuationEnded: false,
        })));
        expect(snapshot?.team).toBeUndefined();
        expect(snapshot?.loadedAt).toBeUndefined();
        expect(snapshot?.snapshotKey).toBeUndefined();

        const candidate = finalizeAgentTeamSnapshot({
          team: { ownership: "user", id: "candidate", name: "Candidate", description: null, primaryAgentSlug: "lead" },
          members: [{
            name: "lead", displayName: "Lead", description: null, agentMarkdown: "# Lead",
            executionProfile: { cli: "claude", model: "sonnet", effort: "high" },
          }],
        }, { capturedAt: "2026-08-04T01:00:00.000Z" });
        await store.writeSessionAgentTeamCandidate!({ sessionId, snapshot: candidate });
        expect((await store.readSessionTeamUpdateRecord!(sessionId)).candidate?.snapshotKey)
          .toBe(candidate.snapshotKey);
      }
      await store.close();
    }

    const database = new DatabaseSync(sqlitePath, { readOnly: true });
    try {
      expect(database.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
      expect(database.prepare("SELECT COUNT(*) AS count FROM session_agent_team_members WHERE session_id = ?")
        .get(sessionId)).toEqual({ count: fixture.members.length + 1 });
      expect(database.prepare(
        `SELECT slot, member_name, display_name, member_description, agent_markdown, sort_order,
                execution_cli, execution_model, execution_effort, snapshot_key
         FROM session_agent_team_members
         WHERE session_id = ? AND slot != 'candidate'
         ORDER BY slot, sort_order, member_name`,
      ).all(sessionId)).toEqual([...fixture.members]
        .sort((left, right) => left.slot.localeCompare(right.slot) || left.order - right.order || left.name.localeCompare(right.name))
        .map((row) => ({
          slot: row.slot,
          member_name: row.name,
          display_name: null,
          member_description: null,
          agent_markdown: row.markdown,
          sort_order: row.order,
          execution_cli: row.cli,
          execution_model: row.model,
          execution_effort: row.effort,
          snapshot_key: null,
        })));
      expect(database.prepare(
        "SELECT team_name, loaded_at, snapshot_key FROM session_agent_team_snapshot_meta WHERE session_id = ? AND slot != 'candidate'",
      ).all(sessionId)).toEqual([]);
      if (fixture.messages !== undefined) {
        expect(database.prepare(
          "SELECT status, dispatch_snapshot_key FROM session_messages WHERE session_id = ? ORDER BY id",
        ).all(sessionId)).toEqual([
          { status: "running", dispatch_snapshot_key: null },
          { status: "pending", dispatch_snapshot_key: null },
        ]);
      }
    } finally {
      database.close();
    }
  });

  it("rolls back every schema rewrite when the migration foreign-key check fails", async () => {
    const fixture = fixtures[0]!;
    const { root, sqlitePath } = await createLegacyFixture(fixture);
    roots.push(root);
    const legacy = new DatabaseSync(sqlitePath);
    try {
      legacy.exec("PRAGMA foreign_keys = OFF");
      legacy.prepare(
        `INSERT INTO session_agent_team_members
          (session_id, slot, member_name, agent_markdown, sort_order, execution_cli, execution_model, execution_effort)
         VALUES ('missing-session', 'effective', 'orphan', '# orphan', 99, NULL, NULL, NULL)`,
      ).run();
    } finally {
      legacy.close();
    }

    const failing = await createSqliteLocalConsoleStore({ sqlitePath, sessionLogRoot: path.join(root, "sessions") });
    await expect(failing.init()).rejects.toThrow("Foreign key check failed during Agent team snapshot migration");
    await failing.close();

    const rolledBack = new DatabaseSync(sqlitePath);
    try {
      const columns = rolledBack.prepare("PRAGMA table_info(session_agent_team_members)").all() as Array<{ name: string }>;
      expect(columns.map(({ name }) => name)).not.toContain("display_name");
      expect(rolledBack.prepare("SELECT 1 FROM schema_migrations WHERE version = ?")
        .get("agent-team-snapshot-traceability-and-apply")).toBeUndefined();
      expect(rolledBack.prepare("SELECT member_name FROM session_agent_team_members WHERE session_id = 'missing-session'")
        .get()).toEqual({ member_name: "orphan" });
      rolledBack.prepare("DELETE FROM session_agent_team_members WHERE session_id = 'missing-session'").run();
    } finally {
      rolledBack.close();
    }

    const recovered = await createSqliteLocalConsoleStore({ sqlitePath, sessionLogRoot: path.join(root, "sessions") });
    await recovered.init();
    await recovered.close();
    const database = new DatabaseSync(sqlitePath, { readOnly: true });
    try {
      expect(database.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
      expect(database.prepare("SELECT 1 FROM schema_migrations WHERE version = ?")
        .get("agent-team-snapshot-traceability-and-apply")).toBeDefined();
    } finally {
      database.close();
    }
  });
});

function member(
  slot: "effective" | "pending",
  name: string,
  order: number,
  cli: "codex" | "claude" | "kimi" | null,
): LegacyMember {
  return {
    slot,
    name,
    markdown: `# ${name}\n`,
    order,
    cli,
    model: cli === null ? null : `${cli}-model`,
    effort: cli === null ? null : "high",
  };
}

async function createLegacyFixture(fixture: typeof fixtures[number]): Promise<{
  root: string;
  sqlitePath: string;
  sessionId: string;
}> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "moebius-team-snapshot-migration-"));
  const sqlitePath = path.join(root, "state.sqlite");
  const sessionId = `legacy-${fixture.name.replaceAll(/[^a-z]+/giu, "-").toLowerCase()}`;
  const store = await createSqliteLocalConsoleStore({ sqlitePath, sessionLogRoot: path.join(root, "sessions") });
  await store.init();
  await store.createSession({ sessionId, title: fixture.name, now: "2026-08-04T00:00:00.000Z" });
  if (fixture.messages !== undefined) {
    await store.appendUserMessage({
      sessionId, body: "running", dispatch: { lane: "primary", role: "lead", reason: "single-valid-mention" },
      now: "2026-08-04T00:01:00.000Z",
    });
    await store.appendUserMessage({
      sessionId, body: "pending", dispatch: { lane: "primary", role: "lead", reason: "single-valid-mention" },
      now: "2026-08-04T00:02:00.000Z",
    });
    await store.claimNextPendingMessage({ sessionId, runId: "legacy-running", now: "2026-08-04T00:03:00.000Z" });
  }
  await store.close();

  const database = new DatabaseSync(sqlitePath);
  try {
    database.exec(`
      PRAGMA foreign_keys = OFF;
      DROP TABLE session_agent_team_snapshot_meta;
      DROP TABLE session_team_update_intents;
      DROP TABLE session_agent_team_members;
      CREATE TABLE session_agent_team_members (
        session_id TEXT NOT NULL REFERENCES sessions(session_id) ON DELETE CASCADE,
        slot TEXT NOT NULL CHECK (slot IN ('effective', 'pending')),
        member_name TEXT NOT NULL,
        agent_markdown TEXT NOT NULL,
        sort_order INTEGER NOT NULL,
        execution_cli TEXT CHECK (execution_cli IS NULL OR execution_cli IN ('codex', 'claude', 'kimi')),
        execution_model TEXT,
        execution_effort TEXT,
        PRIMARY KEY(session_id, slot, member_name)
      );
      ALTER TABLE session_messages DROP COLUMN dispatch_snapshot_key;
      DELETE FROM schema_migrations WHERE version = 'agent-team-snapshot-traceability-and-apply';
    `);
    database.prepare(
      `UPDATE sessions
       SET agent_team_ownership = ?, agent_team_id = ?, agent_team_pending_ownership = ?, agent_team_pending_id = ?
       WHERE session_id = ?`,
    ).run(
      fixture.effectiveBinding?.[0] ?? null,
      fixture.effectiveBinding?.[1] ?? null,
      fixture.pendingBinding?.[0] ?? null,
      fixture.pendingBinding?.[1] ?? null,
      sessionId,
    );
    const insert = database.prepare(
      `INSERT INTO session_agent_team_members
        (session_id, slot, member_name, agent_markdown, sort_order, execution_cli, execution_model, execution_effort)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    for (const row of fixture.members) {
      insert.run(sessionId, row.slot, row.name, row.markdown, row.order, row.cli, row.model, row.effort);
    }
  } finally {
    database.close();
  }
  return { root, sqlitePath, sessionId };
}
