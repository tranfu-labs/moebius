import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { CodexRunOptions, CodexRunResult } from "../src/codex.js";
import { startLocalConsoleServer, type StartedLocalConsoleServer } from "../src/local-console/server.js";
import { createSqliteLocalConsoleStore } from "../src/local-console/store.js";
import { runSqliteStateCommand, type SqliteStateCommand } from "../src/sqlite-state.js";

const roots: string[] = [];
const servers: StartedLocalConsoleServer[] = [];

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => server.close()));
  await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});

describe("ADR-0004 per-session JSONL fact logs", () => {
  it("round-trips appended facts, keeps a stable path, and commits the log before the SQLite index", async () => {
    const root = await fixtureRoot();
    const sqlitePath = path.join(root, ".state", "local-console.sqlite");
    const store = await createSqliteLocalConsoleStore({ sqlitePath });
    await store.init();
    await store.createSession({ sessionId: "local:roundtrip", title: "roundtrip", now: "2026-07-22T00:00:00.000Z" });

    const firstPath = store.getSessionFactLogPath("local:roundtrip");
    const message = await store.appendUserMessage({
      sessionId: "local:roundtrip",
      body: "包含附件引用 ![proof](https://example.com/proof.png)",
      now: "2026-07-22T00:00:01.000Z",
    });
    expect(store.getSessionFactLogPath("local:roundtrip")).toBe(firstPath);
    expect(path.dirname(firstPath)).toBe(path.join(root, "sessions"));
    expect((await fs.readFile(firstPath, "utf8")).endsWith("\n")).toBe(true);
    await expect(store.listMessages("local:roundtrip")).resolves.toEqual([
      expect.objectContaining({ id: message.id, body: "包含附件引用 ![proof](https://example.com/proof.png)" }),
    ]);
    await store.close();

    const blockedRoot = path.join(root, "not-a-directory");
    await fs.writeFile(blockedRoot, "blocked", "utf8");
    const blocked = await createSqliteLocalConsoleStore({ sqlitePath, sessionLogRoot: blockedRoot });
    await expect(blocked.appendUserMessage({
      sessionId: "local:roundtrip",
      body: "must not reach sqlite",
      now: "2026-07-22T00:00:02.000Z",
    })).rejects.toThrow();
    const database = new DatabaseSync(sqlitePath, { readOnly: true });
    try {
      expect(database.prepare("SELECT 1 AS found FROM session_messages WHERE body = ?").get("must not reach sqlite"))
        .toBeUndefined();
    } finally {
      database.close();
    }
  });

  it("rejects every direct worker command that can mutate the session message index", async () => {
    const root = await fixtureRoot();
    const sqlitePath = path.join(root, ".state", "local-console.sqlite");
    const now = "2026-07-22T00:00:00.000Z";
    const sessionId = "local:blocked";
    const messageId = 1;
    const commands: SqliteStateCommand[] = [
      { kind: "local-create-session", sessionId, projectId: "local", title: "blocked", initialMessage: "blocked", now },
      {
        kind: "local-create-child-session",
        parentSessionId: sessionId,
        childSessionId: "local:blocked-child",
        projectId: "local",
        title: "blocked child",
        relation: "task",
        hiddenKey: "blocked-child",
        initialBody: "blocked",
        initialRole: "dev",
        now,
      },
      {
        kind: "local-record-child-session-card",
        parentSessionId: sessionId,
        sourceId: "blocked-card",
        body: "blocked",
        runId: "run-blocked",
        runDir: "/tmp/blocked",
        now,
      },
      { kind: "local-append-user", sessionId, body: "blocked", now },
      { kind: "local-claim-next", sessionId, runId: "run-blocked", now },
      { kind: "local-set-run-dir", id: messageId, runDir: "/tmp/blocked", now },
      { kind: "local-record-message-processed", userMessageId: messageId, sessionId, runId: "run-blocked", runDir: null, now },
      {
        kind: "local-record-route-append",
        userMessageId: messageId,
        sessionId,
        routeKey: "route-blocked",
        body: "blocked",
        targetRole: "dev",
        runId: "run-blocked",
        runDir: null,
        now,
      },
      {
        kind: "local-record-route-no-action",
        userMessageId: messageId,
        sessionId,
        routeKey: "route-blocked",
        outcome: "no_action",
        reason: "blocked",
        runId: "run-blocked",
        runDir: null,
        now,
      },
      { kind: "local-release-message-for-retry", userMessageId: messageId, sessionId, now },
      {
        kind: "local-release-message-for-resume",
        userMessageId: messageId,
        sessionId,
        sourceDisposition: "primary",
        targetRunId: "run-blocked",
        role: "dev-manager",
        now,
      },
      {
        kind: "local-repair-agent-handoff-resume-source",
        sessionId,
        intentId: "intent-blocked",
        targetRunId: "run-blocked",
        sourceMessageId: messageId,
        role: "qa",
        now,
      },
      {
        kind: "local-record-agent-response",
        userMessageId: messageId,
        sessionId,
        role: "dev",
        body: "blocked",
        runId: "run-blocked",
        runDir: "/tmp/blocked",
        now,
      },
      {
        kind: "local-record-system-and-complete",
        userMessageId: messageId,
        sessionId,
        body: "blocked",
        systemEventKind: "other",
        runId: "run-blocked",
        runDir: null,
        now,
      },
      {
        kind: "local-record-system",
        sessionId,
        body: "blocked",
        runId: null,
        runDir: null,
        error: null,
        systemEventKind: "other",
        now,
      },
      { kind: "local-record-failure", userMessageId: messageId, sessionId, error: "blocked", runId: null, runDir: null, now },
      { kind: "local-record-retryable-failure", userMessageId: messageId, sessionId, error: "blocked", runId: null, runDir: null, now },
      {
        kind: "local-record-dead-letter-and-complete",
        userMessageId: messageId,
        sessionId,
        error: "blocked",
        runId: null,
        runDir: null,
        failureCount: 5,
        now,
      },
      { kind: "local-record-interrupted", userMessageId: messageId, sessionId, reason: "blocked", runId: null, runDir: null, now },
      { kind: "local-record-stuck", userMessageId: messageId, sessionId, reason: "blocked", runId: null, runDir: null, now },
      { kind: "local-mark-stale-running", sessionId, cutoffIso: now, now, reason: "blocked" },
    ];

    for (const command of commands) {
      await expect(runSqliteStateCommand({ sqlitePath, command }))
        .rejects.toThrow(`Direct session message write is forbidden by ADR-0004; use local-commit-session-fact-write: ${command.kind}`);
    }

    const database = new DatabaseSync(sqlitePath, { readOnly: true });
    try {
      expect(database.prepare("SELECT COUNT(*) AS count FROM session_messages").get()).toMatchObject({ count: 0 });
    } finally {
      database.close();
    }
  });

  it("releases graceful resume sources by explicit disposition and repairs an Agent source idempotently", async () => {
    const root = await fixtureRoot();
    const sqlitePath = path.join(root, ".state", "local-console.sqlite");
    const store = await createSqliteLocalConsoleStore({ sqlitePath });
    await store.init();

    await store.createSession({
      sessionId: "local:resume-primary",
      title: "primary",
      now: "2026-07-22T01:00:00.000Z",
    });
    const primary = await store.appendUserMessage({
      sessionId: "local:resume-primary",
      body: "primary",
      dispatch: { lane: "primary", role: "dev-manager", reason: "no-valid-mention" },
      now: "2026-07-22T01:00:01.000Z",
    });
    await store.claimNextPendingMessage({
      sessionId: primary.sessionId,
      runId: "run-primary",
      now: "2026-07-22T01:00:02.000Z",
    });
    await store.releaseMessageForResume({
      userMessageId: primary.id,
      sessionId: primary.sessionId,
      sourceDisposition: "primary",
      targetRunId: "run-primary",
      role: "dev-manager",
      now: "2026-07-22T01:00:03.000Z",
    });
    await expect(store.listMessages(primary.sessionId)).resolves.toContainEqual(expect.objectContaining({
      id: primary.id,
      speaker: "user",
      status: "pending",
      runId: null,
      dispatchLane: "primary",
      dispatchRole: "dev-manager",
    }));

    await store.createSession({
      sessionId: "local:resume-direct",
      title: "direct",
      now: "2026-07-22T01:01:00.000Z",
    });
    const direct = await store.appendUserMessage({
      sessionId: "local:resume-direct",
      body: "@qa direct",
      dispatch: { lane: "worker", role: "qa", reason: "single-valid-mention" },
      now: "2026-07-22T01:01:01.000Z",
    });
    await store.claimNextPendingWorkerMessage({
      sessionId: direct.sessionId,
      role: "qa",
      runId: "run-direct",
      now: "2026-07-22T01:01:02.000Z",
    });
    await store.releaseMessageForResume({
      userMessageId: direct.id,
      sessionId: direct.sessionId,
      sourceDisposition: "user-direct",
      targetRunId: "run-direct",
      role: "qa",
      now: "2026-07-22T01:01:03.000Z",
    });
    await expect(store.listMessages(direct.sessionId)).resolves.toContainEqual(expect.objectContaining({
      id: direct.id,
      speaker: "user",
      status: "pending",
      runId: null,
      dispatchLane: "worker",
      dispatchRole: "qa",
    }));

    await store.createSession({
      sessionId: "local:resume-handoff",
      title: "handoff",
      now: "2026-07-22T01:02:00.000Z",
    });
    const managerSource = await store.appendUserMessage({
      sessionId: "local:resume-handoff",
      body: "delegate",
      dispatch: { lane: "primary", role: "dev-manager", reason: "no-valid-mention" },
      now: "2026-07-22T01:02:01.000Z",
    });
    await store.claimNextPendingMessage({
      sessionId: managerSource.sessionId,
      runId: "run-manager",
      now: "2026-07-22T01:02:02.000Z",
    });
    await store.recordAgentResponse({
      userMessageId: managerSource.id,
      sessionId: managerSource.sessionId,
      role: "dev-manager",
      body: "@qa handoff",
      runId: "run-manager",
      runDir: "/tmp/run-manager",
      now: "2026-07-22T01:02:03.000Z",
    });
    const handoffSource = (await store.listMessages(managerSource.sessionId)).find((message) =>
      message.speaker === "agent" && message.body === "@qa handoff")!;
    await store.claimNextPendingMessage({
      sessionId: managerSource.sessionId,
      runId: "run-handoff",
      now: "2026-07-22T01:02:04.000Z",
    });
    await store.releaseMessageForResume({
      userMessageId: handoffSource.id,
      sessionId: managerSource.sessionId,
      sourceDisposition: "agent-handoff",
      targetRunId: "run-handoff",
      role: "qa",
      now: "2026-07-22T01:02:05.000Z",
    });
    await expect(store.listMessages(managerSource.sessionId)).resolves.toContainEqual(expect.objectContaining({
      id: handoffSource.id,
      speaker: "agent",
      status: "displayed",
    }));
    const database = new DatabaseSync(sqlitePath);
    try {
      expect(database.prepare(
        "SELECT processed_through_message_id, active_message_id, active_run_id FROM local_message_cursors WHERE session_id = ?",
      ).get(managerSource.sessionId)).toMatchObject({
        processed_through_message_id: handoffSource.id - 1,
        active_message_id: null,
        active_run_id: null,
      });
      database.prepare(
        "UPDATE session_messages SET status = 'pending' WHERE session_id = ? AND id = ?",
      ).run(managerSource.sessionId, handoffSource.id);
    } finally {
      database.close();
    }
    const repairInput = {
      sessionId: managerSource.sessionId,
      intentId: "legacy-handoff-intent",
      targetRunId: "run-handoff",
      sourceMessageId: handoffSource.id,
      role: "qa",
      now: "2026-07-22T01:02:06.000Z",
    };
    await expect(store.repairAgentHandoffResumeSource(repairInput)).resolves.toBe("repaired");
    await expect(store.repairAgentHandoffResumeSource({
      ...repairInput,
      now: "2026-07-22T01:02:07.000Z",
    })).resolves.toBe("already-repaired");
    const repairFacts = (await fs.readFile(
      store.getSessionFactLogPath(managerSource.sessionId),
      "utf8",
    )).trimEnd().split("\n").map((line) => JSON.parse(line) as { type?: string });
    expect(repairFacts.filter((fact) =>
      fact.type === "repair_agent_handoff_resume_source")).toHaveLength(1);

    await store.claimNextPendingMessage({
      sessionId: managerSource.sessionId,
      runId: "run-active-cursor",
      now: "2026-07-22T01:02:07.100Z",
    });
    await expect(store.repairAgentHandoffResumeSource({
      ...repairInput,
      intentId: "reject-active-cursor",
      targetRunId: "run-active-cursor",
      now: "2026-07-22T01:02:07.200Z",
    })).rejects.toThrow("active cursor");
    await store.releaseMessageForResume({
      userMessageId: handoffSource.id,
      sessionId: managerSource.sessionId,
      sourceDisposition: "agent-handoff",
      targetRunId: "run-active-cursor",
      role: "qa",
      now: "2026-07-22T01:02:07.300Z",
    });

    await store.recordDetachedRunStarted({
      sessionId: managerSource.sessionId,
      role: "qa",
      runId: "run-running-owner",
      runDir: "/tmp/run-running-owner",
      now: "2026-07-22T01:02:07.400Z",
    });
    await expect(store.repairAgentHandoffResumeSource({
      ...repairInput,
      intentId: "reject-running-owner",
      targetRunId: "run-running-owner",
      now: "2026-07-22T01:02:07.500Z",
    })).rejects.toThrow("running owner");
    await store.recordDetachedRunTerminal({
      sessionId: managerSource.sessionId,
      body: "running owner stopped",
      systemEventKind: "other",
      runId: "run-running-owner",
      runDir: "/tmp/run-running-owner",
      error: "stopped",
      status: "interrupted",
      now: "2026-07-22T01:02:07.600Z",
    });

    await store.recordDetachedRunStarted({
      sessionId: managerSource.sessionId,
      role: "qa",
      runId: "run-multiple-placeholders",
      runDir: "/tmp/run-multiple-placeholders-1",
      now: "2026-07-22T01:02:07.700Z",
    });
    await store.recordDetachedRunStarted({
      sessionId: managerSource.sessionId,
      role: "qa",
      runId: "run-multiple-placeholders",
      runDir: "/tmp/run-multiple-placeholders-2",
      now: "2026-07-22T01:02:07.800Z",
    });
    await store.recordDetachedRunTerminal({
      sessionId: managerSource.sessionId,
      body: "multiple placeholders stopped",
      systemEventKind: "other",
      runId: "run-multiple-placeholders",
      runDir: null,
      error: "stopped",
      status: "interrupted",
      now: "2026-07-22T01:02:07.900Z",
    });
    await expect(store.repairAgentHandoffResumeSource({
      ...repairInput,
      intentId: "reject-multiple-placeholders",
      targetRunId: "run-multiple-placeholders",
      now: "2026-07-22T01:02:07.950Z",
    })).rejects.toThrow("multiple placeholders");
    const rejectionRepairFacts = (await fs.readFile(
      store.getSessionFactLogPath(managerSource.sessionId),
      "utf8",
    )).trimEnd().split("\n").map((line) => JSON.parse(line) as {
      type?: string;
      payload?: { intentId?: string };
    }).filter((fact) =>
      fact.type === "repair_agent_handoff_resume_source"
      && fact.payload?.intentId?.startsWith("reject-"));
    expect(rejectionRepairFacts).toHaveLength(0);

    await store.recordSystemMessage({
      sessionId: managerSource.sessionId,
      body: "placeholder",
      runId: "run-placeholder",
      runDir: null,
      error: null,
      now: "2026-07-22T01:02:08.000Z",
    });
    const systemSource = (await store.listMessages(managerSource.sessionId)).find((message) =>
      message.speaker === "system" && message.body === "placeholder")!;
    await expect(store.releaseMessageForResume({
      userMessageId: systemSource.id,
      sessionId: managerSource.sessionId,
      sourceDisposition: "agent-handoff",
      targetRunId: "run-placeholder",
      role: "qa",
      now: "2026-07-22T01:02:09.000Z",
    })).rejects.toThrow("must be an Agent message");
    await expect(store.listMessages(managerSource.sessionId)).resolves.toContainEqual(expect.objectContaining({
      id: systemSource.id,
      speaker: "system",
      status: "displayed",
    }));

    await store.createSession({
      sessionId: "local:resume-exact-source",
      title: "exact source",
      now: "2026-07-22T01:03:00.000Z",
    });
    const skippedWorker = await store.appendUserMessage({
      sessionId: "local:resume-exact-source",
      body: "@qa queued",
      dispatch: { lane: "worker", role: "qa", reason: "single-valid-mention" },
      now: "2026-07-22T01:03:01.000Z",
    });
    const freshPrimary = await store.appendUserMessage({
      sessionId: "local:resume-exact-source",
      body: "continue",
      dispatch: { lane: "primary", role: "dev-manager", reason: "no-valid-mention" },
      now: "2026-07-22T01:03:02.000Z",
    });
    const exactClaim = await store.claimNextPendingMessage({
      sessionId: "local:resume-exact-source",
      runId: "run-fresh-primary",
      gracefulResumeTargets: [{
        sourceMessageId: skippedWorker.id,
        targetRunId: "run-old-qa",
      }],
      now: "2026-07-22T01:03:03.000Z",
    });
    expect(exactClaim).toMatchObject({
      id: freshPrimary.id,
      runId: "run-fresh-primary",
    });
    await store.close();
  });

  it("keeps every message-mutating store facade inside the fact-write funnel", async () => {
    const root = await fixtureRoot();
    const sqlitePath = path.join(root, ".state", "local-console.sqlite");
    const store = await createSqliteLocalConsoleStore({ sqlitePath });
    await store.init();
    const claimed = async (suffix: string, createdAt: string): Promise<{ sessionId: string; messageId: number }> => {
      const sessionId = `local:facade-${suffix}`;
      await store.createSession({ sessionId, title: suffix, now: createdAt });
      const message = await store.appendUserMessage({ sessionId, body: suffix, now: createdAt });
      await store.claimNextPendingMessage({ sessionId, runId: `run-${suffix}`, now: createdAt });
      return { sessionId, messageId: message.id };
    };

    const agent = await claimed("agent", "2026-07-22T00:01:00.000Z");
    await store.setRunDir({ id: agent.messageId, sessionId: agent.sessionId, runDir: "/tmp/agent", now: "2026-07-22T00:01:01.000Z" });
    await store.recordAgentResponse({
      userMessageId: agent.messageId,
      sessionId: agent.sessionId,
      role: "dev",
      body: "agent response",
      runId: "run-agent",
      runDir: "/tmp/agent",
      now: "2026-07-22T00:01:02.000Z",
    });

    const processed = await claimed("processed", "2026-07-22T00:02:00.000Z");
    await store.recordMessageProcessed({
      userMessageId: processed.messageId,
      sessionId: processed.sessionId,
      runId: "run-processed",
      runDir: null,
      now: "2026-07-22T00:02:01.000Z",
    });

    const routeAppend = await claimed("route-append", "2026-07-22T00:03:00.000Z");
    await store.recordRouteAppend({
      userMessageId: routeAppend.messageId,
      sessionId: routeAppend.sessionId,
      routeKey: "route:append",
      body: "route append",
      targetRole: "dev",
      runId: "run-route-append",
      runDir: null,
      now: "2026-07-22T00:03:01.000Z",
    });

    const routeNoAction = await claimed("route-no-action", "2026-07-22T00:04:00.000Z");
    await store.recordRouteNoAction({
      userMessageId: routeNoAction.messageId,
      sessionId: routeNoAction.sessionId,
      routeKey: "route:no-action",
      outcome: "no_action",
      reason: "none",
      runId: "run-route-no-action",
      runDir: null,
      now: "2026-07-22T00:04:01.000Z",
    });

    const retry = await claimed("retry", "2026-07-22T00:05:00.000Z");
    await store.setRunDir({
      id: retry.messageId,
      sessionId: retry.sessionId,
      runDir: "/tmp/retry",
      now: "2026-07-22T00:05:00.500Z",
    });
    await store.releaseMessageForRetry({ userMessageId: retry.messageId, sessionId: retry.sessionId, now: "2026-07-22T00:05:01.000Z" });
    await expect(store.listMessages(retry.sessionId)).resolves.toContainEqual(expect.objectContaining({
      id: retry.messageId,
      status: "pending",
      runId: null,
      runDir: null,
    }));

    const systemComplete = await claimed("system-complete", "2026-07-22T00:06:00.000Z");
    await store.recordSystemAndComplete({
      userMessageId: systemComplete.messageId,
      sessionId: systemComplete.sessionId,
      body: "system complete",
      runId: "run-system-complete",
      runDir: null,
      now: "2026-07-22T00:06:01.000Z",
    });

    await store.recordSystemMessage({
      sessionId: "local:facade-system",
      body: "system",
      runId: null,
      runDir: null,
      error: null,
      now: "2026-07-22T00:07:00.000Z",
    });

    const failure = await claimed("failure", "2026-07-22T00:08:00.000Z");
    await store.recordFailure({ userMessageId: failure.messageId, sessionId: failure.sessionId, error: "failed", runId: null, runDir: null, now: "2026-07-22T00:08:01.000Z" });

    const retryable = await claimed("retryable", "2026-07-22T00:09:00.000Z");
    await store.recordRetryableFailure({ userMessageId: retryable.messageId, sessionId: retryable.sessionId, error: "retryable", runId: null, runDir: null, now: "2026-07-22T00:09:01.000Z" });

    const deadLetter = await claimed("dead-letter", "2026-07-22T00:10:00.000Z");
    await store.recordDeadLetter({ userMessageId: deadLetter.messageId, sessionId: deadLetter.sessionId, error: "dead", runId: null, runDir: null, failureCount: 5, now: "2026-07-22T00:10:01.000Z" });

    const interrupted = await claimed("interrupted", "2026-07-22T00:11:00.000Z");
    await store.recordInterrupted({ userMessageId: interrupted.messageId, sessionId: interrupted.sessionId, reason: "stopped", runId: null, runDir: null, now: "2026-07-22T00:11:01.000Z" });

    const stuck = await claimed("stuck", "2026-07-22T00:12:00.000Z");
    await store.recordStuck({ userMessageId: stuck.messageId, sessionId: stuck.sessionId, reason: "stuck", runId: null, runDir: null, now: "2026-07-22T00:12:01.000Z" });

    const stale = await claimed("stale", "2026-07-22T00:13:00.000Z");
    await expect(store.markStaleRunning({
      sessionId: stale.sessionId,
      cutoffIso: "2026-07-22T00:13:01.000Z",
      now: "2026-07-22T00:13:02.000Z",
      reason: "stale",
    })).resolves.toBe(1);

    await store.createSession({
      sessionId: "local:facade-initial",
      title: "initial",
      initialMessage: "initial message",
      now: "2026-07-22T00:14:00.000Z",
    });
    await store.createSession({ sessionId: "local:facade-parent", title: "parent", now: "2026-07-22T00:15:00.000Z" });
    const child = await store.createChildSession({
      parentSessionId: "local:facade-parent",
      childSessionId: "local:facade-child",
      projectId: "local",
      title: "child",
      relation: "task",
      hiddenKey: "facade-child",
      initialBody: "child handoff",
      initialRole: "dev",
      now: "2026-07-22T00:15:01.000Z",
    });
    await store.recordChildSessionCard({
      parentSessionId: "local:facade-parent",
      sourceId: "facade-card",
      childSessionIds: [child.sessionId],
      runId: "run-card",
      runDir: "/tmp/card",
      now: "2026-07-22T00:15:02.000Z",
    });

    for (const sessionId of [
      agent.sessionId,
      processed.sessionId,
      routeAppend.sessionId,
      routeNoAction.sessionId,
      retry.sessionId,
      systemComplete.sessionId,
      "local:facade-system",
      failure.sessionId,
      retryable.sessionId,
      deadLetter.sessionId,
      interrupted.sessionId,
      stuck.sessionId,
      stale.sessionId,
      "local:facade-initial",
      "local:facade-parent",
      "local:facade-child",
    ]) {
      expect((await fs.readFile(store.getSessionFactLogPath(sessionId), "utf8")).endsWith("\n")).toBe(true);
    }
    await store.close();
  }, 20_000);

  it("ignores an incomplete tail while reading and truncates it before the next append", async () => {
    const root = await fixtureRoot();
    const store = await createSqliteLocalConsoleStore({ sqlitePath: path.join(root, ".state", "local-console.sqlite") });
    await store.init();
    await store.createSession({ sessionId: "local:half-line", title: "half", now: "2026-07-22T00:00:00.000Z" });
    await store.appendUserMessage({ sessionId: "local:half-line", body: "完整消息", now: "2026-07-22T00:00:01.000Z" });
    const logPath = store.getSessionFactLogPath("local:half-line");
    await fs.appendFile(logPath, "{\"version\":1,\"incomplete\"", "utf8");

    await expect(store.listMessages("local:half-line")).resolves.toEqual([
      expect.objectContaining({ body: "完整消息" }),
    ]);
    expect(await fs.readFile(logPath, "utf8")).not.toContain("incomplete");
    await store.appendUserMessage({ sessionId: "local:half-line", body: "修复后消息", now: "2026-07-22T00:00:02.000Z" });

    const text = await fs.readFile(logPath, "utf8");
    expect(text).not.toContain("incomplete");
    expect(text.endsWith("\n")).toBe(true);
    expect(text.trimEnd().split("\n").every((line) => {
      JSON.parse(line);
      return true;
    })).toBe(true);
  });

  it("migrates legacy session_messages once and never lets later legacy rows overwrite the fact log", async () => {
    const root = await fixtureRoot();
    const sqlitePath = path.join(root, ".state", "local-console.sqlite");
    await runSqliteStateCommand({ sqlitePath, command: { kind: "local-init" } });
    insertLegacyMessage(sqlitePath, "旧消息", "2026-07-22T00:00:00.000Z");

    const store = await createSqliteLocalConsoleStore({ sqlitePath });
    await store.init();
    const logPath = store.getSessionFactLogPath("local:legacy");
    const migratedText = await fs.readFile(logPath, "utf8");
    expect(migratedText).toContain("session_history_migrated");
    await store.close();

    insertLegacyMessage(sqlitePath, "marker 后旧表新增", "2026-07-22T00:00:01.000Z");
    const reopened = await createSqliteLocalConsoleStore({ sqlitePath });
    await reopened.init();
    expect(await fs.readFile(logPath, "utf8")).toBe(migratedText);
    await expect(reopened.listMessages("local:legacy")).resolves.toEqual([
      expect.objectContaining({ body: "旧消息" }),
    ]);
    const database = new DatabaseSync(sqlitePath, { readOnly: true });
    try {
      expect(database.prepare("SELECT 1 AS found FROM schema_migrations WHERE version = ?")
        .get("session-jsonl-fact-log-v1")).toBeDefined();
      expect(database.prepare("SELECT 1 AS found FROM session_messages WHERE body = ?").get("marker 后旧表新增"))
        .toBeUndefined();
    } finally {
      database.close();
    }
  });

  it("discovers JSONL files and rebuilds the SQLite message cache without session index rows", async () => {
    const root = await fixtureRoot();
    const sqlitePath = path.join(root, ".state", "local-console.sqlite");
    const store = await createSqliteLocalConsoleStore({ sqlitePath });
    await store.init();
    await store.createSession({ sessionId: "local:rebuild", title: "rebuild", now: "2026-07-22T00:00:00.000Z" });
    await store.appendUserMessage({ sessionId: "local:rebuild", body: "事实仍在", now: "2026-07-22T00:00:01.000Z" });

    const database = new DatabaseSync(sqlitePath);
    try {
      database.prepare("DELETE FROM session_messages WHERE session_id = ?").run("local:rebuild");
      database.prepare("DELETE FROM sessions WHERE session_id = ?").run("local:rebuild");
    } finally {
      database.close();
    }
    await store.rebuildMessageIndex();

    const verify = new DatabaseSync(sqlitePath, { readOnly: true });
    try {
      expect(verify.prepare("SELECT body FROM session_messages WHERE session_id = ?").get("local:rebuild"))
        .toMatchObject({ body: "事实仍在" });
    } finally {
      verify.close();
    }
  });

  it("writes independent child facts and the parent creation event through the real HTTP assembly", async () => {
    const root = await fixtureRoot();
    const started = await startLocalConsoleServer({
      projectRoot: root,
      port: 0,
      runCodex: vi.fn(async (options: CodexRunOptions) => codexOk(options)),
    });
    servers.push(started);
    const parentResponse = await fetch(new URL("/api/local-console/sessions", started.url), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ projectId: "local", title: "parent" }),
    });
    const parent = await parentResponse.json() as { session: { sessionId: string } };
    const childId = "local:http-child";
    const childResponse = await fetch(new URL("/api/local-console/child-sessions", started.url), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        parentSessionId: parent.session.sessionId,
        childSessionId: childId,
        projectId: "local",
        title: "child",
        hiddenKey: "http-child-key",
        initialBody: "@dev 子任务",
      }),
    });
    expect(childResponse.status).toBe(201);

    const parentLog = await readSessionLog(root, parent.session.sessionId);
    const childLog = await readSessionLog(root, childId);
    expect(parentLog.map((event) => event.type)).toContain("child_session_created");
    expect(childLog.map((event) => event.type)).toContain("session_created");
    expect(JSON.stringify(childLog)).toContain("@dev 子任务");
  });
});

async function fixtureRoot(): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "moebius-session-fact-"));
  roots.push(root);
  return root;
}

async function readSessionLog(root: string, sessionId: string): Promise<Array<{ type: string }>> {
  const fileName = `${Buffer.from(sessionId, "utf8").toString("base64url")}.jsonl`;
  const text = await fs.readFile(path.join(root, "sessions", fileName), "utf8");
  return text.trimEnd().split("\n").map((line) => JSON.parse(line) as { type: string });
}

function insertLegacyMessage(sqlitePath: string, body: string, now: string): void {
  const database = new DatabaseSync(sqlitePath);
  try {
    database
      .prepare(
        `INSERT OR IGNORE INTO sessions
          (session_id, project_id, source_type, title, status, created_at, updated_at)
         VALUES ('local:legacy', 'local', 'local', 'legacy', 'active', ?, ?)`,
      )
      .run(now, now);
    database
      .prepare(
        `INSERT INTO session_messages
          (session_id, speaker, role, body, status, run_id, run_dir, error, source_kind, source_id, created_at, updated_at)
         VALUES ('local:legacy', 'user', NULL, ?, 'pending', NULL, NULL, NULL, 'legacy-test-fixture', NULL, ?, ?)`,
      )
      .run(body, now, now);
  } finally {
    database.close();
  }
}

function codexOk(options: CodexRunOptions): CodexRunResult {
  return {
    ok: true,
    finalText: "完成\n\n<!-- agent-stage:code-verified -->",
    threadId: null,
    cachedInputTokens: null,
    runDir: options.runDir,
    stdoutPath: path.join(options.runDir, "stdout.jsonl"),
    stderrPath: path.join(options.runDir, "stderr.log"),
  };
}
