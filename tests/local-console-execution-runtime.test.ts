import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

import { afterEach, describe, expect, it, vi } from "vitest";

import type { CodexRunOptions, CodexRunResult } from "../src/codex.js";
import type { KimiAcpRunOptions } from "../src/kimi.js";
import { createLocalExecutionRunner } from "../src/local-console/execution-driver.js";
import { startLocalConsoleServer, type StartedLocalConsoleServer } from "../src/local-console/server.js";
import { createSqliteLocalConsoleStore } from "../src/local-console/store.js";
import type {
  LocalConsoleAgentTeamSnapshot,
  LocalConsoleExecutionProfile,
  LocalConsoleMessage,
} from "../src/local-console/types.js";

const roots: string[] = [];
const servers: StartedLocalConsoleServer[] = [];

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => server.close().catch(() => undefined)));
  await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});

describe("local execution runtime", { timeout: 15_000 }, () => {
  it("runs a mixed Kimi/Codex team through the snapshotted driver for each member", async () => {
    const root = await fixtureRoot();
    const codex = vi.fn(async (options: CodexRunOptions) => success(options, "dev completed"));
    let kimiCall = 0;
    const kimi = vi.fn(async (options: KimiAcpRunOptions): Promise<CodexRunResult> => {
      kimiCall += 1;
      const sessionId = options.mode.kind === "resume"
        ? options.mode.externalSessionId
        : `kimi-mixed-${String(kimiCall)}`;
      await options.onSessionStarted?.(sessionId);
      return {
        ok: true,
        finalText: kimiCall === 1 ? "@dev implement the change" : "manager completed",
        threadId: sessionId,
        cachedInputTokens: null,
        runDir: options.runDir,
        stdoutPath: path.join(options.runDir, "kimi-acp.jsonl"),
        stderrPath: path.join(options.runDir, "kimi-stderr.log"),
      };
    });
    const server = await startLocalConsoleServer({
      host: "127.0.0.1",
      port: 0,
      projectRoot: root,
      sqlitePath: path.join(root, "local-console.sqlite"),
      listAgentFiles: async () => [],
      loadAgentTeamSnapshot: async () => ({
        members: [
          {
            name: "manager",
            agentMarkdown: "# manager\n\nDelegate implementation to @dev.",
            executionProfile: { cli: "kimi", model: "kimi-for-coding", effort: "high" },
          },
          {
            name: "dev",
            agentMarkdown: "# dev\n\nImplement and return to the manager.",
            executionProfile: { cli: "codex", model: "gpt-5.6-sol", effort: "medium" },
          },
        ],
      }),
      runCodex: codex,
      runExecution: createLocalExecutionRunner({ runCodex: codex, runKimi: kimi }),
    });
    servers.push(server);

    await server.runtime.switchSessionTeam({
      sessionId: "default",
      agentTeamOwnership: "user",
      agentTeamId: "mixed",
    });
    await post(server.url, "build it");
    await waitForAgent(server.url, "manager completed");

    expect(kimi).toHaveBeenCalledTimes(2);
    expect(codex).toHaveBeenCalledTimes(1);
    expect(kimi.mock.calls[0]?.[0]).toMatchObject({
      profile: { cli: "kimi", model: "kimi-for-coding", effort: "high" },
    });
    expect(kimi.mock.calls[1]?.[0]).toMatchObject({
      mode: { kind: "resume", externalSessionId: "kimi-mixed-1" },
    });
    expect(kimi.mock.calls[1]?.[0].prompt).toContain("dev completed");
    expect(kimi.mock.calls[1]?.[0].prompt).not.toContain("当前本地对话时间线");
    expect(codex.mock.calls[0]?.[0].execOptions).toEqual(expect.arrayContaining([
      "--disable",
      "multi_agent",
      "-m",
      "gpt-5.6-sol",
      "-c",
      'model_reasoning_effort="medium"',
    ]));
  });

  it("freezes the selected member profile and hard-routes Kimi without invoking Codex", async () => {
    const root = await fixtureRoot();
    const kimiProfile: LocalConsoleExecutionProfile = {
      cli: "kimi",
      model: "kimi-for-coding",
      effort: "high",
    };
    let selectedProfile: LocalConsoleExecutionProfile = kimiProfile;
    const snapshots: Record<string, LocalConsoleAgentTeamSnapshot> = {
      development: snapshot("old Kimi team", selectedProfile),
    };
    const codex = vi.fn(async (options: CodexRunOptions) => success(options, "Codex"));
    const kimi = vi.fn(async (options: KimiAcpRunOptions): Promise<CodexRunResult> => {
      await options.onSessionStarted?.("kimi-session-a");
      return {
        ok: true,
        finalText: "Kimi completed",
        threadId: "kimi-session-a",
        cachedInputTokens: null,
        runDir: options.runDir,
        stdoutPath: path.join(options.runDir, "kimi-acp.jsonl"),
        stderrPath: path.join(options.runDir, "kimi-stderr.log"),
      };
    });
    const server = await startLocalConsoleServer({
      host: "127.0.0.1",
      port: 0,
      projectRoot: root,
      workdirRoot: path.join(root, "workdir"),
      sqlitePath: path.join(root, "local-console.sqlite"),
      listAgentFiles: async () => [],
      loadAgentTeamSnapshot: async ({ id }) => snapshots[id]!,
      runCodex: codex,
      runExecution: createLocalExecutionRunner({ runCodex: codex, runKimi: kimi }),
      makeRunDir: (_count, now) => path.join(root, `run-${String(now?.getTime() ?? 0)}`),
    });
    servers.push(server);

    await server.runtime.switchSessionTeam({
      sessionId: "default",
      agentTeamOwnership: "user",
      agentTeamId: "development",
    });
    selectedProfile = { cli: "codex", model: "gpt-5.6-sol", effort: "medium" };
    snapshots.development = snapshot("new Codex team", selectedProfile);

    await post(server.url, "@dev implement");
    await waitForAgent(server.url, "Kimi completed");
    await post(server.url, "second message");
    await waitForCalls(kimi, 2);
    await post(server.url, "third message");
    await waitForCalls(kimi, 3);

    const createNew = await fetch(new URL("/api/local-console/sessions", server.url), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        projectId: "local",
        initialMessage: "new session message",
        agentTeamOwnership: "user",
        agentTeamId: "development",
      }),
    });
    expect(createNew.status).toBe(201);
    await waitForCalls(codex, 1);

    expect(kimi).toHaveBeenCalledTimes(3);
    for (const [index, [options]] of kimi.mock.calls.entries()) {
      expect(options).toMatchObject({
        profile: kimiProfile,
        mode: index === 0
          ? { kind: "full" }
          : { kind: "resume", externalSessionId: "kimi-session-a" },
      });
    }
    expect(codex.mock.calls[0]?.[0].execOptions).toEqual(expect.arrayContaining([
      "-m",
      "gpt-5.6-sol",
      "-c",
      'model_reasoning_effort="medium"',
    ]));

    const facts = await fs.readFile(server.runtime.getSessionFactLogPath("default"), "utf8");
    expect(facts).toContain('"type":"run_execution_context"');
    expect(facts).toContain('"engine":"kimi"');
    expect(facts).toContain('"type":"execution_session_link"');
    expect(facts).toContain('"externalSessionId":"kimi-session-a"');
    expect(facts).toContain("old Kimi team");
    expect(facts).not.toContain("new Codex team");
    const database = new DatabaseSync(path.join(root, "local-console.sqlite"), { readOnly: true });
    try {
      expect(database.prepare(
        "SELECT COUNT(*) AS count FROM local_run_execution_contexts WHERE session_id = 'default'",
      ).get()).toEqual({ count: 3 });
      expect(database.prepare(
        "SELECT COUNT(*) AS count FROM local_execution_session_links WHERE session_id = 'default'",
      ).get()).toEqual({ count: 3 });
    } finally {
      database.close();
    }
  });

  it("persists a new session, first message, and bound snapshot before a missing driver fails", async () => {
    const root = await fixtureRoot();
    const sqlitePath = path.join(root, "local-console.sqlite");
    const codex = vi.fn(async (options: CodexRunOptions) => success(options, "unexpected Codex"));
    const kimi = vi.fn(async (options: KimiAcpRunOptions): Promise<CodexRunResult> => ({
      ok: false,
      reason: "Kimi CLI 未安装",
      runDir: options.runDir,
      stdoutPath: path.join(options.runDir, "kimi-acp.jsonl"),
      stderrPath: path.join(options.runDir, "kimi-stderr.log"),
    }));
    const server = await startLocalConsoleServer({
      host: "127.0.0.1",
      port: 0,
      projectRoot: root,
      sqlitePath,
      listAgentFiles: async () => [],
      loadAgentTeamSnapshot: async () => snapshot("Kimi primary", {
        cli: "kimi",
        model: "future-model",
        effort: "future-effort",
      }),
      runCodex: codex,
      runExecution: createLocalExecutionRunner({ runCodex: codex, runKimi: kimi }),
    });
    servers.push(server);

    const response = await fetch(new URL("/api/local-console/sessions", server.url), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        projectId: "local",
        initialMessage: "first message",
        agentTeamOwnership: "user",
        agentTeamId: "development",
      }),
    });
    expect(response.status).toBe(201);
    const created = await response.json() as { session: { sessionId: string } };
    await waitForCalls(kimi, 1);
    expect(kimi).toHaveBeenCalledTimes(1);
    expect(codex).not.toHaveBeenCalled();
    const database = new DatabaseSync(sqlitePath, { readOnly: true });
    try {
      const failed = await waitForDatabaseRow(database, {
        sql: `SELECT body, error, status, system_event_kind
              FROM session_messages
              WHERE session_id = ? AND speaker = 'system' AND system_event_kind = 'run-not-started'`,
        params: [created.session.sessionId],
      });
      expect(failed).toMatchObject({
        body: expect.stringContaining("这一步没跑起来"),
        error: expect.stringContaining("Kimi CLI 未安装"),
        status: "displayed",
        system_event_kind: "run-not-started",
      });
      expect(database.prepare(
        "SELECT agent_team_ownership, agent_team_id FROM sessions WHERE session_id = ?",
      ).get(created.session.sessionId)).toEqual({
        agent_team_ownership: "user",
        agent_team_id: "development",
      });
      expect(database.prepare(
        "SELECT body, status FROM session_messages WHERE session_id = ? AND speaker = 'user'",
      ).get(created.session.sessionId)).toEqual({ body: "first message", status: "failed" });
      expect(database.prepare(
        `SELECT execution_cli, execution_model, execution_effort
         FROM session_agent_team_members
         WHERE session_id = ? AND slot = 'effective' AND sort_order = 0`,
      ).get(created.session.sessionId)).toEqual({
        execution_cli: "kimi",
        execution_model: "future-model",
        execution_effort: "future-effort",
      });
    } finally {
      database.close();
    }
  });

  it("persists an actionable Codex upgrade failure and resumes the same thread after retry", async () => {
    const root = await fixtureRoot();
    const sqlitePath = path.join(root, "local-console.sqlite");
    let call = 0;
    const codex = vi.fn(async (options: CodexRunOptions): Promise<CodexRunResult> => {
      call += 1;
      await options.onThreadStarted?.("codex-upgrade-thread");
      if (call === 1) {
        return {
          ok: false,
          reason: "codex-cli-upgrade-required",
          failure: {
            code: "codex-cli-upgrade-required",
            message: "Codex 版本过旧，无法运行模型 gpt-5.6-sol。请升级当前 Codex 后再重试。",
          },
          runDir: options.runDir,
          stdoutPath: path.join(options.runDir, "stdout.jsonl"),
          stderrPath: path.join(options.runDir, "stderr.log"),
        };
      }
      return {
        ok: true,
        finalText: "retry completed",
        threadId: "codex-upgrade-thread",
        cachedInputTokens: 0,
        runDir: options.runDir,
        stdoutPath: path.join(options.runDir, "stdout.jsonl"),
        stderrPath: path.join(options.runDir, "stderr.log"),
      };
    });
    const server = await startLocalConsoleServer({
      host: "127.0.0.1",
      port: 0,
      projectRoot: root,
      sqlitePath,
      listAgentFiles: async () => [],
      loadAgentTeamSnapshot: async () => snapshot("Codex primary", {
        cli: "codex",
        model: "gpt-5.6-sol",
        effort: "high",
      }),
      runCodex: codex,
      runExecution: createLocalExecutionRunner({ runCodex: codex }),
      isCodexThreadAvailable: async () => true,
    });
    servers.push(server);

    const response = await fetch(new URL("/api/local-console/sessions", server.url), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        projectId: "local",
        initialMessage: "first message",
        agentTeamOwnership: "user",
        agentTeamId: "development",
      }),
    });
    expect(response.status).toBe(201);
    const created = await response.json() as { session: { sessionId: string } };
    const failed = await waitForSessionSystemEvent(
      server,
      created.session.sessionId,
      "run-not-started",
    );
    expect(failed).toMatchObject({
      body: "Codex 版本过旧，无法运行模型 gpt-5.6-sol。请升级当前 Codex 后再重试。",
      error: "codex-cli-upgrade-required",
    });
    expect(failed.runId).not.toBeNull();

    const facts = await fs.readFile(server.runtime.getSessionFactLogPath(created.session.sessionId), "utf8");
    expect(facts).toContain('"error":"codex-cli-upgrade-required"');
    expect(facts).toContain("Codex 版本过旧");
    expect(facts).not.toContain("invalid_request_error");

    const retry = await fetch(new URL(
      `/api/local-console/sessions/${encodeURIComponent(created.session.sessionId)}/runs/${encodeURIComponent(failed.runId!)}/retry`,
      server.url,
    ), { method: "POST" });
    expect(retry.status).toBe(202);
    await waitForSessionAgent(server, created.session.sessionId, "retry completed");
    expect(codex).toHaveBeenCalledTimes(2);
    expect(codex.mock.calls[0]?.[0].mode).toEqual({ kind: "full" });
    expect(codex.mock.calls[1]?.[0].mode).toEqual({
      kind: "resume",
      threadId: "codex-upgrade-thread",
    });
  });

  it("keeps a NULL legacy snapshot on Codex without profile options", async () => {
    const root = await fixtureRoot();
    const codex = vi.fn(async (options: CodexRunOptions) => {
      await options.onThreadStarted?.("codex-thread");
      return success(options, "legacy completed");
    });
    const server = await startLocalConsoleServer({
      host: "127.0.0.1",
      port: 0,
      projectRoot: root,
      sqlitePath: path.join(root, "local-console.sqlite"),
      listAgentFiles: async () => [{
        name: "dev",
        agentMarkdown: "# dev\n\nlegacy",
        executionProfile: null,
      }],
      runCodex: codex,
      runExecution: createLocalExecutionRunner({ runCodex: codex }),
    });
    servers.push(server);

    await post(server.url, "@dev continue");
    await waitForAgent(server.url, "legacy completed");
    expect(codex).toHaveBeenCalledTimes(1);
    expect(codex.mock.calls[0]?.[0].execOptions).toBeUndefined();
    const facts = await fs.readFile(server.runtime.getSessionFactLogPath("default"), "utf8");
    expect(facts).toContain('"profile":null');
    expect(facts).toContain('"engine":"codex"');
  });

  it("records an observed Codex thread before link failure and never starts full again", async () => {
    const root = await fixtureRoot();
    const sqlitePath = path.join(root, "local-console.sqlite");
    const store = await createSqliteLocalConsoleStore({ sqlitePath });
    const originalRecordAgentSessionLink = store.recordAgentSessionLink.bind(store);
    let failLink = true;
    store.recordAgentSessionLink = async (input) => {
      if (failLink) {
        failLink = false;
        throw new Error("canonical link temporarily unavailable");
      }
      await originalRecordAgentSessionLink(input);
    };
    const codex = vi.fn(async (options: CodexRunOptions): Promise<CodexRunResult> => {
      try {
        await options.onThreadStarted?.("codex-thread-observed");
      } catch (error) {
        return {
          ok: false,
          reason: `thread-start-callback-failed:${
            error instanceof Error ? error.message : String(error)
          }`,
          runDir: options.runDir,
          stdoutPath: path.join(options.runDir, "stdout.jsonl"),
          stderrPath: path.join(options.runDir, "stderr.log"),
        };
      }
      return success(options, "must not be published");
    });
    const server = await startLocalConsoleServer({
      host: "127.0.0.1",
      port: 0,
      projectRoot: root,
      sqlitePath,
      store,
      listAgentFiles: async () => [{
        name: "dev",
        agentMarkdown: "# dev\n\npersist strictly",
        executionProfile: null,
      }],
      runCodex: codex,
      runExecution: createLocalExecutionRunner({ runCodex: codex }),
    });
    servers.push(server);

    await post(server.url, "@dev first");
    await waitForSystemEvent(server.url, "run-not-started");
    await post(server.url, "@dev second");
    await waitForSystemEvent(server.url, "resume-unavailable");

    expect(codex).toHaveBeenCalledTimes(1);
    expect(codex.mock.calls[0]?.[0].mode).toEqual({ kind: "full" });
    const response = await fetch(new URL("/api/local-console/messages", server.url));
    const snapshot = await response.json() as { messages: LocalConsoleMessage[] };
    expect(snapshot.messages).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ speaker: "agent", body: "must not be published" }),
    ]));
    const facts = await fs.readFile(server.runtime.getSessionFactLogPath("default"), "utf8");
    expect(facts).toContain('"type":"provider_session_observed"');
    expect(facts).toContain('"externalSessionId":"codex-thread-observed"');
    expect(facts).not.toContain('"type":"agent_session_link"');
  });

  it("retries the original input with the old run snapshot after a team switch", async () => {
    const root = await fixtureRoot();
    const snapshots: Record<string, LocalConsoleAgentTeamSnapshot> = {
      old: snapshot("old Kimi rules", {
        cli: "kimi",
        model: "kimi-for-coding",
        effort: "high",
      }),
      next: snapshot("new Codex rules", {
        cli: "codex",
        model: "gpt-5.6-sol",
        effort: "medium",
      }),
    };
    const codex = vi.fn(async (options: CodexRunOptions) => success(options, "new Codex retry completed"));
    let call = 0;
    const kimi = vi.fn(async (options: KimiAcpRunOptions): Promise<CodexRunResult> => {
      call += 1;
      const sessionId = options.mode.kind === "resume"
        ? options.mode.externalSessionId
        : `kimi-session-${String(call)}`;
      await options.onSessionStarted?.(sessionId);
      if (call === 1) {
        return {
          ok: false,
          reason: "interrupted:user-interrupted",
          runDir: options.runDir,
          stdoutPath: path.join(options.runDir, "kimi-acp.jsonl"),
          stderrPath: path.join(options.runDir, "kimi-stderr.log"),
        };
      }
      return {
        ok: true,
        finalText: "old Kimi fallback completed",
        threadId: sessionId,
        cachedInputTokens: null,
        runDir: options.runDir,
        stdoutPath: path.join(options.runDir, "kimi-acp.jsonl"),
        stderrPath: path.join(options.runDir, "kimi-stderr.log"),
      };
    });
    const server = await startLocalConsoleServer({
      host: "127.0.0.1",
      port: 0,
      projectRoot: root,
      sqlitePath: path.join(root, "local-console.sqlite"),
      listAgentFiles: async () => [],
      loadAgentTeamSnapshot: async ({ id }) => snapshots[id]!,
      runCodex: codex,
      runExecution: createLocalExecutionRunner({ runCodex: codex, runKimi: kimi }),
    });
    servers.push(server);

    await server.runtime.switchSessionTeam({
      sessionId: "default",
      agentTeamOwnership: "user",
      agentTeamId: "old",
    });
    await post(server.url, "@dev implement");
    const stopped = await waitForSystemEvent(server.url, "user-stopped");
    expect(stopped.runId).not.toBeNull();

    await server.runtime.switchSessionTeam({
      sessionId: "default",
      agentTeamOwnership: "user",
      agentTeamId: "next",
    });
    const retry = await fetch(new URL(
      `/api/local-console/sessions/default/runs/${encodeURIComponent(stopped.runId!)}/retry`,
      server.url,
    ), { method: "POST" });
    expect(retry.status).toBe(202);
    await waitForAgent(server.url, "old Kimi fallback completed");

    expect(kimi).toHaveBeenCalledTimes(2);
    expect(codex).not.toHaveBeenCalled();
    expect(kimi.mock.calls[1]?.[0]).toMatchObject({
      profile: {
        cli: "kimi",
        model: "kimi-for-coding",
        effort: "high",
      },
      mode: { kind: "resume", externalSessionId: "kimi-session-1" },
    });
    expect(kimi.mock.calls[1]?.[0].prompt).toContain("继续");
    expect(kimi.mock.calls[1]?.[0].prompt).not.toContain("new Codex rules");
  });

  it("fails closed when an explicit retry has lost its frozen old run context", async () => {
    const root = await fixtureRoot();
    const snapshots: Record<string, LocalConsoleAgentTeamSnapshot> = {
      old: snapshot("old Kimi rules", {
        cli: "kimi",
        model: "kimi-for-coding",
        effort: "high",
      }),
      next: snapshot("new Codex rules", {
        cli: "codex",
        model: "gpt-5.6-sol",
        effort: "medium",
      }),
    };
    const codex = vi.fn(async (options: CodexRunOptions) => success(options, "new Codex retry completed"));
    const kimi = vi.fn(async (options: KimiAcpRunOptions): Promise<CodexRunResult> => {
      await options.onSessionStarted?.("kimi-session-missing-context");
      return {
        ok: false,
        reason: "interrupted:user-interrupted",
        runDir: options.runDir,
        stdoutPath: path.join(options.runDir, "kimi-acp.jsonl"),
        stderrPath: path.join(options.runDir, "kimi-stderr.log"),
      };
    });
    const server = await startLocalConsoleServer({
      host: "127.0.0.1",
      port: 0,
      projectRoot: root,
      sqlitePath: path.join(root, "local-console.sqlite"),
      listAgentFiles: async () => [],
      loadAgentTeamSnapshot: async ({ id }) => snapshots[id]!,
      runCodex: codex,
      runExecution: createLocalExecutionRunner({ runCodex: codex, runKimi: kimi }),
    });
    servers.push(server);

    await server.runtime.switchSessionTeam({
      sessionId: "default",
      agentTeamOwnership: "user",
      agentTeamId: "old",
    });
    await post(server.url, "@dev implement");
    const stopped = await waitForSystemEvent(server.url, "user-stopped");
    expect(stopped.runId).not.toBeNull();

    await server.runtime.switchSessionTeam({
      sessionId: "default",
      agentTeamOwnership: "user",
      agentTeamId: "next",
    });
    const logPath = server.runtime.getSessionFactLogPath("default");
    const lines = (await fs.readFile(logPath, "utf8")).trimEnd().split("\n");
    const withoutTargetContext = lines.filter((line) => {
      const event = JSON.parse(line) as {
        type?: string;
        payload?: { runId?: string };
      };
      return !(
        event.type === "run_execution_context"
        && event.payload?.runId === stopped.runId
      );
    });
    await fs.writeFile(logPath, `${withoutTargetContext.join("\n")}\n`, "utf8");
    kimi.mockClear();
    codex.mockClear();

    const retry = await fetch(new URL(
      `/api/local-console/sessions/default/runs/${encodeURIComponent(stopped.runId!)}/retry`,
      server.url,
    ), { method: "POST" });
    expect(retry.status).toBe(202);
    await waitForSystemEvent(server.url, "resume-unavailable");

    expect(kimi).not.toHaveBeenCalled();
    expect(codex).not.toHaveBeenCalled();
  });
});

function snapshot(
  markdown: string,
  executionProfile: LocalConsoleExecutionProfile,
): LocalConsoleAgentTeamSnapshot {
  return {
    members: [{
      name: "dev",
      agentMarkdown: `# dev\n\n${markdown}`,
      executionProfile,
    }],
  };
}

async function fixtureRoot(): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "moebius-execution-runtime-"));
  roots.push(root);
  return root;
}

async function post(url: string, body: string): Promise<void> {
  const response = await fetch(new URL("/api/local-console/sessions/default/messages", url), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ body }),
  });
  expect(response.status).toBe(202);
}

async function waitForAgent(url: string, body: string): Promise<void> {
  const deadline = Date.now() + 8_000;
  while (Date.now() < deadline) {
    const response = await fetch(new URL("/api/local-console/messages", url));
    const snapshot = await response.json() as { messages: LocalConsoleMessage[] };
    if (snapshot.messages.some((message) => message.speaker === "agent" && message.body === body)) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error(`timed out waiting for ${body}`);
}

async function waitForCalls(mock: { mock: { calls: unknown[][] } }, count: number): Promise<void> {
  const deadline = Date.now() + 8_000;
  while (Date.now() < deadline) {
    if (mock.mock.calls.length >= count) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error(`timed out waiting for ${String(count)} driver calls`);
}

async function waitForDatabaseRow(
  database: DatabaseSync,
  query: { sql: string; params: string[] },
): Promise<Record<string, unknown>> {
  const deadline = Date.now() + 8_000;
  while (Date.now() < deadline) {
    const row = database.prepare(query.sql).get(...query.params);
    if (row !== undefined) {
      return row as Record<string, unknown>;
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error("timed out waiting for persisted database row");
}

async function waitForSystemEvent(
  url: string,
  systemEventKind: LocalConsoleMessage["systemEventKind"],
): Promise<LocalConsoleMessage> {
  const deadline = Date.now() + 8_000;
  while (Date.now() < deadline) {
    const response = await fetch(new URL("/api/local-console/messages", url));
    const snapshot = await response.json() as { messages: LocalConsoleMessage[] };
    const matching = snapshot.messages.find((message) =>
      message.speaker === "system" && message.systemEventKind === systemEventKind);
    if (matching !== undefined) {
      return matching;
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error(`timed out waiting for ${systemEventKind}`);
}

async function waitForSessionSystemEvent(
  server: StartedLocalConsoleServer,
  sessionId: string,
  systemEventKind: LocalConsoleMessage["systemEventKind"],
): Promise<LocalConsoleMessage> {
  const deadline = Date.now() + 8_000;
  while (Date.now() < deadline) {
    const snapshot = await server.runtime.snapshot(sessionId);
    const matching = snapshot.messages.find((message) =>
      message.speaker === "system" && message.systemEventKind === systemEventKind);
    if (matching !== undefined) {
      return matching;
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error(`timed out waiting for ${systemEventKind} in ${sessionId}`);
}

async function waitForSessionAgent(
  server: StartedLocalConsoleServer,
  sessionId: string,
  body: string,
): Promise<void> {
  const deadline = Date.now() + 8_000;
  while (Date.now() < deadline) {
    const snapshot = await server.runtime.snapshot(sessionId);
    if (snapshot.messages.some((message) => message.speaker === "agent" && message.body === body)) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error(`timed out waiting for ${body} in ${sessionId}`);
}

function success(options: CodexRunOptions, finalText: string): CodexRunResult {
  return {
    ok: true,
    finalText,
    threadId: "codex-thread",
    cachedInputTokens: 0,
    runDir: options.runDir,
    stdoutPath: path.join(options.runDir, "stdout.jsonl"),
    stderrPath: path.join(options.runDir, "stderr.log"),
  };
}
