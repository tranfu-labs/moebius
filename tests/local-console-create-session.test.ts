import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { CodexRunOptions, CodexRunResult } from "../src/codex.js";
import { startLocalConsoleServer, type StartedLocalConsoleServer } from "../src/local-console/start.js";
import { waitForValue } from "../src/testing/wait.js";

const startedServers: StartedLocalConsoleServer[] = [];
const fixtureRoots: string[] = [];

afterEach(async () => {
  await Promise.all(startedServers.splice(0).map((server) => server.close()));
  await Promise.all(fixtureRoots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});

describe("POST /api/local-console/sessions with initialMessage", () => {
  it("creates the session and first user message atomically with a derived title", async () => {
    const started = await startFixtureServer();
    const response = await postSession(started, {
      projectId: "local",
      initialMessage: "  帮我   完成登录页\n这一行不进标题  ",
      agentTeamOwnership: "system",
      agentTeamId: "development",
    });

    expect(response.status).toBe(201);
    const body = await response.json() as { session: { sessionId: string; title: string } };
    expect(body.session.title).toBe("帮我 完成登录页");

    let lastState: SessionState | undefined;
    const state = await waitForValue(async () => {
      const response = await fetch(new URL(
        `/api/local-console/state?projectId=local&sessionId=${encodeURIComponent(body.session.sessionId)}`,
        started.url,
      ));
      expect(response.status).toBe(200);
      lastState = await response.json() as SessionState;
      return lastState.messages.some((message) => message.speaker === "user") ? lastState : undefined;
    }, {
      describe: "initial message to appear in the public session timeline",
      kind: "io",
      snapshot: () => lastState,
    });
    expect(state).toMatchObject({
      selectedSession: { sessionId: body.session.sessionId, title: "帮我 完成登录页" },
    });
    expect(state.messages).toEqual(expect.arrayContaining([
      expect.objectContaining({
        speaker: "user",
        body: "帮我   完成登录页\n这一行不进标题",
      }),
    ]));
  });

  it("rolls back the session when inserting the initial message fails", async () => {
    const started = await startFixtureServer();
    const database = new DatabaseSync(started.sqlitePath);
    database.exec(`
      CREATE TRIGGER fail_initial_message
      BEFORE INSERT ON session_messages
      WHEN NEW.body = 'force atomic failure'
      BEGIN
        SELECT RAISE(ABORT, 'forced initial message failure');
      END;
    `);
    database.close();

    const response = await postSession(started, {
      projectId: "local",
      initialMessage: "force atomic failure",
    });
    expect(response.status).toBe(500);

    const verify = new DatabaseSync(started.sqlitePath, { readOnly: true });
    try {
      verify.exec("PRAGMA busy_timeout = 2000");
      expect(verify.prepare("SELECT session_id FROM sessions WHERE title = ?").get("force atomic failure"))
        .toBeUndefined();
      expect(verify.prepare("SELECT id FROM session_messages WHERE body = ?").get("force atomic failure"))
        .toBeUndefined();
    } finally {
      verify.close();
    }
  });

  it("keeps legacy and child-session creation independent of initialMessage", async () => {
    const started = await startFixtureServer();
    const parentResponse = await postSession(started, { projectId: "local", title: "legacy parent" });
    const parent = await parentResponse.json() as { session: { sessionId: string } };

    const childResponse = await fetch(new URL("/api/local-console/child-sessions", started.url), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        parentSessionId: parent.session.sessionId,
        childSessionId: "local:child-with-own-handoff",
        projectId: "local",
        title: "child",
        hiddenKey: "child-key",
        initialBody: "@dev 接手子任务",
      }),
    });

    expect(parentResponse.status).toBe(201);
    expect(childResponse.status).toBe(201);
    const stateResponse = await fetch(new URL(
      "/api/local-console/state?projectId=local&sessionId=local%3Achild-with-own-handoff",
      started.url,
    ));
    await expect(stateResponse.json()).resolves.toMatchObject({
      selectedSession: { parentSessionId: parent.session.sessionId, title: "child" },
      pendingPrimaryMessages: [expect.objectContaining({ body: "@dev 接手子任务" })],
    });
  });
});

async function startFixtureServer(): Promise<StartedLocalConsoleServer> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "moebius-create-session-"));
  fixtureRoots.push(root);
  const started = await startLocalConsoleServer({
    projectRoot: root,
    port: 0,
    storeTimeoutMs: 2_000,
    runCodex: vi.fn(async (options: CodexRunOptions) => codexOk(options)),
  });
  startedServers.push(started);
  return started;
}

async function postSession(started: StartedLocalConsoleServer, body: Record<string, unknown>): Promise<Response> {
  return await fetch(new URL("/api/local-console/sessions", started.url), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
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

interface SessionState {
  selectedSession: { sessionId: string; title: string } | null;
  messages: Array<{ speaker: string; body: string }>;
}
