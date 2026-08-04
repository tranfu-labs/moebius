import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";

import { finalizeAgentTeamSnapshot } from "../src/local-console/session-team-snapshot.js";
import { createSqliteLocalConsoleStore } from "../src/local-console/store.js";
import type { LocalConsoleAgentTeamSnapshot } from "../src/local-console/types.js";

describe("persisted session team update state", () => {
  it("promotes an idle candidate atomically and restores the complete effective snapshot", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "moebius-team-update-store-"));
    const sqlitePath = path.join(root, "state.sqlite");
    const store = await createSqliteLocalConsoleStore({
      sqlitePath,
      sessionLogRoot: path.join(root, "sessions"),
    });
    try {
      await store.init();
      const effective = snapshot("old", "codex", "2026-08-04T00:00:00.000Z");
      const candidate = snapshot("new", "claude", "2026-08-04T00:01:00.000Z");
      await store.createSession({
        sessionId: "team-update-idle",
        title: "idle",
        agentTeamOwnership: "user",
        agentTeamId: "team-a",
        agentTeamSnapshot: effective,
        now: "2026-08-04T00:00:00.000Z",
      });
      await store.writeSessionAgentTeamCandidate({ sessionId: "team-update-idle", snapshot: candidate });
      await expect(store.beginSessionTeamUpdate({
        sessionId: "team-update-idle",
        expectedUpdateToken: "stale-token",
        now: "2026-08-04T00:01:30.000Z",
      })).rejects.toThrow("SESSION_TEAM_UPDATE_STALE");
      expect((await store.readSessionTeamUpdateRecord("team-update-idle")).intent).toBeNull();
      await store.beginSessionTeamUpdate({
        sessionId: "team-update-idle",
        expectedUpdateToken: candidate.snapshotKey,
        now: "2026-08-04T00:02:00.000Z",
      });
      await store.applyPendingSessionContext({ sessionId: "team-update-idle", now: "2026-08-04T00:03:00.000Z" });

      expect(await store.listSessionAgentTeamSnapshot("team-update-idle")).toMatchObject({
        snapshotKey: candidate.snapshotKey,
        loadedAt: "2026-08-04T00:03:00.000Z",
        members: [{ agentMarkdown: "new", executionProfile: { cli: "claude" } }],
      });
      expect(await store.readSessionTeamUpdateRecord("team-update-idle")).toEqual({
        candidate: null,
        pending: null,
        intent: null,
      });
      await store.close();

      const reopened = await createSqliteLocalConsoleStore({ sqlitePath, sessionLogRoot: path.join(root, "sessions") });
      try {
        await reopened.init();
        expect((await reopened.listSessionAgentTeamSnapshot("team-update-idle"))?.snapshotKey)
          .toBe(candidate.snapshotKey);
      } finally {
        await reopened.close();
      }
    } finally {
      await store.close();
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it("binds legacy queued work to the old generation and keeps awaiting messages unbound", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "moebius-team-update-generation-"));
    const sqlitePath = path.join(root, "state.sqlite");
    const store = await createSqliteLocalConsoleStore({
      sqlitePath,
      sessionLogRoot: path.join(root, "sessions"),
    });
    try {
      await store.init();
      const effective = snapshot("old", "codex", "2026-08-04T00:00:00.000Z");
      const candidate = snapshot("new", "kimi", "2026-08-04T00:01:00.000Z");
      await store.createSession({
        sessionId: "team-update-waiting",
        title: "waiting",
        agentTeamOwnership: "user",
        agentTeamId: "team-a",
        agentTeamSnapshot: effective,
        now: "2026-08-04T00:00:00.000Z",
      });
      await store.appendUserMessage({
        sessionId: "team-update-waiting",
        body: "old primary",
        dispatch: { lane: "primary", role: "lead", reason: "single-valid-mention" },
        now: "2026-08-04T00:00:20.000Z",
      });
      await store.appendUserMessage({
        sessionId: "team-update-waiting",
        body: "old worker",
        dispatch: { lane: "worker", role: "lead", reason: "single-valid-mention" },
        now: "2026-08-04T00:00:30.000Z",
      });
      await store.writeSessionAgentTeamCandidate({ sessionId: "team-update-waiting", snapshot: candidate });
      await store.beginSessionTeamUpdate({ sessionId: "team-update-waiting", now: "2026-08-04T00:02:00.000Z" });
      await store.appendUserMessage({
        sessionId: "team-update-waiting",
        body: "handoff created by the old run",
        dispatch: { lane: "worker", role: "lead", reason: "single-valid-mention" },
        now: "2026-08-04T00:02:15.000Z",
      });
      await store.appendUserMessage({
        sessionId: "team-update-waiting",
        body: "wait for update",
        dispatch: { lane: "awaiting-team", role: "lead", reason: "no-valid-mention" },
        now: "2026-08-04T00:02:30.000Z",
      });
      await store.applyPendingSessionContext({ sessionId: "team-update-waiting", now: "2026-08-04T00:03:00.000Z" });

      expect((await store.listSessionAgentTeamSnapshot("team-update-waiting"))?.snapshotKey)
        .toBe(effective.snapshotKey);
      expect((await store.readSessionTeamUpdateRecord("team-update-waiting")).intent?.status).toBe("waiting");
      const database = new DatabaseSync(sqlitePath, { readOnly: true });
      try {
        const rows = database.prepare(
          "SELECT dispatch_lane, dispatch_snapshot_key FROM session_messages WHERE session_id = ? ORDER BY id",
        ).all("team-update-waiting") as Array<{ dispatch_lane: string; dispatch_snapshot_key: string | null }>;
        expect(rows).toEqual([
          { dispatch_lane: "primary", dispatch_snapshot_key: effective.snapshotKey },
          { dispatch_lane: "worker", dispatch_snapshot_key: effective.snapshotKey },
          { dispatch_lane: "worker", dispatch_snapshot_key: effective.snapshotKey },
          { dispatch_lane: "awaiting-team", dispatch_snapshot_key: null },
        ]);
      } finally {
        database.close();
      }
    } finally {
      await store.close();
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it("retries the frozen pending snapshot instead of a newer candidate", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "moebius-team-update-retry-"));
    const sqlitePath = path.join(root, "state.sqlite");
    const store = await createSqliteLocalConsoleStore({
      sqlitePath,
      sessionLogRoot: path.join(root, "sessions"),
    });
    try {
      await store.init();
      const effective = snapshot("old", "codex", "2026-08-04T00:00:00.000Z");
      const frozen = snapshot("frozen", "claude", "2026-08-04T00:01:00.000Z");
      const newer = snapshot("newer", "kimi", "2026-08-04T00:02:00.000Z");
      await store.createSession({
        sessionId: "team-update-retry",
        title: "retry",
        agentTeamOwnership: "user",
        agentTeamId: "team-a",
        agentTeamSnapshot: effective,
        now: "2026-08-04T00:00:00.000Z",
      });
      await store.writeSessionAgentTeamCandidate!({ sessionId: "team-update-retry", snapshot: frozen });
      await store.beginSessionTeamUpdate!({
        sessionId: "team-update-retry",
        expectedUpdateToken: frozen.snapshotKey,
        now: "2026-08-04T00:01:30.000Z",
      });
      await store.markSessionTeamUpdateFailed!({
        sessionId: "team-update-retry",
        code: "INJECTED",
        summary: "first promotion failed",
      });
      await store.writeSessionAgentTeamCandidate!({ sessionId: "team-update-retry", snapshot: newer });

      await expect(store.retrySessionTeamUpdate!({
        sessionId: "team-update-retry",
        expectedUpdateToken: newer.snapshotKey,
        now: "2026-08-04T00:02:30.000Z",
      })).rejects.toThrow("SESSION_TEAM_UPDATE_STALE");
      expect((await store.readSessionTeamUpdateRecord!("team-update-retry")).intent?.status).toBe("failed");

      await store.retrySessionTeamUpdate!({
        sessionId: "team-update-retry",
        expectedUpdateToken: frozen.snapshotKey,
        now: "2026-08-04T00:03:00.000Z",
      });
      const retrying = await store.readSessionTeamUpdateRecord!("team-update-retry");
      expect(retrying).toMatchObject({
        candidate: { snapshotKey: newer.snapshotKey },
        pending: { snapshotKey: frozen.snapshotKey, members: [{ agentMarkdown: "frozen" }] },
        intent: { status: "waiting", targetSnapshotKey: frozen.snapshotKey },
      });
      await store.applyPendingSessionContext({ sessionId: "team-update-retry", now: "2026-08-04T00:04:00.000Z" });
      expect(await store.listSessionAgentTeamSnapshot!("team-update-retry")).toMatchObject({
        snapshotKey: frozen.snapshotKey,
        members: [{ agentMarkdown: "frozen", executionProfile: { cli: "claude" } }],
      });
    } finally {
      await store.close();
      await fs.rm(root, { recursive: true, force: true });
    }
  });
});

function snapshot(
  agentMarkdown: string,
  cli: "codex" | "claude" | "kimi",
  capturedAt: string,
): LocalConsoleAgentTeamSnapshot {
  return finalizeAgentTeamSnapshot({
    team: {
      ownership: "user",
      id: "team-a",
      name: "Team A",
      description: "Purpose",
      primaryAgentSlug: "lead",
    },
    members: [{
      name: "lead",
      displayName: "Lead",
      description: "Leads",
      agentMarkdown,
      executionProfile: { cli, model: `${cli}-model`, effort: "medium" },
    }],
  }, { capturedAt });
}
