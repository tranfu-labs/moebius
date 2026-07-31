import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";

import { waitForCondition, waitForValue } from "../src/testing/wait.js";

import { startLocalConsoleServer, type StartedLocalConsoleServer } from "../src/local-console/server.js";
import { createSqliteLocalConsoleStore } from "../src/local-console/store.js";
import { LOCAL_CONSOLE_DEFAULT_SESSION_ID } from "../src/local-console/types.js";
import { runSqliteStateCommand } from "../src/sqlite-state.js";

const SCALE_SESSION_COUNT = 132;
const SCALE_FACT_LOG_BYTES = 10 * 1024 * 1024;
const SENTINEL_SESSION_ID = LOCAL_CONSOLE_DEFAULT_SESSION_ID;
const SENTINEL_MESSAGE = "scale fixture sentinel timeline message";
const SENTINEL_RUN_ID = "run-scale-sentinel";
const RUNNING_SESSION_ID = "local:scale-131";
const PENDING_SESSION_ID = "local:scale-pending";
const ORPHAN_RUN_ID = "run-scale-orphan";
const PENDING_RESPONSE = "startup pending message processed";

const roots: string[] = [];
const servers: StartedLocalConsoleServer[] = [];

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => server.close()));
  await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});

describe("local console store initialization", { timeout: 60_000 }, () => {
  it("starts with 132 sessions and exactly 10 MiB of fact logs without a batch-wide store deadline", async () => {
    const fixture = await createScaleFixture();
    const files = await fs.readdir(fixture.sessionLogRoot);
    const initialTotalBytes = (await Promise.all(files.map(async (fileName) =>
      (await fs.stat(path.join(fixture.sessionLogRoot, fileName))).size)))
      .reduce((sum, size) => sum + size, 0);
    expect(files).toHaveLength(SCALE_SESSION_COUNT);
    expect(initialTotalBytes).toBe(SCALE_FACT_LOG_BYTES);

    const started = await startLocalConsoleServer({
      projectRoot: fixture.root,
      port: 0,
    });
    servers.push(started);

    const response = await fetch(new URL(
      `/api/local-console/state?projectId=local&sessionId=${encodeURIComponent(SENTINEL_SESSION_ID)}`,
      started.url,
    ));
    expect(response.status).toBe(200);
    const state = await response.json() as {
      project: { sessions: Array<{ sessionId: string }> };
      selectedSessionId: string;
      messages: Array<{ body: string }>;
    };
    expect(state.project.sessions).toHaveLength(SCALE_SESSION_COUNT);
    expect(state.selectedSessionId).toBe(SENTINEL_SESSION_ID);
    expect(state.messages).toEqual([
      expect.objectContaining({ body: SENTINEL_MESSAGE }),
    ]);

    const database = new DatabaseSync(fixture.sqlitePath, { readOnly: true });
    try {
      expect(database.prepare(
        "SELECT body FROM session_messages WHERE session_id = ?",
      ).all(SENTINEL_SESSION_ID)).toEqual([{ body: SENTINEL_MESSAGE }]);
      expect(database.prepare(
        "SELECT run_id FROM local_run_execution_contexts WHERE session_id = ?",
      ).all(SENTINEL_SESSION_ID)).toEqual([{ run_id: SENTINEL_RUN_ID }]);
      expect(database.prepare(
        "SELECT run_id FROM local_execution_session_links WHERE session_id = ?",
      ).all(SENTINEL_SESSION_ID)).toEqual([{ run_id: SENTINEL_RUN_ID }]);
    } finally {
      database.close();
    }
  });

  it("allows multi-step init to exceed the ordinary store timeout while later calls remain bounded", async () => {
    const root = await fixtureRoot("moebius-store-init-deadline-");
    const store = await createSqliteLocalConsoleStore({
      sqlitePath: path.join(root, ".state", "local-console.sqlite"),
    });
    const originalInit = store.init.bind(store);
    store.init = async () => {
      await new Promise((resolve) => setTimeout(resolve, 2_100));
      await originalInit();
    };

    const started = await startLocalConsoleServer({
      projectRoot: root,
      port: 0,
      store,
      storeTimeoutMs: 2_000,
    });
    servers.push(started);

    store.listProjects = async () => await new Promise<never>(() => undefined);
    const response = await fetch(new URL("/api/local-console/state", started.url));
    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({
      error: "local-console-store-list-projects-timeout:2000ms",
    });
  });

  it("keeps the default-session init catch-up fallback when a custom store reports no sessions", async () => {
    const root = await fixtureRoot("moebius-store-init-empty-summary-");
    const store = await createSqliteLocalConsoleStore({
      sqlitePath: path.join(root, ".state", "local-console.sqlite"),
    });
    const listMessageCalls: string[] = [];
    const markStaleCalls: string[] = [];
    const originalListMessages = store.listMessages.bind(store);
    const originalMarkStaleRunning = store.markStaleRunning.bind(store);
    store.listSessions = async () => [];
    store.listMessages = async (sessionId) => {
      listMessageCalls.push(sessionId);
      return originalListMessages(sessionId);
    };
    store.markStaleRunning = async (input) => {
      markStaleCalls.push(input.sessionId);
      return originalMarkStaleRunning(input);
    };

    const started = await startLocalConsoleServer({
      projectRoot: root,
      port: 0,
      store,
    });
    servers.push(started);

    expect(listMessageCalls).toEqual([SENTINEL_SESSION_ID]);
    expect(markStaleCalls).toEqual([SENTINEL_SESSION_ID]);
  });

  it("leaves 131 quiet logs unchanged while settling running and pending startup work", async () => {
    const fixture = await createScaleFixture({
      runningSessionId: RUNNING_SESSION_ID,
      pendingSessionId: PENDING_SESSION_ID,
    });
    const quietHashesBefore = await factLogHashes(fixture.sessionLogRoot);
    quietHashesBefore.delete(RUNNING_SESSION_ID);
    quietHashesBefore.delete(PENDING_SESSION_ID);
    expect(quietHashesBefore.size).toBe(131);
    const store = await createSqliteLocalConsoleStore({
      sqlitePath: fixture.sqlitePath,
      sessionLogRoot: fixture.sessionLogRoot,
    });
    const listMessageCalls: string[] = [];
    const markStaleCalls: string[] = [];
    const claimCalls: string[] = [];
    const originalListMessages = store.listMessages.bind(store);
    const originalMarkStaleRunning = store.markStaleRunning.bind(store);
    const originalClaimNextPendingMessage = store.claimNextPendingMessage.bind(store);
    store.listMessages = async (sessionId) => {
      listMessageCalls.push(sessionId);
      return originalListMessages(sessionId);
    };
    store.markStaleRunning = async (input) => {
      markStaleCalls.push(input.sessionId);
      return originalMarkStaleRunning(input);
    };
    store.claimNextPendingMessage = async (input) => {
      claimCalls.push(input.sessionId);
      return originalClaimNextPendingMessage(input);
    };

    const started = await startLocalConsoleServer({
      projectRoot: fixture.root,
      port: 0,
      store,
      listAgentFiles: async () => [{
        name: "dev-manager",
        agentMarkdown: "# dev-manager\n\nROLE:dev-manager",
      }],
      runCodex: async (options) => ({
        ok: true,
        finalText: PENDING_RESPONSE,
        threadId: "thread-startup-pending",
        cachedInputTokens: null,
        runDir: options.runDir,
        stdoutPath: path.join(options.runDir, "stdout.jsonl"),
        stderrPath: path.join(options.runDir, "stderr.log"),
      }),
      makeRunDir: (count) => path.join(fixture.root, "runs", `startup-${String(count)}`),
    });
    servers.push(started);

    await waitFor(async () => {
      const [runningMessages, pendingMessages, sessions] = await Promise.all([
        originalListMessages(RUNNING_SESSION_ID),
        originalListMessages(PENDING_SESSION_ID),
        store.listSessions(),
      ]);
      return runningMessages.some((message) =>
        message.runId === ORPHAN_RUN_ID
        && message.systemEventKind === "run-stuck")
        && pendingMessages.some((message) =>
          message.speaker === "agent"
          && message.body === PENDING_RESPONSE)
        && sessions.find((session) => session.sessionId === PENDING_SESSION_ID)
          ?.hasPendingControlWork === false;
    });

    const quietHashesAfter = await waitForStableFactLogHashes(
      fixture.sessionLogRoot,
      new Set([RUNNING_SESSION_ID, PENDING_SESSION_ID]),
    );
    expect(listMessageCalls.every((sessionId) =>
      sessionId === RUNNING_SESSION_ID || sessionId === PENDING_SESSION_ID)).toBe(true);
    expect(markStaleCalls.every((sessionId) =>
      sessionId === RUNNING_SESSION_ID || sessionId === PENDING_SESSION_ID)).toBe(true);
    expect(new Set(claimCalls)).toEqual(new Set([PENDING_SESSION_ID]));
    expect(quietHashesAfter.size).toBe(131);
    expect(quietHashesAfter).toEqual(quietHashesBefore);

    const pendingMessages = await originalListMessages(PENDING_SESSION_ID);
    expect(pendingMessages).toEqual(expect.arrayContaining([
      expect.objectContaining({
        speaker: "user",
        status: "completed",
      }),
      expect.objectContaining({
        speaker: "agent",
        body: PENDING_RESPONSE,
      }),
    ]));

    const runningMessages = await originalListMessages(RUNNING_SESSION_ID);
    expect(runningMessages).toEqual(expect.arrayContaining([
      expect.objectContaining({
        runId: ORPHAN_RUN_ID,
        status: "stuck",
      }),
      expect.objectContaining({
        runId: ORPHAN_RUN_ID,
        systemEventKind: "run-stuck",
      }),
    ]));

    const response = await fetch(new URL(
      `/api/local-console/state?projectId=local&sessionId=${encodeURIComponent(PENDING_SESSION_ID)}`,
      started.url,
    ));
    expect(response.status).toBe(200);
  });

  it("does not write startup no-op facts when every session is quiet", async () => {
    const fixture = await createScaleFixture();
    const quietHashesBefore = await factLogHashes(fixture.sessionLogRoot);
    const started = await startLocalConsoleServer({
      projectRoot: fixture.root,
      port: 0,
    });
    servers.push(started);

    const quietHashesAfter = await waitForStableFactLogHashes(fixture.sessionLogRoot);
    expect(quietHashesAfter).toEqual(quietHashesBefore);
  });

  it("rejects a malformed fact log before the server starts listening", async () => {
    const root = await fixtureRoot("moebius-store-init-malformed-");
    const sqlitePath = path.join(root, ".state", "local-console.sqlite");
    const sessionLogRoot = path.join(root, "sessions");
    await runSqliteStateCommand({ sqlitePath, command: { kind: "local-init" } });
    await fs.mkdir(sessionLogRoot, { recursive: true });
    await fs.writeFile(
      factLogPath(sessionLogRoot, SENTINEL_SESSION_ID),
      "{\"version\":1,\"broken\":true}\n",
      "utf8",
    );

    await expect(startLocalConsoleServer({
      projectRoot: root,
      port: 0,
      sqlitePath,
      sessionLogRoot,
    })).rejects.toThrow(`invalid session fact event ${SENTINEL_SESSION_ID} line 1`);
  });
});

interface ScaleFixture {
  root: string;
  sqlitePath: string;
  sessionLogRoot: string;
}

async function createScaleFixture(
  options: {
    runningSessionId?: string;
    pendingSessionId?: string;
  } = {},
): Promise<ScaleFixture> {
  const root = await fixtureRoot("moebius-store-init-scale-");
  const sqlitePath = path.join(root, ".state", "local-console.sqlite");
  const sessionLogRoot = path.join(root, "sessions");
  await runSqliteStateCommand({ sqlitePath, command: { kind: "local-init" } });
  await fs.mkdir(sessionLogRoot, { recursive: true });

  const sessionIds = [
    SENTINEL_SESSION_ID,
    ...Array.from(
      { length: SCALE_SESSION_COUNT - 1 },
      (_, index) => `local:scale-${String(index + 1).padStart(3, "0")}`,
    ),
    ...(options.pendingSessionId === undefined ? [] : [options.pendingSessionId]),
  ];
  const database = new DatabaseSync(sqlitePath);
  try {
    const insertSession = database.prepare(
      `INSERT INTO sessions
        (session_id, project_id, source_type, workspace_mode, title, status, created_at, updated_at)
       VALUES (?, 'local', 'local', 'direct', ?, 'active', ?, ?)`,
    );
    const insertCursor = database.prepare(
      `INSERT INTO local_message_cursors
        (session_id, processed_through_message_id, active_message_id, active_run_id, updated_at)
       VALUES (?, 0, NULL, NULL, ?)`,
    );
    for (const [index, sessionId] of sessionIds.entries()) {
      if (sessionId === SENTINEL_SESSION_ID) {
        continue;
      }
      const now = sessionId === options.pendingSessionId
        ? fixtureTimestamp(-1)
        : fixtureTimestamp(index);
      insertSession.run(sessionId, `Scale session ${String(index)}`, now, now);
      insertCursor.run(sessionId, now);
    }

    database.prepare(
      `INSERT INTO session_messages
        (id, session_id, speaker, role, body, status, run_id, run_dir, error, system_event_kind,
         failure_count, last_failure_reason, source_kind, source_id, activated_at, created_at, updated_at)
       VALUES (999999, ?, 'user', NULL, 'stale sqlite cache', 'completed', NULL, NULL, NULL, 'other',
               0, NULL, NULL, NULL, ?, ?, ?)`,
    ).run(SENTINEL_SESSION_ID, fixtureTimestamp(0), fixtureTimestamp(0), fixtureTimestamp(0));
    database.prepare(
      "INSERT INTO local_run_execution_contexts (session_id, run_id, context_json) VALUES (?, 'stale-run', '{}')",
    ).run(SENTINEL_SESSION_ID);
    database.prepare(
      "INSERT INTO local_execution_session_links (session_id, run_id, link_json) VALUES (?, 'stale-run', '{}')",
    ).run(SENTINEL_SESSION_ID);
  } finally {
    database.close();
  }

  const baseBytes = Math.floor(SCALE_FACT_LOG_BYTES / sessionIds.length);
  const remainder = SCALE_FACT_LOG_BYTES % sessionIds.length;
  await Promise.all(sessionIds.map(async (sessionId, index) => {
    const targetBytes = baseBytes + (index < remainder ? 1 : 0);
    const text = buildSizedFactLog({
      root,
      sessionId,
      messageId: index + 1,
      targetBytes,
      sentinel: index === 0,
      running: sessionId === options.runningSessionId,
      pending: sessionId === options.pendingSessionId,
    });
    await fs.writeFile(factLogPath(sessionLogRoot, sessionId), text, "utf8");
  }));

  return { root, sqlitePath, sessionLogRoot };
}

function buildSizedFactLog(input: {
  root: string;
  sessionId: string;
  messageId: number;
  targetBytes: number;
  sentinel: boolean;
  running: boolean;
  pending: boolean;
}): string {
  const now = fixtureTimestamp(input.messageId);
  const message = {
    id: input.messageId,
    sessionId: input.sessionId,
    speaker: "user",
    role: null,
    body: input.sentinel
      ? SENTINEL_MESSAGE
      : input.pending
        ? "startup pending control message"
        : `scale fixture message ${String(input.messageId)}`,
    status: input.running ? "running" : input.pending ? "pending" : "completed",
    runId: input.running ? ORPHAN_RUN_ID : null,
    runDir: input.running ? path.join(input.root, "runs", ORPHAN_RUN_ID) : null,
    error: null,
    systemEventKind: "other",
    failureCount: 0,
    lastFailureReason: null,
    sourceKind: null,
    sourceId: null,
    activatedAt: now,
    createdAt: now,
    updatedAt: now,
  };
  const primary = {
    version: 1,
    eventId: `scale-message-${String(input.messageId)}`,
    sessionId: input.sessionId,
    type: "scale_fixture_message",
    recordedAt: now,
    payload: { kind: "scale-fixture", padding: "" },
    messageUpserts: [message],
  };
  const events: unknown[] = [primary];
  if (input.sentinel) {
    events.push(
      {
        version: 1,
        eventId: "scale-run-context",
        sessionId: input.sessionId,
        type: "run_execution_context",
        recordedAt: now,
        payload: {
          sessionId: input.sessionId,
          runId: SENTINEL_RUN_ID,
          sourceMessageId: input.messageId,
          role: "dev-manager",
          engine: "codex",
          profile: null,
          profileFingerprint: "scale-profile",
          agentIdentityFingerprint: "scale-agent",
          contextFingerprint: "scale-context",
          workspace: {
            cwd: input.root,
            mode: "direct",
            worktreePath: null,
            worktreeUnavailableReason: null,
            branchName: null,
            baseRef: null,
            originalRepoRoot: input.root,
          },
          team: [],
          recordedAt: now,
        },
        messageUpserts: [],
      },
      {
        version: 1,
        eventId: "scale-execution-link",
        sessionId: input.sessionId,
        type: "execution_session_link",
        recordedAt: now,
        payload: {
          sessionId: input.sessionId,
          runId: SENTINEL_RUN_ID,
          sourceMessageId: input.messageId,
          role: "dev-manager",
          engine: "codex",
          externalSessionId: "scale-external-session",
          profileFingerprint: "scale-profile",
          agentIdentityFingerprint: "scale-agent",
          contextFingerprint: "scale-context",
          startedAt: now,
        },
        messageUpserts: [],
      },
    );
  }

  const unpadded = serializeEvents(events);
  const paddingBytes = input.targetBytes - Buffer.byteLength(unpadded);
  if (paddingBytes < 0) {
    throw new Error(`scale fixture target too small for ${input.sessionId}`);
  }
  primary.payload.padding = "x".repeat(paddingBytes);
  const text = serializeEvents(events);
  if (Buffer.byteLength(text) !== input.targetBytes) {
    throw new Error(`scale fixture byte mismatch for ${input.sessionId}`);
  }
  return text;
}

function serializeEvents(events: unknown[]): string {
  return `${events.map((event) => JSON.stringify(event)).join("\n")}\n`;
}

function factLogPath(sessionLogRoot: string, sessionId: string): string {
  return path.join(
    sessionLogRoot,
    `${Buffer.from(sessionId, "utf8").toString("base64url")}.jsonl`,
  );
}

function fixtureTimestamp(index: number): string {
  return new Date(Date.UTC(2026, 6, 28, 0, 0, index)).toISOString();
}

async function fixtureRoot(prefix: string): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
  roots.push(root);
  return root;
}

async function factLogHashes(
  sessionLogRoot: string,
  excludedSessionIds = new Set<string>(),
): Promise<Map<string, string>> {
  const files = await fs.readdir(sessionLogRoot);
  const entries = await Promise.all(files.map(async (fileName) => {
    const encoded = fileName.slice(0, -".jsonl".length);
    const sessionId = Buffer.from(encoded, "base64url").toString("utf8");
    if (excludedSessionIds.has(sessionId)) {
      return null;
    }
    const digest = createHash("sha256")
      .update(await fs.readFile(path.join(sessionLogRoot, fileName)))
      .digest("hex");
    return [sessionId, digest] as const;
  }));
  return new Map(entries.filter((entry): entry is readonly [string, string] => entry !== null));
}

async function waitForStableFactLogHashes(
  sessionLogRoot: string,
  excludedSessionIds = new Set<string>(),
): Promise<Map<string, string>> {
  let previous = await factLogHashes(sessionLogRoot, excludedSessionIds);
  let stableSamples = 0;
  return waitForValue(
    async () => {
      const current = await factLogHashes(sessionLogRoot, excludedSessionIds);
      if (!mapsEqual(previous, current)) {
        stableSamples = 0;
        previous = current;
        return undefined;
      }
      stableSamples += 1;
      // 连续三次采样一致才算稳定——单次相等可能只是恰好落在两次写入之间。
      return stableSamples >= 3 ? current : undefined;
    },
    {
      describe: "session fact logs 稳定",
      kind: "io",
      timeoutMs: 5_000,
      pollMs: 100,
      snapshot: () => ({ stableSamples, entries: previous.size }),
    },
  );
}

function mapsEqual(left: Map<string, string>, right: Map<string, string>): boolean {
  return left.size === right.size
    && [...left].every(([key, value]) => right.get(key) === value);
}

async function waitFor(predicate: () => Promise<boolean>): Promise<void> {
  await waitForCondition(predicate, {
    describe: "startup catch-up",
    kind: "io",
    timeoutMs: 15_000,
    pollMs: 50,
  });
}
