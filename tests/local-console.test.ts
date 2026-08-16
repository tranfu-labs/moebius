import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it, vi } from "vitest";

import { waitForCondition, waitForValue, waitScale } from "../src/testing/wait.js";
import { resolveTrigger } from "../src/triggers/index.js";
import {
  buildLocalConsoleRoutingTimeline,
  buildLocalConsoleTimeline,
} from "../src/local-console/timeline.js";
import { createSqliteLocalConsoleStore } from "../src/local-console/store.js";
import {
  startLocalConsoleServer as startLocalConsoleServerImpl,
  type LocalConsoleServerOptions,
  type StartedLocalConsoleServer,
} from "../src/local-console/start.js";
import { LocalPendingProcessingRuntime } from "../src/local-console/pending-processing-runtime.js";
import { LocalConsoleRuntime, type LocalConsoleAgentFile } from "../src/local-console/runtime.js";
import { readLocalConsoleOutputTail } from "../src/local-console/output-tail.js";
import { buildLocalAgentPrompt } from "../src/local-console/prompt.js";
import type {
  LocalAgentSessionLinkFact,
  LocalAgentTimelineCursorFact,
  LocalExecutionSessionLinkFact,
  LocalProviderInvocationFact,
  LocalProviderSessionObservedFact,
  LocalRunExecutionContextFact,
} from "../src/local-console/execution-context.js";
import type {
  LocalCodexResumeConsumedFact,
  LocalCodexResumeIntentFact,
  LocalCodexRunUsageFact,
} from "../src/local-console/codex-resume.js";
import {
  listLocalT5Facts,
  recordLocalDeadLetter,
  recordLocalRouteDecision,
} from "../src/local-console/t5-store.js";
import {
  LOCAL_CONSOLE_DEFAULT_SESSION_ID,
  LOCAL_CONSOLE_PROJECT_ID,
  type LocalConsoleChildSessionSummary,
  type LocalConsoleMessage,
  type LocalConsoleProjectSummary,
  type LocalConsoleSessionSummary,
  type LocalConsoleSessionWorkspaceSource,
  type LocalConsoleStore,
} from "../src/local-console/types.js";
import type { CodexRunOptions, CodexRunResult } from "../src/codex.js";

const originalPath = process.env.PATH;
const STANDARD_STORE_TIMEOUT_MS = 10_000;
const LIVE_RUN_COMPLETION_WAIT_TIMEOUT_MS = 4_000;

async function startLocalConsoleServer(options: LocalConsoleServerOptions = {}): Promise<StartedLocalConsoleServer> {
  const projectRoot = options.projectRoot ?? process.cwd();
  return startLocalConsoleServerImpl({
    ...options,
    enableSessionTitleGeneration: options.enableSessionTitleGeneration ?? false,
    isCodexThreadAvailable: options.isCodexThreadAvailable ?? (async () => true),
    listAgentFiles: options.listAgentFiles ?? (async () => {
      const agentsDirectory = path.join(projectRoot, "agents");
      const entries = await fs.readdir(agentsDirectory, { withFileTypes: true });
      return entries
        .filter((entry) => entry.isFile() && entry.name.endsWith(".md"))
        .map((entry) => ({
          name: entry.name.slice(0, -3),
          path: path.join(agentsDirectory, entry.name),
        }));
    }),
  });
}

afterEach(() => {
  process.env.PATH = originalPath;
});

describe("local console", { timeout: 15_000 }, () => {
  it("builds a local-native prompt with primary-agent closeout rules", () => {
    const prompt = buildLocalAgentPrompt({
      role: "qa",
      agentMarkdown: "# QA\n\n检查质量。",
      primaryAgent: "dev-manager",
      availableAgentNames: ["dev-manager", "dev", "qa"],
      timeline: [{ index: 0, speaker: "user", body: "所有人依次报数", source: "message" }],
    });

    expect(prompt).toContain("本地对话 session");
    expect(prompt).toContain("当前团队主 Agent：@dev-manager");
    expect(prompt).toContain("“验收”“通过”“不通过”");
    expect(prompt).not.toContain("GitHub Issue");
    expect(prompt).not.toContain("role envelope");
  });

  it("releases a failed retry action and keeps other sessions independent", async () => {
    const workspace: LocalConsoleSessionWorkspaceSource = {
      projectId: "local",
      title: "test workspace",
      folderPath: process.cwd(),
      workspaceMode: "direct",
      workspacePendingMode: null,
      baselineCommit: null,
    };
    let releasePrimary!: () => void;
    const primaryRelease = new Promise<void>((resolve) => {
      releasePrimary = resolve;
    });
    let markPrimaryStarted!: () => void;
    const primaryStarted = new Promise<void>((resolve) => {
      markPrimaryStarted = resolve;
    });
    const executedSessions: string[] = [];
    const reported: Array<{ event: string; error: string }> = [];
    let firstPrimary = true;
    const runtime = new LocalPendingProcessingRuntime({
      stopping: () => false,
      repairStale: async () => undefined,
      applyPendingContext: async () => undefined,
      continuableWorkspace: async () => workspace,
      dispatchWorkers: async () => undefined,
      hasPersistedPrimary: async () => false,
      executePrimary: async (sessionId) => {
        executedSessions.push(sessionId);
        if (sessionId === "session-a" && firstPrimary) {
          firstPrimary = false;
          markPrimaryStarted();
          await primaryRelease;
        }
        return "stop";
      },
      listSessions: async () => [],
      formatError: (error) => error instanceof Error ? error.message : String(error),
      setError: () => undefined,
      report: (event, error) => reported.push({ event, error }),
    });

    const current = runtime.process("session-a");
    await primaryStarted;
    let actionAttempts = 0;
    const failedRetry = runtime.runRetryAfterCurrent("session-a", async () => {
      actionAttempts += 1;
      throw new Error("release failed");
    });
    const otherSession = runtime.process("session-b");
    await otherSession;
    expect(executedSessions).toContain("session-b");
    expect(actionAttempts).toBe(0);

    releasePrimary();
    await expect(failedRetry).rejects.toThrow("release failed");
    expect(reported).toEqual([{ event: "local-console-processing-failed", error: "release failed" }]);

    const recovered = await runtime.runRetryAfterCurrent("session-a", async () => {
      actionAttempts += 1;
    });
    expect(recovered).toBe(true);
    expect(actionAttempts).toBe(2);
    await current;
    await waitForCondition(
      () => executedSessions.filter((sessionId) => sessionId === "session-a").length === 2,
      { describe: "retry drain after failed action", kind: "logic" },
    );
  });

  it("stores user and agent messages in SQLite", async () => {
    const root = await makeFixtureRoot();
    const store = await createSqliteLocalConsoleStore({ sqlitePath: path.join(root, ".state", "local-console.sqlite") });
    await store.init();
    try {
      const user = await store.appendUserMessage({
        sessionId: LOCAL_CONSOLE_DEFAULT_SESSION_ID,
        body: "@dev hello",
        now: "2026-07-09T00:00:00.000Z",
      });
      const claimed = await store.claimNextPendingMessage({
        sessionId: LOCAL_CONSOLE_DEFAULT_SESSION_ID,
        runId: "run-1",
        now: "2026-07-09T00:00:01.000Z",
      });
      expect(claimed).toMatchObject({ id: user.id, status: "running", runId: "run-1" });

      await store.recordAgentResponse({
        userMessageId: user.id,
        sessionId: LOCAL_CONSOLE_DEFAULT_SESSION_ID,
        role: "dev",
        body: "hello from codex",
        runId: "run-1",
        runDir: "/tmp/run-1",
        processSteps: [],
        now: "2026-07-09T00:00:02.000Z",
      });

      expect(await store.listMessages(LOCAL_CONSOLE_DEFAULT_SESSION_ID)).toMatchObject([
        { speaker: "user", status: "completed", body: "@dev hello" },
        { speaker: "agent", role: "dev", status: "displayed", body: "hello from codex" },
      ]);
    } finally {
      await store.close();
    }

    const restarted = await createSqliteLocalConsoleStore({ sqlitePath: path.join(root, ".state", "local-console.sqlite") });
    await restarted.init();
    try {
      expect(await restarted.listMessages(LOCAL_CONSOLE_DEFAULT_SESSION_ID)).toMatchObject([
        { speaker: "user", status: "completed", body: "@dev hello" },
        { speaker: "agent", role: "dev", status: "displayed", body: "hello from codex" },
      ]);
    } finally {
      await restarted.close();
    }
  });

  it("persists an Agent team binding atomically and preserves unbound legacy sessions", async () => {
    const root = await makeFixtureRoot();
    const sqlitePath = path.join(root, ".state", "local-console.sqlite");
    const store = await createSqliteLocalConsoleStore({ sqlitePath });
    await store.init();
    const projectId = LOCAL_CONSOLE_PROJECT_ID;
    await store.createSession({
      sessionId: "local:bound-team",
      projectId,
      title: "bound",
      agentTeamOwnership: "user",
      agentTeamId: "my-team",
      now: "2026-07-21T00:00:00.000Z",
    });

    expect((await store.listSessions()).find((session) => session.sessionId === "local:bound-team"))
      .toMatchObject({ agentTeamOwnership: "user", agentTeamId: "my-team" });
    expect((await store.listSessions()).find((session) => session.sessionId === LOCAL_CONSOLE_DEFAULT_SESSION_ID))
      .toMatchObject({ agentTeamOwnership: null, agentTeamId: null });
    await store.close();

    const restarted = await createSqliteLocalConsoleStore({ sqlitePath });
    await restarted.init();
    try {
      expect((await restarted.listSessions()).find((session) => session.sessionId === "local:bound-team"))
        .toMatchObject({ agentTeamOwnership: "user", agentTeamId: "my-team" });
      expect((await restarted.listSessions()).find((session) => session.sessionId === LOCAL_CONSOLE_DEFAULT_SESSION_ID))
        .toMatchObject({ agentTeamOwnership: null, agentTeamId: null });
    } finally {
      await restarted.close();
    }
  });

  it("backfills upgrade-era pending user messages to the primary dispatch without rewriting the body", async () => {
    const root = await makeFixtureRoot();
    const sqlitePath = path.join(root, ".state", "local-console.sqlite");
    const store = await createSqliteLocalConsoleStore({ sqlitePath });
    await store.init();
    await store.createSession({
      sessionId: "local:dispatch-migration",
      title: "dispatch migration",
      agentTeamOwnership: "system",
      agentTeamId: "development",
      agentTeamSnapshot: {
        members: [
          { name: "dev-manager", agentMarkdown: "ROLE:dev-manager" },
          { name: "qa", agentMarkdown: "ROLE:qa" },
        ],
      },
      now: "2026-07-29T00:00:00.000Z",
    });
    const pending = await store.appendUserMessage({
      sessionId: "local:dispatch-migration",
      body: "@qa legacy pending",
      dispatch: {
        lane: "worker",
        role: "qa",
        reason: "single-valid-mention",
      },
      now: "2026-07-29T00:00:01.000Z",
    });
    const factLogPath = store.getSessionFactLogPath("local:dispatch-migration");
    await store.close();

    const legacyFacts = (await fs.readFile(factLogPath, "utf8"))
      .trimEnd()
      .split("\n")
      .map((line) => {
        const fact = JSON.parse(line) as { messageUpserts?: Array<Record<string, unknown>> };
        for (const message of fact.messageUpserts ?? []) {
          delete message.dispatchLane;
          delete message.dispatchRole;
          delete message.dispatchReason;
        }
        return JSON.stringify(fact);
      })
      .join("\n");
    await fs.writeFile(factLogPath, `${legacyFacts}\n`, "utf8");

    const database = new DatabaseSync(sqlitePath);
    database
      .prepare(
        `UPDATE session_messages
         SET dispatch_lane = NULL, dispatch_role = NULL, dispatch_reason = NULL
         WHERE id = ?`,
      )
      .run(pending.id);
    database.close();

    const restarted = await createSqliteLocalConsoleStore({ sqlitePath });
    await restarted.init();
    try {
      const messages = await restarted.listMessages("local:dispatch-migration");
      expect(messages.find((message) => message.id === pending.id)).toMatchObject({
        body: "@qa legacy pending",
        status: "pending",
        dispatchLane: "primary",
        dispatchRole: null,
        dispatchReason: "no-valid-mention",
      });
      await expect(restarted.claimNextPendingMessage({
        sessionId: "local:dispatch-migration",
        runId: "legacy-primary-run",
        now: "2026-07-29T00:00:02.000Z",
      })).resolves.toMatchObject({
        id: pending.id,
        dispatchLane: "primary",
      });
    } finally {
      await restarted.close();
    }
  });

  it("claims worker dispatches atomically per role while preserving per-role FIFO", async () => {
    const root = await makeFixtureRoot();
    const store = await createSqliteLocalConsoleStore({
      sqlitePath: path.join(root, ".state", "local-console.sqlite"),
    });
    await store.init();
    try {
      await store.createSession({
        sessionId: "local:worker-fifo",
        title: "worker fifo",
        now: "2026-07-29T00:00:00.000Z",
      });
      const qaFirst = await store.appendUserMessage({
        sessionId: "local:worker-fifo",
        body: "@qa first",
        dispatch: { lane: "worker", role: "qa", reason: "single-valid-mention" },
        now: "2026-07-29T00:00:01.000Z",
      });
      const devFirst = await store.appendUserMessage({
        sessionId: "local:worker-fifo",
        body: "@dev first",
        dispatch: { lane: "worker", role: "dev", reason: "single-valid-mention" },
        now: "2026-07-29T00:00:02.000Z",
      });
      const qaSecond = await store.appendUserMessage({
        sessionId: "local:worker-fifo",
        body: "@qa second",
        dispatch: { lane: "worker", role: "qa", reason: "single-valid-mention" },
        now: "2026-07-29T00:00:03.000Z",
      });

      await expect(store.claimNextPendingMessage({
        sessionId: "local:worker-fifo",
        runId: "primary-skip",
        now: "2026-07-29T00:00:04.000Z",
      })).resolves.toBeNull();
      await expect(store.claimNextPendingWorkerMessage?.({
        sessionId: "local:worker-fifo",
        role: "qa",
        runId: "qa-run-1",
        now: "2026-07-29T00:00:05.000Z",
      })).resolves.toMatchObject({ id: qaFirst.id });
      await expect(store.claimNextPendingWorkerMessage?.({
        sessionId: "local:worker-fifo",
        role: "qa",
        runId: "qa-run-2-too-early",
        now: "2026-07-29T00:00:06.000Z",
      })).resolves.toBeNull();
      await expect(store.claimNextPendingWorkerMessage?.({
        sessionId: "local:worker-fifo",
        role: "dev",
        runId: "dev-run-1",
        now: "2026-07-29T00:00:07.000Z",
      })).resolves.toMatchObject({ id: devFirst.id });

      await store.recordAgentResponse({
        userMessageId: qaFirst.id,
        sessionId: "local:worker-fifo",
        role: "qa",
        body: "qa first done",
        runId: "qa-run-1",
        runDir: "/tmp/qa-run-1",
        processSteps: [],
        now: "2026-07-29T00:00:08.000Z",
      });
      await expect(store.claimNextPendingWorkerMessage?.({
        sessionId: "local:worker-fifo",
        role: "qa",
        runId: "qa-run-2",
        now: "2026-07-29T00:00:09.000Z",
      })).resolves.toMatchObject({ id: qaSecond.id });
      expect((await store.listSessions()).find((session) => session.sessionId === "local:worker-fifo"))
        .toMatchObject({ hasPendingControlWork: true });
    } finally {
      await store.close();
    }
  });

  it("persists human-attention and unread-result state with race-safe read acknowledgement", async () => {
    const root = await makeFixtureRoot();
    const sqlitePath = path.join(root, ".state", "local-console.sqlite");
    const store = await createSqliteLocalConsoleStore({ sqlitePath });
    await store.init();
    try {
      const user = await store.appendUserMessage({
        sessionId: LOCAL_CONSOLE_DEFAULT_SESSION_ID,
        body: "@dev implement",
        now: "2026-07-09T00:00:00.000Z",
      });
      await store.claimNextPendingMessage({
        sessionId: LOCAL_CONSOLE_DEFAULT_SESSION_ID,
        runId: "run-attention",
        now: "2026-07-09T00:00:01.000Z",
      });
      await store.recordAgentResponse({
        userMessageId: user.id,
        sessionId: LOCAL_CONSOLE_DEFAULT_SESSION_ID,
        role: "dev",
        body: "结果已生成\n\n等待真人：请验收结果",
        runId: "run-attention",
        runDir: "/tmp/run-attention",
        processSteps: [],
        now: "2026-07-09T00:00:02.000Z",
      });

      expect((await store.listSessions()).find((session) => session.sessionId === LOCAL_CONSOLE_DEFAULT_SESSION_ID)).toMatchObject({
        awaitsHumanReason: null,
        unreadSince: "2026-07-09T00:00:02.000Z",
        waitingCount: 0,
      });
      await expect(store.markSessionResultRead({
        sessionId: LOCAL_CONSOLE_DEFAULT_SESSION_ID,
        unreadSince: "2026-07-09T00:00:01.000Z",
        now: "2026-07-09T00:00:03.000Z",
      })).resolves.toBe(false);
      await expect(store.markSessionResultRead({
        sessionId: LOCAL_CONSOLE_DEFAULT_SESSION_ID,
        unreadSince: "2026-07-09T00:00:02.000Z",
        now: "2026-07-09T00:00:04.000Z",
      })).resolves.toBe(true);
      expect((await store.listSessions()).find((session) => session.sessionId === LOCAL_CONSOLE_DEFAULT_SESSION_ID)).toMatchObject({
        awaitsHumanReason: null,
        unreadSince: null,
      });

      await store.appendUserMessage({
        sessionId: LOCAL_CONSOLE_DEFAULT_SESSION_ID,
        body: "验收反馈",
        now: "2026-07-09T00:00:05.000Z",
      });
      expect((await store.listSessions()).find((session) => session.sessionId === LOCAL_CONSOLE_DEFAULT_SESSION_ID)).toMatchObject({
        awaitsHumanReason: null,
        unreadSince: null,
      });
    } finally {
      await store.close();
    }

    const database = new DatabaseSync(sqlitePath);
    try {
      expect(() => database.prepare("UPDATE sessions SET awaits_human_reason = 'invalid' WHERE session_id = ?")
        .run(LOCAL_CONSOLE_DEFAULT_SESSION_ID)).toThrow();
    } finally {
      database.close();
    }
  });

  it("blocks archive while control work is pending and allows it after the handoff is processed", async () => {
    const root = await makeFixtureRoot();
    const sqlitePath = path.join(root, ".state", "local-console.sqlite");
    const store = await createSqliteLocalConsoleStore({ sqlitePath });
    await store.init();
    try {
      const projectId = LOCAL_CONSOLE_PROJECT_ID;
      const target = await store.createSession({
        sessionId: "local:archive-target",
        projectId,
        title: "archive target",
        now: "2030-01-02T00:00:00.000Z",
      });
      const neighbor = await store.createSession({
        sessionId: "local:archive-neighbor",
        projectId,
        title: "archive neighbor",
        now: "2030-01-01T00:00:00.000Z",
      });
      const user = await store.appendUserMessage({
        sessionId: target.sessionId,
        body: "@dev prepare a handoff",
        now: "2030-01-02T00:00:01.000Z",
      });
      await store.claimNextPendingMessage({
        sessionId: target.sessionId,
        runId: "run-archive-user",
        now: "2030-01-02T00:00:02.000Z",
      });
      await store.recordAgentResponse({
        userMessageId: user.id,
        sessionId: target.sessionId,
        role: "dev",
        body: "@qa 请继续验收\n等待真人：请确认后续安排",
        runId: "run-archive-user",
        runDir: "/tmp/run-archive-user",
        processSteps: [],
        now: "2030-01-02T00:00:03.000Z",
      });
      const handoff = await store.claimNextPendingMessage({
        sessionId: target.sessionId,
        runId: "run-archive-handoff",
        now: "2030-01-02T00:00:04.000Z",
      });
      expect(handoff).toMatchObject({ speaker: "agent", role: "dev", status: "displayed" });

      expect((await store.listSessions()).find((session) => session.sessionId === target.sessionId)).toMatchObject({
        hasPendingControlWork: true,
        status: "running",
        runningCount: 1,
      });
      await expect(store.archiveSession!({
        sessionId: target.sessionId,
        now: "2030-01-02T00:00:05.000Z",
      })).rejects.toMatchObject({ code: "SESSION_HAS_RUNNING_AGENT" });
      await store.recordMessageProcessed({
        userMessageId: handoff!.id,
        sessionId: target.sessionId,
        runId: "run-archive-handoff",
        runDir: null,
        now: "2030-01-02T00:00:06.000Z",
      });
      expect((await store.listSessions()).find((session) => session.sessionId === target.sessionId)).toMatchObject({
        hasPendingControlWork: false,
        status: "idle",
        runningCount: 0,
      });
      await expect(store.archiveSession!({
        sessionId: target.sessionId,
        now: "2030-01-02T00:00:07.000Z",
      })).resolves.toEqual({
        sessionId: target.sessionId,
        projectId,
        selectedSessionId: neighbor.sessionId,
        archivedSessionIds: [target.sessionId],
      });
      expect((await store.listSessions()).map((session) => session.sessionId)).not.toContain(target.sessionId);

      const database = new DatabaseSync(sqlitePath, { readOnly: true });
      try {
        expect(database.prepare(
          `SELECT s.archived_at, s.awaits_human_reason, s.unread_since,
                  c.processed_through_message_id, c.active_message_id, c.active_run_id
           FROM sessions s JOIN local_message_cursors c ON c.session_id = s.session_id
           WHERE s.session_id = ?`,
        ).get(target.sessionId)).toMatchObject({
          archived_at: "2030-01-02T00:00:07.000Z",
          awaits_human_reason: null,
          unread_since: "2030-01-02T00:00:03.000Z",
          processed_through_message_id: handoff!.id,
          active_message_id: null,
          active_run_id: null,
        });
      } finally {
        database.close();
      }

      await expect(store.claimNextPendingMessage({
        sessionId: target.sessionId,
        runId: "run-while-archived",
        now: "2030-01-02T00:00:08.000Z",
      })).resolves.toBeNull();
      await expect(store.restoreSession!({
        sessionId: target.sessionId,
        now: "2030-01-02T00:00:09.000Z",
      })).resolves.toMatchObject({
        sessionId: target.sessionId,
        awaitsHumanReason: null,
        unreadSince: "2030-01-02T00:00:03.000Z",
      });
      await expect(store.claimNextPendingMessage({
        sessionId: target.sessionId,
        runId: "run-restored-handoff",
        now: "2030-01-02T00:00:10.000Z",
      })).resolves.toBeNull();

      const running = await store.createSession({
        sessionId: "local:archive-running",
        projectId,
        title: "running",
        now: "2030-01-03T00:00:00.000Z",
      });
      await store.appendUserMessage({
        sessionId: running.sessionId,
        body: "@dev still running",
        now: "2030-01-03T00:00:01.000Z",
      });
      await store.claimNextPendingMessage({
        sessionId: running.sessionId,
        runId: "run-still-running",
        now: "2030-01-03T00:00:02.000Z",
      });
      await expect(store.archiveSession!({
        sessionId: running.sessionId,
        now: "2030-01-03T00:00:03.000Z",
      })).rejects.toMatchObject({ code: "SESSION_HAS_RUNNING_AGENT" });
    } finally {
      await store.close();
    }
  });

  it("marks stale running SQLite messages as stuck", async () => {
    const root = await makeFixtureRoot();
    const store = await createSqliteLocalConsoleStore({ sqlitePath: path.join(root, ".state", "local-console.sqlite") });
    await store.init();
    try {
      const user = await store.appendUserMessage({
        sessionId: LOCAL_CONSOLE_DEFAULT_SESSION_ID,
        body: "@dev hello",
        now: "2026-07-09T00:00:00.000Z",
      });
      await store.claimNextPendingMessage({
        sessionId: LOCAL_CONSOLE_DEFAULT_SESSION_ID,
        runId: "run-1",
        now: "2026-07-09T00:00:01.000Z",
      });

      expect(
        await store.markStaleRunning({
          sessionId: LOCAL_CONSOLE_DEFAULT_SESSION_ID,
          cutoffIso: "2026-07-09T00:00:02.000Z",
          now: "2026-07-09T00:00:03.000Z",
          reason: "Recovered stale local console run after process restart",
          roles: { [user.id]: null },
        }),
      ).toBe(1);
      expect(await store.listMessages(LOCAL_CONSOLE_DEFAULT_SESSION_ID)).toMatchObject([
        { id: user.id, speaker: "user", status: "stuck", error: "Recovered stale local console run after process restart" },
        { speaker: "system", status: "stuck", systemEventKind: "run-stuck", body: expect.stringContaining("这一步卡住了"), error: "Recovered stale local console run after process restart" },
      ]);
    } finally {
      await store.close();
    }
  });

  it("recovers every persisted worker run as stuck after restart", async () => {
    const root = await makeFixtureRoot();
    const sqlitePath = path.join(root, ".state", "local-console.sqlite");
    const store = await createSqliteLocalConsoleStore({ sqlitePath });
    await store.init();
    try {
      await store.recordDetachedRunStarted?.({
        sessionId: LOCAL_CONSOLE_DEFAULT_SESSION_ID,
        role: "dev",
        runId: "worker-dev",
        runDir: path.join(root, "runs", "dev"),
        now: "2026-07-09T00:00:00.000Z",
      });
      await store.recordDetachedRunStarted?.({
        sessionId: LOCAL_CONSOLE_DEFAULT_SESSION_ID,
        role: "qa",
        runId: "worker-qa",
        runDir: path.join(root, "runs", "qa"),
        now: "2026-07-09T00:00:01.000Z",
      });
    } finally {
      await store.close();
    }

    const started = await startLocalConsoleServer({
      projectRoot: root,
      sqlitePath,
      port: 0,
      runCodex: vi.fn(),
      storeTimeoutMs: STANDARD_STORE_TIMEOUT_MS,
    });
    try {
      const state = await getState(started.url, LOCAL_CONSOLE_DEFAULT_SESSION_ID);
      expect(state.activeRuns).toEqual([]);
      expect(state.messages.filter((message) => message.systemEventKind === "run-stuck"))
        .toEqual(expect.arrayContaining([
          expect.objectContaining({ runId: "worker-dev", status: "stuck", error: "orphaned-by-restart" }),
          expect.objectContaining({ runId: "worker-qa", status: "stuck", error: "orphaned-by-restart" }),
        ]));
      expect(state.messages.some((message) => message.sourceKind === "local-worker-run")).toBe(false);
    } finally {
      await started.close();
    }
  });

  it("marks an orphaned direct worker source stuck before releasing the next same-role dispatch", async () => {
    const root = await makeFixtureRoot();
    const sqlitePath = path.join(root, ".state", "local-console.sqlite");
    const store = await createSqliteLocalConsoleStore({ sqlitePath });
    await store.init();
    await store.createSession({
      sessionId: "local:direct-orphan-fifo",
      title: "direct orphan fifo",
      agentTeamOwnership: "system",
      agentTeamId: "development",
      agentTeamSnapshot: {
        members: [
          { name: "manager", agentMarkdown: "# manager\n\nROLE:manager" },
          { name: "qa", agentMarkdown: "# qa\n\nROLE:qa" },
        ],
      },
      now: "2026-07-29T00:00:00.000Z",
    });
    const orphaned = await store.appendUserMessage({
      sessionId: "local:direct-orphan-fifo",
      body: "@qa orphaned direct",
      dispatch: { lane: "worker", role: "qa", reason: "single-valid-mention" },
      now: "2026-07-29T00:00:01.000Z",
    });
    const next = await store.appendUserMessage({
      sessionId: "local:direct-orphan-fifo",
      body: "@qa after orphan",
      dispatch: { lane: "worker", role: "qa", reason: "single-valid-mention" },
      now: "2026-07-29T00:00:02.000Z",
    });
    await store.claimNextPendingWorkerMessage?.({
      sessionId: "local:direct-orphan-fifo",
      role: "qa",
      runId: "orphan-direct-qa",
      now: "2026-07-29T00:00:03.000Z",
    });
    await store.close();

    const runCodex = vi.fn(async (options: CodexRunOptions): Promise<CodexRunResult> => {
      const role = roleFromPrompt(options.prompt);
      const threadId = `thread-${role}-after-orphan`;
      await options.onThreadStarted?.(threadId);
      return {
        ...codexOk(options, role === "qa" ? "qa after orphan" : "manager closeout"),
        threadId,
      };
    });
    const started = await startLocalConsoleServer({
      projectRoot: root,
      sqlitePath,
      port: 0,
      runCodex,
      isCodexThreadAvailable: async () => true,
      makeRunDir: (count) => path.join(root, "runs", `direct-orphan-${String(count)}`),
      storeTimeoutMs: STANDARD_STORE_TIMEOUT_MS,
    });
    try {
      const state = await waitForState(started.url, "local:direct-orphan-fifo", (snapshot) =>
        snapshot.messages.some((message) =>
          message.speaker === "agent" && message.role === "qa" && message.body === "qa after orphan"),
      );
      expect(state.messages).toEqual(expect.arrayContaining([
        expect.objectContaining({
          id: orphaned.id,
          status: "stuck",
          runId: "orphan-direct-qa",
          dispatchLane: "worker",
          dispatchRole: "qa",
        }),
        expect.objectContaining({
          id: next.id,
          status: "completed",
          dispatchLane: "worker",
          dispatchRole: "qa",
        }),
        expect.objectContaining({
          speaker: "system",
          systemEventKind: "run-stuck",
          runId: "orphan-direct-qa",
        }),
      ]));
      expect(runCodex.mock.calls.map(([options]) => roleFromPrompt(options.prompt))[0]).toBe("qa");
    } finally {
      await started.close();
    }
  }, 20_000);

  it("persists local projects and rejects orphan local sessions atomically", async () => {
    const root = await makeFixtureRoot();
    const sqlitePath = path.join(root, ".state", "local-console.sqlite");
    const folderPath = path.join(root, "workspace-a");
    await fs.mkdir(folderPath, { recursive: true });
    const store = await createSqliteLocalConsoleStore({ sqlitePath });
    await store.init();
    try {
      const project = await store.createProject({
        folderPath,
        worktreeMode: true,
        now: "2026-07-09T00:00:00.000Z",
      });
      const session = await store.createSession({
        sessionId: "local:project-session",
        projectId: project.projectId,
        title: "project session",
        now: "2026-07-09T00:00:01.000Z",
      });
      await store.appendUserMessage({
        sessionId: session.sessionId,
        body: "@dev project message",
        now: "2026-07-09T00:00:02.000Z",
      });

      expect((await store.listProjects()).find((entry) => entry.projectId === project.projectId)).toMatchObject({
        title: "workspace-a",
        folderPath,
        worktreeMode: true,
        sessions: [expect.objectContaining({ sessionId: session.sessionId, projectId: project.projectId })],
      });
      await expect(
        store.createSession({
          sessionId: "local:missing-project",
          projectId: "missing-project",
          title: "bad",
          now: "2026-07-09T00:00:03.000Z",
        }),
      ).rejects.toThrow();
    } finally {
      await store.close();
    }

    const database = new DatabaseSync(sqlitePath, { readOnly: true });
    try {
      const good = database.prepare("SELECT session_id, project_id FROM sessions WHERE session_id = 'local:project-session'").get();
      expect(good).toMatchObject({ session_id: "local:project-session" });
      const orphan = database.prepare("SELECT session_id FROM sessions WHERE session_id = 'local:missing-project'").get();
      expect(orphan).toBeUndefined();
      const message = database.prepare("SELECT body FROM session_messages WHERE session_id = 'local:project-session'").get();
      expect(message).toMatchObject({ body: "@dev project message" });
    } finally {
      database.close();
    }
  });

  it("renames and removes a project without deleting its history, then re-adds the same path as a new project", async () => {
    const root = await makeFixtureRoot();
    const sqlitePath = path.join(root, ".state", "local-console.sqlite");
    const folderPath = path.join(root, "removable-project");
    await fs.mkdir(folderPath, { recursive: true });
    const store = await createSqliteLocalConsoleStore({ sqlitePath });
    let removedProjectId = "";
    await store.init();
    try {
      const project = await store.createProject({
        folderPath,
        worktreeMode: false,
        now: "2026-07-20T00:00:00.000Z",
      });
      removedProjectId = project.projectId;
      const session = await store.createSession({
        sessionId: "local:removable-session",
        projectId: project.projectId,
        title: "kept history",
        now: "2026-07-20T00:00:01.000Z",
      });
      await store.appendUserMessage({
        sessionId: session.sessionId,
        body: "history survives removal",
        now: "2026-07-20T00:00:02.000Z",
      });

      await expect(store.renameProject!({
        projectId: project.projectId,
        title: "  显示名称  ",
        now: "2026-07-20T00:00:03.000Z",
      })).resolves.toMatchObject({ title: "显示名称", folderPath });
      await expect(store.renameProject!({
        projectId: project.projectId,
        title: "   ",
        now: "2026-07-20T00:00:04.000Z",
      })).resolves.toMatchObject({ title: "removable-project" });

      const claimed = await store.claimNextPendingMessage({
        sessionId: session.sessionId,
        runId: "run-removal",
        now: "2026-07-20T00:00:05.000Z",
      });
      expect(claimed).not.toBeNull();
      await expect(store.removeProject!({
        projectId: project.projectId,
        force: false,
        now: "2026-07-20T00:00:06.000Z",
      })).rejects.toThrow("PROJECT_HAS_RUNNING_AGENTS");
      expect((await store.listProjects()).some((candidate) => candidate.projectId === project.projectId)).toBe(true);

      await expect(store.removeProject!({
        projectId: project.projectId,
        force: true,
        now: "2026-07-20T00:00:07.000Z",
      })).resolves.toEqual({ projectId: project.projectId, archivedSessionIds: [session.sessionId] });
      expect((await store.listProjects()).some((candidate) => candidate.projectId === project.projectId)).toBe(false);
      expect((await store.listSessions()).some((candidate) => candidate.sessionId === session.sessionId)).toBe(false);
      expect(await store.listMessages(session.sessionId)).toEqual([
        expect.objectContaining({ body: "history survives removal" }),
      ]);
      const activeProjectIds = (await store.listProjects()).map((candidate) => candidate.projectId);
      await expect(store.reorderProjects([...activeProjectIds].reverse())).resolves.toHaveLength(activeProjectIds.length);

      const readded = await store.createProject({
        folderPath,
        worktreeMode: true,
        now: "2026-07-20T00:00:08.000Z",
      });
      expect(readded).toMatchObject({ folderPath, title: "removable-project", sessions: [] });
      expect(readded.projectId).not.toBe(project.projectId);
      expect((await store.listProjects())[0]?.projectId).toBe(readded.projectId);
    } finally {
      await store.close();
    }

    const database = new DatabaseSync(sqlitePath, { readOnly: true });
    try {
      expect(database.prepare("SELECT original_folder_path, removed_at FROM projects WHERE project_id = ?").get(
        removedProjectId,
      )).toMatchObject({ original_folder_path: folderPath, removed_at: "2026-07-20T00:00:07.000Z" });
      expect(database.prepare("SELECT archived_at FROM sessions WHERE session_id = ?").get("local:removable-session"))
        .toMatchObject({ archived_at: "2026-07-20T00:00:07.000Z" });
    } finally {
      database.close();
    }
  });

  it("persists explicit project order, keeps state updates stable, and places new projects first", async () => {
    const root = await makeFixtureRoot();
    const sqlitePath = path.join(root, ".state", "local-console.sqlite");
    const folderA = path.join(root, "workspace-a");
    const folderB = path.join(root, "workspace-b");
    const folderC = path.join(root, "workspace-c");
    await Promise.all([folderA, folderB, folderC].map((folderPath) => fs.mkdir(folderPath, { recursive: true })));
    const store = await createSqliteLocalConsoleStore({ sqlitePath });
    await store.init();
    const projectA = await store.createProject({ folderPath: folderA, worktreeMode: false, now: "2026-07-09T00:00:01.000Z" });
    const projectB = await store.createProject({ folderPath: folderB, worktreeMode: false, now: "2026-07-09T00:00:02.000Z" });
    expect((await store.listProjects()).map((project) => project.projectId)).toEqual([
      projectB.projectId,
      projectA.projectId,
    ]);

    const explicitOrder = [projectA.projectId, projectB.projectId];
    await store.reorderProjects(explicitOrder);
    await store.updateProject({ projectId: projectB.projectId, worktreeMode: true, now: "2026-07-09T00:00:03.000Z" });
    expect((await store.listProjects()).map((project) => project.projectId)).toEqual(explicitOrder);
    await expect(store.reorderProjects([projectA.projectId])).rejects.toThrow(
      "project order must contain every active project exactly once",
    );
    await store.close();

    const reopened = await createSqliteLocalConsoleStore({ sqlitePath });
    await reopened.init();
    expect((await reopened.listProjects()).map((project) => project.projectId)).toEqual(explicitOrder);
    const projectC = await reopened.createProject({ folderPath: folderC, worktreeMode: false, now: "2026-07-09T00:00:04.000Z" });
    expect((await reopened.listProjects()).map((project) => project.projectId)).toEqual([
      projectC.projectId,
      ...explicitOrder,
    ]);
    await reopened.close();
  });

  it("repairs an unavailable project folder in place and rejects an active folder binding conflict", async () => {
    const root = await makeFixtureRoot();
    await writeAgent(root, "dev", "# Dev\n\nROLE:dev");
    let runCount = 0;
    const oldFolder = path.join(root, "repair-old");
    const movedFolder = path.join(root, "repair-moved");
    const occupiedFolder = path.join(root, "repair-occupied");
    await fs.mkdir(oldFolder, { recursive: true });
    await fs.mkdir(occupiedFolder, { recursive: true });
    const started = await startLocalConsoleServer({
      projectRoot: root,
      port: 0,
      runCodex: vi.fn(async (options: CodexRunOptions) => {
        runCount += 1;
        await options.onThreadStarted?.(threadIdFor(options));
        return codexOk(options, runCount === 1 ? "修复前历史已记录" : "项目修复后继续推进");
      }),
      makeRunDir: (count) => path.join(root, "runs", `repair-${String(count)}`),
      storeTimeoutMs: STANDARD_STORE_TIMEOUT_MS,
    });
    try {
      const project = await createProject(started.url, oldFolder, false);
      const session = await createProjectSession(started.url, "repair history", project.projectId);
      expect((await postSessionMessage(started.url, session.sessionId, "@dev 先记录历史")).status).toBe(202);
      await waitForState(started.url, session.sessionId, (state) =>
        state.activeRun === null && state.messages.some((message) => message.body === "修复前历史已记录"),
      );
      await createProject(started.url, occupiedFolder, false);
      await fs.rename(oldFolder, movedFolder);

      const unavailable = await getState(started.url, session.sessionId);
      expect(unavailable.project).toMatchObject({
        projectId: project.projectId,
        folderPath: oldFolder,
        directoryAvailable: false,
        directoryUnavailableReason: "当前项目本地文件夹未找到，可以指定新的文件夹",
      });
      expect(unavailable.selectedSession).toMatchObject({
        continuation: { canContinue: false, kind: "project-unavailable", recoveryAction: "repair-project" },
      });
      expect(unavailable.messages).toEqual(expect.arrayContaining([
        expect.objectContaining({
          speaker: "system",
          systemEventKind: "other",
          error: "project-unavailable",
          body: expect.stringContaining("项目文件夹"),
        }),
      ]));

      const blockedSession = await fetch(new URL("/api/local-console/sessions", started.url), {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ title: "blocked", projectId: project.projectId }),
      });
      expect(blockedSession.status).toBe(409);
      await expect(blockedSession.json()).resolves.toMatchObject({ code: "PROJECT_DIRECTORY_UNAVAILABLE" });

      const blockedSend = await postSessionMessage(started.url, session.sessionId, "@dev blocked");
      expect(blockedSend.status).toBe(409);
      await expect(blockedSend.json()).resolves.toMatchObject({ code: "PROJECT_DIRECTORY_UNAVAILABLE" });

      const conflict = await repairProjectFolder(started.url, project.projectId, occupiedFolder);
      expect(conflict.status).toBe(409);
      await expect(conflict.json()).resolves.toMatchObject({ code: "PROJECT_FOLDER_ALREADY_BOUND" });
      expect((await getState(started.url, session.sessionId)).project.folderPath).toBe(oldFolder);

      const repaired = await repairProjectFolder(started.url, project.projectId, movedFolder);
      expect(repaired.status).toBe(200);
      await expect(repaired.json()).resolves.toMatchObject({
        project: {
          projectId: project.projectId,
          folderPath: movedFolder,
          directoryAvailable: true,
          sessions: [expect.objectContaining({ sessionId: session.sessionId })],
        },
      });
      const restored = await getState(started.url, session.sessionId);
      expect(restored.project).toMatchObject({
        projectId: project.projectId,
        folderPath: movedFolder,
        directoryAvailable: true,
      });
      expect(restored.selectedSession).toMatchObject({
        continuation: { canContinue: true, kind: "available" },
      });
      expect(restored.project.sessions.map((entry) => entry.sessionId)).toContain(session.sessionId);
      expect((await postSessionMessage(started.url, session.sessionId, "@dev 修复后继续")).status).toBe(202);
      const continued = await waitForState(started.url, session.sessionId, (state) =>
        state.activeRun === null && state.messages.some((message) =>
          message.systemEventKind === "resume-unavailable"
          && message.error === "resume-unavailable:context-mismatch"
        ),
      );
      expect(continued.messages.some((message) => message.body === "修复前历史已记录")).toBe(true);
      expect(runCount).toBe(1);
      await expect(createProjectSession(started.url, "restored", project.projectId)).resolves.toMatchObject({
        projectId: project.projectId,
      });
    } finally {
      await started.close();
    }
  }, 20_000);

  it("interrupts an in-place run when its project folder disappears", async () => {
    const root = await makeFixtureRoot();
    const folderPath = path.join(root, "direct-disappears");
    await fs.mkdir(folderPath, { recursive: true });
    await writeAgent(root, "dev", "# Dev\n\nROLE:dev");
    const runCodex = vi.fn(waitForAbortResult);
    const started = await startLocalConsoleServer({
      projectRoot: root,
      port: 0,
      runCodex,
      makeRunDir: (count) => path.join(root, "runs", `direct-disappears-${String(count)}`),
      storeTimeoutMs: STANDARD_STORE_TIMEOUT_MS,
    });
    try {
      const project = await createProject(started.url, folderPath, false);
      const session = await createProjectSession(started.url, "direct disappears", project.projectId);
      await postSessionMessage(started.url, session.sessionId, "@dev keep running");
      await waitForState(started.url, session.sessionId, (state) => state.activeRun?.workspaceMode === "direct");

      await fs.rm(folderPath, { recursive: true });
      const unavailable = await getState(started.url, session.sessionId);
      expect(unavailable.project.directoryAvailable).toBe(false);
      const interrupted = await waitForState(started.url, session.sessionId, (state) =>
        state.messages.some((message) => message.status === "interrupted"),
      );
      expect(interrupted.messages).toEqual(expect.arrayContaining([
        expect.objectContaining({ status: "interrupted", error: "interrupted:project-directory-unavailable" }),
      ]));
      expect(runCodex).toHaveBeenCalledTimes(1);
    } finally {
      await started.close();
    }
  });

  it("lets a worktree finish its current step after source loss, then stops the handoff", async () => {
    const root = await makeFixtureRoot();
    const folderPath = path.join(root, "worktree-disappears");
    const movedFolder = path.join(root, "worktree-moved");
    await createGitRepo(folderPath);
    await writeAgent(root, "dev", "# Dev\n\nROLE:dev");
    await writeAgent(root, "qa", "# QA\n\nROLE:qa");
    const roles: string[] = [];
    const runCodex = vi.fn(async (options: CodexRunOptions): Promise<CodexRunResult> => {
      roles.push(roleFromPrompt(options.prompt));
      await fs.rename(folderPath, movedFolder);
      return codexOk(options, "@qa verify next");
    });
    const started = await startLocalConsoleServer({
      projectRoot: root,
      workdirRoot: path.join(root, "workdir"),
      port: 0,
      runCodex,
      makeRunDir: (count) => path.join(root, "runs", `worktree-disappears-${String(count)}`),
      storeTimeoutMs: STANDARD_STORE_TIMEOUT_MS,
    });
    try {
      const project = await createProject(started.url, folderPath, true);
      const session = await createProjectSession(started.url, "worktree disappears", project.projectId);
      await postSessionMessage(started.url, session.sessionId, "@dev run once");
      const stopped = await waitForState(started.url, session.sessionId, (state) =>
        state.messages.some((message) => message.speaker === "system" && message.error === "PROJECT_DIRECTORY_UNAVAILABLE"),
      );
      expect(roles).toEqual(["dev"]);
      expect(stopped.messages).toEqual(expect.arrayContaining([
        expect.objectContaining({ speaker: "agent", role: "dev", body: "@qa verify next" }),
        expect.objectContaining({ speaker: "system", status: "failed", error: "PROJECT_DIRECTORY_UNAVAILABLE" }),
      ]));
      expect(stopped.project.directoryAvailable).toBe(false);
    } finally {
      await started.close();
    }
  });

  it("keeps sessions ordered by creation time when an older session is updated", async () => {
    const root = await makeFixtureRoot();
    const sqlitePath = path.join(root, ".state", "local-console.sqlite");
    const store = await createSqliteLocalConsoleStore({ sqlitePath });
    await store.init();
    try {
      await store.createSession({
        sessionId: "local:older",
        title: "older",
        now: "2099-07-09T00:00:00.000Z",
      });
      await store.createSession({
        sessionId: "local:newer",
        title: "newer",
        now: "2099-07-09T00:01:00.000Z",
      });
      await store.appendUserMessage({
        sessionId: "local:older",
        body: "updating an old session must not move it",
        now: "2099-07-09T00:02:00.000Z",
      });

      const orderedSessionIds = (await store.listSessions())
        .filter((session) => session.sessionId === "local:older" || session.sessionId === "local:newer")
        .map((session) => session.sessionId);
      expect(orderedSessionIds).toEqual(["local:newer", "local:older"]);

      const localProject = (await store.listProjects()).find((project) => project.projectId === LOCAL_CONSOLE_PROJECT_ID);
      expect(
        localProject?.sessions
          .filter((session) => session.sessionId === "local:older" || session.sessionId === "local:newer")
          .map((session) => session.sessionId),
      ).toEqual(["local:newer", "local:older"]);
    } finally {
      await store.close();
    }
  });

  it("backfills a missing session createdAt from its earliest message id", async () => {
    const root = await makeFixtureRoot();
    const sqlitePath = path.join(root, ".state", "local-console.sqlite");
    await fs.mkdir(path.dirname(sqlitePath), { recursive: true });
    const database = new DatabaseSync(sqlitePath);
    try {
      database.exec(`
        CREATE TABLE sessions (
          session_id TEXT PRIMARY KEY,
          project_id TEXT,
          source_type TEXT NOT NULL,
          source_owner TEXT,
          source_repo TEXT,
          source_issue_number INTEGER,
          parent_session_id TEXT,
          title TEXT,
          status TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );
        CREATE TABLE local_messages (
          id INTEGER PRIMARY KEY,
          session_id TEXT NOT NULL,
          speaker TEXT NOT NULL,
          role TEXT,
          body TEXT NOT NULL,
          status TEXT NOT NULL,
          run_id TEXT,
          run_dir TEXT,
          error TEXT,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );
        INSERT INTO sessions
          (session_id, project_id, source_type, title, status, updated_at)
        VALUES
          ('local:legacy', 'local', 'local', 'legacy', 'active', '2099-07-09T00:03:00.000Z');
        INSERT INTO local_messages
          (id, session_id, speaker, role, body, status, run_id, run_dir, error, created_at, updated_at)
        VALUES
          (20, 'local:legacy', 'user', NULL, 'later id', 'completed', NULL, NULL, NULL, '2099-07-09T00:01:00.000Z', '2099-07-09T00:01:00.000Z'),
          (10, 'local:legacy', 'user', NULL, 'earliest id', 'completed', NULL, NULL, NULL, '2099-07-09T00:02:00.000Z', '2099-07-09T00:02:00.000Z');
      `);
    } finally {
      database.close();
    }

    const store = await createSqliteLocalConsoleStore({ sqlitePath });
    await store.init();
    try {
      expect((await store.listSessions()).find((session) => session.sessionId === "local:legacy")?.createdAt)
        .toBe("2099-07-09T00:02:00.000Z");
    } finally {
      await store.close();
    }
  });

  it("uses the earliest legacy message id when migration synthesizes the default session", async () => {
    const root = await makeFixtureRoot();
    const sqlitePath = path.join(root, ".state", "local-console.sqlite");
    await fs.mkdir(path.dirname(sqlitePath), { recursive: true });
    const database = new DatabaseSync(sqlitePath);
    try {
      database.exec(`
        CREATE TABLE local_messages (
          id INTEGER PRIMARY KEY,
          session_id TEXT NOT NULL,
          speaker TEXT NOT NULL,
          role TEXT,
          body TEXT NOT NULL,
          status TEXT NOT NULL,
          run_id TEXT,
          run_dir TEXT,
          error TEXT,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );
        INSERT INTO local_messages
          (id, session_id, speaker, role, body, status, run_id, run_dir, error, created_at, updated_at)
        VALUES
          (20, 'default', 'user', NULL, 'later id', 'completed', NULL, NULL, NULL, '2099-07-09T00:01:00.000Z', '2099-07-09T00:01:00.000Z'),
          (10, 'default', 'user', NULL, 'earliest id', 'completed', NULL, NULL, NULL, '2099-07-09T00:02:00.000Z', '2099-07-09T00:02:00.000Z');
      `);
    } finally {
      database.close();
    }

    const store = await createSqliteLocalConsoleStore({ sqlitePath });
    await store.init();
    try {
      expect((await store.listSessions()).find((session) => session.sessionId === LOCAL_CONSOLE_DEFAULT_SESSION_ID)?.createdAt)
        .toBe("2099-07-09T00:02:00.000Z");
    } finally {
      await store.close();
    }
  });

  it("moves only empty unlinked local sessions and fails closed on either lineage source", async () => {
    const root = await makeFixtureRoot();
    const sqlitePath = path.join(root, ".state", "local-console.sqlite");
    const targetFolder = path.join(root, "workspace-target");
    await fs.mkdir(targetFolder, { recursive: true });
    let store = await createSqliteLocalConsoleStore({ sqlitePath });
    await store.init();
    const target = await store.createProject({
      folderPath: targetFolder,
      worktreeMode: false,
      now: "2026-07-09T01:00:00.000Z",
    });
    const sessionIds = ["movable", "with-message", "parent-column", "reverse-child", "edge-parent", "edge-child"];
    for (const sessionId of sessionIds) {
      await store.createSession({
        sessionId: `local:${sessionId}`,
        title: sessionId,
        now: "2026-07-09T01:00:01.000Z",
      });
    }
    await store.appendUserMessage({
      sessionId: "local:with-message",
      body: "history locks project",
      now: "2026-07-09T01:00:02.000Z",
    });

    await store.close();
    const database = new DatabaseSync(sqlitePath);
    try {
      database.prepare("UPDATE sessions SET parent_session_id = ? WHERE session_id = ?")
        .run("local:missing-parent", "local:parent-column");
      database.prepare(
        `INSERT INTO sessions
          (session_id, project_id, source_type, parent_session_id, title, status, created_at, updated_at)
         VALUES (?, ?, 'local', ?, 'column-only-child', 'idle', ?, ?)`,
      ).run(
        "local:column-only-child",
        LOCAL_CONSOLE_PROJECT_ID,
        "local:reverse-child",
        "2026-07-09T01:00:03.000Z",
        "2026-07-09T01:00:03.000Z",
      );
      database.prepare(
        `INSERT INTO session_edges (parent_session_id, child_session_id, relation, hidden_key, created_at)
         VALUES (?, ?, 'task', 'edge-only', ?)`,
      ).run("local:edge-parent", "local:edge-child", "2026-07-09T01:00:04.000Z");
      database.prepare(
        `INSERT INTO sessions
          (session_id, project_id, source_type, title, status, created_at, updated_at)
         VALUES ('github:foreign', NULL, 'github', 'foreign', 'idle', ?, ?)`,
      ).run("2026-07-09T01:00:04.000Z", "2026-07-09T01:00:04.000Z");
    } finally {
      database.close();
    }
    store = await createSqliteLocalConsoleStore({ sqlitePath });

    await expect(store.moveEmptySessionToProject({
      sessionId: "local:movable",
      projectId: target.projectId,
      now: "2026-07-09T01:00:05.000Z",
    })).resolves.toMatchObject({ sessionId: "local:movable", projectId: target.projectId });

    for (const sessionId of ["with-message", "parent-column", "reverse-child", "edge-parent", "edge-child"]) {
      await expect(store.moveEmptySessionToProject({
        sessionId: `local:${sessionId}`,
        projectId: target.projectId,
        now: "2026-07-09T01:00:06.000Z",
      })).rejects.toMatchObject({ code: "SESSION_PROJECT_LOCKED" });
    }
    await expect(store.moveEmptySessionToProject({
      sessionId: "local:missing",
      projectId: target.projectId,
      now: "2026-07-09T01:00:06.000Z",
    })).rejects.toMatchObject({ code: "LOCAL_SESSION_NOT_FOUND" });
    await expect(store.moveEmptySessionToProject({
      sessionId: "github:foreign",
      projectId: target.projectId,
      now: "2026-07-09T01:00:06.000Z",
    })).rejects.toMatchObject({ code: "LOCAL_SESSION_NOT_FOUND" });
    await expect(store.moveEmptySessionToProject({
      sessionId: "local:parent-column",
      projectId: "missing-project",
      now: "2026-07-09T01:00:06.000Z",
    })).rejects.toMatchObject({ code: "LOCAL_PROJECT_NOT_FOUND" });

    const unchanged = (await store.listSessions()).filter((session) =>
      ["local:with-message", "local:parent-column", "local:reverse-child", "local:edge-parent", "local:edge-child"].includes(session.sessionId),
    );
    expect(unchanged.every((session) => session.projectId === LOCAL_CONSOLE_PROJECT_ID)).toBe(true);
    expect(await store.listMessages("local:with-message")).toHaveLength(1);
    await store.close();
  });

  it("maps session project rebinding API validation and domain failures to stable status codes", async () => {
    const root = await makeFixtureRoot();
    const store = await createSqliteLocalConsoleStore({ sqlitePath: path.join(root, ".state", "local-console.sqlite") });
    await store.init();
    const targetFolder = path.join(root, "api-target");
    await fs.mkdir(targetFolder, { recursive: true });
    const target = await store.createProject({ folderPath: targetFolder, worktreeMode: false, now: "2026-07-09T02:00:00.000Z" });
    await store.createSession({ sessionId: "local:api-empty", title: "api empty", now: "2026-07-09T02:00:01.000Z" });
    await store.createSession({ sessionId: "local:api-locked", title: "api locked", now: "2026-07-09T02:00:01.000Z" });
    await store.appendUserMessage({ sessionId: "local:api-locked", body: "locked", now: "2026-07-09T02:00:02.000Z" });

    const started = await startLocalConsoleServer({ projectRoot: root, port: 0, store, storeTimeoutMs: STANDARD_STORE_TIMEOUT_MS });
    try {
      const invalidJson = await fetch(new URL("/api/local-console/sessions/local%3Aapi-empty/project", started.url), {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: "{",
      });
      expect(invalidJson.status).toBe(400);
      await expect(invalidJson.json()).resolves.toMatchObject({ code: "INVALID_SESSION_PROJECT_REQUEST" });

      const invalidField = await fetch(new URL("/api/local-console/sessions/local%3Aapi-empty/project", started.url), {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ projectId: "" }),
      });
      expect(invalidField.status).toBe(400);
      await expect(invalidField.json()).resolves.toMatchObject({ code: "INVALID_SESSION_PROJECT_REQUEST" });

      const missingProject = await patchSessionProject(started.url, "local:api-empty", "missing-project");
      expect(missingProject.status).toBe(404);
      await expect(missingProject.json()).resolves.toMatchObject({ code: "LOCAL_PROJECT_NOT_FOUND" });

      const missingSession = await patchSessionProject(started.url, "local:missing", target.projectId);
      expect(missingSession.status).toBe(404);
      await expect(missingSession.json()).resolves.toMatchObject({ code: "LOCAL_SESSION_NOT_FOUND" });

      const locked = await patchSessionProject(started.url, "local:api-locked", target.projectId);
      expect(locked.status).toBe(409);
      await expect(locked.json()).resolves.toMatchObject({ code: "SESSION_PROJECT_LOCKED" });

      const moved = await patchSessionProject(started.url, "local:api-empty", target.projectId);
      expect(moved.status).toBe(200);
      await expect(moved.json()).resolves.toMatchObject({
        session: { sessionId: "local:api-empty", projectId: target.projectId },
      });
    } finally {
      await started.close();
    }
  });

  it("persists T5 child sessions and remaining local records idempotently", async () => {
    const root = await makeFixtureRoot();
    const sqlitePath = path.join(root, ".state", "local-console.sqlite");
    const store = await createSqliteLocalConsoleStore({ sqlitePath });
    await store.init();
    try {
      await store.createSession({ sessionId: "local:parent", title: "parent", now: "2026-07-09T00:00:00.000Z" });
      const child = await store.createChildSession({
        parentSessionId: "local:parent",
        childSessionId: "local:child",
        projectId: LOCAL_CONSOLE_PROJECT_ID,
        title: "child task",
        relation: "task",
        hiddenKey: "child-key-1",
        initialRole: "dev",
        initialBody: "Initial handoff",
        now: "2026-07-09T00:00:01.000Z",
      });
      const duplicate = await store.createChildSession({
        parentSessionId: "local:parent",
        childSessionId: "local:child-duplicate",
        projectId: LOCAL_CONSOLE_PROJECT_ID,
        title: "duplicate",
        relation: "task",
        hiddenKey: "child-key-1",
        initialRole: "dev",
        initialBody: "Should recover existing",
        now: "2026-07-09T00:00:02.000Z",
      });
      expect(duplicate.sessionId).toBe(child.sessionId);

      await recordLocalRouteDecision(
        { sqlitePath },
        {
          sessionId: "local:parent",
          messageId: 1,
          routeKey: "route:1",
          outcome: "append",
          targetRole: "dev",
          reason: "goal-shape",
          now: "2026-07-09T00:00:03.000Z",
        },
      );
      await recordLocalDeadLetter(
        { sqlitePath },
        {
          sessionId: "local:parent",
          sourceMessageId: 1,
          failureCount: 5,
          reason: "exit-code-1",
          recovered: false,
          now: "2026-07-09T00:00:06.000Z",
        },
      );

      const sessions = await store.listSessions();
      expect(sessions.find((entry) => entry.sessionId === "local:parent")).toMatchObject({ childCount: 1 });
      expect(sessions.find((entry) => entry.sessionId === "local:child")).toMatchObject({
        parentSessionId: "local:parent",
      });
      const facts = await listLocalT5Facts({ sqlitePath });
      expect(facts.sessionEdges).toHaveLength(1);
      expect(facts.routeDecisions).toHaveLength(1);
      expect(facts.acceptanceFacts).toHaveLength(0);
      expect(facts.integrationEvents).toHaveLength(0);
      expect(facts.deadLetters).toHaveLength(1);
    } finally {
      await store.close();
    }
  });

  it("treats acceptance words as ordinary text while the unique user mention routes directly", async () => {
    const root = await makeFixtureRoot();
    await writeAgent(root, "dev-manager", "# dev-manager\n\nROLE:dev-manager");
    await writeAgent(root, "qa", "# qa\n\nROLE:qa");
    const calls: string[] = [];
    const runCodex = vi.fn(async (options: CodexRunOptions): Promise<CodexRunResult> => {
      const role = roleFromPrompt(options.prompt);
      calls.push(role);
      return codexOk(
        options,
        role === "qa"
          ? "验收结论：通过。未发现阻塞问题。"
          : "报数与检查已经完成，还有什么指示？",
      );
    });
    const started = await startLocalConsoleServer({
      projectRoot: root,
      port: 0,
      listAgentFiles: async () => [
        { name: "dev-manager", path: path.join(root, "agents", "dev-manager.md") },
        { name: "qa", path: path.join(root, "agents", "qa.md") },
      ],
      runCodex,
      makeRunDir: (count) => path.join(root, "runs", `ordinary-acceptance-${String(count)}`),
      storeTimeoutMs: STANDARD_STORE_TIMEOUT_MS,
    });
    try {
      const session = await createSession(started.url, "ordinary acceptance words");
      await postSessionMessage(started.url, session.sessionId, "@qa 请报数，并说明通过或不通过");
      const state = await waitForState(started.url, session.sessionId, (data) =>
        data.messages.filter((entry) => entry.speaker === "agent").length === 2,
      );
      expect(calls).toEqual(["qa", "dev-manager"]);
      expect(state.messages.filter((entry) => entry.speaker === "agent").map((entry) => entry.role))
        .toEqual(["qa", "dev-manager"]);
      expect(state.messages.filter((entry) => entry.speaker === "system")).not.toEqual(expect.arrayContaining([
        expect.objectContaining({ body: expect.stringContaining("formal acceptance statements") }),
      ]));
      const facts = await listLocalT5Facts({ sqlitePath: started.sqlitePath }, session.sessionId);
      expect(facts.acceptanceFacts).toHaveLength(0);
      expect(facts.integrationEvents).toHaveLength(0);
    } finally {
      await started.close();
    }
  });
  it("rejects cross-project local child sessions and hidden key collisions", async () => {
    const root = await makeFixtureRoot();
    const sqlitePath = path.join(root, ".state", "local-console.sqlite");
    const otherFolder = path.join(root, "other-project");
    await fs.mkdir(otherFolder, { recursive: true });
    const store = await createSqliteLocalConsoleStore({ sqlitePath });
    await store.init();
    try {
      const otherProject = await store.createProject({
        folderPath: otherFolder,
        worktreeMode: false,
        now: "2026-07-09T00:00:00.000Z",
      });
      await store.createSession({ sessionId: "local:parent", title: "parent", now: "2026-07-09T00:00:01.000Z" });

      await expect(
        store.createChildSession({
          parentSessionId: "local:parent",
          childSessionId: "local:cross-project",
          projectId: otherProject.projectId,
          title: "bad child",
          relation: "task",
          hiddenKey: "hidden:cross-project",
          initialRole: "dev",
          initialBody: "bad",
          now: "2026-07-09T00:00:02.000Z",
        }),
      ).rejects.toThrow(/project mismatch/u);
      expect((await store.listSessions()).find((entry) => entry.sessionId === "local:cross-project")).toBeUndefined();

      const childA = await store.createChildSession({
        parentSessionId: "local:parent",
        childSessionId: "local:child-a",
        projectId: LOCAL_CONSOLE_PROJECT_ID,
        title: "child A",
        relation: "task",
        hiddenKey: "hidden:collision",
        initialRole: "dev",
        initialBody: "child A",
        now: "2026-07-09T00:00:03.000Z",
      });

      const database = new DatabaseSync(sqlitePath);
      try {
        database
          .prepare(
            `INSERT INTO sessions
              (session_id, project_id, source_type, source_owner, source_repo, source_issue_number, parent_session_id, title, status, created_at, updated_at)
             VALUES ('local:child-b', ?, 'local', NULL, NULL, NULL, 'local:parent', 'child B', 'active', ?, ?)`,
          )
          .run(LOCAL_CONSOLE_PROJECT_ID, "2026-07-09T00:00:04.000Z", "2026-07-09T00:00:04.000Z");
        database
          .prepare(
            `INSERT INTO session_edges (parent_session_id, child_session_id, relation, hidden_key, created_at)
             VALUES ('local:parent', 'local:child-b', 'task', 'hidden:collision', ?)`,
          )
          .run("2026-07-09T00:00:04.000Z");
      } finally {
        database.close();
      }

      await expect(
        store.createChildSession({
          parentSessionId: "local:parent",
          childSessionId: "local:child-c",
          projectId: LOCAL_CONSOLE_PROJECT_ID,
          title: "child C",
          relation: "task",
          hiddenKey: "hidden:collision",
          initialRole: "dev",
          initialBody: "child C",
          now: "2026-07-09T00:00:05.000Z",
        }),
      ).rejects.toThrow(/hidden key collision/u);

      expect(childA).toMatchObject({ parentSessionId: "local:parent", projectId: LOCAL_CONSOLE_PROJECT_ID });
    } finally {
      await store.close();
    }
  });

  it("maps a local CEO child orchestration result to child sessions", async () => {
    const root = await makeFixtureRoot();
    await writeAgent(root, "ceo", "# CEO\n\nROLE:ceo");
    await writeAgent(root, "dev", "# Dev\n\nROLE:dev");
    await writeCeoScript(root, "milestone-spawn-child-issues", "spawn_child_issues");
    const ceoOutput = `${JSON.stringify({
      action: "spawn_child_issues",
      workflowId: "milestone-spawn-child-issues",
      summary: "spawn local children",
      groups: [{ id: "g-runtime-sqlite-serial", reason: "runtime sqlite serial" }],
      issues: [
        {
          ledgerTaskId: "task-a",
          groupId: "g-runtime-sqlite-serial",
          title: "Task A",
          description: "Implement task A",
          initialRole: "dev",
          qualityBaseline: "production",
          taskChecks: ["跑 A → 应通过"],
          dependencies: [],
          provenance: "local test",
        },
        {
          ledgerTaskId: "task-b",
          groupId: "g-runtime-sqlite-serial",
          title: "Task B",
          description: "Implement task B",
          initialRole: "dev",
          qualityBaseline: "production",
          dependencies: ["task-a"],
          provenance: "local test",
        },
      ],
    })}\n\n<!-- moebius:stage=in-progress -->`;
    const ceoProviderGate = deferred<void>();
    let ceoProviderStarted = false;
    const runCodex = vi.fn(async (options: CodexRunOptions): Promise<CodexRunResult> => {
      ceoProviderStarted = true;
      await ceoProviderGate.promise;
      return codexOk(options, ceoOutput);
    });
    let started = await startLocalConsoleServer({
      projectRoot: root,
      port: 0,
      runCodex,
      listAgentFiles: async (sessionId) => sessionId.startsWith("local:child:")
        ? []
        : [
            { name: "ceo", agentMarkdown: "ROLE:ceo" },
            { name: "dev", agentMarkdown: "ROLE:dev" },
          ],
      makeRunDir: (count) => path.join(root, "runs", `child-orchestration-${String(count)}`),
      storeTimeoutMs: STANDARD_STORE_TIMEOUT_MS,
    });
    try {
      const parent = await createSession(started.url, "parent goal");
      await postSessionMessage(started.url, parent.sessionId, "@ceo spawn child sessions");
      await waitForCondition(
        () => ceoProviderStarted,
        {
          describe: "CEO provider invocation for child orchestration",
          kind: "io",
          timeoutMs: 6_000,
          snapshot: () => ({ ceoProviderStarted, providerCalls: runCodex.mock.calls.length }),
        },
      );
      ceoProviderGate.resolve(undefined);
      const state = await waitForState(
        started.url,
        parent.sessionId,
        (data) => {
          const sessions = data.projects.flatMap((project) => project.sessions);
          return sessions.filter((session) => session.parentSessionId === parent.sessionId).length === 2 &&
            data.messages.some((entry) => entry.sourceKind === "local-child-session-card");
        },
        {
          describe: "two child sessions and their persisted child-session card",
          timeoutMs: 10_000,
          snapshot: (data) => data === null ? null : ({
            childSessionCount: data.projects
              .flatMap((project) => project.sessions)
              .filter((session) => session.parentSessionId === parent.sessionId).length,
            childCardCount: data.messages.filter((entry) => entry.sourceKind === "local-child-session-card").length,
            messageStatuses: data.messages.map((entry) => ({
              role: entry.role,
              sourceKind: entry.sourceKind,
              status: entry.status,
            })),
          }),
        },
      );
      const childSessions = state.projects.flatMap((project) => project.sessions).filter((session) => session.parentSessionId === parent.sessionId);
      expect(childSessions.map((session) => session.title).sort()).toEqual(["Task A", "Task B"]);
      const triggerIndex = state.messages.findIndex((entry) => entry.body === ceoOutput);
      const cardIndex = state.messages.findIndex((entry) => entry.sourceKind === "local-child-session-card");
      expect(cardIndex).toBeGreaterThan(triggerIndex);
      expect(JSON.parse(state.messages[cardIndex]!.body)).toMatchObject({
        version: 1,
        childSessionIds: expect.arrayContaining(childSessions.map((session) => session.sessionId)),
      });
      expect(state.childSessions).toEqual(expect.arrayContaining([
        expect.objectContaining({ title: "Task A", memberName: "开发" }),
        expect.objectContaining({ title: "Task B", memberName: "开发" }),
      ]));
      const taskA = childSessions.find((session) => session.title === "Task A")!;
      const taskB = childSessions.find((session) => session.title === "Task B")!;
      const [taskAState, taskBState] = await Promise.all([
        waitForState(
          started.url,
          taskA.sessionId,
          (data) => data.messages.length > 0,
          {
            describe: "Task A child session initial message",
            timeoutMs: 4_000,
            snapshot: (data) => data === null ? null : ({ messageBodies: data.messages.map((entry) => entry.body) }),
          },
        ),
        waitForState(
          started.url,
          taskB.sessionId,
          (data) => data.messages.length > 0,
          {
            describe: "Task B child session initial message",
            timeoutMs: 4_000,
            snapshot: (data) => data === null ? null : ({ messageBodies: data.messages.map((entry) => entry.body) }),
          },
        ),
      ]);
      expect(taskAState.messages[0]?.body).toContain("任务检查参考:\n1. 跑 A → 应通过");
      expect(taskBState.messages[0]?.body).not.toContain("任务检查参考:");
      expect(taskAState.messages[0]?.body).not.toContain("Acceptance statements:");
      const facts = await listLocalT5Facts({ sqlitePath: started.sqlitePath }, parent.sessionId);
      expect(facts.sessionEdges).toHaveLength(2);

      await started.close();
      started = await startLocalConsoleServer({
        projectRoot: root,
        port: 0,
        runCodex,
        listAgentFiles: async (sessionId) => sessionId.startsWith("local:child:")
          ? []
          : [
              { name: "ceo", agentMarkdown: "ROLE:ceo" },
              { name: "dev", agentMarkdown: "ROLE:dev" },
            ],
        makeRunDir: (count) => path.join(root, "runs", `child-orchestration-restart-${String(count)}`),
        storeTimeoutMs: STANDARD_STORE_TIMEOUT_MS,
      });
      const restartedState = await getState(started.url, parent.sessionId);
      expect(restartedState.messages.findIndex((entry) => entry.sourceKind === "local-child-session-card"))
        .toBe(cardIndex);
      expect(restartedState.messages.findIndex((entry) => entry.body === ceoOutput))
        .toBe(triggerIndex);
    } finally {
      ceoProviderGate.resolve(undefined);
      await started.close();
    }
  }, 20_000 * waitScale());

  it("builds local timelines that reuse mention parsing rules", () => {
    const agents = ["dev"];
    const runTimeline = buildLocalConsoleTimeline([message({ id: 1, body: "@dev hello" })], agents);
    expect(resolveTrigger({ timeline: runTimeline, availableAgentNames: agents })).toMatchObject({
      kind: "run-agent",
      role: "dev",
    });

    const codeTimeline = buildLocalConsoleTimeline([message({ id: 1, body: "示例：`@dev hello`" })], agents);
    expect(resolveTrigger({ timeline: codeTimeline, availableAgentNames: agents })).toEqual({
      kind: "skip",
      reason: "no-trigger",
    });
  });

  it("routes a claimed source without treating newer execution context as the trigger", () => {
    const agents = ["manager", "worker"];
    const messages = [
      message({ id: 1, speaker: "user", body: "start" }),
      message({ id: 2, speaker: "agent", role: "manager", body: "take this @worker" }),
      message({ id: 3, speaker: "system", body: "worker failed" }),
      message({ id: 4, speaker: "agent", role: "manager", body: "new public context" }),
    ];

    const routingTimeline = buildLocalConsoleRoutingTimeline(messages, 2, agents);
    expect(resolveTrigger({
      timeline: routingTimeline,
      availableAgentNames: agents,
    })).toMatchObject({
      kind: "run-agent",
      role: "worker",
    });

    const executionTimeline = buildLocalConsoleTimeline(messages, agents);
    expect(executionTimeline.at(-1)?.body).toContain("new public context");
  });

  it("runs a local HTTP message through fake Codex without calling gh", async () => {
    const root = await makeFixtureRoot();
    await writeAgent(root, "dev", "# Dev\n\nReply briefly.");
    const fakeBin = path.join(root, "fake-bin");
    await fs.mkdir(fakeBin, { recursive: true });
    const ghLog = path.join(root, "fake-gh.log");
    await fs.writeFile(path.join(fakeBin, "gh"), fakeCommandScript(ghLog, "gh"), { mode: 0o755 });
    process.env.PATH = `${fakeBin}${path.delimiter}${originalPath ?? ""}`;

    const runCodex = vi.fn(async (options: CodexRunOptions): Promise<CodexRunResult> => ({
      ok: true,
      finalText: "hello from fake codex",
      threadId: threadIdFor(options),
      cachedInputTokens: null,
      runDir: options.runDir,
      stdoutPath: path.join(options.runDir, "stdout.jsonl"),
      stderrPath: path.join(options.runDir, "stderr.log"),
    }));

    const started = await startLocalConsoleServer({
      projectRoot: root,
      port: 0,
      runCodex,
      makeRunDir: (count) => path.join(root, "runs", `run-${String(count)}`),
      storeTimeoutMs: STANDARD_STORE_TIMEOUT_MS,
    });
    try {
      const post = await fetch(new URL("/api/local-console/messages", started.url), {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ body: "@dev 帮我写个 hello" }),
      });
      expect(post.status).toBe(202);

      const snapshot = await waitForSnapshot(started.url, (data) =>
        data.messages.some((entry) => entry.speaker === "agent" && entry.body.includes("fake codex")),
      );
      expect(snapshot.messages).toMatchObject([
        { speaker: "user", status: "completed" },
        { speaker: "agent", role: "dev", body: "hello from fake codex" },
      ]);
      expect(runCodex).toHaveBeenCalledTimes(1);
      await expect(fs.stat(ghLog)).rejects.toMatchObject({ code: "ENOENT" });
    } finally {
      await started.close();
    }
  });

  it("runs a non-git project in place and records worktree unavailable reason", async () => {
    const root = await makeFixtureRoot();
    const folderPath = path.join(root, "plain-folder");
    await fs.mkdir(folderPath, { recursive: true });
    await writeAgent(root, "dev", "# Dev\n\nROLE:dev");
    const cwdCalls: string[] = [];
    const runCodex = vi.fn(async (options: CodexRunOptions): Promise<CodexRunResult> => {
      if (options.cwd === undefined) {
        throw new Error("codex cwd is required");
      }
      const cwd = options.cwd;
      cwdCalls.push(cwd);
      await fs.writeFile(path.join(cwd, "local-output.txt"), "changed", "utf8");
      return codexOk(options, "done in non git");
    });
    const started = await startLocalConsoleServer({
      projectRoot: root,
      workdirRoot: path.join(root, "workdir"),
      port: 0,
      runCodex,
      makeRunDir: (count) => path.join(root, "runs", `non-git-${String(count)}`),
      storeTimeoutMs: STANDARD_STORE_TIMEOUT_MS,
    });
    try {
      const project = await createProject(started.url, folderPath, true);
      const session = await createProjectSession(started.url, "plain", project.projectId);
      await postSessionMessage(started.url, session.sessionId, "@dev write in cwd");
      const state = await waitForState(started.url, session.sessionId, (data) =>
        data.messages.some((entry) => entry.speaker === "agent" && entry.body === "done in non git"),
      );
      expect(cwdCalls).toEqual([folderPath]);
      expect(state.project).toMatchObject({
        projectId: project.projectId,
        folderPath,
        worktreeMode: true,
        worktreeUnavailableReason: "not-git-repository",
      });
      await expect(fs.readFile(path.join(folderPath, "local-output.txt"), "utf8")).resolves.toBe("changed");
      await expect(fs.stat(path.join(folderPath, ".git"))).rejects.toMatchObject({ code: "ENOENT" });
    } finally {
      await started.close();
    }
  });

  it("generates a workspace diff fact after a successful git worktree run", async () => {
    const root = await makeFixtureRoot();
    const folderPath = path.join(root, "git-project");
    await createGitRepo(folderPath);
    await writeAgent(root, "dev", "# Dev\n\nROLE:dev");
    const runCodex = vi.fn(async (options: CodexRunOptions): Promise<CodexRunResult> => {
      if (options.cwd === undefined) {
        throw new Error("codex cwd is required");
      }
      await fs.writeFile(path.join(options.cwd, "local-output.txt"), "changed", "utf8");
      return codexOk(options, "done in worktree\n\n<!-- moebius:stage=code-verified -->");
    });
    const started = await startLocalConsoleServer({
      projectRoot: root,
      workdirRoot: path.join(root, "workdir"),
      port: 0,
      runCodex,
      makeRunDir: (count) => path.join(root, "runs", `git-${String(count)}`),
      storeTimeoutMs: STANDARD_STORE_TIMEOUT_MS,
    });
    try {
      const project = await createProject(started.url, folderPath, true);
      const session = await createProjectSession(started.url, "git", project.projectId);
      await postSessionMessage(started.url, session.sessionId, "@dev write in worktree");
      await waitForState(started.url, session.sessionId, (data) =>
        data.messages.some((entry) => entry.speaker === "agent" && entry.body.includes("done in worktree")),
      );
      const facts = await listLocalT5Facts({ sqlitePath: started.sqlitePath }, session.sessionId);
      expect(facts.workspaceDiffs).toHaveLength(1);
      const [diff] = facts.workspaceDiffs as Array<{
        affected_files_json: string;
        original_repo_root: string;
        patch_path: string;
        status: string;
        worktree_path: string;
      }>;
      await expect(fs.realpath(diff.original_repo_root)).resolves.toBe(await fs.realpath(folderPath));
      expect(diff).toMatchObject({ status: "generated" });
      expect(JSON.parse(diff.affected_files_json) as string[]).toContain("local-output.txt");
      await expect(fs.readFile(diff.patch_path, "utf8")).resolves.toContain("local-output.txt");
      await expect(fs.stat(path.join(diff.worktree_path, "local-output.txt"))).resolves.toBeDefined();
      expect(await gitStatus(folderPath)).toBe("");
    } finally {
      await started.close();
    }
  });

  it("does not generate a returnable workspace diff for plan-written worktree runs", async () => {
    const root = await makeFixtureRoot();
    const folderPath = path.join(root, "git-project-plan");
    await createGitRepo(folderPath);
    await writeAgent(root, "dev", "# Dev\n\nROLE:dev");
    const runCodex = vi.fn(async (options: CodexRunOptions): Promise<CodexRunResult> => {
      if (options.cwd === undefined) {
        throw new Error("codex cwd is required");
      }
      await fs.writeFile(path.join(options.cwd, "plan-output.txt"), "draft", "utf8");
      return codexOk(options, "plan only\n\n<!-- moebius:stage=plan-written -->");
    });
    const started = await startLocalConsoleServer({
      projectRoot: root,
      workdirRoot: path.join(root, "workdir"),
      port: 0,
      runCodex,
      makeRunDir: (count) => path.join(root, "runs", `git-plan-${String(count)}`),
      storeTimeoutMs: STANDARD_STORE_TIMEOUT_MS,
    });
    try {
      const project = await createProject(started.url, folderPath, true);
      const session = await createProjectSession(started.url, "git plan", project.projectId);
      await postSessionMessage(started.url, session.sessionId, "@dev write plan in worktree");
      await waitForState(started.url, session.sessionId, (data) =>
        data.messages.some((entry) => entry.speaker === "agent" && entry.body.includes("plan only")),
      );
      const facts = await listLocalT5Facts({ sqlitePath: started.sqlitePath }, session.sessionId);
      expect(facts.workspaceDiffs).toHaveLength(0);
      expect(await gitStatus(folderPath)).toBe("");
    } finally {
      await started.close();
    }
  });

  it("drains local agent handoffs without waiting for the fixed poll interval", async () => {
    const root = await makeFixtureRoot();
    for (const role of ["ceo", "dev-manager", "dev", "qa"]) {
      await writeAgent(root, role, `# ${role}\n\nROLE:${role}`);
    }
    const providerGates = Array.from({ length: 5 }, () => deferred<void>());
    const calls: Array<{ role: string; timerOrigin: boolean }> = [];
    const schedulingEvents: Array<{ method: "process-pending" | "process-all-pending"; timerOrigin: boolean }> = [];
    let primaryCallCount = 0;
    const timerOrigin = trackTimerCallbackOrigin();
    const runCodex = vi.fn(async (options: CodexRunOptions): Promise<CodexRunResult> => {
      const role = roleFromPrompt(options.prompt);
      const callIndex = calls.length;
      calls.push({ role, timerOrigin: timerOrigin.isInsideTimerCallback() });
      await providerGates[callIndex]!.promise;
      if (role === "ceo") {
        primaryCallCount += 1;
        return codexOk(options, primaryCallCount === 1 ? "@dev-manager please review" : "Team handoff complete");
      }
      const next: Record<string, string> = {
        "dev-manager": "@dev please implement",
        dev: "@qa please test",
        qa: "QA done",
      };
      return codexOk(options, next[role] ?? "done");
    });
    let started: Awaited<ReturnType<typeof startLocalConsoleServer>> | null = null;
    let processPendingSpy: { mockRestore(): void } | null = null;
    let processAllPendingSpy: { mockRestore(): void } | null = null;
    try {
      let sentinelSawTimerOrigin = false;
      await new Promise<void>((resolve) => {
        setTimeout(() => {
          sentinelSawTimerOrigin = timerOrigin.isInsideTimerCallback();
          resolve();
        }, 0);
      });
      expect(sentinelSawTimerOrigin).toBe(true);

      started = await startLocalConsoleServer({
        projectRoot: root,
        port: 0,
        runCodex,
        makeRunDir: (count) => path.join(root, "runs", `run-${String(count)}`),
        storeTimeoutMs: STANDARD_STORE_TIMEOUT_MS,
      });
      const originalProcessPending = started.runtime.processPending.bind(started.runtime);
      const originalProcessAllPending = started.runtime.processAllPending.bind(started.runtime);
      processPendingSpy = vi.spyOn(started.runtime, "processPending").mockImplementation(async (...args) => {
        schedulingEvents.push({
          method: "process-pending",
          timerOrigin: timerOrigin.isInsideTimerCallback(),
        });
        await originalProcessPending(...args);
      });
      processAllPendingSpy = vi.spyOn(started.runtime, "processAllPending").mockImplementation(async (...args) => {
        schedulingEvents.push({
          method: "process-all-pending",
          timerOrigin: timerOrigin.isInsideTimerCallback(),
        });
        await originalProcessAllPending(...args);
      });

      const session = await createSession(started.url, "handoff");
      await postSessionMessage(started.url, session.sessionId, "@ceo 我想做 X");
      await waitForValue(
        () => calls.length >= 1 ? calls[0] : undefined,
        {
          describe: "initial CEO provider call",
          kind: "io",
          timeoutMs: 8_000,
          snapshot: () => ({ calls, schedulingEvents }),
        },
      );
      schedulingEvents.length = 0;

      for (let callIndex = 0; callIndex < providerGates.length - 1; callIndex += 1) {
        const schedulingStart = schedulingEvents.length;
        providerGates[callIndex]!.resolve(undefined);
        const nextCall = await waitForValue(
          () => calls.length > callIndex + 1 ? calls[callIndex + 1] : undefined,
          {
            describe: `completion-triggered provider call ${String(callIndex + 2)} of 5`,
            kind: "io",
            timeoutMs: 8_000,
            snapshot: () => ({
              releasedThrough: callIndex + 1,
              calls,
              schedulingEvents: schedulingEvents.slice(schedulingStart),
            }),
          },
        );
        expect(nextCall?.timerOrigin).toBe(false);
        expect(schedulingEvents.slice(schedulingStart).filter((event) => event.timerOrigin)).toEqual([]);
      }
      providerGates[providerGates.length - 1]!.resolve(undefined);

      const state = await waitForState(
        started.url,
        session.sessionId,
        (data) => data.messages.filter((entry) => entry.speaker === "agent").length === 5,
        {
          describe: "five persisted handoff agent messages and final CEO closeout",
          timeoutMs: 8_000,
          snapshot: handoffStateSnapshot,
        },
      );
      expect(state.messages.filter((entry) => entry.speaker === "agent").map((entry) => entry.role)).toEqual([
        "ceo",
        "dev-manager",
        "dev",
        "qa",
        "ceo",
      ]);
      expect(calls.map((entry) => entry.role)).toEqual(["ceo", "dev-manager", "dev", "qa", "ceo"]);
      expect(state.messages.filter((entry) => entry.speaker === "agent").at(-1)?.body).toBe("Team handoff complete");
    } finally {
      for (const gate of providerGates) {
        gate.resolve(undefined);
      }
      try {
        if (started !== null) {
          await started.close();
        }
      } finally {
        processPendingSpy?.mockRestore();
        processAllPendingSpy?.mockRestore();
        timerOrigin.restore();
      }
    }
  }, 30_000);

  it("rejects archive while a claimed handoff is resolving, then archives after it completes", async () => {
    const root = await makeFixtureRoot();
    await writeAgent(root, "qa", "# QA\n\nROLE:qa");
    const sqlitePath = path.join(root, ".state", "local-console.sqlite");
    const store = await createSqliteLocalConsoleStore({ sqlitePath });
    await store.init();
    const user = await store.appendUserMessage({
      sessionId: LOCAL_CONSOLE_DEFAULT_SESSION_ID,
      body: "@dev prepare QA",
      now: "2026-07-20T00:00:00.000Z",
    });
    await store.claimNextPendingMessage({
      sessionId: LOCAL_CONSOLE_DEFAULT_SESSION_ID,
      runId: "run-seed",
      now: "2026-07-20T00:00:01.000Z",
    });
    await store.recordAgentResponse({
      userMessageId: user.id,
      sessionId: LOCAL_CONSOLE_DEFAULT_SESSION_ID,
      role: "dev",
      body: "@qa 请继续验收",
      runId: "run-seed",
      runDir: "/tmp/run-seed",
      processSteps: [],
      now: "2026-07-20T00:00:02.000Z",
    });

    const releaseAgentList = deferred<LocalConsoleAgentFile[]>();
    let listCallCount = 0;
    const listAgentFiles = vi.fn(async () => {
      listCallCount += 1;
      if (listCallCount === 1) {
        return await releaseAgentList.promise;
      }
      return [{ name: "qa", path: path.join(root, "agents", "qa.md") }];
    });
    const runCodex = vi.fn(async (options: CodexRunOptions): Promise<CodexRunResult> => codexOk(options, "QA resumed"));
    const started = await startLocalConsoleServer({
      projectRoot: root,
      port: 0,
      store,
      listAgentFiles,
      runCodex,
      makeRunDir: (count) => path.join(root, "runs", `archive-handoff-${String(count)}`),
      storeTimeoutMs: STANDARD_STORE_TIMEOUT_MS,
    });
    try {
      await waitFor(() => listAgentFiles.mock.calls.length === 1);
      const archive = await fetch(
        new URL(`/api/local-console/sessions/${encodeURIComponent(LOCAL_CONSOLE_DEFAULT_SESSION_ID)}/archive`, started.url),
        { method: "POST" },
      );
      expect(archive.status).toBe(409);
      releaseAgentList.resolve([{ name: "qa", path: path.join(root, "agents", "qa.md") }]);
      const state = await waitForState(started.url, LOCAL_CONSOLE_DEFAULT_SESSION_ID, (data) =>
        data.messages.some((message) => message.speaker === "agent" && message.role === "qa" && message.body === "QA resumed") &&
        data.selectedSession?.hasPendingControlWork === false,
      );
      expect(runCodex).toHaveBeenCalledTimes(1);
      expect(state.messages.filter((message) => message.speaker === "agent").map((message) => message.role)).toEqual(["dev", "qa"]);
      const archiveAfterCompletion = await fetch(
        new URL(`/api/local-console/sessions/${encodeURIComponent(LOCAL_CONSOLE_DEFAULT_SESSION_ID)}/archive`, started.url),
        { method: "POST" },
      );
      expect(archiveAfterCompletion.status).toBe(200);
    } finally {
      await started.close();
    }
  });

  it("routes a user message without mention directly to the session primary Agent", async () => {
    const root = await makeFixtureRoot();
    for (const role of ["ceo", "dev"]) {
      await writeAgent(root, role, `# ${role}\n\nROLE:${role}`);
    }
    const routeJudgment = vi.fn(async () => ({
      action: "APPEND" as const,
      body: "@dev 请继续处理本地交棒。",
      targetRole: "dev",
      reason: "appended" as const,
    }));
    const runCodex = vi.fn(async (options: CodexRunOptions): Promise<CodexRunResult> => codexOk(options, "dev handled local route"));
    const started = await startLocalConsoleServer({
      projectRoot: root,
      port: 0,
      listAgentFiles: async () => [
        { name: "dev", path: path.join(root, "agents", "dev.md") },
        { name: "ceo", path: path.join(root, "agents", "ceo.md") },
      ],
      routeJudgment,
      runCodex,
      makeRunDir: (count) => path.join(root, "runs", `route-${String(count)}`),
      storeTimeoutMs: STANDARD_STORE_TIMEOUT_MS,
    });
    try {
      const session = await createSession(started.url, "local route");
      await postSessionMessage(started.url, session.sessionId, "交给 dev 继续处理");
      const state = await waitForState(started.url, session.sessionId, (data) =>
        data.messages.some((entry) => entry.speaker === "agent" && entry.role === "dev"),
      );
      expect(routeJudgment).not.toHaveBeenCalled();
      expect(runCodex).toHaveBeenCalledTimes(1);
      expect(state.messages).toEqual(expect.arrayContaining([
        expect.objectContaining({ speaker: "agent", role: "dev", body: "dev handled local route" }),
      ]));
      expect(state.messages.filter((entry) => entry.speaker === "agent" && entry.role === "ceo")).toHaveLength(0);
      const facts = await listLocalT5Facts({ sqlitePath: started.sqlitePath }, session.sessionId);
      expect(facts.routeDecisions).toEqual([]);
    } finally {
      await started.close();
    }
  }, 10_000);

  it("uses the legacy no-primary route fallback for a claimable message without dispatch metadata", async () => {
    const root = await makeFixtureRoot();
    const sqlitePath = path.join(root, ".state", "local-console.sqlite");
    const store = await createSqliteLocalConsoleStore({ sqlitePath });
    const routeJudgment = vi.fn(async () => ({
      action: "NO_ACTION" as const,
      reason: "ceo-no-action" as const,
    }));
    const runCodex = vi.fn(async (options: CodexRunOptions): Promise<CodexRunResult> =>
      codexOk(options, "unexpected provider response"));
    const started = await startLocalConsoleServer({
      projectRoot: root,
      port: 0,
      sqlitePath,
      store,
      listAgentFiles: async () => [],
      routeJudgment,
      runCodex,
      makeRunDir: (count) => path.join(root, "runs", `route-without-primary-${String(count)}`),
      storeTimeoutMs: STANDARD_STORE_TIMEOUT_MS,
    });
    try {
      const session = await createSession(started.url, "no primary route fallback");
      await store.appendUserMessage({
        sessionId: session.sessionId,
        body: "兼容消息没有 dispatch metadata",
        now: new Date().toISOString(),
      });
      await started.runtime.processPending(session.sessionId);
      const state = await waitForState(started.url, session.sessionId, (data) =>
        data.selectedSession?.hasPendingControlWork === false
      );

      expect(routeJudgment).toHaveBeenCalledTimes(1);
      expect(runCodex).not.toHaveBeenCalled();
      expect(state.activeRuns).toEqual([]);
      const facts = await listLocalT5Facts({ sqlitePath: started.sqlitePath }, session.sessionId);
      expect(facts.routeDecisions).toEqual([
        expect.objectContaining({ outcome: "no_action", reason: "ceo-no-action" }),
      ]);
    } finally {
      await started.close();
    }
  }, 10_000);

  it("does not rerun a completed primary Agent message without a mention", async () => {
    const root = await makeFixtureRoot();
    await writeAgent(root, "dev", "# dev\n\nROLE:dev");
    const routeJudgment = vi.fn(async () => ({
      action: "APPEND" as const,
      body: "@dev 请继续处理。",
      targetRole: "dev",
      reason: "appended" as const,
    }));
    const runCodex = vi.fn(async (options: CodexRunOptions): Promise<CodexRunResult> => codexOk(options, "dev once"));
    const started = await startLocalConsoleServer({
      projectRoot: root,
      port: 0,
      routeJudgment,
      runCodex,
      makeRunDir: (count) => path.join(root, "runs", `dedupe-${String(count)}`),
      storeTimeoutMs: STANDARD_STORE_TIMEOUT_MS,
    });
    try {
      const session = await createSession(started.url, "dedupe route");
      await postSessionMessage(started.url, session.sessionId, "交给 dev");
      await waitForState(started.url, session.sessionId, (data) =>
        data.messages.some((entry) => entry.speaker === "agent" && entry.role === "dev"),
      );
      await started.runtime.processPending(session.sessionId);
      await started.runtime.processPending(session.sessionId);
      const state = await getState(started.url, session.sessionId);
      expect(routeJudgment).not.toHaveBeenCalled();
      expect(runCodex).toHaveBeenCalledTimes(1);
      expect(state.messages.filter((entry) => entry.speaker === "agent" && entry.role === "dev")).toHaveLength(1);
      const facts = await listLocalT5Facts({ sqlitePath: started.sqlitePath }, session.sessionId);
      expect(facts.routeDecisions).toHaveLength(0);
    } finally {
      await started.close();
    }
  }, 10_000);

  it("silently advances an agent reply with no valid trigger once", async () => {
    const root = await makeFixtureRoot();
    await writeAgent(root, "ceo", "# ceo\n\nROLE:ceo");
    const runCodex = vi.fn(async (options: CodexRunOptions): Promise<CodexRunResult> => codexOk(options, "no handoff"));
    const started = await startLocalConsoleServer({
      projectRoot: root,
      port: 0,
      runCodex,
      makeRunDir: (count) => path.join(root, "runs", `run-${String(count)}`),
      storeTimeoutMs: STANDARD_STORE_TIMEOUT_MS,
    });
    try {
      const session = await createSession(started.url, "no trigger agent");
      await postSessionMessage(started.url, session.sessionId, "@ceo stop here");
      await waitForState(started.url, session.sessionId, (data) =>
        data.messages.some((entry) => entry.speaker === "agent" && entry.role === "ceo"),
      );
      await started.runtime.processPending(session.sessionId);
      await started.runtime.processPending(session.sessionId);
      const state = await getState(started.url, session.sessionId);
      expect(runCodex).toHaveBeenCalledTimes(1);
      expect(state.messages.filter((entry) => entry.speaker === "system" && entry.body.includes("No valid agent mention"))).toHaveLength(0);
    } finally {
      await started.close();
    }
  });

  it("resumes from a committed agent reply after restart without repeating the completed role", async () => {
    const root = await makeFixtureRoot();
    await writeAgent(root, "dev", "# dev\n\nROLE:dev");
    const sqlitePath = path.join(root, ".state", "local-console.sqlite");
    const store = await createSqliteLocalConsoleStore({ sqlitePath });
    await store.init();
    const session = await store.createSession({
      sessionId: "local:committed-agent",
      title: "committed agent",
      now: "2026-07-09T00:00:00.000Z",
    });
    const user = await store.appendUserMessage({
      sessionId: session.sessionId,
      body: "@ceo first",
      now: "2026-07-09T00:00:01.000Z",
    });
    await store.claimNextPendingMessage({
      sessionId: session.sessionId,
      runId: "run-ceo",
      now: "2026-07-09T00:00:02.000Z",
    });
    await store.recordAgentResponse({
      userMessageId: user.id,
      sessionId: session.sessionId,
      role: "ceo",
      body: "@dev continue",
      runId: "run-ceo",
      runDir: path.join(root, "runs", "ceo"),
      processSteps: [],
      now: "2026-07-09T00:00:03.000Z",
    });
    await store.close();

    const runCodex = vi.fn(async (options: CodexRunOptions): Promise<CodexRunResult> => codexOk(options, "dev done"));
    const started = await startLocalConsoleServer({
      projectRoot: root,
      sqlitePath,
      port: 0,
      runCodex,
      makeRunDir: (count) => path.join(root, "runs", `restart-${String(count)}`),
      storeTimeoutMs: STANDARD_STORE_TIMEOUT_MS,
    });
    try {
      const state = await waitForState(started.url, session.sessionId, (data) =>
        data.messages.some((entry) => entry.speaker === "agent" && entry.role === "dev"),
      );
      expect(state.messages.filter((entry) => entry.speaker === "agent").map((entry) => entry.role)).toEqual(["ceo", "dev"]);
      expect(runCodex).toHaveBeenCalledTimes(1);
    } finally {
      await started.close();
    }
  });

  it("keeps a pre-commit response failure stopped until the user explicitly retries", async () => {
    const root = await makeFixtureRoot();
    await writeAgent(root, "dev", "# dev\n\nROLE:dev");
    const sqlitePath = path.join(root, ".state", "local-console.sqlite");
    const innerStore = await createSqliteLocalConsoleStore({ sqlitePath });
    const store = new FailOnceRecordAgentResponseStore(innerStore);
    const runCodex = vi.fn(async (options: CodexRunOptions): Promise<CodexRunResult> => codexOk(options, "dev done"));
    const started = await startLocalConsoleServer({
      projectRoot: root,
      sqlitePath,
      port: 0,
      store,
      runCodex,
      makeRunDir: (count) => path.join(root, "runs", `run-${String(count)}`),
      storeTimeoutMs: STANDARD_STORE_TIMEOUT_MS,
    });
    try {
      const session = await createSession(started.url, "record failure");
      await postSessionMessage(started.url, session.sessionId, "@dev retry me");
      await waitFor(() => runCodex.mock.calls.length === 1);
      const failed = await waitForState(started.url, session.sessionId, (data) =>
        data.messages.some((entry) => entry.systemEventKind === "run-not-started"),
      );
      expect(failed.pendingPrimaryMessages).toHaveLength(0);
      expect((await getState(started.url, session.sessionId)).messages.filter((entry) => entry.speaker === "agent")).toHaveLength(0);

      const failure = failed.messages.find((entry) => entry.systemEventKind === "run-not-started");
      const retry = await fetch(new URL(
        `/api/local-console/sessions/${encodeURIComponent(session.sessionId)}/runs/${encodeURIComponent(failure!.runId!)}/retry`,
        started.url,
      ), { method: "POST" });
      expect(retry.status).toBe(202);
      const state = await waitForState(started.url, session.sessionId, (data) =>
        data.messages.some((entry) => entry.speaker === "agent" && entry.role === "dev"),
      );
      expect(runCodex).toHaveBeenCalledTimes(2);
      expect(state.messages.filter((entry) => entry.speaker === "agent")).toHaveLength(1);
    } finally {
      await started.close();
    }
  });

  it("records a stuck handoff run and lets later local messages continue", async () => {
    const root = await makeFixtureRoot();
    for (const role of ["ceo", "dev", "qa"]) {
      await writeAgent(root, role, `# ${role}\n\nROLE:${role}`);
    }
    let ceoCallCount = 0;
    const runCodex = vi.fn(async (options: CodexRunOptions): Promise<CodexRunResult> => {
      const role = roleFromPrompt(options.prompt);
      if (role === "ceo") {
        ceoCallCount += 1;
        return codexOk(options, ceoCallCount === 1 ? "@dev continue" : "primary after stuck");
      }
      if (role === "dev") {
        return {
          ok: false,
          reason: "max-duration-timeout:20ms",
          runDir: options.runDir,
          stdoutPath: path.join(options.runDir, "stdout.jsonl"),
          stderrPath: path.join(options.runDir, "stderr.log"),
        };
      }
      return codexOk(options, "qa after stuck");
    });
    const started = await startLocalConsoleServer({
      projectRoot: root,
      port: 0,
      runCodex,
      makeRunDir: (count) => path.join(root, "runs", `run-${String(count)}`),
      storeTimeoutMs: STANDARD_STORE_TIMEOUT_MS,
      codexMaxDurationMs: 20,
    });
    try {
      const session = await createSession(started.url, "stuck handoff");
      await postSessionMessage(started.url, session.sessionId, "@ceo start");
      await waitForState(started.url, session.sessionId, (data) =>
        data.messages.some((entry) => entry.status === "stuck" && entry.error === "max-duration-timeout:20ms"),
      );

      const next = await postSessionMessage(started.url, session.sessionId, "@qa after stuck");
      expect(next.status).toBe(202);
      const state = await waitForState(started.url, session.sessionId, (data) =>
        data.messages.some((entry) => entry.speaker === "agent" && entry.body === "primary after stuck"),
      );
      expect(state.messages).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ speaker: "system", systemEventKind: "run-stuck", body: expect.stringContaining("这一步卡住了") }),
          expect.objectContaining({ speaker: "agent", role: "ceo", body: "primary after stuck" }),
        ]),
      );
    } finally {
      await started.close();
    }
  }, 30_000);

  it("runs startup catch-up for another session while one session is slow", async () => {
    const root = await makeFixtureRoot();
    await writeAgent(root, "dev", "# dev\n\nROLE:dev");
    const sqlitePath = path.join(root, ".state", "local-console.sqlite");
    const store = await createSqliteLocalConsoleStore({ sqlitePath });
    await store.init();
    const sessionA = await store.createSession({
      sessionId: "local:slow-a",
      title: "slow A",
      now: "2026-07-09T00:00:00.000Z",
    });
    const sessionB = await store.createSession({
      sessionId: "local:fast-b",
      title: "fast B",
      now: "2026-07-09T00:00:00.000Z",
    });
    await store.appendUserMessage({
      sessionId: sessionA.sessionId,
      body: "@dev slow startup",
      now: "2026-07-09T00:00:01.000Z",
    });
    await store.appendUserMessage({
      sessionId: sessionB.sessionId,
      body: "@dev fast startup",
      now: "2026-07-09T00:00:02.000Z",
    });
    await store.close();

    let fastProviderStarted = false;
    let slowProviderStarted = false;
    let slowProviderSettled = false;
    const runCodex = vi.fn(async (options: CodexRunOptions): Promise<CodexRunResult> => {
      if (options.prompt.includes("slow startup")) {
        slowProviderStarted = true;
        try {
          return await waitForAbortResult(options);
        } finally {
          slowProviderSettled = true;
        }
      }
      fastProviderStarted = true;
      return codexOk(options, "fast done");
    });
    const started = await startLocalConsoleServer({
      projectRoot: root,
      sqlitePath,
      port: 0,
      runCodex,
      listAgentFiles: async () => [{ name: "dev", agentMarkdown: "ROLE:dev" }],
      makeRunDir: (count) => path.join(root, "runs", `startup-${String(count)}`),
      storeTimeoutMs: STANDARD_STORE_TIMEOUT_MS,
    });
    try {
      await waitForCondition(
        () => slowProviderStarted,
        {
          describe: "startup catch-up reaches slow provider after fast provider",
          kind: "io",
          timeoutMs: 6_000,
          snapshot: () => ({
            fastProviderStarted,
            slowProviderStarted,
            providerPrompts: runCodex.mock.calls.map(([options]) =>
              (options as CodexRunOptions).prompt.includes("slow startup") ? "slow" : "fast"),
          }),
        },
      );
      const fastState = await getState(started.url, sessionB.sessionId);
      const slowState = await getState(started.url, sessionA.sessionId);
      expect(fastState.messages).toEqual(
        expect.arrayContaining([expect.objectContaining({ speaker: "agent", role: "dev", body: "fast done" })]),
      );
      expect(slowState.activeRun).toMatchObject({ sessionId: sessionA.sessionId, interruptible: true });
    } finally {
      await started.close();
      expect(slowProviderSettled).toBe(true);
    }
  }, 10_000 * waitScale());

  it("returns project/session state and runs messages in the selected session", async () => {
    const root = await makeFixtureRoot();
    await writeAgent(root, "dev", "# Dev\n\nReply briefly.");
    const runCodex = vi.fn(async (options: CodexRunOptions): Promise<CodexRunResult> => ({
      ok: true,
      finalText: `reply for ${path.basename(options.runDir)}`,
      threadId: threadIdFor(options),
      cachedInputTokens: null,
      runDir: options.runDir,
      stdoutPath: path.join(options.runDir, "stdout.jsonl"),
      stderrPath: path.join(options.runDir, "stderr.log"),
    }));
    const started = await startLocalConsoleServer({
      projectRoot: root,
      port: 0,
      runCodex,
      makeRunDir: (count) => path.join(root, "runs", `run-${String(count)}`),
      storeTimeoutMs: STANDARD_STORE_TIMEOUT_MS,
    });
    try {
      const session = await createSession(started.url, "T4 验收会话");
      expect(session.title).toBe("T4 验收会话");

      const post = await postSessionMessage(started.url, session.sessionId, "@dev session hello");
      expect(post.status).toBe(202);

      const state = await waitForState(started.url, session.sessionId, (data) =>
        data.messages.some((entry) => entry.speaker === "agent" && entry.body.includes("reply")),
      );
      expect(state.project.sessions.map((entry) => entry.sessionId)).toContain(session.sessionId);
      expect(state.selectedSessionId).toBe(session.sessionId);
      expect(state.messages).toMatchObject([
        { speaker: "user", status: "completed", body: "@dev session hello" },
        { speaker: "agent", role: "dev", status: "displayed" },
      ]);
    } finally {
      await started.close();
    }
  });

  it("shows a bounded live run snapshot with non-empty fallback output", async () => {
    const root = await makeFixtureRoot();
    await writeAgent(root, "dev", "# Dev");
    const runCodex = vi.fn((options: CodexRunOptions) => waitForAbortResult(options));
    const started = await startLocalConsoleServer({
      projectRoot: root,
      port: 0,
      runCodex,
      makeRunDir: (count) => path.join(root, "runs", `run-${String(count)}`),
      storeTimeoutMs: STANDARD_STORE_TIMEOUT_MS,
    });
    try {
      const session = await createSession(started.url, "empty output");
      await postSessionMessage(started.url, session.sessionId, "@dev slow empty output");
      const state = await waitForState(started.url, session.sessionId, (data) => data.activeRun !== null);
      expect(state.activeRun).toMatchObject({
        sessionId: session.sessionId,
        status: "running",
        liveMarkdown: null,
        lastOutputSummary: "正在运行，等待输出",
        interruptible: true,
      });
      expect(state.activeRun?.elapsedMs).toBeGreaterThanOrEqual(0);
      expect(state.activeRun?.runDir).toContain(path.join(root, "runs"));

      const interrupted = await interruptRun(started.url, session.sessionId, state.activeRun?.runId ?? "");
      expect(interrupted.status).toBe(202);
      await waitForState(started.url, session.sessionId, (data) =>
        data.messages.some((entry) => entry.status === "interrupted"),
      );
    } finally {
      await started.close();
    }
  });

  it("replaces live Markdown in one active run and persists only the final agent message", async () => {
    const root = await makeFixtureRoot();
    await writeAgent(root, "dev", "# Dev");
    const captured: {
      options?: CodexRunOptions;
      finish?: (result: CodexRunResult) => void;
    } = {};
    let firstMarkdownObserved = false;
    const runCodex = vi.fn((options: CodexRunOptions) => {
      captured.options = options;
      options.onStructuredActivity?.({
        type: "item.started",
        item: { type: "command_execution", command: "pnpm test --filter /private/work" },
      });
      options.onVisibleAgentMarkdown?.("## 第一段\n\n正在检查。");
      firstMarkdownObserved = true;
      return new Promise<CodexRunResult>((resolve) => {
        captured.finish = resolve;
      });
    });
    const started = await startLocalConsoleServer({
      projectRoot: root,
      port: 0,
      runCodex,
      makeRunDir: (count) => path.join(root, "runs", `run-${String(count)}`),
      storeTimeoutMs: STANDARD_STORE_TIMEOUT_MS,
    });
    try {
      const session = await createSession(started.url, "live Markdown");
      await postSessionMessage(started.url, session.sessionId, "@dev 展示进度");
      await waitForCondition(() => firstMarkdownObserved, {
        describe: "first active run live Markdown callback",
        kind: "logic",
        timeoutMs: 2_000,
        snapshot: () => ({ firstMarkdownObserved, providerCalls: runCodex.mock.calls.length }),
      });
      const first = await getState(started.url, session.sessionId);
      expect(first.activeRun?.liveMarkdown).toBe("## 第一段\n\n正在检查。");
      const runId = first.activeRun?.runId;
      expect(first.messages).toHaveLength(1);
      expect(first.activeRun?.startedAt).not.toBeNull();
      expect(first.activeRun?.elapsedMs).toBeGreaterThanOrEqual(0);

      captured.options?.onStructuredActivity?.({
        type: "item.completed",
        item: { type: "file_change", path: "/private/work/src/run-block.tsx", status: "completed" },
      });
      captured.options?.onVisibleAgentMarkdown?.("## 第二段\n\n检查完成。");
      const second = await getState(started.url, session.sessionId);
      expect(second.activeRun?.liveMarkdown).toBe("## 第二段\n\n检查完成。");
      expect(second.activeRun?.runId).toBe(runId);
      expect(second.messages).toHaveLength(1);
      expect(second.activeRun?.activity).toMatchObject({
        kind: "progress",
        action: "正在处理",
        object: "第二段",
      });
      expect(JSON.stringify(second.activeRun?.activity)).not.toContain("/private/work");

      const options = captured.options;
      const finishRun = captured.finish;
      if (options === undefined || finishRun === undefined) {
        throw new Error("Codex run was not captured");
      }
      finishRun({
        ok: true,
        finalText: "## 最终结果\n\n只落库一次。",
        threadId: "thread-live",
        cachedInputTokens: null,
        runDir: options.runDir,
        stdoutPath: path.join(options.runDir, "stdout.jsonl"),
        stderrPath: path.join(options.runDir, "stderr.log"),
      });
      const completed = await waitForState(
        started.url,
        session.sessionId,
        (data) => data.activeRun === null && data.messages.some((entry) => entry.speaker === "agent"),
        {
          describe: "active run completion",
          timeoutMs: LIVE_RUN_COMPLETION_WAIT_TIMEOUT_MS,
          snapshot: (snapshot) => snapshot === null ? null : {
            activeRun: snapshot.activeRun === null ? null : {
              runId: snapshot.activeRun.runId,
              liveMarkdown: snapshot.activeRun.liveMarkdown,
              activity: snapshot.activeRun.activity,
            },
            activeRunCount: snapshot.activeRuns.length,
            messages: snapshot.messages.map((entry) => ({
              speaker: entry.speaker,
              body: entry.body,
              status: entry.status,
              error: entry.error,
            })),
          },
        },
      );
      expect(completed.messages.map((entry) => entry.speaker)).toEqual(["user", "agent"]);
      expect(completed.messages[1]?.body).toBe("## 最终结果\n\n只落库一次。");
      expect(completed.messages[1]?.runTiming).toMatchObject({
        stepId: `message:${String(completed.messages[0]?.id)}`,
        attempt: 1,
        status: "completed",
        engine: "codex",
        processOutputAvailable: true,
      });
      expect(completed.messages[1]?.runTiming?.elapsedMs).toBeGreaterThanOrEqual(0);
      expect(completed.messages[1]?.runTiming?.completedAt).not.toBeNull();
      const factLogPath = path.join(root, "sessions", `${Buffer.from(session.sessionId, "utf8").toString("base64url")}.jsonl`);
      const factEvents = (await fs.readFile(factLogPath, "utf8")).trimEnd().split("\n")
        .map((line) => JSON.parse(line) as { type: string; payload?: { body?: string } });
      expect(factEvents.filter((event) => event.type === "agent_progress").map((event) => event.payload?.body))
        .toEqual(["## 第一段\n\n正在检查。", "## 第二段\n\n检查完成。"]);
      expect(factEvents.filter((event) => event.type === "run_activity")).toHaveLength(4);
      expect(factEvents.filter((event) => event.type === "run_lifecycle").map((event) =>
        (event.payload as { phase?: string }).phase)).toEqual(["created", "started", "terminal"]);
    } finally {
      await started.close();
    }
  }, 10_000);

  it("interrupts only when both sessionId and runId match", async () => {
    const root = await makeFixtureRoot();
    await writeAgent(root, "dev", "# Dev");
    let callCount = 0;
    let firstProviderStarted = false;
    let firstProviderSettled = false;
    let secondProviderStarted = false;
    const runCodex = vi.fn(async (options: CodexRunOptions): Promise<CodexRunResult> => {
      callCount += 1;
      if (callCount === 1) {
        firstProviderStarted = true;
        try {
          return await waitForAbortResult(options);
        } finally {
          firstProviderSettled = true;
        }
      }
      secondProviderStarted = true;
      return codexOk(options, "after interrupt");
    });
    const started = await startLocalConsoleServer({
      projectRoot: root,
      port: 0,
      runCodex,
      listAgentFiles: async () => [{ name: "dev", agentMarkdown: "ROLE:dev" }],
      makeRunDir: (count) => path.join(root, "runs", `run-${String(count)}`),
      storeTimeoutMs: STANDARD_STORE_TIMEOUT_MS,
    });
    try {
      const sessionA = await createSession(started.url, "A");
      const sessionB = await createSession(started.url, "B");
      await postSessionMessage(started.url, sessionA.sessionId, "@dev slow A");
      await waitForCondition(
        () => firstProviderStarted,
        {
          describe: "first interruptible provider starts",
          kind: "io",
          timeoutMs: 4_000,
          snapshot: () => ({ callCount, firstProviderStarted }),
        },
      );
      const runningA = await getState(started.url, sessionA.sessionId);
      expect(runningA.activeRun).toMatchObject({
        sessionId: sessionA.sessionId,
        role: "dev",
        interruptible: true,
      });

      const wrongSession = await interruptRun(started.url, sessionB.sessionId, runningA.activeRun?.runId ?? "");
      expect(wrongSession.status).toBe(409);
      expect(firstProviderSettled).toBe(false);
      expect((await getState(started.url, sessionA.sessionId)).activeRun?.runId).toBe(runningA.activeRun?.runId);

      const rightSession = await interruptRun(started.url, sessionA.sessionId, runningA.activeRun?.runId ?? "");
      expect(rightSession.status).toBe(202);
      await waitForCondition(
        () => firstProviderSettled,
        {
          describe: "matching interrupt settles the first provider",
          kind: "logic",
          timeoutMs: 2_000,
          snapshot: () => ({ firstProviderStarted, firstProviderSettled }),
        },
      );
      const interrupted = await waitForState(
        started.url,
        sessionA.sessionId,
        (data) => data.messages.some((entry) => entry.status === "interrupted"),
        {
          describe: "matching interrupt persists user and system interruption facts",
          timeoutMs: 4_000,
          snapshot: (data) => data === null ? null : ({
            activeRuns: data.activeRuns.map((run) => ({ runId: run.runId, role: run.role })),
            messages: data.messages.map((entry) => ({
              speaker: entry.speaker,
              status: entry.status,
              systemEventKind: entry.systemEventKind,
            })),
          }),
        },
      );
      expect(interrupted.messages).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ speaker: "user", status: "interrupted", error: "interrupted:user-interrupted" }),
          expect.objectContaining({ speaker: "system", systemEventKind: "user-stopped", body: expect.stringContaining("你让这一步停下了") }),
        ]),
      );
      expect(secondProviderStarted).toBe(false);
      expect(runCodex).toHaveBeenCalledTimes(1);
    } finally {
      await started.close();
    }
  }, 10_000);

  it("runs the next provider message after a matching interrupt", async () => {
    const root = await makeFixtureRoot();
    await writeAgent(root, "dev", "# Dev");
    let callCount = 0;
    let firstProviderStarted = false;
    let firstProviderSettled = false;
    let secondProviderStarted = false;
    const runCodex = vi.fn(async (options: CodexRunOptions): Promise<CodexRunResult> => {
      callCount += 1;
      if (callCount === 1) {
        firstProviderStarted = true;
        try {
          return await waitForAbortResult(options);
        } finally {
          firstProviderSettled = true;
        }
      }
      secondProviderStarted = true;
      return codexOk(options, "after interrupt");
    });
    const started = await startLocalConsoleServer({
      projectRoot: root,
      port: 0,
      runCodex,
      listAgentFiles: async () => [{ name: "dev", agentMarkdown: "ROLE:dev" }],
      makeRunDir: (count) => path.join(root, "runs", `interrupt-recovery-${String(count)}`),
      storeTimeoutMs: STANDARD_STORE_TIMEOUT_MS,
    });
    try {
      const session = await createSession(started.url, "interrupt recovery");
      await postSessionMessage(started.url, session.sessionId, "@dev slow first");
      await waitForCondition(
        () => firstProviderStarted,
        {
          describe: "interrupt recovery first provider starts",
          kind: "io",
          timeoutMs: 4_000,
          snapshot: () => ({ callCount, firstProviderStarted }),
        },
      );
      const running = await getState(started.url, session.sessionId);
      expect((await interruptRun(started.url, session.sessionId, running.activeRun?.runId ?? "")).status).toBe(202);
      await waitForCondition(
        () => firstProviderSettled,
        {
          describe: "interrupt recovery first provider settles",
          kind: "logic",
          timeoutMs: 2_000,
          snapshot: () => ({ firstProviderStarted, firstProviderSettled }),
        },
      );

      expect((await postSessionMessage(started.url, session.sessionId, "@dev after interrupt")).status).toBe(202);
      await waitForCondition(
        () => secondProviderStarted,
        {
          describe: "interrupt recovery second provider starts",
          kind: "io",
          timeoutMs: 4_000,
          snapshot: () => ({ callCount, firstProviderSettled, secondProviderStarted }),
        },
      );
      const completed = await waitForState(
        started.url,
        session.sessionId,
        (data) => data.messages.some((entry) => entry.speaker === "agent" && entry.body === "after interrupt"),
        {
          describe: "interrupt recovery second provider response is persisted",
          timeoutMs: 4_000,
          snapshot: (data) => data === null ? null : ({
            activeRuns: data.activeRuns.map((run) => ({ runId: run.runId, role: run.role })),
            agentBodies: data.messages.filter((entry) => entry.speaker === "agent").map((entry) => entry.body),
          }),
        },
      );
      expect(completed.messages).toEqual(expect.arrayContaining([
        expect.objectContaining({ speaker: "agent", role: "dev", body: "after interrupt" }),
      ]));
      expect(runCodex).toHaveBeenCalledTimes(2);
    } finally {
      await started.close();
    }
  }, 10_000 * waitScale());

  it("queues user messages for the primary agent and activates them in delivery order", async () => {
    const root = await makeFixtureRoot();
    const firstRunGate = deferred<void>();
    const prompts: string[] = [];
    const roles: string[] = [];
    let firstProviderStarted = false;
    let secondProviderStarted = false;
    const runCodex = vi.fn(async (options: CodexRunOptions): Promise<CodexRunResult> => {
      prompts.push(options.prompt);
      roles.push(roleFromPrompt(options.prompt));
      if (prompts.length === 1) {
        firstProviderStarted = true;
        await firstRunGate.promise;
        return codexOk(options, "第一轮主理人回复");
      }
      secondProviderStarted = true;
      return codexOk(options, "第二轮主理人回复");
    });
    const started = await startLocalConsoleServer({
      projectRoot: root,
      port: 0,
      runCodex,
      listAgentFiles: async () => [
        { name: "dev-manager", agentMarkdown: "ROLE:dev-manager" },
        { name: "qa", agentMarkdown: "ROLE:qa" },
      ],
      makeRunDir: (count) => path.join(root, "runs", `run-${String(count)}`),
      storeTimeoutMs: STANDARD_STORE_TIMEOUT_MS,
    });
    try {
      const session = await createSession(started.url, "primary pending");
      expect((await postSessionMessage(started.url, session.sessionId, "先检查现状")).status).toBe(202);
      await waitForCondition(
        () => firstProviderStarted,
        {
          describe: "first primary provider starts",
          kind: "io",
          timeoutMs: 4_000,
          snapshot: () => ({ firstProviderStarted, roles }),
        },
      );

      expect((await postSessionMessage(started.url, session.sessionId, "再补一轮验证")).status).toBe(202);
      const queued = await getState(started.url, session.sessionId);
      expect(queued.activeRun?.role).toBe("dev-manager");
      expect(queued.pendingPrimaryMessages.some((message) => message.body === "再补一轮验证")).toBe(true);
      expect(queued.messages.some((message) => message.body === "再补一轮验证")).toBe(false);
      expect(roles).toEqual(["dev-manager"]);

      firstRunGate.resolve(undefined);
      await waitForCondition(
        () => secondProviderStarted,
        {
          describe: "queued primary message starts its provider after the first completes",
          kind: "io",
          timeoutMs: 4_000,
          snapshot: () => ({ firstProviderStarted, secondProviderStarted, roles }),
        },
      );
      const completed = await waitForState(
        started.url,
        session.sessionId,
        (state) =>
          state.messages.some((message) => message.body === "第二轮主理人回复")
          && state.activeRuns.length === 0,
        {
          describe: "queued primary response persists in delivery order and leaves no active run",
          timeoutMs: 4_000,
          snapshot: (state) => state === null ? null : ({
            activeRuns: state.activeRuns.map((run) => ({ runId: run.runId, role: run.role })),
            pendingPrimaryMessages: state.pendingPrimaryMessages.map((message) => message.body),
            messageBodies: state.messages.map((message) => message.body),
          }),
        },
      );
      expect(roles).toEqual(["dev-manager", "dev-manager"]);
      expect(runCodex).toHaveBeenCalledTimes(2);
      expect(completed.pendingPrimaryMessages).toEqual([]);
      expect(completed.messages.map((message) => message.body)).toEqual([
        "先检查现状",
        "第一轮主理人回复",
        "再补一轮验证",
        "第二轮主理人回复",
      ]);
      expect(prompts[1]?.indexOf("第一轮主理人回复")).toBeLessThan(
        prompts[1]?.indexOf("再补一轮验证") ?? -1,
      );
    } finally {
      firstRunGate.resolve(undefined);
      await started.close();
    }
  }, 10_000 * waitScale());

  it("routes a unique user mention directly and queues the same busy member without aborting", async () => {
    const root = await makeFixtureRoot();
    const firstQaGate = deferred<void>();
    const roles: string[] = [];
    const qaSignals: AbortSignal[] = [];
    let qaCalls = 0;
    const runCodex = vi.fn(async (options: CodexRunOptions): Promise<CodexRunResult> => {
      const role = roleFromPrompt(options.prompt);
      roles.push(role);
      if (role === "qa") {
        qaCalls += 1;
        qaSignals.push(options.signal!);
        if (qaCalls === 1) {
          await firstQaGate.promise;
          return codexOk(options, "QA 第一轮完成");
        }
        return codexOk(options, "QA 第二轮完成");
      }
      return codexOk(options, "主理人收尾");
    });
    const started = await startLocalConsoleServer({
      projectRoot: root,
      port: 0,
      runCodex,
      listAgentFiles: async () => [
        { name: "dev-manager", agentMarkdown: "ROLE:dev-manager" },
        { name: "dev", agentMarkdown: "ROLE:dev" },
        { name: "qa", agentMarkdown: "ROLE:qa" },
      ],
      makeRunDir: (count) => path.join(root, "runs", `run-${String(count)}`),
      storeTimeoutMs: STANDARD_STORE_TIMEOUT_MS,
    });
    try {
      const session = await createSession(started.url, "direct qa");
      expect((await postSessionMessage(started.url, session.sessionId, "@qa 只回复第一轮")).status).toBe(202);
      const firstActive = await waitForState(started.url, session.sessionId, (state) =>
        state.activeRuns.some((run) => run.role === "qa")
      );
      const firstQaRun = firstActive.activeRuns.find((run) => run.role === "qa");
      expect(firstQaRun).toBeDefined();
      expect(roles).toEqual(["qa"]);

      expect((await postSessionMessage(started.url, session.sessionId, "@qa 只回复第二轮")).status).toBe(202);
      const queued = await waitForState(started.url, session.sessionId, (state) =>
        state.pendingDispatchMessages.some((dispatch) =>
          dispatch.message.body === "@qa 只回复第二轮"
          && dispatch.targetLane === "worker"
          && dispatch.targetRole === "qa")
      );
      expect(queued.activeRuns.filter((run) => run.role === "qa")).toHaveLength(1);
      expect(queued.activeRuns.find((run) => run.role === "qa")?.runId).toBe(firstQaRun?.runId);
      expect(roles).toEqual(["qa"]);
      expect(qaSignals[0]?.aborted).toBe(false);

      firstQaGate.resolve(undefined);
      const completed = await waitForState(started.url, session.sessionId, (state) =>
        state.messages.some((message) => message.body === "QA 第二轮完成")
        && state.activeRuns.length === 0
        && state.selectedSession?.hasPendingControlWork === false
      );
      expect(roles.filter((role) => role === "qa")).toEqual(["qa", "qa"]);
      expect(qaSignals[0]?.aborted).toBe(false);
      expect(completed.pendingDispatchMessages.some((dispatch) => dispatch.targetRole === "qa")).toBe(false);
    } finally {
      firstQaGate.resolve(undefined);
      await started.close();
    }
  }, 20_000);

  it("starts a newly addressed idle worker while the primary run remains active", async () => {
    const root = await makeFixtureRoot();
    const managerGate = deferred<void>();
    const qaGate = deferred<void>();
    const calls: Array<{ role: string; options: CodexRunOptions }> = [];
    const runCodex = vi.fn(async (options: CodexRunOptions): Promise<CodexRunResult> => {
      const role = roleFromPrompt(options.prompt);
      calls.push({ role, options });
      if (role === "dev-manager") {
        await managerGate.promise;
        return codexOk(options, "主理人完成");
      }
      if (role === "qa") {
        await qaGate.promise;
        return codexOk(options, "QA 完成");
      }
      throw new Error(`unexpected role: ${role}`);
    });
    const started = await startLocalConsoleServer({
      projectRoot: root,
      port: 0,
      runCodex,
      listAgentFiles: async () => [
        { name: "dev-manager", agentMarkdown: "ROLE:dev-manager" },
        { name: "qa", agentMarkdown: "ROLE:qa" },
      ],
      makeRunDir: (count) => path.join(root, "runs", `primary-then-worker-${String(count)}`),
      storeTimeoutMs: STANDARD_STORE_TIMEOUT_MS,
    });
    try {
      const session = await createSession(started.url, "primary then worker");
      expect((await postSessionMessage(started.url, session.sessionId, "主理人先处理")).status).toBe(202);
      const managerActive = await waitForState(started.url, session.sessionId, (state) =>
        state.activeRuns.some((run) => run.role === "dev-manager")
      );
      const managerRunId = managerActive.activeRuns.find((run) => run.role === "dev-manager")?.runId;

      expect((await postSessionMessage(started.url, session.sessionId, "@qa ROUTE_QA")).status).toBe(202);
      const parallel = await waitForState(started.url, session.sessionId, (state) =>
        state.activeRuns.some((run) => run.role === "dev-manager")
        && state.activeRuns.some((run) => run.role === "qa")
      );
      expect(parallel.activeRuns.map((run) => run.role).sort()).toEqual(["dev-manager", "qa"]);
      expect(parallel.activeRuns.find((run) => run.role === "dev-manager")?.runId).toBe(managerRunId);
      expect(parallel.pendingDispatchMessages.some((item) => item.message.body === "@qa ROUTE_QA")).toBe(false);
      expect(calls.map((call) => call.role)).toEqual(["dev-manager", "qa"]);
      expect(calls.find((call) => call.role === "dev-manager")?.options.signal?.aborted).toBe(false);

      qaGate.resolve(undefined);
      await waitForState(started.url, session.sessionId, (state) =>
        state.messages.some((message) => message.role === "qa" && message.body === "QA 完成")
        && state.activeRuns.some((run) => run.role === "dev-manager")
      );
      expect(calls.find((call) => call.role === "dev-manager")?.options.signal?.aborted).toBe(false);

      managerGate.resolve(undefined);
      await waitForState(started.url, session.sessionId, (state) =>
        state.activeRuns.length === 0 && state.selectedSession?.hasPendingControlWork === false
      );
    } finally {
      qaGate.resolve(undefined);
      managerGate.resolve(undefined);
      await started.close();
    }
  }, 20_000);

  it("runs only the latest dispatch and expires a superseded run's late reply", async () => {
    const root = await makeFixtureRoot();
    const qaRun1Gate = deferred<void>();
    const managerRun2Gate = deferred<void>();
    const qaRun1Aborted = deferred<void>();
    const roles: string[] = [];
    const runCodex = vi.fn(async (options: CodexRunOptions): Promise<CodexRunResult> => {
      const role = roleFromPrompt(options.prompt);
      roles.push(role);
      if (role === "dev-manager") {
        const managerCalls = roles.filter((entry) => entry === "dev-manager").length;
        if (managerCalls === 1) return codexOk(options, "第一轮评审，@qa 请复评");
        if (managerCalls === 2) {
          await managerRun2Gate.promise;
          return codexOk(options, "第一轮评审修订，@qa 请复评");
        }
        return codexOk(options, "收到");
      }
      if (role === "qa") {
        const qaCalls = roles.filter((entry) => entry === "qa").length;
        if (qaCalls === 1) {
          // 第一笔派工的 run 无视 abort 仍然完成：产生晚到回复，验证其不能继续推动接力。
          options.signal?.addEventListener("abort", () => qaRun1Aborted.resolve(undefined), { once: true });
          await qaRun1Gate.promise;
          return codexOk(options, "第一轮复评结论：6 项必改。@qa 请复核");
        }
        return codexOk(options, "修订复评结论：3 项必改。@dev-manager 请裁决");
      }
      throw new Error(`unexpected role: ${role}`);
    });
    const started = await startLocalConsoleServer({
      projectRoot: root,
      port: 0,
      runCodex,
      listAgentFiles: async () => [
        { name: "dev-manager", agentMarkdown: "ROLE:dev-manager" },
        { name: "qa", agentMarkdown: "ROLE:qa" },
      ],
      makeRunDir: (count) => path.join(root, "runs", `handoff-generation-${String(count)}`),
      storeTimeoutMs: STANDARD_STORE_TIMEOUT_MS,
    });
    try {
      const session = await createSession(started.url, "handoff generation");
      expect((await postSessionMessage(started.url, session.sessionId, "请评审第一轮")).status).toBe(202);
      await waitForState(started.url, session.sessionId, (state) =>
        state.activeRuns.some((run) => run.role === "qa")
      );

      expect((await postSessionMessage(started.url, session.sessionId, "补充材料，请修订评审")).status).toBe(202);
      await waitForState(started.url, session.sessionId, (state) =>
        state.activeRuns.some((run) => run.role === "dev-manager")
      );

      // 主 Agent 修订回复先落盘：第二笔派工记录 generation 2 并 abort 第一笔派工的 run。
      managerRun2Gate.resolve(undefined);
      await qaRun1Aborted.promise;
      // 第一笔派工的 run 仍然完成，晚到回复进入时间线。
      qaRun1Gate.resolve(undefined);

      const settled = await waitForState(started.url, session.sessionId, (state) =>
        state.messages.some((message) => message.role === "qa" && message.body === "修订复评结论：3 项必改。@dev-manager 请裁决")
        && state.selectedSession?.hasPendingControlWork === false
        && state.activeRuns.length === 0
      );
      const qaReplies = settled.messages.filter((message) =>
        message.speaker === "agent" && message.role === "qa"
      );
      expect(qaReplies.map((message) => message.body)).toEqual([
        "第一轮复评结论：6 项必改。@qa 请复核",
        "修订复评结论：3 项必改。@dev-manager 请裁决",
      ]);
      // 处理位点已推进（处理过），但不产生新 run：晚到回复与正常交棒回复都保持历史可读。
      expect(qaReplies[0]?.status).toBe("displayed");
      expect(qaReplies[1]?.status).toBe("displayed");
      // 只有两笔 qa run：晚到回复的 @qa mention 没有触发第三笔派工。
      expect(roles).toEqual(["dev-manager", "qa", "dev-manager", "qa", "dev-manager"]);
    } finally {
      qaRun1Gate.resolve(undefined);
      managerRun2Gate.resolve(undefined);
      await started.close();
    }
  }, 20_000);

  it("releases a delayed direct worker claim during clean close and starts it once after restart", async () => {
    const root = await makeFixtureRoot();
    const sqlitePath = path.join(root, ".state", "local-console.sqlite");
    const claimEntered = deferred<void>();
    const releaseClaim = deferred<void>();
    const managerAborted = deferred<void>();
    const innerStore = await createSqliteLocalConsoleStore({ sqlitePath });
    const delayedStore = new Proxy(innerStore, {
      get(target, property) {
        if (property === "claimNextPendingWorkerMessage") {
          return async (
            input: Parameters<NonNullable<LocalConsoleStore["claimNextPendingWorkerMessage"]>>[0],
          ) => {
            claimEntered.resolve(undefined);
            await releaseClaim.promise;
            return await target.claimNextPendingWorkerMessage!(input);
          };
        }
        const value = Reflect.get(target, property, target) as unknown;
        return typeof value === "function" ? value.bind(target) : value;
      },
    }) as LocalConsoleStore;
    const firstRoles: string[] = [];
    const firstRunCodex = vi.fn(async (options: CodexRunOptions): Promise<CodexRunResult> => {
      const role = roleFromPrompt(options.prompt);
      firstRoles.push(role);
      if (role !== "dev-manager") {
        throw new Error(`worker provider started during clean close: ${role}`);
      }
      await options.onThreadStarted?.("thread-clean-close-manager");
      return await new Promise<CodexRunResult>((resolve) => {
        options.signal?.addEventListener("abort", () => {
          managerAborted.resolve(undefined);
          resolve({
            ok: false,
            reason: `interrupted:${String(options.signal?.reason)}`,
            runDir: options.runDir,
            stdoutPath: path.join(options.runDir, "stdout.jsonl"),
            stderrPath: path.join(options.runDir, "stderr.log"),
          });
        }, { once: true });
      });
    });
    const agents = [
      { name: "dev-manager", agentMarkdown: "ROLE:dev-manager" },
      { name: "qa", agentMarkdown: "ROLE:qa" },
    ];
    const first = await startLocalConsoleServer({
      projectRoot: root,
      port: 0,
      store: delayedStore,
      runCodex: firstRunCodex,
      listAgentFiles: async () => agents,
      makeRunDir: (count) => path.join(root, "runs", `clean-close-first-${String(count)}`),
      storeTimeoutMs: STANDARD_STORE_TIMEOUT_MS,
    });
    let firstClosed = false;
    try {
      const session = await createSession(first.url, "clean close worker claim");
      expect((await postSessionMessage(first.url, session.sessionId, "主理人保持运行")).status).toBe(202);
      await waitForState(first.url, session.sessionId, (state) =>
        state.activeRuns.some((run) => run.role === "dev-manager")
      );
      expect((await postSessionMessage(first.url, session.sessionId, "@qa close race")).status).toBe(202);
      await claimEntered.promise;

      const closePromise = first.close();
      await managerAborted.promise;
      releaseClaim.resolve(undefined);
      await closePromise;
      firstClosed = true;
      expect(firstRoles).toEqual(["dev-manager"]);

      const inspectionStore = await createSqliteLocalConsoleStore({ sqlitePath });
      await inspectionStore.init();
      const afterClose = await inspectionStore.listMessages(session.sessionId);
      await inspectionStore.close();
      expect(afterClose).toContainEqual(expect.objectContaining({
        body: "@qa close race",
        status: "pending",
        runId: null,
        runDir: null,
        dispatchLane: "worker",
        dispatchRole: "qa",
      }));

      let qaCalls = 0;
      const restartedRunCodex = vi.fn(async (options: CodexRunOptions): Promise<CodexRunResult> => {
        const role = options.mode?.kind === "resume"
          && options.mode.threadId === "thread-clean-close-manager"
          ? "dev-manager"
          : roleFromPrompt(options.prompt);
        const threadId = options.mode?.kind === "resume"
          ? options.mode.threadId
          : `thread-clean-close-${role}`;
        await options.onThreadStarted?.(threadId);
        if (role === "qa") {
          qaCalls += 1;
          return { ...codexOk(options, "QA 重启后恰好执行一次"), threadId };
        }
        return { ...codexOk(options, "主理人恢复完成"), threadId };
      });
      const restarted = await startLocalConsoleServer({
        projectRoot: root,
        sqlitePath,
        port: 0,
        runCodex: restartedRunCodex,
        listAgentFiles: async () => agents,
        makeRunDir: (count) => path.join(root, "runs", `clean-close-restart-${String(count)}`),
        storeTimeoutMs: STANDARD_STORE_TIMEOUT_MS,
      });
      try {
        const settled = await waitForState(restarted.url, session.sessionId, (state) =>
          state.messages.some((message) =>
            message.role === "qa" && message.body === "QA 重启后恰好执行一次")
          && state.activeRuns.length === 0
          && state.selectedSession?.hasPendingControlWork === false
        );
        expect(qaCalls).toBe(1);
        expect(settled.messages.some((message) =>
          message.systemEventKind === "run-stuck"
          && message.error === "orphaned-by-restart")).toBe(false);
        expect(settled.pendingDispatchMessages.some((item) => item.targetRole === "qa")).toBe(false);
      } finally {
        await restarted.close();
      }
    } finally {
      releaseClaim.resolve(undefined);
      if (!firstClosed) {
        await first.close().catch(() => undefined);
      }
    }
  }, 30_000);

  it.each([
    {
      gateName: "execution context persistence",
      storeMethod: "recordRunExecutionContext",
      matchesQaRun: (input: unknown) =>
        (input as { role?: string }).role === "qa",
    },
    {
      gateName: "lifecycle preparation",
      storeMethod: "nextRunAttempt",
      matchesQaRun: (_input: unknown) => true,
    },
    {
      gateName: "provider invocation persistence",
      storeMethod: "recordProviderInvocation",
      matchesQaRun: (input: unknown) => {
        const invocation = input as { role?: string; phase?: string };
        return invocation.role === "qa" && invocation.phase === "started";
      },
    },
  ])(
    "releases a direct worker closed during $gateName before provider start and restarts it once",
    async ({ storeMethod, matchesQaRun }) => {
      const root = await makeFixtureRoot();
      const sqlitePath = path.join(root, ".state", "local-console.sqlite");
      const gateEntered = deferred<void>();
      const releaseGate = deferred<void>();
      const innerStore = await createSqliteLocalConsoleStore({ sqlitePath });
      let gateArmed = false;
      const gatedStore = new Proxy(innerStore, {
        get(target, property) {
          const value = Reflect.get(target, property, target) as unknown;
          if (property === storeMethod && typeof value === "function") {
            return async (...args: unknown[]) => {
              if (gateArmed && matchesQaRun(args[0])) {
                gateArmed = false;
                gateEntered.resolve(undefined);
                await releaseGate.promise;
              }
              return await Reflect.apply(value, target, args) as unknown;
            };
          }
          return typeof value === "function" ? value.bind(target) : value;
        },
      }) as LocalConsoleStore;
      const firstRunCodex = vi.fn(async (options: CodexRunOptions): Promise<CodexRunResult> =>
        codexOk(options, "不应在关闭期间启动"));
      const agents = [
        { name: "dev-manager", agentMarkdown: "ROLE:dev-manager" },
        { name: "qa", agentMarkdown: "ROLE:qa" },
      ];
      const first = await startLocalConsoleServer({
        projectRoot: root,
        port: 0,
        store: gatedStore,
        runCodex: firstRunCodex,
        listAgentFiles: async () => agents,
        makeRunDir: (count) => path.join(root, "runs", `provider-gap-first-${String(count)}`),
        storeTimeoutMs: STANDARD_STORE_TIMEOUT_MS,
      });
      let firstClosed = false;
      try {
        const session = await createSession(first.url, "provider start close race");
        gateArmed = true;
        expect((await postSessionMessage(first.url, session.sessionId, "@qa provider gap")).status).toBe(202);
        await gateEntered.promise;
        const beforeClose = await getState(first.url, session.sessionId);
        expect(beforeClose.activeRuns.some((run) => run.role === "qa")).toBe(
          storeMethod === "recordProviderInvocation",
        );

        const closePromise = first.close();
        let closeResolved = false;
        void closePromise.then(() => {
          closeResolved = true;
        });
        await new Promise((resolve) => setTimeout(resolve, 50));
        expect(closeResolved).toBe(false);
        releaseGate.resolve(undefined);
        await closePromise;
        firstClosed = true;
        expect(firstRunCodex).not.toHaveBeenCalled();

        const inspectionStore = await createSqliteLocalConsoleStore({ sqlitePath });
        await inspectionStore.init();
        const afterClose = await inspectionStore.listMessages(session.sessionId);
        await inspectionStore.close();
        expect(afterClose).toContainEqual(expect.objectContaining({
          body: "@qa provider gap",
          status: "pending",
          runId: null,
          runDir: null,
          dispatchLane: "worker",
          dispatchRole: "qa",
        }));

        let qaCalls = 0;
        const restartedRunCodex = vi.fn(async (options: CodexRunOptions): Promise<CodexRunResult> => {
          const role = roleFromPrompt(options.prompt);
          if (role === "dev-manager") {
            return codexOk(options, "主理人已接回");
          }
          if (role !== "qa") {
            throw new Error(`unexpected restarted role: ${role}`);
          }
          qaCalls += 1;
          await options.onThreadStarted?.("thread-provider-gap-qa");
          return { ...codexOk(options, "QA 重启后执行一次"), threadId: "thread-provider-gap-qa" };
        });
        const restarted = await startLocalConsoleServer({
          projectRoot: root,
          sqlitePath,
          port: 0,
          runCodex: restartedRunCodex,
          listAgentFiles: async () => agents,
          makeRunDir: (count) => path.join(root, "runs", `provider-gap-restart-${String(count)}`),
          storeTimeoutMs: STANDARD_STORE_TIMEOUT_MS,
        });
        try {
          const settled = await waitForState(restarted.url, session.sessionId, (state) =>
            state.messages.some((message) =>
              message.role === "qa" && message.body === "QA 重启后执行一次")
            && state.activeRuns.length === 0
            && state.selectedSession?.hasPendingControlWork === false
          );
          expect(qaCalls).toBe(1);
          expect(settled.messages.some((message) =>
            message.systemEventKind === "run-stuck"
            && message.error === "orphaned-by-restart")).toBe(false);
          expect(settled.pendingDispatchMessages.some((item) => item.targetRole === "qa")).toBe(false);
        } finally {
          await restarted.close();
        }
      } finally {
        releaseGate.resolve(undefined);
        if (!firstClosed) {
          await first.close().catch(() => undefined);
        }
      }
    },
    45_000,
  );

  it("runs the primary agent beside a worker and interrupts only the selected worker run", async () => {
    const root = await makeFixtureRoot();
    let managerCallCount = 0;
    const secondManagerRun = deferred<CodexRunResult>();
    const observed = {
      secondManagerOptions: null as CodexRunOptions | null,
      devOptions: null as CodexRunOptions | null,
    };
    const runCodex = vi.fn(async (options: CodexRunOptions): Promise<CodexRunResult> => {
      const role = roleFromPrompt(options.prompt);
      if (role === "dev") {
        observed.devOptions = options;
        return await waitForAbortResult(options);
      }
      managerCallCount += 1;
      if (managerCallCount === 1) {
        return codexOk(options, "@dev 请开始实现");
      }
      observed.secondManagerOptions = options;
      return await secondManagerRun.promise;
    });
    const started = await startLocalConsoleServer({
      projectRoot: root,
      port: 0,
      runCodex,
      listAgentFiles: async () => [
        { name: "dev-manager", agentMarkdown: "ROLE:dev-manager" },
        { name: "dev", agentMarkdown: "ROLE:dev" },
      ],
      makeRunDir: (count) => path.join(root, "runs", `run-${String(count)}`),
      storeTimeoutMs: STANDARD_STORE_TIMEOUT_MS,
    });
    try {
      const session = await createSession(started.url, "parallel lanes");
      await postSessionMessage(started.url, session.sessionId, "启动实现");
      const workerOnly = await waitForState(started.url, session.sessionId, (state) =>
        state.activeRun === null
        && state.activeRuns.some((run) => run.role === "dev")
      );
      const devRun = workerOnly.activeRuns.find((run) => run.role === "dev");
      expect(devRun).toBeDefined();

      await postSessionMessage(started.url, session.sessionId, "请主理人继续判断");
      const parallel = await waitForState(started.url, session.sessionId, (state) =>
        state.activeRun?.role === "dev-manager"
        && state.activeRuns.some((run) => run.role === "dev")
      );
      expect(parallel.activeRuns.map((run) => run.role).sort()).toEqual(["dev", "dev-manager"]);

      const interrupted = await interruptRun(started.url, session.sessionId, devRun?.runId ?? "");
      expect(interrupted.status).toBe(202);
      await waitForState(started.url, session.sessionId, (state) =>
        state.activeRun?.role === "dev-manager"
        && !state.activeRuns.some((run) => run.role === "dev")
      );
      expect(observed.devOptions?.signal?.aborted).toBe(true);
      expect(observed.secondManagerOptions?.signal?.aborted).toBe(false);

      if (observed.secondManagerOptions !== null) {
        secondManagerRun.resolve(codexOk(observed.secondManagerOptions, "主理人继续运行完成"));
      }
      await waitForState(started.url, session.sessionId, (state) =>
        state.activeRuns.length === 0
        && state.messages.some((message) => message.body === "主理人继续运行完成")
      );
    } finally {
      if (observed.secondManagerOptions !== null) {
        secondManagerRun.resolve(codexOk(observed.secondManagerOptions, "主理人继续运行完成"));
      }
      await started.close();
    }
  }, 30_000);

  it("silently auto-retries no-output failures and dead-letters after the limit", async () => {
    const root = await makeFixtureRoot();
    await writeAgent(root, "dev", "# Dev");
    const sqlitePath = path.join(root, ".state", "local-console.sqlite");
    const runCodex = vi.fn(async (options: CodexRunOptions): Promise<CodexRunResult> => ({
      ok: false,
      reason: "exit:42",
      runDir: options.runDir,
      stdoutPath: path.join(options.runDir, "stdout.jsonl"),
      stderrPath: path.join(options.runDir, "stderr.log"),
    }));
    const started = await startLocalConsoleServer({
      projectRoot: root,
      sqlitePath,
      port: 0,
      runCodex,
      makeRunDir: (count) => path.join(root, "runs", `run-${String(count)}`),
      storeTimeoutMs: STANDARD_STORE_TIMEOUT_MS,
      failureRetryLimit: 2,
    });
    const session = await createSession(started.url, "failure");
    try {
      await postSessionMessage(started.url, session.sessionId, "@dev fail");
      const settled = await waitForState(started.url, session.sessionId, (data) =>
        data.messages.some((entry) =>
          entry.speaker === "system" && entry.systemEventKind === "retry-exhausted"
        ) && data.activeRuns.length === 0,
      );
      // 自动重试静默进行：对话里只有终局的 retry-exhausted，没有逐次失败噪音。
      expect(runCodex).toHaveBeenCalledTimes(2);
      expect(settled.pendingPrimaryMessages).toHaveLength(0);
      expect(settled.messages.filter((entry) => entry.systemEventKind === "run-not-started")).toHaveLength(0);
      expect(settled.messages.filter((entry) => entry.systemEventKind === "retry-exhausted")).toHaveLength(1);
    } finally {
      await started.close();
    }

    const restarted = await startLocalConsoleServer({
      projectRoot: root,
      sqlitePath,
      port: 0,
      runCodex,
      makeRunDir: (count) => path.join(root, "runs", `restart-${String(count)}`),
      storeTimeoutMs: STANDARD_STORE_TIMEOUT_MS,
      failureRetryLimit: 2,
    });
    try {
      const state = await getState(restarted.url, session.sessionId);
      // 死信是终局：重启后不再自动重跑。
      expect(state.messages.filter((entry) => entry.systemEventKind === "retry-exhausted")).toHaveLength(1);
      expect(runCodex).toHaveBeenCalledTimes(2);
    } finally {
      await restarted.close();
    }
  });

  it("returns a visible POST error on fast store write failure and does not call Codex", async () => {
    const root = await makeFixtureRoot();
    await writeAgent(root, "dev", "# Dev");
    const runCodex = vi.fn<LocalRunCodex>(async () => {
      throw new Error("should not run");
    });
    const started = await startLocalConsoleServer({
      projectRoot: root,
      port: 0,
      store: new FastFailAppendStore(),
      runCodex,
      storeTimeoutMs: 20,
    });
    try {
      const response = await fetch(new URL("/api/local-console/messages", started.url), {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ body: "@dev hello" }),
      });
      const body = (await response.json()) as { error: string };
      expect(response.status).toBe(503);
      expect(body.error).toContain("read-only local console store");
      expect(runCodex).not.toHaveBeenCalled();
    } finally {
      await started.close();
    }
  });

  it("bounds a hanging store write and accepts the next message after recovery", async () => {
    const root = await makeFixtureRoot();
    await writeAgent(root, "dev", "# Dev");
    const runCodex = vi.fn(async (options: CodexRunOptions): Promise<CodexRunResult> => ({
      ok: true,
      finalText: "after recovery",
      threadId: threadIdFor(options),
      cachedInputTokens: null,
      runDir: options.runDir,
      stdoutPath: path.join(options.runDir, "stdout.jsonl"),
      stderrPath: path.join(options.runDir, "stderr.log"),
    }));
    const started = await startLocalConsoleServer({
      projectRoot: root,
      port: 0,
      store: new RecoveringAppendStore(),
      runCodex,
      makeRunDir: (count) => path.join(root, "runs", `run-${String(count)}`),
      storeTimeoutMs: 20,
    });
    try {
      const first = await postMessage(started.url, "@dev first");
      const body = (await first.json()) as { error: string };
      expect(first.status).toBe(503);
      expect(body.error).toContain("local-console-store-append-user-timeout");
      expect(runCodex).not.toHaveBeenCalled();

      const second = await postMessage(started.url, "@dev second");
      expect(second.status).toBe(202);
      const snapshot = await waitForSnapshot(started.url, (data) =>
        data.messages.some((entry) => entry.speaker === "agent" && entry.body.includes("after recovery")),
      );
      expect(snapshot.messages).toMatchObject([
        { speaker: "user", status: "completed", body: "@dev second" },
        { speaker: "agent", role: "dev", status: "displayed", body: "after recovery" },
      ]);
      expect(runCodex).toHaveBeenCalledTimes(1);
    } finally {
      await started.close();
    }
  });

  it("fails visibly on a real SQLite lock without starting Codex", async () => {
    const root = await makeFixtureRoot();
    await writeAgent(root, "dev", "# Dev");
    const sqlitePath = path.join(root, ".state", "local-console.sqlite");
    const store = await createSqliteLocalConsoleStore({
      sqlitePath,
      busyTimeoutMs: 500,
      timeoutMs: 500,
    });
    await store.init();
    const runCodex = vi.fn(async (options: CodexRunOptions): Promise<CodexRunResult> => ({
      ok: true,
      finalText: "after sqlite unlock",
      threadId: threadIdFor(options),
      cachedInputTokens: null,
      runDir: options.runDir,
      stdoutPath: path.join(options.runDir, "stdout.jsonl"),
      stderrPath: path.join(options.runDir, "stderr.log"),
    }));
    const started = await startLocalConsoleServer({
      projectRoot: root,
      port: 0,
      store,
      runCodex,
      makeRunDir: (count) => path.join(root, "runs", `run-${String(count)}`),
      storeTimeoutMs: STANDARD_STORE_TIMEOUT_MS,
    });
    (started.runtime as unknown as { storeTimeoutMs: number }).storeTimeoutMs = 50;
    const lock = new DatabaseSync(sqlitePath);
    try {
      lock.exec("PRAGMA busy_timeout = 2000");
      lock.exec("BEGIN EXCLUSIVE");
      const locked = await postMessage(started.url, "@dev locked");
      const lockedBody = (await locked.json()) as { error: string };
      expect(locked.status).toBe(503);
      expect(lockedBody.error).toContain("timeout");
      expect(runCodex).not.toHaveBeenCalled();

      expect(runCodex).toHaveBeenCalledTimes(0);
    } finally {
      try {
        lock.exec("ROLLBACK");
      } catch {
        // The lock may already have been released by the recovery path.
      }
      lock.close();
      await started.close();
    }
  }, 10_000);

  it("records Codex timeout as stuck and accepts the next local message", async () => {
    const root = await makeFixtureRoot();
    await writeAgent(root, "dev", "# Dev");
    const runCodex = vi.fn(async (options: CodexRunOptions): Promise<CodexRunResult> => ({
      ok: false,
      reason: "idle-timeout:10ms",
      runDir: options.runDir,
      stdoutPath: path.join(options.runDir, "stdout.jsonl"),
      stderrPath: path.join(options.runDir, "stderr.log"),
    }));
    const started = await startLocalConsoleServer({
      projectRoot: root,
      port: 0,
      runCodex,
      makeRunDir: (count) => path.join(root, "runs", `run-${String(count)}`),
      storeTimeoutMs: STANDARD_STORE_TIMEOUT_MS,
      codexIdleTimeoutMs: 10,
      codexMaxDurationMs: 20,
    });
    try {
      await postMessage(started.url, "@dev first");
      await waitForSnapshot(started.url, (data) => data.messages.some((entry) => entry.status === "stuck"));

      const second = await postMessage(started.url, "@dev second");
      expect(second.status).toBe(202);
      await waitFor(() => runCodex.mock.calls.length === 2);
      expect(runCodex).toHaveBeenCalledTimes(2);
    } finally {
      await started.close();
    }
  });

  it("reads large output tails with a byte cap and deterministic summary", async () => {
    const root = await makeFixtureRoot();
    const runDir = path.join(root, "runs", "large");
    await fs.mkdir(runDir, { recursive: true });
    const lines = Array.from({ length: 200 }, (_, index) =>
      JSON.stringify({ message: `line-${String(index).padStart(3, "0")}` }),
    );
    await fs.writeFile(path.join(runDir, "stdout.jsonl"), `${lines.join("\n")}\n`);

    const before = Date.now();
    const tail = await readLocalConsoleOutputTail(runDir, { maxBytes: 256, timeoutMs: 500 });
    expect(Date.now() - before).toBeLessThan(500);
    expect(tail.lastOutputSummary).toBe("line-199");
    expect(tail.tailDiagnostic).toContain("tail-truncated:stdout.jsonl");
    expect(tail.stdoutTruncated).toBe(true);
    expect(tail.stdoutState).toBe("available");
    expect(tail.stderrState).toBe("missing");
    expect(tail.stdoutTail?.length).toBeLessThanOrEqual(256);
  });

  it("does not substitute runDir output when Codex thread links are unavailable", async () => {
    const root = await makeFixtureRoot();
    const sqlitePath = path.join(root, ".state", "local-console.sqlite");
    await writeAgent(root, "dev", "# Dev");
    const runCodex = vi.fn<LocalRunCodex>(async (options) => {
      await fs.mkdir(options.runDir, { recursive: true });
      if (runCodex.mock.calls.length === 1) {
        await fs.writeFile(
          path.join(options.runDir, "stdout.jsonl"),
          `${"x".repeat(70_000)}\nfirst-attempt-tail /tmp/project/src/index.ts\n`,
          "utf8",
        );
        await fs.writeFile(
          path.join(options.runDir, "stderr.log"),
          "FAIL original stderr /tmp/project/tests/index.test.ts\n",
          "utf8",
        );
        return {
          ok: false,
          reason: "exit:42",
          runDir: options.runDir,
          stdoutPath: path.join(options.runDir, "stdout.jsonl"),
          stderrPath: path.join(options.runDir, "stderr.log"),
        };
      }
      await fs.writeFile(
        path.join(options.runDir, "stdout.jsonl"),
        "second-attempt PASS /tmp/project/src/index.ts\n",
        "utf8",
      );
      return codexOk(options, "retry finished");
    });
    const started = await startLocalConsoleServer({
      projectRoot: root,
      sqlitePath,
      port: 0,
      runCodex,
      makeRunDir: (count) => path.join(root, "runs", `run-${String(count)}`),
      storeTimeoutMs: STANDARD_STORE_TIMEOUT_MS,
      failureRetryLimit: 3,
    });
    const session = await createSession(started.url, "process output");
    let requestedRunId = "";
    try {
      await postSessionMessage(started.url, session.sessionId, "@dev retry this step");
      // 第一次尝试 exit:42 且无可见产出 → 静默自动重试，第二次成功，无需人工干预。
      const completed = await waitForState(started.url, session.sessionId, (data) =>
        data.messages.some((entry) => entry.speaker === "agent" && entry.body === "retry finished"),
      );
      expect(runCodex).toHaveBeenCalledTimes(2);
      expect(completed.messages.filter((entry) => entry.systemEventKind === "run-not-started")).toHaveLength(0);
      requestedRunId = completed.messages.find(
        (entry) => entry.speaker === "agent" && entry.body === "retry finished",
      )?.runId ?? "";

      const response = await fetch(new URL(
        `/api/local-console/sessions/${encodeURIComponent(session.sessionId)}/runs/${encodeURIComponent(requestedRunId)}/process-output`,
        started.url,
      ));
      expect(response.status).toBe(200);
      const body = (await response.json()) as {
        role: string | null;
        status: string;
        unavailableReason: string | null;
        attempts: unknown[];
        events: unknown[];
      };
      expect(body).toEqual(expect.objectContaining({
        role: null,
        status: "unavailable",
        unavailableReason: "link-missing",
        attempts: [],
        events: [],
      }));
    } finally {
      await started.close();
    }

    await fs.rm(path.join(root, "runs"), { recursive: true, force: true });
    const restarted = await startLocalConsoleServer({
      projectRoot: root,
      sqlitePath,
      port: 0,
      runCodex,
      makeRunDir: (count) => path.join(root, "runs", `restart-${String(count)}`),
      storeTimeoutMs: STANDARD_STORE_TIMEOUT_MS,
      failureRetryLimit: 3,
    });
    try {
      const response = await fetch(new URL(
        `/api/local-console/sessions/${encodeURIComponent(session.sessionId)}/runs/${encodeURIComponent(requestedRunId)}/process-output`,
        restarted.url,
      ));
      expect(response.status).toBe(200);
      const body = (await response.json()) as {
        status: string;
        unavailableReason: string | null;
        attempts: unknown[];
        events: unknown[];
      };
      expect(body).toEqual(expect.objectContaining({
        status: "unavailable",
        unavailableReason: "link-missing",
        attempts: [],
        events: [],
      }));
    } finally {
      await restarted.close();
    }
  });

  it("accepts a second local message while a slow Codex run is active", async () => {
    const root = await makeFixtureRoot();
    await writeAgent(root, "dev", "# Dev");
    let resolveCodex: ((result: CodexRunResult) => void) | null = null;
    let activeSignal: AbortSignal | undefined;
    const runCodex = vi.fn((options: CodexRunOptions) => {
      if (runCodex.mock.calls.length > 1) {
        return Promise.resolve(codexOk(options, "supplement message done"));
      }
      activeSignal = options.signal;
      return new Promise<CodexRunResult>((resolve) => {
        resolveCodex = resolve;
      });
    });
    const started = await startLocalConsoleServer({
      projectRoot: root,
      port: 0,
      runCodex,
      makeRunDir: (count) => path.join(root, "runs", `run-${String(count)}`),
      storeTimeoutMs: STANDARD_STORE_TIMEOUT_MS,
    });
    try {
      await postMessage(started.url, "@dev slow");
      await waitForSnapshot(started.url, (data) => data.activeRun !== null);
      await waitFor(() => runCodex.mock.calls.length === 1);

      const archive = await fetch(
        new URL(`/api/local-console/sessions/${encodeURIComponent(LOCAL_CONSOLE_DEFAULT_SESSION_ID)}/archive`, started.url),
        { method: "POST" },
      );
      expect(archive.status).toBe(409);
      await expect(archive.json()).resolves.toMatchObject({ code: "SESSION_HAS_RUNNING_AGENT" });

      const second = await postMessage(started.url, "这条没有点名，应该排在当前步骤之后");
      expect(second.status).toBe(202);
      expect(runCodex).toHaveBeenCalledTimes(1);
      expect(activeSignal?.aborted).toBe(false);
      await expect(second.json()).resolves.toMatchObject({
        message: expect.objectContaining({ speaker: "user", status: "pending" }),
      });

      expect(resolveCodex).toBeTypeOf("function");
      resolveCodex!({
        ok: true,
        finalText: "done",
        threadId: "thread-local-console",
        cachedInputTokens: null,
        runDir: path.join(root, "runs", "run-1"),
        stdoutPath: path.join(root, "runs", "run-1", "stdout.jsonl"),
        stderrPath: path.join(root, "runs", "run-1", "stderr.log"),
      });
      const state = await waitForSnapshot(
        started.url,
        (data) => data.messages.filter((entry) => entry.speaker === "agent").length === 2,
      );
      expect(runCodex).toHaveBeenCalledTimes(2);
      expect(state.messages).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ speaker: "agent", body: "done" }),
          expect.objectContaining({ speaker: "agent", body: "supplement message done" }),
        ]),
      );
    } finally {
      await started.close();
    }
  });

  it("waits for an active run to reach terminal state before stopping tasks", async () => {
    const root = await makeFixtureRoot();
    await writeAgent(root, "dev", "# Dev");
    let abortObserved = false;
    let releaseRun: (() => void) | null = null;
    const runCodex = vi.fn((options: CodexRunOptions) => new Promise<CodexRunResult>((resolve) => {
      releaseRun = () => resolve({
        ok: false,
        reason: "interrupted:desktop-install-stop",
        runDir: options.runDir,
        stdoutPath: path.join(options.runDir, "stdout.jsonl"),
        stderrPath: path.join(options.runDir, "stderr.log"),
      });
      const observeAbort = () => {
        abortObserved = true;
      };
      if (options.signal?.aborted) observeAbort();
      else options.signal?.addEventListener("abort", observeAbort, { once: true });
    }));
    const started = await startLocalConsoleServer({
      projectRoot: root,
      port: 0,
      runCodex,
      makeRunDir: (count) => path.join(root, "runs", `stop-running-${String(count)}`),
      storeTimeoutMs: STANDARD_STORE_TIMEOUT_MS,
    });
    try {
      await postMessage(started.url, "@dev keep running");
      await waitForSnapshot(started.url, (snapshot) => snapshot.activeRun !== null);
      await waitForCondition(() => started.runtime.getRunningTaskCount() === 1, {
        describe: "active run enters desktop task count",
        kind: "logic",
      });

      const stopping = started.stopRunningTasks();
      await waitForCondition(() => abortObserved, {
        describe: "active run receives install stop signal",
        kind: "logic",
      });
      expect(runCodex).toHaveBeenCalledOnce();
      expect(releaseRun).toBeTypeOf("function");
      expect(started.runtime.getRunningTaskCount()).toBe(1);
      let stopped = false;
      void stopping.then(() => { stopped = true; });
      expect(stopped).toBe(false);

      releaseRun!();
      await stopping;

      expect(started.runtime.getRunningTaskCount()).toBe(0);
      await waitForSnapshot(started.url, (snapshot) => snapshot.activeRun === null);
      await expect(getState(started.url, LOCAL_CONSOLE_DEFAULT_SESSION_ID)).resolves.toMatchObject({
        activeRun: null,
      });
    } finally {
      await started.close();
    }
  });

  it("stops pending dispatch before closing an active runtime", async () => {
    const root = await makeFixtureRoot();
    await writeAgent(root, "dev", "# Dev");
    const runCodex = vi.fn(waitForAbortResult);
    const started = await startLocalConsoleServer({
      projectRoot: root,
      port: 0,
      runCodex,
      makeRunDir: (count) => path.join(root, "runs", `run-${String(count)}`),
      storeTimeoutMs: STANDARD_STORE_TIMEOUT_MS,
    });
    let closed = false;
    try {
      await postMessage(started.url, "@dev slow");
      await waitForSnapshot(started.url, (data) => data.activeRun !== null);

      const pending = await postMessage(started.url, "这条留在当前步骤之后");
      expect(pending.status).toBe(202);
      expect(runCodex).toHaveBeenCalledTimes(1);

      await started.close();
      closed = true;
      expect(runCodex).toHaveBeenCalledTimes(1);
    } finally {
      if (!closed) {
        await started.close();
      }
    }
  });

});

type LocalRunCodex = (options: CodexRunOptions) => Promise<CodexRunResult>;

function deferred<T>(): { promise: Promise<T>; resolve(value: T): void } {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function trackTimerCallbackOrigin(): {
  isInsideTimerCallback(): boolean;
  restore(): void;
} {
  const originalSetTimeout = globalThis.setTimeout;
  const originalSetInterval = globalThis.setInterval;
  let timerCallbackDepth = 0;

  const wrapCallback = (callback: (...args: unknown[]) => void): ((...args: unknown[]) => void) =>
    (...args: unknown[]) => {
      timerCallbackDepth += 1;
      try {
        callback(...args);
      } finally {
        timerCallbackDepth -= 1;
      }
    };
  const timeoutSpy = vi.spyOn(globalThis, "setTimeout").mockImplementation(
    ((callback: (...args: unknown[]) => void, delay?: number, ...args: unknown[]) =>
      originalSetTimeout(wrapCallback(callback), delay, ...args)) as typeof globalThis.setTimeout,
  );
  const intervalSpy = vi.spyOn(globalThis, "setInterval").mockImplementation(
    ((callback: (...args: unknown[]) => void, delay?: number, ...args: unknown[]) =>
      originalSetInterval(wrapCallback(callback), delay, ...args)) as typeof globalThis.setInterval,
  );

  return {
    isInsideTimerCallback: () => timerCallbackDepth > 0,
    restore: () => {
      timeoutSpy.mockRestore();
      intervalSpy.mockRestore();
    },
  };
}

function handoffStateSnapshot(state: LocalStateResponse | null): unknown {
  if (state === null) return null;
  return {
    activeRuns: state.activeRuns.map((run) => ({ runId: run.runId, role: run.role })),
    agentMessages: state.messages
      .filter((message) => message.speaker === "agent")
      .map((message) => ({ role: message.role, status: message.status, body: message.body })),
    pendingPrimaryMessages: state.pendingPrimaryMessages.map((message) => message.body),
  };
}

async function makeFixtureRoot(): Promise<string> {
  return await fs.mkdtemp(path.join(os.tmpdir(), "moebius-local-console-"));
}

async function createGitRepo(folderPath: string): Promise<void> {
  await fs.mkdir(folderPath, { recursive: true });
  await runGit(folderPath, ["init"]);
  await runGit(folderPath, ["config", "user.email", "local-console@example.test"]);
  await runGit(folderPath, ["config", "user.name", "Local Console"]);
  await fs.writeFile(path.join(folderPath, "README.md"), "initial\n", "utf8");
  await runGit(folderPath, ["add", "README.md"]);
  await runGit(folderPath, ["commit", "-m", "initial"]);
}

async function gitStatus(folderPath: string): Promise<string> {
  return (await runGit(folderPath, ["status", "--short"])).stdout.trim();
}

async function runGit(cwd: string, args: string[]): Promise<{ stdout: string; stderr: string }> {
  return await new Promise((resolve, reject) => {
    const child = spawn("git", args, { cwd, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    const timeout = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error(`git timeout: ${args.join(" ")}`));
    }, 5_000);
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk: string) => {
      stderr += chunk;
    });
    child.once("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    child.once("close", (code) => {
      clearTimeout(timeout);
      if (code === 0) {
        resolve({ stdout, stderr });
        return;
      }
      reject(new Error(`git ${args.join(" ")} failed: ${stderr}`));
    });
  });
}

async function waitFor(predicate: () => boolean | Promise<boolean>): Promise<void> {
  await waitForCondition(predicate, { describe: "local console condition", kind: "io", timeoutMs: 5_000 });
}

async function writeAgent(root: string, name: string, body: string): Promise<void> {
  const agentsDir = path.join(root, "agents");
  await fs.mkdir(agentsDir, { recursive: true });
  await fs.writeFile(path.join(agentsDir, `${name}.md`), body, "utf8");
}

async function writeCeoScript(root: string, id: string, action: string): Promise<void> {
  const scriptsDir = path.join(root, "agents", "ceo-scripts");
  await fs.mkdir(scriptsDir, { recursive: true });
  await fs.writeFile(
    path.join(scriptsDir, `${id}.md`),
    `---\nid: ${id}\naction: ${action}\ntitle: ${id}\n---\nLocal test script.\n`,
    "utf8",
  );
}

function message(input: { id: number; body: string; speaker?: "user" | "agent" | "system"; role?: string | null }): LocalConsoleMessage {
  return {
    id: input.id,
    sessionId: LOCAL_CONSOLE_DEFAULT_SESSION_ID,
    speaker: input.speaker ?? "user",
    role: input.role ?? null,
    body: input.body,
    status: "pending",
    runId: null,
    runDir: null,
    error: null,
    systemEventKind: "other",
    failureCount: 0,
    lastFailureReason: null,
    createdAt: "2026-07-09T00:00:00.000Z",
    updatedAt: "2026-07-09T00:00:00.000Z",
  };
}

async function postMessage(url: string, body: string): Promise<Response> {
  return await fetch(new URL("/api/local-console/messages", url), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ body }),
  });
}

async function createSession(url: string, title: string): Promise<LocalConsoleSessionSummary> {
  const response = await fetch(new URL("/api/local-console/sessions", url), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ title }),
  });
  expect(response.status).toBe(201);
  const body = (await response.json()) as { session: LocalConsoleSessionSummary };
  return body.session;
}

async function createProjectSession(url: string, title: string, projectId: string): Promise<LocalConsoleSessionSummary> {
  const response = await fetch(new URL("/api/local-console/sessions", url), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ title, projectId }),
  });
  expect(response.status).toBe(201);
  const body = (await response.json()) as { session: LocalConsoleSessionSummary };
  return body.session;
}

async function createProject(url: string, folderPath: string, worktreeMode: boolean): Promise<LocalConsoleProjectSummary> {
  const response = await fetch(new URL("/api/local-console/projects", url), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ folderPath, worktreeMode }),
  });
  expect(response.status).toBe(201);
  const body = (await response.json()) as { project: LocalConsoleProjectSummary };
  return body.project;
}

async function postSessionMessage(url: string, sessionId: string, body: string): Promise<Response> {
  return await fetch(new URL(`/api/local-console/sessions/${encodeURIComponent(sessionId)}/messages`, url), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ body }),
  });
}

async function patchSessionProject(url: string, sessionId: string, projectId: string): Promise<Response> {
  return await fetch(new URL(`/api/local-console/sessions/${encodeURIComponent(sessionId)}/project`, url), {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ projectId }),
  });
}

async function repairProjectFolder(url: string, projectId: string, folderPath: string): Promise<Response> {
  return await fetch(new URL(`/api/local-console/projects/${encodeURIComponent(projectId)}`, url), {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ folderPath }),
  });
}

async function interruptRun(url: string, sessionId: string, runId: string): Promise<Response> {
  return await fetch(new URL(`/api/local-console/sessions/${encodeURIComponent(sessionId)}/interrupt`, url), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ runId }),
  });
}

async function getState(url: string, sessionId: string): Promise<LocalStateResponse> {
  const stateUrl = new URL("/api/local-console/state", url);
  stateUrl.searchParams.set("sessionId", sessionId);
  const response = await fetch(stateUrl);
  expect(response.status).toBe(200);
  return (await response.json()) as LocalStateResponse;
}

async function waitForState(
  url: string,
  sessionId: string,
  predicate: (snapshot: LocalStateResponse) => boolean,
  options: {
    describe?: string;
    timeoutMs?: number;
    snapshot?: (snapshot: LocalStateResponse | null) => unknown;
  } = {},
): Promise<LocalStateResponse> {
  let latest: LocalStateResponse | null = null;
  return waitForValue(
    async () => {
      latest = await getState(url, sessionId);
      return predicate(latest) ? latest : undefined;
    },
    {
      describe: options.describe ?? `local state ${sessionId}`,
      kind: "io",
      timeoutMs: options.timeoutMs ?? 20_000,
      // 服务端重启窗口内取状态会抛错，属于预期争用，继续轮询。
      onError: () => "retry",
      snapshot: () => options.snapshot?.(latest) ?? latest,
    },
  );
}

async function waitForSnapshot(
  url: string,
  predicate: (snapshot: LocalSnapshotResponse) => boolean,
): Promise<LocalSnapshotResponse> {
  let latest: LocalSnapshotResponse | null = null;
  return waitForValue(
    async () => {
      const response = await fetch(new URL("/api/local-console/messages", url));
      if (response.status !== 200) return undefined;
      latest = (await response.json()) as LocalSnapshotResponse;
      if (!Array.isArray(latest.messages)) return undefined;
      return predicate(latest) ? latest : undefined;
    },
    { describe: "local snapshot", kind: "io", timeoutMs: 5_000, snapshot: () => latest },
  );
}

interface LocalSnapshotResponse {
  status: "idle" | "running" | "failed" | "stuck";
  messages: LocalConsoleMessage[];
  pendingDispatchMessages: Array<{
    message: LocalConsoleMessage;
    targetLane: "primary" | "worker" | "awaiting-team";
    targetRole: string | null;
    waitingForTeam: boolean;
  }>;
  pendingPrimaryMessages: LocalConsoleMessage[];
  activeRuns: LocalRunSnapshotResponse[];
  activeRun: LocalRunSnapshotResponse | null;
}

interface LocalStateResponse {
  projects: Array<{
    projectId: string;
    title: string;
    folderPath: string;
    worktreeMode: boolean;
    worktreeUnavailableReason: string | null;
    directoryAvailable?: boolean;
    directoryUnavailableReason?: string | null;
    sessions: LocalConsoleSessionSummary[];
  }>;
  project: {
    projectId: string;
    title: string;
    folderPath: string;
    worktreeMode: boolean;
    worktreeUnavailableReason: string | null;
    directoryAvailable?: boolean;
    directoryUnavailableReason?: string | null;
    sessions: LocalConsoleSessionSummary[];
  };
  selectedProjectId: string;
  selectedSessionId: string;
  selectedSession: LocalConsoleSessionSummary | null;
  messages: LocalConsoleMessage[];
  pendingDispatchMessages: Array<{
    message: LocalConsoleMessage;
    targetLane: "primary" | "worker" | "awaiting-team";
    targetRole: string | null;
    waitingForTeam: boolean;
  }>;
  pendingPrimaryMessages: LocalConsoleMessage[];
  childSessions: LocalConsoleChildSessionSummary[];
  activeRuns: LocalRunSnapshotResponse[];
  activeRun: LocalRunSnapshotResponse | null;
}

interface LocalRunSnapshotResponse {
  sessionId: string;
  runId: string;
  role: string | null;
  status: "running";
  createdAt: string;
  startedAt: string | null;
  elapsedMs: number | null;
  activity: {
    cursor: number;
    kind: string;
    phase: "running" | "completed";
    action: string;
    object: string | null;
    occurredAt: string;
  } | null;
  runDir: string | null;
  cwd: string | null;
  workspaceMode: "direct" | "worktree" | null;
  worktreeUnavailableReason: string | null;
  liveMarkdown: string | null;
  lastOutputSummary: string;
  interruptible: boolean;
}

function fakeCommandScript(logPath: string, name: string): string {
  return `#!/bin/sh
printf '%s %s\\n' '${name}' "$*" >> '${logPath}'
exit 0
`;
}

function roleFromPrompt(prompt: string): string {
  for (const role of ["ceo", "dev-manager", "manager", "dev", "qa"]) {
    if (
      prompt.includes(`ROLE:${role}`)
      || prompt.includes(`不是你自己 <${role}> 发出的消息`)
    ) {
      return role;
    }
  }
  throw new Error(`Unable to detect role from prompt: ${prompt.slice(0, 160)}`);
}

function codexOk(options: CodexRunOptions, finalText: string): CodexRunResult {
  return {
    ok: true,
    finalText,
    threadId: threadIdFor(options),
    cachedInputTokens: null,
    runDir: options.runDir,
    stdoutPath: path.join(options.runDir, "stdout.jsonl"),
    stderrPath: path.join(options.runDir, "stderr.log"),
  };
}

function threadIdFor(options: CodexRunOptions): string {
  return options.mode?.kind === "resume"
    ? options.mode.threadId
    : "thread-local-console";
}

function waitForAbortResult(options: CodexRunOptions): Promise<CodexRunResult> {
  return new Promise<CodexRunResult>((resolve) => {
    options.signal?.addEventListener(
      "abort",
      () => {
        resolve({
          ok: false,
          reason: `interrupted:${String(options.signal?.reason ?? "abort")}`,
          runDir: options.runDir,
          stdoutPath: path.join(options.runDir, "stdout.jsonl"),
          stderrPath: path.join(options.runDir, "stderr.log"),
        });
      },
      { once: true },
    );
  });
}

function buildSessionSummary(sessionId: string, title = "默认会话", messages: LocalConsoleMessage[] = []): LocalConsoleSessionSummary {
  const runningCount = messages.filter((message) => message.sessionId === sessionId && message.status === "running").length;
  const stuckCount = messages.filter((message) => message.sessionId === sessionId && message.status === "stuck").length;
  const errorCount = messages.filter((message) => message.sessionId === sessionId && message.status === "failed").length;
  const interruptedCount = messages.filter((message) => message.sessionId === sessionId && message.status === "interrupted").length;
  return {
    sessionId,
    projectId: LOCAL_CONSOLE_PROJECT_ID,
    title,
    status: runningCount > 0
      ? "running"
      : stuckCount > 0
        ? "stuck"
        : errorCount > 0
          ? "failed"
          : interruptedCount > 0
            ? "interrupted"
            : "idle",
    awaitsHumanReason: null,
    unreadSince: null,
    runningCount,
    waitingCount: 0,
    stuckCount,
    errorCount,
    interruptedCount,
    workspaceMode: "direct",
    workspacePendingMode: null,
    createdAt: "2026-07-09T00:00:00.000Z",
    updatedAt: "2026-07-09T00:00:00.000Z",
  };
}

function buildProjectSummary(
  sessions: LocalConsoleSessionSummary[] = [buildSessionSummary(LOCAL_CONSOLE_DEFAULT_SESSION_ID)],
  input: { worktreeMode?: boolean; folderPath?: string } = {},
): LocalConsoleProjectSummary {
  return {
    projectId: LOCAL_CONSOLE_PROJECT_ID,
    sourceType: "local-folder",
    title: "moebius",
    folderPath: input.folderPath ?? process.cwd(),
    worktreeMode: input.worktreeMode ?? false,
    workspaceCwd: input.folderPath ?? process.cwd(),
    workspaceMode: "direct",
    worktreePath: null,
    worktreeUnavailableReason: null,
    workspaceUpdatedAt: "2026-07-09T00:00:00.000Z",
    sessions,
    runningCount: sessions.reduce((sum, session) => sum + session.runningCount, 0),
    waitingCount: sessions.reduce((sum, session) => sum + session.waitingCount, 0),
    stuckCount: sessions.reduce((sum, session) => sum + session.stuckCount, 0),
    errorCount: sessions.reduce((sum, session) => sum + session.errorCount, 0),
  };
}

function buildWorkspaceSource(worktreeMode = false): LocalConsoleSessionWorkspaceSource {
  return {
    projectId: LOCAL_CONSOLE_PROJECT_ID,
    title: "moebius",
    folderPath: process.cwd(),
    workspaceMode: worktreeMode ? "worktree" : "direct",
    workspacePendingMode: null,
  };
}

class FastFailAppendStore implements LocalConsoleStore {
  readonly sqlitePath = "/tmp/fast-fail-local-console.sqlite";

  async init(): Promise<void> {}

  async close(): Promise<void> {}

  async createProject(input: { folderPath: string; worktreeMode: boolean; now: string }): Promise<LocalConsoleProjectSummary> {
    void input.now;
    return buildProjectSummary([buildSessionSummary(LOCAL_CONSOLE_DEFAULT_SESSION_ID)], {
      folderPath: input.folderPath,
      worktreeMode: input.worktreeMode,
    });
  }

  async updateProject(input: { projectId: string; worktreeMode: boolean; now: string }): Promise<LocalConsoleProjectSummary> {
    void input.projectId;
    void input.now;
    return buildProjectSummary([buildSessionSummary(LOCAL_CONSOLE_DEFAULT_SESSION_ID)], { worktreeMode: input.worktreeMode });
  }

  async reorderProjects(): Promise<LocalConsoleProjectSummary[]> {
    return await this.listProjects();
  }

  async listProjects(): Promise<LocalConsoleProjectSummary[]> {
    return [buildProjectSummary(await this.listSessions())];
  }

  async getSessionWorkspace(): Promise<LocalConsoleSessionWorkspaceSource> {
    return buildWorkspaceSource();
  }

  async switchSessionWorkspace(input: { sessionId: string }): Promise<LocalConsoleSessionSummary> {
    return buildSessionSummary(input.sessionId);
  }

  async switchSessionTeam(input: { sessionId: string }): Promise<LocalConsoleSessionSummary> {
    return buildSessionSummary(input.sessionId);
  }

  async applyPendingSessionContext(input: { sessionId: string }): Promise<LocalConsoleSessionSummary> {
    return buildSessionSummary(input.sessionId);
  }

  async recordProjectWorkspaceStatus(): Promise<void> {}

  async createSession(input: { sessionId: string; projectId?: string; title: string; now: string }): Promise<LocalConsoleSessionSummary> {
    void input.projectId;
    void input.now;
    return buildSessionSummary(input.sessionId, input.title);
  }

  async moveEmptySessionToProject(input: { sessionId: string; projectId: string; now: string }): Promise<LocalConsoleSessionSummary> {
    void input.projectId;
    void input.now;
    return buildSessionSummary(input.sessionId);
  }

  async listSessions(): Promise<LocalConsoleSessionSummary[]> {
    return [buildSessionSummary(LOCAL_CONSOLE_DEFAULT_SESSION_ID)];
  }

  async markSessionResultRead(): Promise<boolean> {
    return false;
  }

  appendUserMessage(): Promise<LocalConsoleMessage> {
    throw new Error("read-only local console store");
  }

  async listMessages(): Promise<LocalConsoleMessage[]> {
    return [];
  }

  async hasRunningMessage(): Promise<boolean> {
    return false;
  }

  async claimNextPendingMessage(): Promise<LocalConsoleMessage | null> {
    return null;
  }

  async setRunDir(): Promise<void> {}

  async recordAgentResponse(): Promise<void> {}

  async recordSystemAndComplete(): Promise<void> {}

  async recordSystemMessage(): Promise<void> {}

  async recordMessageProcessed(): Promise<void> {}

  async findRouteDecision(): Promise<null> {
    return null;
  }

  async recordRouteAppend(): Promise<void> {}

  async recordRouteNoAction(): Promise<void> {}

  async releaseMessageForRetry(): Promise<void> {}

  async recordFailure(): Promise<void> {}

  async recordRetryableFailure(input: {
    userMessageId: number;
    sessionId: string;
    error: string;
    runId: string | null;
    runDir: string | null;
    now: string;
  }): Promise<LocalConsoleMessage> {
    void input;
    throw new Error("read-only local console store");
  }

  async recordDeadLetter(): Promise<void> {}

  async recordInterrupted(): Promise<void> {}

  async recordStuck(): Promise<void> {}

  async markStaleRunning(): Promise<number> {
    return 0;
  }
}

type RecoveryCapableLocalConsoleStore = LocalConsoleStore & {
  getSessionFactLogPath(sessionId: string): string;
  recordCodexResumeIntent(input: LocalCodexResumeIntentFact): Promise<void>;
  recordCodexResumeConsumed(input: LocalCodexResumeConsumedFact): Promise<void>;
  recordCodexRunUsage(input: LocalCodexRunUsageFact): Promise<void>;
  recordRunExecutionContext(input: LocalRunExecutionContextFact): Promise<void>;
  recordExecutionSessionLink(input: LocalExecutionSessionLinkFact): Promise<void>;
  recordAgentSessionLink(input: LocalAgentSessionLinkFact): Promise<void>;
  recordProviderSessionObserved(input: LocalProviderSessionObservedFact): Promise<void>;
  recordAgentTimelineCursor(input: LocalAgentTimelineCursorFact): Promise<void>;
  recordProviderInvocation(input: LocalProviderInvocationFact): Promise<void>;
  recordCodexThreadLink(
    input: Parameters<NonNullable<LocalConsoleStore["recordCodexThreadLink"]>>[0],
  ): Promise<void>;
};

class FailOnceRecordAgentResponseStore implements LocalConsoleStore {
  readonly sqlitePath: string;
  private failNextRecord = true;

  constructor(private readonly inner: LocalConsoleStore) {
    this.sqlitePath = inner.sqlitePath;
  }

  async init(): Promise<void> {
    await this.inner.init();
  }

  async close(): Promise<void> {
    await this.inner.close();
  }

  getSessionFactLogPath(sessionId: string): string {
    return this.recoveryStore().getSessionFactLogPath(sessionId);
  }

  async recordCodexResumeIntent(input: LocalCodexResumeIntentFact): Promise<void> {
    await this.recoveryStore().recordCodexResumeIntent(input);
  }

  async recordCodexResumeConsumed(input: LocalCodexResumeConsumedFact): Promise<void> {
    await this.recoveryStore().recordCodexResumeConsumed(input);
  }

  async recordCodexRunUsage(input: LocalCodexRunUsageFact): Promise<void> {
    await this.recoveryStore().recordCodexRunUsage(input);
  }

  async recordRunExecutionContext(input: LocalRunExecutionContextFact): Promise<void> {
    await this.recoveryStore().recordRunExecutionContext(input);
  }

  async recordExecutionSessionLink(input: LocalExecutionSessionLinkFact): Promise<void> {
    await this.recoveryStore().recordExecutionSessionLink(input);
  }

  async recordAgentSessionLink(input: LocalAgentSessionLinkFact): Promise<void> {
    await this.recoveryStore().recordAgentSessionLink(input);
  }

  async recordProviderSessionObserved(input: LocalProviderSessionObservedFact): Promise<void> {
    await this.recoveryStore().recordProviderSessionObserved(input);
  }

  async recordAgentTimelineCursor(input: LocalAgentTimelineCursorFact): Promise<void> {
    await this.recoveryStore().recordAgentTimelineCursor(input);
  }

  async recordProviderInvocation(input: LocalProviderInvocationFact): Promise<void> {
    await this.recoveryStore().recordProviderInvocation(input);
  }

  async recordCodexThreadLink(
    input: Parameters<NonNullable<LocalConsoleStore["recordCodexThreadLink"]>>[0],
  ): Promise<void> {
    await this.recoveryStore().recordCodexThreadLink(input);
  }

  private recoveryStore(): RecoveryCapableLocalConsoleStore {
    return this.inner as RecoveryCapableLocalConsoleStore;
  }

  async createProject(input: { folderPath: string; worktreeMode: boolean; now: string }): Promise<LocalConsoleProjectSummary> {
    return await this.inner.createProject(input);
  }

  async updateProject(input: { projectId: string; worktreeMode: boolean; now: string }): Promise<LocalConsoleProjectSummary> {
    return await this.inner.updateProject(input);
  }

  async reorderProjects(projectIds: string[]): Promise<LocalConsoleProjectSummary[]> {
    return await this.inner.reorderProjects(projectIds);
  }

  async listProjects(): Promise<LocalConsoleProjectSummary[]> {
    return await this.inner.listProjects();
  }

  async getProject(projectId: string): Promise<LocalConsoleProjectSummary | null> {
    return await this.inner.getProject?.(projectId) ?? null;
  }

  async getSessionWorkspace(sessionId: string): Promise<LocalConsoleSessionWorkspaceSource> {
    return await this.inner.getSessionWorkspace(sessionId);
  }

  async switchSessionWorkspace(input: Parameters<LocalConsoleStore["switchSessionWorkspace"]>[0]): Promise<LocalConsoleSessionSummary> {
    return await this.inner.switchSessionWorkspace(input);
  }

  async switchSessionTeam(input: Parameters<LocalConsoleStore["switchSessionTeam"]>[0]): Promise<LocalConsoleSessionSummary> {
    return await this.inner.switchSessionTeam(input);
  }

  async applyPendingSessionContext(input: Parameters<LocalConsoleStore["applyPendingSessionContext"]>[0]): Promise<LocalConsoleSessionSummary> {
    return await this.inner.applyPendingSessionContext(input);
  }

  async recordProjectWorkspaceStatus(input: {
    projectId: string;
    cwd: string;
    mode: "direct" | "worktree";
    worktreePath: string | null;
    worktreeUnavailableReason: string | null;
    now: string;
  }): Promise<void> {
    await this.inner.recordProjectWorkspaceStatus(input);
  }

  async createSession(input: { sessionId: string; projectId?: string; title: string; now: string }): Promise<LocalConsoleSessionSummary> {
    return await this.inner.createSession(input);
  }

  async moveEmptySessionToProject(input: { sessionId: string; projectId: string; now: string }): Promise<LocalConsoleSessionSummary> {
    return await this.inner.moveEmptySessionToProject(input);
  }

  async listSessions(): Promise<LocalConsoleSessionSummary[]> {
    return await this.inner.listSessions();
  }

  async markSessionResultRead(input: { sessionId: string; unreadSince: string; now: string }): Promise<boolean> {
    return await this.inner.markSessionResultRead(input);
  }

  async appendUserMessage(input: { sessionId: string; body: string; now: string }): Promise<LocalConsoleMessage> {
    return await this.inner.appendUserMessage(input);
  }

  async listMessages(sessionId: string): Promise<LocalConsoleMessage[]> {
    return await this.inner.listMessages(sessionId);
  }

  async hasRunningMessage(sessionId: string): Promise<boolean> {
    return await this.inner.hasRunningMessage(sessionId);
  }

  async claimNextPendingMessage(input: { sessionId: string; runId: string; now: string }): Promise<LocalConsoleMessage | null> {
    return await this.inner.claimNextPendingMessage(input);
  }

  async setRunDir(input: { id: number; runDir: string; now: string }): Promise<void> {
    await this.inner.setRunDir(input);
  }

  async recordAgentResponse(input: {
    userMessageId: number;
    sessionId: string;
    role: string;
    body: string;
    runId: string;
    runDir: string;
    processSteps: readonly import("../src/local-console/run-activity.js").LocalRunActivity[];
    now: string;
  }): Promise<void> {
    if (this.failNextRecord) {
      this.failNextRecord = false;
      throw new Error("injected-record-agent-response-before-commit");
    }
    await this.inner.recordAgentResponse(input);
  }

  async recordSystemAndComplete(input: {
    userMessageId: number;
    sessionId: string;
    body: string;
    runId: string;
    runDir: string | null;
    now: string;
  }): Promise<void> {
    await this.inner.recordSystemAndComplete(input);
  }

  async recordSystemMessage(input: {
    sessionId: string;
    body: string;
    runId: string | null;
    runDir: string | null;
    error: string | null;
    status?: "displayed" | "failed" | "stuck";
    role: string | null;
    processSteps: readonly import("../src/local-console/run-activity.js").LocalRunActivity[];
    now: string;
  }): Promise<void> {
    await this.inner.recordSystemMessage(input);
  }

  async recordMessageProcessed(input: {
    userMessageId: number;
    sessionId: string;
    runId: string;
    runDir: string | null;
    now: string;
  }): Promise<void> {
    await this.inner.recordMessageProcessed(input);
  }

  async findRouteDecision(input: { sessionId: string; routeKey: string }) {
    return await this.inner.findRouteDecision(input);
  }

  async recordRouteAppend(input: {
    userMessageId: number;
    sessionId: string;
    routeKey: string;
    body: string;
    targetRole: string;
    runId: string;
    runDir: string | null;
    now: string;
  }): Promise<void> {
    await this.inner.recordRouteAppend(input);
  }

  async recordRouteNoAction(input: {
    userMessageId: number;
    sessionId: string;
    routeKey: string;
    outcome: "no_action" | "fail_open" | "dead_letter";
    reason: string;
    runId: string;
    runDir: string | null;
    now: string;
  }): Promise<void> {
    await this.inner.recordRouteNoAction(input);
  }

  async releaseMessageForRetry(input: { userMessageId: number; sessionId: string; now: string }): Promise<void> {
    await this.inner.releaseMessageForRetry(input);
  }

  async recordFailure(input: {
    userMessageId: number;
    sessionId: string;
    error: string;
    runId: string | null;
    runDir: string | null;
    now: string;
    role: string | null;
    processSteps: readonly import("../src/local-console/run-activity.js").LocalRunActivity[];
  }): Promise<void> {
    await this.inner.recordFailure(input);
  }

  async recordRetryableFailure(input: {
    userMessageId: number;
    sessionId: string;
    error: string;
    runId: string | null;
    runDir: string | null;
    now: string;
  }): Promise<LocalConsoleMessage> {
    return await this.inner.recordRetryableFailure(input);
  }

  async recordDeadLetter(input: {
    userMessageId: number;
    sessionId: string;
    error: string;
    runId: string | null;
    runDir: string | null;
    failureCount: number;
    now: string;
    role: string | null;
    processSteps: readonly import("../src/local-console/run-activity.js").LocalRunActivity[];
  }): Promise<void> {
    await this.inner.recordDeadLetter(input);
  }

  async recordInterrupted(input: {
    userMessageId: number;
    sessionId: string;
    reason: string;
    runId: string | null;
    runDir: string | null;
    now: string;
    role: string | null;
    processSteps: readonly import("../src/local-console/run-activity.js").LocalRunActivity[];
  }): Promise<void> {
    await this.inner.recordInterrupted(input);
  }

  async recordStuck(input: {
    userMessageId: number;
    sessionId: string;
    reason: string;
    runId: string | null;
    runDir: string | null;
    now: string;
    role: string | null;
    processSteps: readonly import("../src/local-console/run-activity.js").LocalRunActivity[];
  }): Promise<void> {
    await this.inner.recordStuck(input);
  }

  async markStaleRunning(input: {
    sessionId: string;
    cutoffIso: string;
    now: string;
    reason: string;
    roles: Record<number, string | null>;
  }): Promise<number> {
    return await this.inner.markStaleRunning(input);
  }
}

class FailOnceRecordRouteAppendStore implements LocalConsoleStore {
  readonly sqlitePath: string;
  private failNextRecord = true;

  constructor(private readonly inner: LocalConsoleStore) {
    this.sqlitePath = inner.sqlitePath;
  }

  async init(): Promise<void> {
    await this.inner.init();
  }

  async close(): Promise<void> {
    await this.inner.close();
  }

  async createProject(input: { folderPath: string; worktreeMode: boolean; now: string }): Promise<LocalConsoleProjectSummary> {
    return await this.inner.createProject(input);
  }

  async updateProject(input: { projectId: string; worktreeMode: boolean; now: string }): Promise<LocalConsoleProjectSummary> {
    return await this.inner.updateProject(input);
  }

  async reorderProjects(projectIds: string[]): Promise<LocalConsoleProjectSummary[]> {
    return await this.inner.reorderProjects(projectIds);
  }

  async listProjects(): Promise<LocalConsoleProjectSummary[]> {
    return await this.inner.listProjects();
  }

  async getProject(projectId: string): Promise<LocalConsoleProjectSummary | null> {
    return await this.inner.getProject?.(projectId) ?? null;
  }

  async getSessionWorkspace(sessionId: string): Promise<LocalConsoleSessionWorkspaceSource> {
    return await this.inner.getSessionWorkspace(sessionId);
  }

  async switchSessionWorkspace(input: Parameters<LocalConsoleStore["switchSessionWorkspace"]>[0]): Promise<LocalConsoleSessionSummary> {
    return await this.inner.switchSessionWorkspace(input);
  }

  async switchSessionTeam(input: Parameters<LocalConsoleStore["switchSessionTeam"]>[0]): Promise<LocalConsoleSessionSummary> {
    return await this.inner.switchSessionTeam(input);
  }

  async applyPendingSessionContext(input: Parameters<LocalConsoleStore["applyPendingSessionContext"]>[0]): Promise<LocalConsoleSessionSummary> {
    return await this.inner.applyPendingSessionContext(input);
  }

  async recordProjectWorkspaceStatus(input: {
    projectId: string;
    cwd: string;
    mode: "direct" | "worktree";
    worktreePath: string | null;
    worktreeUnavailableReason: string | null;
    now: string;
  }): Promise<void> {
    await this.inner.recordProjectWorkspaceStatus(input);
  }

  async createSession(input: { sessionId: string; projectId?: string; title: string; now: string }): Promise<LocalConsoleSessionSummary> {
    return await this.inner.createSession(input);
  }

  async moveEmptySessionToProject(input: { sessionId: string; projectId: string; now: string }): Promise<LocalConsoleSessionSummary> {
    return await this.inner.moveEmptySessionToProject(input);
  }

  async listSessions(): Promise<LocalConsoleSessionSummary[]> {
    return await this.inner.listSessions();
  }

  async markSessionResultRead(input: { sessionId: string; unreadSince: string; now: string }): Promise<boolean> {
    return await this.inner.markSessionResultRead(input);
  }

  async appendUserMessage(input: { sessionId: string; body: string; now: string }): Promise<LocalConsoleMessage> {
    return await this.inner.appendUserMessage(input);
  }

  async listMessages(sessionId: string): Promise<LocalConsoleMessage[]> {
    return await this.inner.listMessages(sessionId);
  }

  async hasRunningMessage(sessionId: string): Promise<boolean> {
    return await this.inner.hasRunningMessage(sessionId);
  }

  async claimNextPendingMessage(input: { sessionId: string; runId: string; now: string }): Promise<LocalConsoleMessage | null> {
    return await this.inner.claimNextPendingMessage(input);
  }

  async setRunDir(input: { id: number; runDir: string; now: string }): Promise<void> {
    await this.inner.setRunDir(input);
  }

  async recordAgentResponse(input: {
    userMessageId: number;
    sessionId: string;
    role: string;
    body: string;
    runId: string;
    runDir: string;
    processSteps: readonly import("../src/local-console/run-activity.js").LocalRunActivity[];
    now: string;
  }): Promise<void> {
    await this.inner.recordAgentResponse(input);
  }

  async recordSystemAndComplete(input: {
    userMessageId: number;
    sessionId: string;
    body: string;
    runId: string;
    runDir: string | null;
    now: string;
  }): Promise<void> {
    await this.inner.recordSystemAndComplete(input);
  }

  async recordSystemMessage(input: {
    sessionId: string;
    body: string;
    runId: string | null;
    runDir: string | null;
    error: string | null;
    status?: "displayed" | "failed" | "stuck";
    role: string | null;
    processSteps: readonly import("../src/local-console/run-activity.js").LocalRunActivity[];
    now: string;
  }): Promise<void> {
    await this.inner.recordSystemMessage(input);
  }

  async recordMessageProcessed(input: {
    userMessageId: number;
    sessionId: string;
    runId: string;
    runDir: string | null;
    now: string;
  }): Promise<void> {
    await this.inner.recordMessageProcessed(input);
  }

  async findRouteDecision(input: { sessionId: string; routeKey: string }) {
    return await this.inner.findRouteDecision(input);
  }

  async recordRouteAppend(input: {
    userMessageId: number;
    sessionId: string;
    routeKey: string;
    body: string;
    targetRole: string;
    runId: string;
    runDir: string | null;
    now: string;
  }): Promise<void> {
    if (this.failNextRecord) {
      this.failNextRecord = false;
      throw new Error("injected-record-route-append-before-commit");
    }
    await this.inner.recordRouteAppend(input);
  }

  async recordRouteNoAction(input: {
    userMessageId: number;
    sessionId: string;
    routeKey: string;
    outcome: "no_action" | "fail_open" | "dead_letter";
    reason: string;
    runId: string;
    runDir: string | null;
    now: string;
  }): Promise<void> {
    await this.inner.recordRouteNoAction(input);
  }

  async releaseMessageForRetry(input: { userMessageId: number; sessionId: string; now: string }): Promise<void> {
    await this.inner.releaseMessageForRetry(input);
  }

  async recordFailure(input: {
    userMessageId: number;
    sessionId: string;
    error: string;
    runId: string | null;
    runDir: string | null;
    now: string;
    role: string | null;
    processSteps: readonly import("../src/local-console/run-activity.js").LocalRunActivity[];
  }): Promise<void> {
    await this.inner.recordFailure(input);
  }

  async recordRetryableFailure(input: {
    userMessageId: number;
    sessionId: string;
    error: string;
    runId: string | null;
    runDir: string | null;
    now: string;
  }): Promise<LocalConsoleMessage> {
    return await this.inner.recordRetryableFailure(input);
  }

  async recordDeadLetter(input: {
    userMessageId: number;
    sessionId: string;
    error: string;
    runId: string | null;
    runDir: string | null;
    failureCount: number;
    now: string;
    role: string | null;
    processSteps: readonly import("../src/local-console/run-activity.js").LocalRunActivity[];
  }): Promise<void> {
    await this.inner.recordDeadLetter(input);
  }

  async recordInterrupted(input: {
    userMessageId: number;
    sessionId: string;
    reason: string;
    runId: string | null;
    runDir: string | null;
    now: string;
    role: string | null;
    processSteps: readonly import("../src/local-console/run-activity.js").LocalRunActivity[];
  }): Promise<void> {
    await this.inner.recordInterrupted(input);
  }

  async recordStuck(input: {
    userMessageId: number;
    sessionId: string;
    reason: string;
    runId: string | null;
    runDir: string | null;
    now: string;
    role: string | null;
    processSteps: readonly import("../src/local-console/run-activity.js").LocalRunActivity[];
  }): Promise<void> {
    await this.inner.recordStuck(input);
  }

  async markStaleRunning(input: {
    sessionId: string;
    cutoffIso: string;
    now: string;
    reason: string;
    roles: Record<number, string | null>;
  }): Promise<number> {
    return await this.inner.markStaleRunning(input);
  }
}

class RecoveringAppendStore implements LocalConsoleStore {
  readonly sqlitePath = path.join(
    os.tmpdir(),
    `recovering-local-console-${Math.random().toString(36).slice(2)}.sqlite`,
  );
  private readonly factLogPath = `${this.sqlitePath}.jsonl`;

  private messages: LocalConsoleMessage[] = [];
  private sessions = new Map<string, string>([[LOCAL_CONSOLE_DEFAULT_SESSION_ID, "默认会话"]]);
  private nextId = 1;
  private hangNextAppend = true;

  async init(): Promise<void> {}

  async close(): Promise<void> {
    await fs.rm(this.factLogPath, { force: true });
  }

  getSessionFactLogPath(): string {
    return this.factLogPath;
  }

  async recordCodexResumeIntent(input: LocalCodexResumeIntentFact): Promise<void> {
    await this.appendFact("codex_resume_intent", input, input.createdAt);
  }

  async recordCodexResumeConsumed(input: LocalCodexResumeConsumedFact): Promise<void> {
    await this.appendFact("codex_resume_consumed", input, input.consumedAt);
  }

  async recordCodexRunUsage(input: LocalCodexRunUsageFact): Promise<void> {
    await this.appendFact("codex_run_usage", input, input.recordedAt);
  }

  async recordRunExecutionContext(input: LocalRunExecutionContextFact): Promise<void> {
    await this.appendFact("run_execution_context", input, input.recordedAt);
  }

  async recordExecutionSessionLink(input: LocalExecutionSessionLinkFact): Promise<void> {
    await this.appendFact("execution_session_link", input, input.startedAt);
  }

  async recordAgentSessionLink(input: LocalAgentSessionLinkFact): Promise<void> {
    await this.appendFact("agent_session_link", input, input.linkedAt);
  }

  async recordProviderSessionObserved(input: LocalProviderSessionObservedFact): Promise<void> {
    await this.appendFact("provider_session_observed", input, input.observedAt);
  }

  async recordAgentTimelineCursor(input: LocalAgentTimelineCursorFact): Promise<void> {
    await this.appendFact("agent_timeline_cursor", input, input.recordedAt);
  }

  async recordProviderInvocation(input: LocalProviderInvocationFact): Promise<void> {
    await this.appendFact("provider_invocation", input, input.recordedAt);
  }

  async recordCodexThreadLink(
    input: Parameters<NonNullable<LocalConsoleStore["recordCodexThreadLink"]>>[0],
  ): Promise<void> {
    await this.appendFact("codex_thread_link", input, input.startedAt);
  }

  private async appendFact(
    type: string,
    payload: { sessionId: string },
    recordedAt: string,
  ): Promise<void> {
    await fs.appendFile(
      this.factLogPath,
      `${JSON.stringify({
        version: 1,
        eventId: `${type}:${recordedAt}`,
        sessionId: payload.sessionId,
        type,
        recordedAt,
        payload,
        messageUpserts: [],
      })}\n`,
      "utf8",
    );
  }

  async createProject(input: { folderPath: string; worktreeMode: boolean; now: string }): Promise<LocalConsoleProjectSummary> {
    void input.now;
    return buildProjectSummary(await this.listSessions(), {
      folderPath: input.folderPath,
      worktreeMode: input.worktreeMode,
    });
  }

  async updateProject(input: { projectId: string; worktreeMode: boolean; now: string }): Promise<LocalConsoleProjectSummary> {
    void input.projectId;
    void input.now;
    return buildProjectSummary(await this.listSessions(), { worktreeMode: input.worktreeMode });
  }

  async reorderProjects(): Promise<LocalConsoleProjectSummary[]> {
    return await this.listProjects();
  }

  async listProjects(): Promise<LocalConsoleProjectSummary[]> {
    return [buildProjectSummary(await this.listSessions())];
  }

  async getSessionWorkspace(): Promise<LocalConsoleSessionWorkspaceSource> {
    return buildWorkspaceSource();
  }

  async switchSessionWorkspace(input: { sessionId: string }): Promise<LocalConsoleSessionSummary> {
    return buildSessionSummary(input.sessionId, this.sessions.get(input.sessionId), this.messages);
  }

  async switchSessionTeam(input: { sessionId: string }): Promise<LocalConsoleSessionSummary> {
    return buildSessionSummary(input.sessionId, this.sessions.get(input.sessionId), this.messages);
  }

  async applyPendingSessionContext(input: { sessionId: string }): Promise<LocalConsoleSessionSummary> {
    return buildSessionSummary(input.sessionId, this.sessions.get(input.sessionId), this.messages);
  }

  async recordProjectWorkspaceStatus(): Promise<void> {}

  async createSession(input: { sessionId: string; projectId?: string; title: string; now: string }): Promise<LocalConsoleSessionSummary> {
    void input.projectId;
    void input.now;
    this.sessions.set(input.sessionId, input.title);
    return buildSessionSummary(input.sessionId, input.title, this.messages);
  }

  async moveEmptySessionToProject(input: { sessionId: string; projectId: string; now: string }): Promise<LocalConsoleSessionSummary> {
    void input.projectId;
    void input.now;
    return buildSessionSummary(input.sessionId, this.sessions.get(input.sessionId), this.messages);
  }

  async listSessions(): Promise<LocalConsoleSessionSummary[]> {
    const ids = new Set([LOCAL_CONSOLE_DEFAULT_SESSION_ID, ...this.sessions.keys(), ...this.messages.map((message) => message.sessionId)]);
    return Array.from(ids).map((sessionId) =>
      buildSessionSummary(sessionId, this.sessions.get(sessionId) ?? sessionId, this.messages),
    );
  }

  async markSessionResultRead(): Promise<boolean> {
    return false;
  }

  appendUserMessage(input: { sessionId: string; body: string; now: string }): Promise<LocalConsoleMessage> {
    if (this.hangNextAppend) {
      this.hangNextAppend = false;
      return new Promise<LocalConsoleMessage>(() => {});
    }
    const message: LocalConsoleMessage = {
      id: this.nextId,
      sessionId: input.sessionId,
      speaker: "user",
      role: null,
      body: input.body,
      status: "pending",
      runId: null,
      runDir: null,
      error: null,
      systemEventKind: "other",
      failureCount: 0,
      lastFailureReason: null,
      createdAt: input.now,
      updatedAt: input.now,
    };
    this.nextId += 1;
    this.sessions.set(input.sessionId, this.sessions.get(input.sessionId) ?? input.body);
    this.messages.push(message);
    return Promise.resolve(message);
  }

  async listMessages(): Promise<LocalConsoleMessage[]> {
    return this.messages.map((message) => ({ ...message }));
  }

  async hasRunningMessage(): Promise<boolean> {
    return this.messages.some((message) => message.status === "running");
  }

  async claimNextPendingMessage(input: { sessionId: string; runId: string; now: string }): Promise<LocalConsoleMessage | null> {
    const message = this.messages.find((entry) => entry.sessionId === input.sessionId && entry.status === "pending");
    if (message === undefined) {
      return null;
    }
    message.status = "running";
    message.runId = input.runId;
    message.updatedAt = input.now;
    return { ...message };
  }

  async setRunDir(input: { id: number; runDir: string; now: string }): Promise<void> {
    const message = this.messages.find((entry) => entry.id === input.id);
    if (message !== undefined) {
      message.runDir = input.runDir;
      message.updatedAt = input.now;
    }
  }

  async recordAgentResponse(input: {
    userMessageId: number;
    sessionId: string;
    role: string;
    body: string;
    runId: string;
    runDir: string;
    now: string;
  }): Promise<void> {
    const user = this.messages.find((entry) => entry.id === input.userMessageId);
    if (user !== undefined) {
      user.status = "completed";
      user.updatedAt = input.now;
    }
    this.messages.push({
      id: this.nextId,
      sessionId: input.sessionId,
      speaker: "agent",
      role: input.role,
      body: input.body,
      status: "displayed",
      runId: input.runId,
      runDir: input.runDir,
      error: null,
      systemEventKind: "other",
      failureCount: 0,
      lastFailureReason: null,
      createdAt: input.now,
      updatedAt: input.now,
    });
    this.nextId += 1;
  }

  async recordSystemAndComplete(): Promise<void> {}

  async recordSystemMessage(): Promise<void> {}

  async recordMessageProcessed(input: {
    userMessageId: number;
    sessionId: string;
    runId: string;
    runDir: string | null;
    now: string;
  }): Promise<void> {
    void input.sessionId;
    void input.runId;
    void input.runDir;
    const message = this.messages.find((entry) => entry.id === input.userMessageId);
    if (message !== undefined && message.speaker === "user") {
      message.status = "completed";
      message.updatedAt = input.now;
    }
  }

  async findRouteDecision(): Promise<null> {
    return null;
  }

  async recordRouteAppend(): Promise<void> {}

  async recordRouteNoAction(): Promise<void> {}

  async releaseMessageForRetry(input: { userMessageId: number; sessionId: string; now: string }): Promise<void> {
    void input.sessionId;
    const message = this.messages.find((entry) => entry.id === input.userMessageId);
    if (message !== undefined && message.speaker === "user" && message.status === "running") {
      message.status = "pending";
      message.runId = null;
      message.updatedAt = input.now;
    }
  }

  async recordFailure(input: { userMessageId: number; error: string; now: string }): Promise<void> {
    const message = this.messages.find((entry) => entry.id === input.userMessageId);
    if (message !== undefined) {
      message.status = "failed";
      message.error = input.error;
      message.updatedAt = input.now;
    }
  }

  async recordRetryableFailure(input: {
    userMessageId: number;
    sessionId: string;
    error: string;
    runId: string | null;
    runDir: string | null;
    now: string;
  }): Promise<LocalConsoleMessage> {
    void input.sessionId;
    const message = this.messages.find((entry) => entry.id === input.userMessageId);
    if (message === undefined) {
      throw new Error("message not found");
    }
    message.status = message.speaker === "user" ? "pending" : message.status;
    message.runId = input.runId;
    message.runDir = input.runDir;
    message.error = input.error;
    message.failureCount += 1;
    message.lastFailureReason = input.error;
    message.updatedAt = input.now;
    return { ...message };
  }

  async recordDeadLetter(input: {
    userMessageId: number;
    sessionId: string;
    error: string;
    runId: string | null;
    runDir: string | null;
    failureCount: number;
    now: string;
  }): Promise<void> {
    const message = this.messages.find((entry) => entry.id === input.userMessageId);
    if (message !== undefined) {
      message.status = "failed";
      message.runId = input.runId;
      message.runDir = input.runDir;
      message.error = input.error;
      message.failureCount = input.failureCount;
      message.lastFailureReason = input.error;
      message.updatedAt = input.now;
    }
    this.messages.push({
      id: this.nextId,
      sessionId: input.sessionId,
      speaker: "system",
      role: null,
      body: `Local dead-letter: source message ${String(input.userMessageId)} stopped after ${String(input.failureCount)} failed attempts.`,
      status: "displayed",
      runId: input.runId,
      runDir: input.runDir,
      error: input.error,
      systemEventKind: "retry-exhausted",
      failureCount: 0,
      lastFailureReason: null,
      createdAt: input.now,
      updatedAt: input.now,
    });
    this.nextId += 1;
  }

  async recordInterrupted(input: { userMessageId: number; reason: string; now: string }): Promise<void> {
    const message = this.messages.find((entry) => entry.id === input.userMessageId);
    if (message !== undefined) {
      message.status = "interrupted";
      message.error = input.reason;
      message.updatedAt = input.now;
    }
  }

  async recordStuck(input: { userMessageId: number; reason: string; now: string }): Promise<void> {
    const message = this.messages.find((entry) => entry.id === input.userMessageId);
    if (message !== undefined) {
      message.status = "stuck";
      message.error = input.reason;
      message.updatedAt = input.now;
    }
  }

  async markStaleRunning(): Promise<number> {
    return 0;
  }
}
