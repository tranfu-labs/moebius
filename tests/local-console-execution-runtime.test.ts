import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

import { afterEach, describe, expect, it, vi } from "vitest";

import { waitForCondition, waitForValue } from "../src/testing/wait.js";
import type { ClaudeRunOptions } from "../src/claude.js";
import type { CodexRunOptions, CodexRunResult } from "../src/codex.js";
import type { KimiAcpRunOptions } from "../src/kimi.js";
import { createLocalExecutionRunner } from "../src/local-console/execution-driver.js";
import { invalidateSessionFactLog } from "../src/local-console/session-fact-log.js";
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

describe("local execution runtime", { timeout: 30_000 }, () => {
  it("gives an analysis run exactly the visible fragment text without expanding its target", async () => {
    const root = await fixtureRoot();
    let call = 0;
    const codex = vi.fn(async (options: CodexRunOptions) => {
      call += 1;
      return success(options, call === 1 ? "HIDDEN_SOURCE_AGENT_OUTPUT" : "分析完成");
    });
    const server = await startLocalConsoleServer({
      host: "127.0.0.1",
      port: 0,
      projectRoot: root,
      sqlitePath: path.join(root, "local-console.sqlite"),
      listAgentFiles: async () => [],
      loadAgentTeamSnapshot: async () => snapshot("Analyze the supplied source.", {
        cli: "codex",
        model: "gpt-5.6-sol",
        effort: "medium",
      }),
      runCodex: codex,
    });
    servers.push(server);
    await server.runtime.switchSessionTeam({
      sessionId: "default",
      agentTeamOwnership: "user",
      agentTeamId: "analysis",
    });
    await post(server.url, "HIDDEN_SOURCE_USER_MESSAGE");
    await waitForAgent(server.url, "HIDDEN_SOURCE_AGENT_OUTPUT");

    const visibleFragment = "[对话 · “默认会话”](moebius-ref:conversation/default)";

    const response = await fetch(new URL("/api/local-console/sessions", server.url), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        projectId: "local",
        initialMessage: "分析来源",
        textFragments: [{
          id: "visible-fragment",
          label: "文本片段 1",
          text: visibleFragment,
        }],
        originSessionId: "default",
        analysisParentSessionId: "default",
        entryTemplate: "session-analysis",
        writePolicy: "confirm-current-plan-before-write",
        agentTeamOwnership: "user",
        agentTeamId: "analysis",
      }),
    });
    expect(response.status).toBe(201);
    const created = await response.json() as {
      session: { sessionId: string; analysisParentSessionId: string | null };
    };
    expect(created.session.analysisParentSessionId).toBe("default");
    await waitForCalls(codex, 2);

    const analysisPrompt = codex.mock.calls[1]![0].prompt;
    expect(analysisPrompt.split(visibleFragment)).toHaveLength(2);
    expect(analysisPrompt).not.toContain("HIDDEN_SOURCE_USER_MESSAGE");
    expect(analysisPrompt).not.toContain("HIDDEN_SOURCE_AGENT_OUTPUT");
    expect(analysisPrompt).not.toContain("只读方式提供");
    expect(analysisPrompt).toContain("当前回合处于只读环境");
  });

  it("does not let an unavailable navigation target block queued messages", async () => {
    const root = await fixtureRoot();
    let releaseBusyRun!: () => void;
    const busyRun = new Promise<void>((resolve) => {
      releaseBusyRun = resolve;
    });
    let call = 0;
    const codex = vi.fn(async (options: CodexRunOptions) => {
      call += 1;
      if (call === 1) {
        await busyRun;
        return success(options, "占用结束");
      }
      return success(options, call === 2 ? "链接消息完成" : "后续消息完成");
    });
    const server = await startLocalConsoleServer({
      host: "127.0.0.1",
      port: 0,
      projectRoot: root,
      sqlitePath: path.join(root, "local-console.sqlite"),
      listAgentFiles: async () => [],
      loadAgentTeamSnapshot: async () => snapshot("Handle the message.", {
        cli: "codex",
        model: "gpt-5.6-sol",
        effort: "medium",
      }),
      runCodex: codex,
    });
    servers.push(server);
    const target = await server.runtime.createSession(
      "目标",
      "local",
      { ownership: "user", id: "analysis" },
      "先占用主理人",
    );
    await waitForCalls(codex, 1);
    await postToSession(
      server,
      target.sessionId,
      "[来源](moebius-ref:conversation/missing-session)\n\n分析来源",
    );
    await postToSession(server, target.sessionId, "后续消息");
    releaseBusyRun();

    await waitForCalls(codex, 3);
    await waitForAgentInSession(server, target.sessionId, "后续消息完成");

    expect(codex.mock.calls[1]![0].prompt).toContain(
      "[来源](moebius-ref:conversation/missing-session)",
    );
    expect((await server.runtime.sessionView(target.sessionId)).pendingPrimaryMessages).toEqual([]);
  });

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
      "-c",
      "agents.enabled=false",
      "-m",
      "gpt-5.6-sol",
      "-c",
      'model_reasoning_effort="medium"',
    ]));
    expect(codex.mock.calls[0]?.[0].execOptions).not.toContain("multi_agent");
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

  it("fails an empty Kimi turn without an execution link and retries the canonical session", async () => {
    const root = await fixtureRoot();
    const codex = vi.fn();
    const modes: KimiAcpRunOptions["mode"][] = [];
    const kimi = vi.fn(async (options: KimiAcpRunOptions): Promise<CodexRunResult> => {
      modes.push(options.mode);
      const sessionId = options.mode.kind === "resume"
        ? options.mode.externalSessionId
        : "kimi-empty-session";
      await options.onSessionStarted?.(sessionId);
      return {
        ok: false,
        reason: "kimi-empty-response",
        failure: {
          code: "kimi-empty-response",
          message: "Kimi 没有返回可用回复。请在终端直接运行 kimi 查看详细错误，然后重试。",
        },
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
      loadAgentTeamSnapshot: async () => snapshot("Kimi empty response", {
        cli: "kimi",
        model: "kimi-for-coding",
        effort: "high",
      }),
      runCodex: codex,
      runExecution: createLocalExecutionRunner({ runCodex: codex, runKimi: kimi }),
    });
    servers.push(server);
    await server.runtime.switchSessionTeam({
      sessionId: "default",
      agentTeamOwnership: "user",
      agentTeamId: "development",
    });

    await post(server.url, "@dev answer");
    const firstFailure = await waitForSystemEventMatching(server, "default", (message) =>
      message.error === "kimi-empty-response");
    expect(firstFailure.body).toBe(
      "Kimi 没有返回可用回复。请在终端直接运行 kimi 查看详细错误，然后重试。",
    );
    let facts = await readFactEvents(server.runtime.getSessionFactLogPath("default"));
    expect(facts.filter((fact) => fact.type === "provider_session_observed")).toHaveLength(1);
    expect(facts.filter((fact) => fact.type === "agent_session_link")).toHaveLength(1);
    expect(facts.filter((fact) => fact.type === "execution_session_link")).toHaveLength(0);
    expect(facts.filter((fact) => fact.type === "agent_timeline_cursor")).toHaveLength(0);
    expect((await server.runtime.snapshot("default")).messages.some((message) =>
      message.speaker === "agent" && message.body.trim() === "")).toBe(false);

    const retry = await fetch(retryUrl(server, "default", firstFailure.runId!), { method: "POST" });
    expect(retry.status).toBe(202);
    await waitForSnapshotMatching(server, "default", (current) =>
      current.messages.filter((message) =>
        message.speaker === "system"
        && message.error === "kimi-empty-response").length === 2);

    expect(modes).toEqual([
      { kind: "full" },
      { kind: "resume", externalSessionId: "kimi-empty-session" },
    ]);
    expect(codex).not.toHaveBeenCalled();
    facts = await readFactEvents(server.runtime.getSessionFactLogPath("default"));
    expect(facts.filter((fact) => fact.type === "execution_session_link")).toHaveLength(0);
    expect(facts.filter((fact) =>
      fact.type === "provider_invocation"
      && fact.payload.phase === "terminal"
      && fact.payload.outcome === "failed")).toHaveLength(2);
  });

  it("completes a Kimi tool-only turn without publishing a blank Agent response", async () => {
    const root = await fixtureRoot();
    const codex = vi.fn();
    const kimi = vi.fn(async (options: KimiAcpRunOptions): Promise<CodexRunResult> => {
      await options.onSessionStarted?.("kimi-tool-only");
      await options.onExecutionTraceReady?.("kimi-tool-only");
      return {
        ok: true,
        finalText: "",
        completionKind: "terminal-tool-result",
        threadId: "kimi-tool-only",
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
      loadAgentTeamSnapshot: async () => snapshot("Kimi tool only", {
        cli: "kimi",
        model: "kimi-for-coding",
        effort: "high",
      }),
      runCodex: codex,
      runExecution: createLocalExecutionRunner({ runCodex: codex, runKimi: kimi }),
    });
    servers.push(server);
    await server.runtime.switchSessionTeam({
      sessionId: "default",
      agentTeamOwnership: "user",
      agentTeamId: "development",
    });

    await post(server.url, "@dev write the file");
    const completed = await waitForSnapshotMatching(server, "default", (current) =>
      current.status === "idle"
      && current.messages.some((message) =>
        message.speaker === "user"
        && message.body === "@dev write the file"
        && message.status === "completed"));
    expect(completed.messages.some((message) => message.speaker === "agent")).toBe(false);
    expect(codex).not.toHaveBeenCalled();

    const facts = await readFactEvents(server.runtime.getSessionFactLogPath("default"));
    expect(facts.filter((fact) => fact.type === "execution_session_link")).toHaveLength(1);
    expect(facts.filter((fact) => fact.type === "agent_timeline_cursor")).toHaveLength(1);
    expect(facts.filter((fact) =>
      fact.type === "run_lifecycle"
      && fact.payload.phase === "terminal"
      && fact.payload.status === "completed")).toHaveLength(1);
  });

  it("freezes a Claude profile and resumes only its canonical Claude session", async () => {
    const root = await fixtureRoot();
    const claudeProfile: LocalConsoleExecutionProfile = {
      cli: "claude",
      model: "fable",
      effort: "xhigh",
    };
    const snapshots: Record<string, LocalConsoleAgentTeamSnapshot> = {
      development: snapshot("Claude rules", claudeProfile),
    };
    const codex = vi.fn();
    const kimi = vi.fn();
    const claude = vi.fn(async (options: ClaudeRunOptions): Promise<CodexRunResult> => {
      const sessionId = options.mode.kind === "resume"
        ? options.mode.externalSessionId
        : "11111111-1111-4111-8111-111111111111";
      await options.onSessionStarted?.(sessionId);
      return {
        ok: true,
        finalText: options.mode.kind === "full" ? "Claude first" : "Claude resumed",
        threadId: sessionId,
        cachedInputTokens: null,
        runDir: options.runDir,
        stdoutPath: path.join(options.runDir, "claude-stream.jsonl"),
        stderrPath: path.join(options.runDir, "claude-stderr.log"),
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
      runExecution: createLocalExecutionRunner({
        runCodex: codex,
        runClaude: claude,
        runKimi: kimi,
      }),
    });
    servers.push(server);

    await server.runtime.switchSessionTeam({
      sessionId: "default",
      agentTeamOwnership: "user",
      agentTeamId: "development",
    });
    snapshots.development = snapshot("replacement Kimi rules", {
      cli: "kimi",
      model: "kimi-for-coding",
      effort: "high",
    });

    await post(server.url, "@dev first");
    await waitForAgent(server.url, "Claude first");
    await post(server.url, "second");
    await waitForAgent(server.url, "Claude resumed");

    expect(claude).toHaveBeenCalledTimes(2);
    expect(claude.mock.calls[0]?.[0]).toMatchObject({
      profile: claudeProfile,
      mode: { kind: "full" },
    });
    expect(claude.mock.calls[1]?.[0]).toMatchObject({
      profile: claudeProfile,
      mode: {
        kind: "resume",
        externalSessionId: "11111111-1111-4111-8111-111111111111",
      },
    });
    expect(codex).not.toHaveBeenCalled();
    expect(kimi).not.toHaveBeenCalled();
    const facts = await fs.readFile(server.runtime.getSessionFactLogPath("default"), "utf8");
    expect(facts).toContain('"engine":"claude"');
    expect(facts).toContain('"externalSessionId":"11111111-1111-4111-8111-111111111111"');
    expect(facts).toContain("Claude rules");
    expect(facts).not.toContain("replacement Kimi rules");
  });

  it("persists a new session, first message, and bound snapshot before a missing driver fails", async () => {
    const root = await fixtureRoot();
    const sqlitePath = path.join(root, "local-console.sqlite");
    const codex = vi.fn(async (options: CodexRunOptions) => success(options, "unexpected Codex"));
    const kimi = vi.fn(async (options: KimiAcpRunOptions): Promise<CodexRunResult> => ({
      ok: false,
      reason: "kimi-cli-not-found",
      failure: {
        code: "kimi-cli-not-found",
        message: "没有找到 Kimi CLI。请先安装 Kimi，然后重试。",
      },
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
        body: "没有找到 Kimi CLI。请先安装 Kimi，然后重试。",
        error: "kimi-cli-not-found",
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

    const legacyReferenceContext = "HIDDEN_LEGACY_REFERENCE_CONTEXT";
    await injectLegacyReferenceContext(
      server.runtime.getSessionFactLogPath(created.session.sessionId),
      failed.runId!,
      legacyReferenceContext,
    );

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
    expect(codex.mock.calls[1]?.[0].prompt).not.toContain(legacyReferenceContext);
    const contextsAfterRetry = (await readFactEvents(
      server.runtime.getSessionFactLogPath(created.session.sessionId),
    ))
      .filter((event) => event.type === "run_execution_context")
      .map((event) => event.payload);
    expect(contextsAfterRetry.length).toBeGreaterThan(1);
    expect(contextsAfterRetry.filter((context) =>
      context.referenceContext === legacyReferenceContext)).toHaveLength(1);
    expect(contextsAfterRetry.at(-1)).not.toHaveProperty("referenceContext");
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

  it("keeps analysis entry runs read-only until the current proposal is confirmed, then grants one write attempt", async () => {
    const root = await fixtureRoot();
    let call = 0;
    const codex = vi.fn(async (options: CodexRunOptions): Promise<CodexRunResult> => {
      call += 1;
      await options.onThreadStarted?.("analysis-thread");
      const finalText = call === 1
        ? "方案 v1\n<!-- moebius:session-analysis-control={\"action\":\"proposal\",\"version\":\"plan-v1\"} -->"
        : call === 2
          ? "确认当前方案\n<!-- moebius:session-analysis-control={\"action\":\"confirm\",\"version\":\"plan-v1\"} -->"
          : "执行完成";
      return {
        ...success(options, finalText),
        threadId: "analysis-thread",
      };
    });
    const server = await startLocalConsoleServer({
      host: "127.0.0.1",
      port: 0,
      projectRoot: root,
      sqlitePath: path.join(root, "local-console.sqlite"),
      listAgentFiles: async () => [{
        name: "assistant",
        agentMarkdown: "# assistant",
        executionProfile: null,
      }],
      runCodex: codex,
      runExecution: createLocalExecutionRunner({ runCodex: codex }),
      isCodexThreadAvailable: async () => true,
    });
    servers.push(server);

    const createResponse = await fetch(new URL("/api/local-console/sessions", server.url), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        projectId: "local",
        initialMessage: "先分析",
        originSessionId: "default",
        entryTemplate: "session-analysis",
        writePolicy: "confirm-current-plan-before-write",
      }),
    });
    expect(createResponse.status).toBe(201);
    const created = await createResponse.json() as { session: { sessionId: string } };
    await waitForSessionAgent(server, created.session.sessionId, "方案 v1");

    const confirmResponse = await fetch(new URL(
      `/api/local-console/sessions/${encodeURIComponent(created.session.sessionId)}/messages`,
      server.url,
    ), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ body: "可以，按这个方案修改" }),
    });
    expect(confirmResponse.status).toBe(202);
    await waitForSessionAgent(server, created.session.sessionId, "执行完成");

    expect(codex).toHaveBeenCalledTimes(3);
    expect(codex.mock.calls[0]?.[0].prompt).toContain("当前回合处于只读环境");
    expect(codex.mock.calls[1]?.[0].prompt).toContain("当前可确认方案版本：plan-v1");
    expect(codex.mock.calls[2]?.[0].prompt).toContain("写入许可只覆盖本次紧接着的执行尝试");
    expect(sandboxValue(codex.mock.calls[0]?.[0].execOptions)).toBe("read-only");
    expect(sandboxValue(codex.mock.calls[1]?.[0].execOptions)).toBe("read-only");
    expect(sandboxValue(codex.mock.calls[2]?.[0].execOptions)).not.toBe("read-only");

    const session = (await server.runtime.sessionView(created.session.sessionId)).session;
    expect(session).toMatchObject({
      proposalVersion: "plan-v1",
      writeLeaseVersion: null,
      writePolicy: "confirm-current-plan-before-write",
    });
  });

  it("accepts compact Kimi control markers and resumes one session for the confirmed write lease", async () => {
    const root = await fixtureRoot();
    const codex = vi.fn(async (options: CodexRunOptions) => success(options, "unexpected Codex"));
    let call = 0;
    const kimi = vi.fn(async (options: KimiAcpRunOptions): Promise<CodexRunResult> => {
      call += 1;
      await options.onSessionStarted?.("kimi-analysis-session");
      if (call === 3) {
        await fs.writeFile(path.join(options.cwd, "kimi-gate.txt"), "written by confirmed Kimi");
      }
      const finalText = call === 1
        ? "方案 v1\n<!--moebius:session-analysis-control={\"action\":\"proposal\",\"version\":\"v1\"}-->"
        : call === 2
          ? "确认当前方案\n<!--moebius:session-analysis-control={\"action\":\"confirm\",\"version\":\"v1\"}-->"
          : "Kimi 执行完成";
      return {
        ok: true,
        finalText,
        threadId: "kimi-analysis-session",
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
      loadAgentTeamSnapshot: async () => snapshot("Kimi analysis", {
        cli: "kimi",
        model: "kimi-for-coding",
        effort: "high",
      }),
      runCodex: codex,
      runExecution: createLocalExecutionRunner({ runCodex: codex, runKimi: kimi }),
    });
    servers.push(server);

    const createResponse = await fetch(new URL("/api/local-console/sessions", server.url), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        projectId: "local",
        initialMessage: "先提出创建 kimi-gate.txt 的方案",
        agentTeamOwnership: "user",
        agentTeamId: "kimi-team",
        workspaceMode: "direct",
        originSessionId: "default",
        entryTemplate: "session-analysis",
        writePolicy: "confirm-current-plan-before-write",
      }),
    });
    expect(createResponse.status).toBe(201);
    const created = await createResponse.json() as { session: { sessionId: string } };
    await waitForSessionAgent(server, created.session.sessionId, "方案 v1");
    expect((await server.runtime.sessionView(created.session.sessionId)).session).toMatchObject({
      proposalVersion: "v1",
      writeLeaseVersion: null,
    });

    await postToSession(server, created.session.sessionId, "可以，执行 v1");
    await waitForSessionAgent(server, created.session.sessionId, "Kimi 执行完成");

    expect(codex).not.toHaveBeenCalled();
    expect(kimi).toHaveBeenCalledTimes(3);
    expect(kimi.mock.calls.map(([options]) => options.mode)).toEqual([
      { kind: "full" },
      { kind: "resume", externalSessionId: "kimi-analysis-session" },
      { kind: "resume", externalSessionId: "kimi-analysis-session" },
    ]);
    expect(kimi.mock.calls.map(([options]) => options.workspaceAccess)).toEqual([
      "read-only",
      "read-only",
      "read-write",
    ]);
    expect(await fs.readFile(path.join(root, "kimi-gate.txt"), "utf8"))
      .toBe("written by confirmed Kimi");
    expect((await server.runtime.sessionView(created.session.sessionId)).session).toMatchObject({
      proposalVersion: "v1",
      writeLeaseVersion: null,
      writePolicy: "confirm-current-plan-before-write",
    });
  });

  it("rejects stale plan confirmation and clears a failed one-shot write lease before the next turn", async () => {
    const root = await fixtureRoot();
    let call = 0;
    const codex = vi.fn(async (options: CodexRunOptions): Promise<CodexRunResult> => {
      call += 1;
      await options.onThreadStarted?.("analysis-thread-versioned");
      if (call === 5) {
        return {
          ok: false,
          reason: "exit:1",
          runDir: options.runDir,
          stdoutPath: path.join(options.runDir, "stdout.jsonl"),
          stderrPath: path.join(options.runDir, "stderr.log"),
        };
      }
      const finalText = [
        "方案 v1\n<!-- moebius:session-analysis-control={\"action\":\"proposal\",\"version\":\"plan-v1\"} -->",
        "方案 v2\n<!-- moebius:session-analysis-control={\"action\":\"proposal\",\"version\":\"plan-v2\"} -->",
        "错误确认旧方案\n<!-- moebius:session-analysis-control={\"action\":\"confirm\",\"version\":\"plan-v1\"} -->",
        "确认 v2\n<!-- moebius:session-analysis-control={\"action\":\"confirm\",\"version\":\"plan-v2\"} -->",
        "",
        "方案 v3\n<!-- moebius:session-analysis-control={\"action\":\"proposal\",\"version\":\"plan-v3\"} -->",
      ][call - 1] ?? "unexpected";
      return {
        ...success(options, finalText),
        threadId: "analysis-thread-versioned",
      };
    });
    const server = await startLocalConsoleServer({
      host: "127.0.0.1",
      port: 0,
      projectRoot: root,
      sqlitePath: path.join(root, "local-console.sqlite"),
      listAgentFiles: async () => [{
        name: "assistant",
        agentMarkdown: "# assistant",
        executionProfile: null,
      }],
      runCodex: codex,
      runExecution: createLocalExecutionRunner({ runCodex: codex }),
      isCodexThreadAvailable: async () => true,
    });
    servers.push(server);

    const createResponse = await fetch(new URL("/api/local-console/sessions", server.url), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        projectId: "local",
        initialMessage: "先分析",
        originSessionId: "default",
        entryTemplate: "session-analysis",
        writePolicy: "confirm-current-plan-before-write",
      }),
    });
    const created = await createResponse.json() as { session: { sessionId: string } };
    await waitForSessionAgent(server, created.session.sessionId, "方案 v1");
    await postToSession(server, created.session.sessionId, "请调整第二项");
    await waitForSessionAgent(server, created.session.sessionId, "方案 v2");
    await postToSession(server, created.session.sessionId, "按旧方案做");
    await waitForSessionAgent(
      server,
      created.session.sessionId,
      "错误确认旧方案\n\n这次确认没有与当前方案版本精确匹配，或当前 provider 会话无法安全继续；我保持只读，没有修改文件。请先重新确认当前完整方案。",
    );

    expect(sandboxValue(codex.mock.calls[2]?.[0].execOptions)).toBe("read-only");
    expect((await server.runtime.sessionView(created.session.sessionId)).session).toMatchObject({
      proposalVersion: "plan-v2",
      writeLeaseVersion: null,
    });

    await postToSession(server, created.session.sessionId, "可以，按 v2 修改");
    await waitForCalls(codex, 5);
    expect(sandboxValue(codex.mock.calls[3]?.[0].execOptions)).toBe("read-only");
    expect(sandboxValue(codex.mock.calls[4]?.[0].execOptions)).not.toBe("read-only");
    expect((await server.runtime.sessionView(created.session.sessionId)).session).toMatchObject({
      proposalVersion: "plan-v2",
      writeLeaseVersion: null,
    });

    await postToSession(server, created.session.sessionId, "失败后重新讨论");
    await waitForSessionAgent(server, created.session.sessionId, "方案 v3");
    expect(sandboxValue(codex.mock.calls[5]?.[0].execOptions)).toBe("read-only");
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

  it("runs an eligible override once under a derived identity then returns to the base provider session", async () => {
    const root = await fixtureRoot();
    const baseProfile: LocalConsoleExecutionProfile = {
      cli: "kimi",
      model: "kimi-code/kimi-for-coding",
      effort: "on",
    };
    const codex = vi.fn(async (options: CodexRunOptions): Promise<CodexRunResult> => {
      await options.onThreadStarted?.("codex-override-session");
      return {
        ...success(options, "override completed"),
        threadId: "codex-override-session",
      };
    });
    let kimiCalls = 0;
    const kimi = vi.fn(async (options: KimiAcpRunOptions): Promise<CodexRunResult> => {
      kimiCalls += 1;
      await options.onSessionStarted?.("kimi-base-session");
      if (kimiCalls === 1) {
        return {
          ok: false,
          reason: "kimi-acp-interrupted",
          terminal: {
            kind: "interrupted",
            actor: "user",
            cause: "user",
            partialText: "partial before stop",
          },
          runDir: options.runDir,
          stdoutPath: path.join(options.runDir, "kimi-acp.jsonl"),
          stderrPath: path.join(options.runDir, "kimi-stderr.log"),
        };
      }
      return {
        ok: true,
        terminal: {
          kind: "completed",
          externalSessionId: "kimi-base-session",
          finalText: "base resumed",
        },
        finalText: "base resumed",
        threadId: "kimi-base-session",
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
      loadAgentTeamSnapshot: async () => snapshot("base Kimi rules", baseProfile),
      runCodex: codex,
      runExecution: createLocalExecutionRunner({ runCodex: codex, runKimi: kimi }),
    });
    servers.push(server);

    await server.runtime.switchSessionTeam({
      sessionId: "default",
      agentTeamOwnership: "user",
      agentTeamId: "base",
    });
    await post(server.url, "@dev implement");
    const stopped = await waitForSystemEvent(server.url, "user-stopped");
    const overrideBody = JSON.stringify({
      executionOverride: {
        overrideId: "override-once",
        profile: { cli: "codex", model: "gpt-5.6-sol", effort: "high" },
        scope: "single-run",
      },
    });
    const retry = await fetch(retryUrl(server, "default", stopped.runId!), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: overrideBody,
    });
    expect(retry.status).toBe(202);
    await waitForAgent(server.url, "override completed");

    const delayedDuplicate = await fetch(retryUrl(server, "default", stopped.runId!), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: overrideBody,
    });
    expect(delayedDuplicate.status).toBe(202);

    await post(server.url, "@dev continue normally");
    await waitForAgent(server.url, "base resumed");

    expect(codex).toHaveBeenCalledTimes(1);
    expect(codex.mock.calls[0]?.[0]).toMatchObject({ mode: { kind: "full" } });
    expect(kimi).toHaveBeenCalledTimes(2);
    expect(kimi.mock.calls[1]?.[0]).toMatchObject({
      profile: baseProfile,
      mode: { kind: "resume", externalSessionId: "kimi-base-session" },
    });
    const events = await readFactEvents(server.runtime.getSessionFactLogPath("default"));
    const contexts = events
      .filter((event) => event.type === "run_execution_context")
      .map((event) => event.payload);
    expect(contexts).toEqual(expect.arrayContaining([
      expect.objectContaining({
        engine: "codex",
        identitySalt: expect.stringMatching(/^override-once:/u),
      }),
      expect.objectContaining({
        engine: "kimi",
      }),
    ]));
    expect(
      contexts
        .filter((context) => context.engine === "kimi")
        .every((context) => !("identitySalt" in context)),
    ).toBe(true);
    const database = new DatabaseSync(path.join(root, "local-console.sqlite"), { readOnly: true });
    try {
      expect(database.prepare(
        `SELECT execution_cli, execution_model, execution_effort
         FROM session_agent_team_members
         WHERE session_id = 'default' AND slot = 'effective'`,
      ).all()).toEqual([{
        execution_cli: "kimi",
        execution_model: "kimi-code/kimi-for-coding",
        execution_effort: "on",
      }]);
    } finally {
      database.close();
    }
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

  it("records an explicit no-trigger retry as run-not-started without invoking a provider", async () => {
    const root = await fixtureRoot();
    const sqlitePath = path.join(root, "local-console.sqlite");
    const store = await createSqliteLocalConsoleStore({ sqlitePath });
    const codex = vi.fn(async (options: CodexRunOptions): Promise<CodexRunResult> => {
      await options.onThreadStarted?.("primary-no-trigger-session");
      return {
        ...success(options, "NO_TRIGGER_SOURCE"),
        threadId: "primary-no-trigger-session",
      };
    });
    const server = await startLocalConsoleServer({
      host: "127.0.0.1",
      port: 0,
      projectRoot: root,
      sqlitePath,
      store,
      listAgentFiles: async () => [],
      loadAgentTeamSnapshot: async () => detachedWorkerSnapshot({
        cli: "kimi",
        model: "kimi-for-coding",
        effort: "high",
      }),
      runCodex: codex,
      runExecution: createLocalExecutionRunner({ runCodex: codex }),
      isCodexThreadAvailable: async () => true,
    });
    servers.push(server);

    await server.runtime.switchSessionTeam({
      sessionId: "default",
      agentTeamOwnership: "user",
      agentTeamId: "no-trigger",
    });
    await post(server.url, "create a no-trigger source");
    await waitForAgent(server.url, "NO_TRIGGER_SOURCE");
    const settled = await waitForSnapshotMatching(server, "default", (snapshot) =>
      snapshot.activeRuns.length === 0
      && snapshot.messages.some((message) =>
        message.speaker === "agent"
        && message.body === "NO_TRIGGER_SOURCE"
        && message.status === "displayed"));
    const source = settled.messages.find((message) =>
      message.speaker === "agent" && message.body === "NO_TRIGGER_SOURCE")!;
    const factsBeforeRetry = await readFactEvents(server.runtime.getSessionFactLogPath("default"));
    const invocationCountBeforeRetry = factsBeforeRetry.filter((fact) =>
      fact.type === "provider_invocation").length;
    const cursorCountBeforeRetry = factsBeforeRetry.filter((fact) =>
      fact.type === "agent_timeline_cursor").length;
    codex.mockClear();

    await store.recordCodexResumeIntent({
      sessionId: "default",
      intentId: "no-trigger-retry-intent",
      targetRunId: "missing-trigger-target",
      sourceMessageId: source.id,
      role: "manager",
      reason: "retry",
      createdAt: new Date().toISOString(),
    });
    await store.releaseMessageForRetry({
      userMessageId: source.id,
      sessionId: "default",
      now: new Date().toISOString(),
    });
    await server.runtime.processPending("default");

    const firstFailure = await waitForSystemEventMatching(
      server,
      "default",
      (message) => message.error === "retry-source-trigger-missing",
    );
    expect(firstFailure).toMatchObject({
      status: "failed",
      systemEventKind: "run-not-started",
      error: "retry-source-trigger-missing",
      sourceKind: "local-retry-intent",
      sourceId: "no-trigger-retry-intent",
    });
    expect(firstFailure.runId).not.toBeNull();
    const failedSnapshot = await server.runtime.snapshot("default");
    expect(failedSnapshot.messages.find((message) => message.id === source.id)).toMatchObject({
      status: "displayed",
      runId: source.runId,
    });
    expect(failedSnapshot.messages).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ systemEventKind: "resume-unavailable" }),
    ]));
    expect(codex).not.toHaveBeenCalled();

    const factsAfterRetry = await readFactEvents(server.runtime.getSessionFactLogPath("default"));
    expect(factsAfterRetry.filter((fact) => fact.type === "provider_invocation"))
      .toHaveLength(invocationCountBeforeRetry);
    expect(factsAfterRetry.filter((fact) => fact.type === "agent_timeline_cursor"))
      .toHaveLength(cursorCountBeforeRetry);
    expect(factsAfterRetry).not.toEqual(expect.arrayContaining([
      expect.objectContaining({
        type: "provider_invocation",
        payload: expect.objectContaining({ runId: firstFailure.runId }),
      }),
    ]));
    expect(factsAfterRetry).not.toEqual(expect.arrayContaining([
      expect.objectContaining({
        type: "codex_resume_consumed",
        payload: expect.objectContaining({ intentId: "no-trigger-retry-intent" }),
      }),
    ]));

    await server.close();
    servers.splice(servers.indexOf(server), 1);
    const restartedCodex = vi.fn(async (options: CodexRunOptions) =>
      success(options, "unexpected provider invocation"));
    const restartedServer = await startLocalConsoleServer({
      host: "127.0.0.1",
      port: 0,
      projectRoot: root,
      sqlitePath,
      listAgentFiles: async () => [],
      loadAgentTeamSnapshot: async () => {
        throw new Error("persisted team snapshot should be restored from SQLite");
      },
      runCodex: restartedCodex,
      runExecution: createLocalExecutionRunner({ runCodex: restartedCodex }),
      isCodexThreadAvailable: async () => true,
    });
    servers.push(restartedServer);
    const restoredFailure = (await restartedServer.runtime.snapshot("default")).messages.find((message) =>
      message.runId === firstFailure.runId);
    expect(restoredFailure).toMatchObject({
      sourceKind: "local-retry-intent",
      sourceId: "no-trigger-retry-intent",
    });

    const retry = await fetch(retryUrl(restartedServer, "default", firstFailure.runId!), {
      method: "POST",
    });
    expect(retry.status).toBe(202);
    const secondFailure = await waitForSystemEventMatching(
      restartedServer,
      "default",
      (message) =>
        message.error === "retry-source-trigger-missing"
        && message.runId !== firstFailure.runId,
    );
    expect(secondFailure).toMatchObject({
      status: "failed",
      systemEventKind: "run-not-started",
      error: "retry-source-trigger-missing",
      sourceKind: "local-retry-intent",
      sourceId: "no-trigger-retry-intent",
    });
    const retriedSnapshot = await restartedServer.runtime.snapshot("default");
    expect(retriedSnapshot.messages.find((message) => message.id === source.id)).toMatchObject({
      status: "displayed",
      runId: source.runId,
    });
    expect(retriedSnapshot.messages.filter((message) =>
      message.error === "retry-source-trigger-missing")).toHaveLength(2);
    expect(retriedSnapshot.messages.some((message) =>
      message.systemEventKind === "resume-unavailable")).toBe(false);
    expect(codex).not.toHaveBeenCalled();
    expect(restartedCodex).not.toHaveBeenCalled();

    const factsAfterSecondRetry = await readFactEvents(
      restartedServer.runtime.getSessionFactLogPath("default"),
    );
    expect(factsAfterSecondRetry.filter((fact) => fact.type === "provider_invocation"))
      .toHaveLength(invocationCountBeforeRetry);
    expect(factsAfterSecondRetry.filter((fact) => fact.type === "agent_timeline_cursor"))
      .toHaveLength(cursorCountBeforeRetry);
    expect(factsAfterSecondRetry.filter((fact) =>
      fact.type === "codex_resume_intent"
      && fact.payload.intentId === "no-trigger-retry-intent")).toHaveLength(1);
    expect(factsAfterSecondRetry).not.toEqual(expect.arrayContaining([
      expect.objectContaining({
        type: "codex_resume_consumed",
        payload: expect.objectContaining({ intentId: "no-trigger-retry-intent" }),
      }),
    ]));
  });

  it.each([
    {
      intentOrder: ["A", "B"] as const,
      processOrder: ["A", "B"] as const,
    },
    {
      intentOrder: ["B", "A"] as const,
      processOrder: ["B", "A"] as const,
    },
  ])(
    "keeps no-trigger retry source-scoped with intent order $intentOrder and process order $processOrder",
    async ({ intentOrder, processOrder }) => {
      const root = await fixtureRoot();
      const sqlitePath = path.join(root, "local-console.sqlite");
      const store = await createSqliteLocalConsoleStore({ sqlitePath });
      let providerCall = 0;
      const codex = vi.fn(async (options: CodexRunOptions): Promise<CodexRunResult> => {
        providerCall += 1;
        await options.onThreadStarted?.("cross-intent-primary-session");
        return {
          ...success(options, providerCall === 1 ? "NO_TRIGGER_SOURCE_A" : "NO_TRIGGER_SOURCE_B"),
          threadId: "cross-intent-primary-session",
        };
      });
      const server = await startLocalConsoleServer({
        host: "127.0.0.1",
        port: 0,
        projectRoot: root,
        sqlitePath,
        store,
        listAgentFiles: async () => [],
        loadAgentTeamSnapshot: async () => detachedWorkerSnapshot({
          cli: "kimi",
          model: "kimi-for-coding",
          effort: "high",
        }),
        runCodex: codex,
        runExecution: createLocalExecutionRunner({ runCodex: codex }),
        isCodexThreadAvailable: async () => true,
      });
      servers.push(server);

      await server.runtime.switchSessionTeam({
        sessionId: "default",
        agentTeamOwnership: "user",
        agentTeamId: "cross-intent",
      });
      await post(server.url, "create source A");
      const afterA = await waitForSnapshotMatching(server, "default", (snapshot) =>
        snapshot.activeRuns.length === 0
        && snapshot.messages.some((message) =>
          message.speaker === "agent"
          && message.body === "NO_TRIGGER_SOURCE_A"
          && message.status === "displayed"));
      const sourceA = afterA.messages.find((message) =>
        message.speaker === "agent" && message.body === "NO_TRIGGER_SOURCE_A")!;
      await post(server.url, "create source B");
      const afterB = await waitForSnapshotMatching(server, "default", (snapshot) =>
        snapshot.activeRuns.length === 0
        && snapshot.messages.some((message) =>
          message.speaker === "agent"
          && message.body === "NO_TRIGGER_SOURCE_B"
          && message.status === "displayed"));
      const sourceB = afterB.messages.find((message) =>
        message.speaker === "agent" && message.body === "NO_TRIGGER_SOURCE_B")!;
      const sources = { A: sourceA, B: sourceB };
      const intents = {
        A: {
          sessionId: "default",
          intentId: "cross-intent-A",
          targetRunId: "target-run-A",
          sourceMessageId: sourceA.id,
          role: "role-A",
          reason: "retry" as const,
        },
        B: {
          sessionId: "default",
          intentId: "cross-intent-B",
          targetRunId: "target-run-B",
          sourceMessageId: sourceB.id,
          role: "role-B",
          reason: "retry" as const,
        },
      };
      for (const key of intentOrder) {
        await store.recordCodexResumeIntent({
          ...intents[key],
          createdAt: new Date().toISOString(),
        });
      }
      const failures = new Map<"A" | "B", LocalConsoleMessage>();
      for (const key of processOrder) {
        await store.releaseMessageForRetry({
          userMessageId: sources[key].id,
          sessionId: "default",
          now: new Date().toISOString(),
        });
        await server.runtime.processPending("default");
        const failure = await waitForSystemEventMatching(
          server,
          "default",
          (message) =>
            message.error === "retry-source-trigger-missing"
            && message.sourceId === intents[key].intentId,
        );
        expect(failure).toMatchObject({
          sourceKind: "local-retry-intent",
          sourceId: intents[key].intentId,
        });
        failures.set(key, failure);
      }
      codex.mockClear();
      const releasedSourceIds: number[] = [];
      const releaseMessageForRetry = store.releaseMessageForRetry.bind(store);
      store.releaseMessageForRetry = async (input) => {
        releasedSourceIds.push(input.userMessageId);
        await releaseMessageForRetry(input);
      };

      const retryA = await fetch(retryUrl(server, "default", failures.get("A")!.runId!), {
        method: "POST",
      });
      expect(retryA.status).toBe(202);

      expect(releasedSourceIds).toEqual([sourceA.id]);
      expect(releasedSourceIds).not.toContain(sourceB.id);
      expect(codex).not.toHaveBeenCalled();
      const facts = await readFactEvents(server.runtime.getSessionFactLogPath("default"));
      const persistedIntents = facts.filter((fact) => fact.type === "codex_resume_intent");
      expect(persistedIntents.filter((fact) =>
        fact.payload.intentId === intents.A.intentId)).toEqual([
        expect.objectContaining({
          payload: expect.objectContaining(intents.A),
        }),
      ]);
      expect(persistedIntents.filter((fact) =>
        fact.payload.intentId === intents.B.intentId)).toEqual([
        expect.objectContaining({
          payload: expect.objectContaining(intents.B),
        }),
      ]);
      expect(facts).not.toEqual(expect.arrayContaining([
        expect.objectContaining({
          type: "codex_resume_consumed",
          payload: expect.objectContaining({
            intentId: expect.stringMatching(/^cross-intent-[AB]$/u),
          }),
        }),
      ]));
    },
  );

  it.each([
    "missing-link",
    "missing-intent",
    "consumed-intent",
    "mismatched-source",
  ] as const)("fails closed for an invalid no-trigger retry association: %s", async (invalidCase) => {
    const root = await fixtureRoot();
    const sqlitePath = path.join(root, "local-console.sqlite");
    const store = await createSqliteLocalConsoleStore({ sqlitePath });
    const codex = vi.fn(async (options: CodexRunOptions): Promise<CodexRunResult> => {
      await options.onThreadStarted?.("invalid-link-primary-session");
      return {
        ...success(options, "INVALID_LINK_SOURCE"),
        threadId: "invalid-link-primary-session",
      };
    });
    const server = await startLocalConsoleServer({
      host: "127.0.0.1",
      port: 0,
      projectRoot: root,
      sqlitePath,
      store,
      listAgentFiles: async () => [],
      loadAgentTeamSnapshot: async () => detachedWorkerSnapshot({
        cli: "kimi",
        model: "kimi-for-coding",
        effort: "high",
      }),
      runCodex: codex,
      runExecution: createLocalExecutionRunner({ runCodex: codex }),
      isCodexThreadAvailable: async () => true,
    });
    servers.push(server);

    await server.runtime.switchSessionTeam({
      sessionId: "default",
      agentTeamOwnership: "user",
      agentTeamId: "invalid-link",
    });
    await post(server.url, "create invalid-link source");
    const settled = await waitForSnapshotMatching(server, "default", (snapshot) =>
      snapshot.activeRuns.length === 0
      && snapshot.messages.some((message) =>
        message.speaker === "agent"
        && message.body === "INVALID_LINK_SOURCE"
        && message.status === "displayed"));
    const source = settled.messages.find((message) =>
      message.speaker === "agent" && message.body === "INVALID_LINK_SOURCE")!;
    const intentId = `invalid-link-intent:${invalidCase}`;
    if (invalidCase === "consumed-intent" || invalidCase === "mismatched-source") {
      await store.recordCodexResumeIntent({
        sessionId: "default",
        intentId,
        targetRunId: `invalid-target:${invalidCase}`,
        sourceMessageId: invalidCase === "mismatched-source" ? source.id + 10_000 : source.id,
        role: "manager",
        reason: "retry",
        createdAt: new Date().toISOString(),
      });
    }
    if (invalidCase === "consumed-intent") {
      await store.recordCodexResumeConsumed({
        sessionId: "default",
        intentId,
        resumedByRunId: "already-consumed-run",
        mode: "resume",
        reason: "already-consumed",
        consumedAt: new Date().toISOString(),
      });
    }
    const runId = `invalid-link-run:${invalidCase}`;
    await store.recordFailure({
      userMessageId: source.id,
      sessionId: "default",
      error: "retry-source-trigger-missing",
      runId,
      runDir: null,
      body: "This retry association is intentionally invalid.",
      systemEventKind: "run-not-started",
      ...(invalidCase === "missing-link"
        ? {}
        : {
            sourceKind: "local-retry-intent",
            sourceId: intentId,
          }),
      now: new Date().toISOString(),
    });
    const factsBeforeRetry = await readFactEvents(server.runtime.getSessionFactLogPath("default"));
    const invocationCountBeforeRetry = factsBeforeRetry.filter((fact) =>
      fact.type === "provider_invocation").length;
    codex.mockClear();

    const retry = await fetch(retryUrl(server, "default", runId), { method: "POST" });
    expect(retry.status).toBe(404);
    expect(codex).not.toHaveBeenCalled();
    const factsAfterRetry = await readFactEvents(server.runtime.getSessionFactLogPath("default"));
    expect(factsAfterRetry.filter((fact) => fact.type === "provider_invocation"))
      .toHaveLength(invocationCountBeforeRetry);
    expect((await server.runtime.snapshot("default")).messages.find((message) =>
      message.id === source.id)).toMatchObject({
        status: "displayed",
        runId: source.runId,
      });
  });

  it("retries a detached Kimi empty response from its claimed source and links only the successful attempt", async () => {
    const root = await fixtureRoot();
    const sqlitePath = path.join(root, "local-console.sqlite");
    let primaryCall = 0;
    const codex = vi.fn(async (options: CodexRunOptions): Promise<CodexRunResult> => {
      primaryCall += 1;
      await options.onThreadStarted?.("primary-codex-session");
      return {
        ...success(
          options,
          primaryCall === 1
            ? "execute the original handoff @worker"
            : "PRIMARY_DELTA_ACK",
        ),
        threadId: "primary-codex-session",
      };
    });
    let workerCall = 0;
    const kimi = vi.fn(async (options: KimiAcpRunOptions): Promise<CodexRunResult> => {
      workerCall += 1;
      await options.onSessionStarted?.("worker-kimi-session");
      if (workerCall < 3) {
        return {
          ok: false,
          reason: "kimi-empty-response",
          failure: {
            code: "kimi-empty-response",
            message: "Kimi 没有返回可用回复。请在终端直接运行 kimi 查看详细错误，然后重试。",
          },
          runDir: options.runDir,
          stdoutPath: path.join(options.runDir, "kimi-acp.jsonl"),
          stderrPath: path.join(options.runDir, "kimi-stderr.log"),
        };
      }
      return {
        ok: true,
        finalText: "KIMI_ATTEMPT_3_COMPLETED",
        threadId: "worker-kimi-session",
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
      sqlitePath,
      listAgentFiles: async () => [],
      loadAgentTeamSnapshot: async () => detachedWorkerSnapshot({
        cli: "kimi",
        model: "kimi-for-coding",
        effort: "high",
      }),
      runCodex: codex,
      runExecution: createLocalExecutionRunner({ runCodex: codex, runKimi: kimi }),
      isCodexThreadAvailable: async () => true,
    });
    servers.push(server);

    await server.runtime.switchSessionTeam({
      sessionId: "default",
      agentTeamOwnership: "user",
      agentTeamId: "detached-kimi",
    });
    await post(server.url, "start detached work");
    const firstFailure = await waitForSystemEventMatching(
      server,
      "default",
      (message) => message.error === "kimi-empty-response",
    );
    expect(firstFailure.runId).not.toBeNull();

    await post(server.url, "AFTER_FAILURE_PUBLIC_DELTA");
    await waitForAgent(server.url, "PRIMARY_DELTA_ACK");

    const firstRetryUrl = retryUrl(server, "default", firstFailure.runId!);
    const [firstRetry, duplicateRetry] = await Promise.all([
      fetch(firstRetryUrl, { method: "POST" }),
      fetch(firstRetryUrl, { method: "POST" }),
    ]);
    expect([firstRetry.status, duplicateRetry.status]).toEqual([202, 202]);
    await Promise.all([
      server.runtime.processPending("default"),
      server.runtime.processPending("default"),
      server.runtime.processPending("default"),
    ]);
    const secondFailure = await waitForSystemEventMatching(
      server,
      "default",
      (message) =>
        message.error === "kimi-empty-response"
        && message.runId !== firstFailure.runId,
    );
    expect(kimi).toHaveBeenCalledTimes(2);
    expect(secondFailure.runId).not.toBeNull();

    const thirdRetry = await fetch(retryUrl(server, "default", secondFailure.runId!), {
      method: "POST",
    });
    expect(thirdRetry.status).toBe(202);
    await waitForAgent(server.url, "KIMI_ATTEMPT_3_COMPLETED");

    expect(codex).toHaveBeenCalledTimes(2);
    expect(kimi).toHaveBeenCalledTimes(3);
    expect(kimi.mock.calls.map(([options]) => options.mode)).toEqual([
      { kind: "full" },
      { kind: "resume", externalSessionId: "worker-kimi-session" },
      { kind: "resume", externalSessionId: "worker-kimi-session" },
    ]);
    expect(kimi.mock.calls.map(([options]) => options.profile)).toEqual([
      { cli: "kimi", model: "kimi-for-coding", effort: "high" },
      { cli: "kimi", model: "kimi-for-coding", effort: "high" },
      { cli: "kimi", model: "kimi-for-coding", effort: "high" },
    ]);
    expect(kimi.mock.calls[1]?.[0].prompt).toContain("AFTER_FAILURE_PUBLIC_DELTA");

    const snapshot = await server.runtime.snapshot("default");
    const handoffs = snapshot.messages.filter((message) =>
      message.speaker === "agent"
      && message.body === "execute the original handoff @worker");
    expect(handoffs).toHaveLength(1);
    const handoff = handoffs[0]!;
    expect(snapshot.messages.filter((message) =>
      message.speaker === "system" && message.error === "kimi-empty-response")).toHaveLength(2);

    const facts = await readFactEvents(server.runtime.getSessionFactLogPath("default"));
    const lifecycleAttempts = facts
      .filter((fact) =>
        fact.type === "run_lifecycle"
        && fact.payload.stepId === `message:${String(handoff.id)}`
        && fact.payload.phase === "created")
      .map((fact) => fact.payload.attempt);
    expect(lifecycleAttempts).toEqual([1, 2, 3]);
    const workerInvocations = facts.filter((fact) =>
      fact.type === "provider_invocation"
      && fact.payload.role === "worker"
      && fact.payload.phase === "started");
    expect(workerInvocations.map((fact) => ({
      mode: fact.payload.mode,
      requestedExternalSessionId: fact.payload.requestedExternalSessionId,
    }))).toEqual([
      { mode: "full", requestedExternalSessionId: null },
      { mode: "resume", requestedExternalSessionId: "worker-kimi-session" },
      { mode: "resume", requestedExternalSessionId: "worker-kimi-session" },
    ]);
    expect(facts.filter((fact) =>
      fact.type === "execution_session_link"
      && fact.payload.role === "worker")).toHaveLength(1);
    expect(facts.filter((fact) =>
      fact.type === "agent_timeline_cursor"
      && fact.payload.role === "worker")).toHaveLength(1);
    const retryIntents = facts.filter((fact) =>
      fact.type === "codex_resume_intent"
      && fact.payload.reason === "retry"
      && fact.payload.sourceMessageId === handoff.id);
    expect(retryIntents).toHaveLength(2);
    const consumedIds = new Set(facts
      .filter((fact) => fact.type === "codex_resume_consumed")
      .map((fact) => fact.payload.intentId));
    expect(retryIntents.every((fact) => consumedIds.has(fact.payload.intentId))).toBe(true);
  });

  it("retries a detached Codex handoff after a full process-state restart", async () => {
    const root = await fixtureRoot();
    const sqlitePath = path.join(root, "local-console.sqlite");
    let firstProcessCall = 0;
    const firstProcessCodex = vi.fn(async (options: CodexRunOptions): Promise<CodexRunResult> => {
      firstProcessCall += 1;
      const worker = firstProcessCall === 2;
      await options.onThreadStarted?.(worker ? "worker-codex-session" : "primary-codex-session");
      if (!worker) {
        return {
          ...success(options, "execute the Codex handoff @worker"),
          threadId: "primary-codex-session",
        };
      }
      return {
        ok: false,
        reason: "exit:1",
        runDir: options.runDir,
        stdoutPath: path.join(options.runDir, "stdout.jsonl"),
        stderrPath: path.join(options.runDir, "stderr.log"),
      };
    });
    const firstServer = await startLocalConsoleServer({
      host: "127.0.0.1",
      port: 0,
      projectRoot: root,
      sqlitePath,
      listAgentFiles: async () => [],
      loadAgentTeamSnapshot: async () => detachedWorkerSnapshot({
        cli: "codex",
        model: "gpt-5.6-sol",
        effort: "high",
      }),
      runCodex: firstProcessCodex,
      runExecution: createLocalExecutionRunner({ runCodex: firstProcessCodex }),
      isCodexThreadAvailable: async () => true,
    });
    servers.push(firstServer);

    await firstServer.runtime.switchSessionTeam({
      sessionId: "default",
      agentTeamOwnership: "user",
      agentTeamId: "detached-codex",
    });
    await post(firstServer.url, "start detached Codex work");
    const failure = await waitForSystemEventMatching(
      firstServer,
      "default",
      (message) => message.error === "exit:1",
    );
    expect(failure.runId).not.toBeNull();
    await firstServer.close();
    servers.splice(servers.indexOf(firstServer), 1);

    const secondProcessCodex = vi.fn(async (options: CodexRunOptions): Promise<CodexRunResult> => {
      await options.onThreadStarted?.("worker-codex-session");
      return {
        ...success(options, "CODEX_RESTART_RETRY_COMPLETED"),
        threadId: "worker-codex-session",
      };
    });
    const restartedServer = await startLocalConsoleServer({
      host: "127.0.0.1",
      port: 0,
      projectRoot: root,
      sqlitePath,
      listAgentFiles: async () => [],
      loadAgentTeamSnapshot: async () => {
        throw new Error("persisted team snapshot should be restored from SQLite");
      },
      runCodex: secondProcessCodex,
      runExecution: createLocalExecutionRunner({ runCodex: secondProcessCodex }),
      isCodexThreadAvailable: async () => true,
    });
    servers.push(restartedServer);

    const retry = await fetch(retryUrl(restartedServer, "default", failure.runId!), {
      method: "POST",
    });
    expect(retry.status).toBe(202);
    await waitForAgent(restartedServer.url, "CODEX_RESTART_RETRY_COMPLETED");

    expect(firstProcessCodex).toHaveBeenCalledTimes(2);
    expect(secondProcessCodex).toHaveBeenCalledTimes(1);
    expect(secondProcessCodex.mock.calls[0]?.[0].mode).toEqual({
      kind: "resume",
      threadId: "worker-codex-session",
    });
    const facts = await readFactEvents(restartedServer.runtime.getSessionFactLogPath("default"));
    const workerStarts = facts.filter((fact) =>
      fact.type === "provider_invocation"
      && fact.payload.role === "worker"
      && fact.payload.phase === "started");
    expect(workerStarts).toHaveLength(2);
    expect(new Set(workerStarts.map((fact) => fact.payload.requestedExternalSessionId)))
      .toEqual(new Set([null, "worker-codex-session"]));
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

function detachedWorkerSnapshot(
  workerProfile: LocalConsoleExecutionProfile,
): LocalConsoleAgentTeamSnapshot {
  return {
    members: [
      {
        name: "manager",
        agentMarkdown: "# manager\n\nDelegate work to @worker.",
        executionProfile: {
          cli: "codex",
          model: "gpt-5.6-sol",
          effort: "medium",
        },
      },
      {
        name: "worker",
        agentMarkdown: "# worker\n\nComplete the delegated step.",
        executionProfile: workerProfile,
      },
    ],
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

async function postToSession(
  server: StartedLocalConsoleServer,
  sessionId: string,
  body: string,
): Promise<void> {
  const response = await fetch(new URL(
    `/api/local-console/sessions/${encodeURIComponent(sessionId)}/messages`,
    server.url,
  ), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ body }),
  });
  expect(response.status).toBe(202);
}

async function waitForAgent(url: string, body: string): Promise<void> {
  await waitForCondition(
    async () => {
      const response = await fetch(new URL("/api/local-console/messages", url));
      const snapshot = await response.json() as { messages: LocalConsoleMessage[] };
      return snapshot.messages.some(
        (message) => message.speaker === "agent" && message.body === body,
      );
    },
    { describe: `agent message ${body}`, kind: "io", timeoutMs: 8_000 },
  );
}

async function waitForAgentInSession(
  server: StartedLocalConsoleServer,
  sessionId: string,
  body: string,
): Promise<void> {
  await waitForCondition(
    async () => (await server.runtime.sessionView(sessionId)).messages.some(
      (message) => message.speaker === "agent" && message.body === body,
    ),
    { describe: `agent message ${body} in ${sessionId}`, kind: "io", timeoutMs: 8_000 },
  );
}

async function waitForCalls(mock: { mock: { calls: unknown[][] } }, count: number): Promise<void> {
  await waitForCondition(() => mock.mock.calls.length >= count, {
    describe: `${String(count)} driver calls`,
    kind: "io",
    timeoutMs: 8_000,
    snapshot: () => ({ calls: mock.mock.calls.length }),
  });
}

async function injectLegacyReferenceContext(
  logPath: string,
  runId: string,
  referenceContext: string,
): Promise<void> {
  let matched = false;
  const lines = (await fs.readFile(logPath, "utf8")).trimEnd().split("\n");
  const rewritten = lines.map((line) => {
    const event = JSON.parse(line) as {
      type?: string;
      payload?: Record<string, unknown>;
    };
    if (event.type !== "run_execution_context" || event.payload?.runId !== runId) {
      return line;
    }
    matched = true;
    return JSON.stringify({
      ...event,
      payload: {
        ...event.payload,
        referenceContext,
      },
    });
  });
  if (!matched) {
    throw new Error(`run execution context fixture not found: ${runId}`);
  }
  await fs.writeFile(logPath, `${rewritten.join("\n")}\n`, "utf8");
  invalidateSessionFactLog(logPath);
}

async function waitForDatabaseRow(
  database: DatabaseSync,
  query: { sql: string; params: string[] },
): Promise<Record<string, unknown>> {
  return waitForValue(() => database.prepare(query.sql).get(...query.params) as
    | Record<string, unknown>
    | undefined, {
    describe: "persisted database row",
    kind: "io",
    timeoutMs: 8_000,
    // 并发写入期间 SQLite 会短暂上锁，这属于正常争用，继续轮询即可；其他错误必须立刻暴露。
    onError: (error) =>
      error instanceof Error && error.message.includes("database is locked") ? "retry" : "throw",
  });
}

async function waitForSystemEvent(
  url: string,
  systemEventKind: LocalConsoleMessage["systemEventKind"],
): Promise<LocalConsoleMessage> {
  return waitForValue(
    async () => {
      const response = await fetch(new URL("/api/local-console/messages", url));
      const snapshot = await response.json() as { messages: LocalConsoleMessage[] };
      return snapshot.messages.find((message) =>
        message.speaker === "system" && message.systemEventKind === systemEventKind);
    },
    { describe: `system event ${String(systemEventKind)}`, kind: "io", timeoutMs: 8_000 },
  );
}

async function waitForSystemEventMatching(
  server: StartedLocalConsoleServer,
  sessionId: string,
  predicate: (message: LocalConsoleMessage) => boolean,
): Promise<LocalConsoleMessage> {
  return waitForValue(
    async () => {
      const snapshot = await server.runtime.snapshot(sessionId);
      return snapshot.messages.find((message) =>
        message.speaker === "system" && predicate(message));
    },
    { describe: `matching system event in ${sessionId}`, kind: "io", timeoutMs: 8_000 },
  );
}

async function waitForSnapshotMatching(
  server: StartedLocalConsoleServer,
  sessionId: string,
  predicate: (snapshot: Awaited<ReturnType<StartedLocalConsoleServer["runtime"]["snapshot"]>>) => boolean,
): Promise<Awaited<ReturnType<StartedLocalConsoleServer["runtime"]["snapshot"]>>> {
  return waitForValue(
    async () => {
      const snapshot = await server.runtime.snapshot(sessionId);
      return predicate(snapshot) ? snapshot : undefined;
    },
    { describe: `matching snapshot in ${sessionId}`, kind: "io", timeoutMs: 8_000 },
  );
}

async function waitForSessionSystemEvent(
  server: StartedLocalConsoleServer,
  sessionId: string,
  systemEventKind: LocalConsoleMessage["systemEventKind"],
): Promise<LocalConsoleMessage> {
  return waitForValue(
    async () => {
      const snapshot = await server.runtime.snapshot(sessionId);
      return snapshot.messages.find((message) =>
        message.speaker === "system" && message.systemEventKind === systemEventKind);
    },
    { describe: `system event ${String(systemEventKind)} in ${sessionId}`, kind: "io", timeoutMs: 8_000 },
  );
}

async function waitForSessionAgent(
  server: StartedLocalConsoleServer,
  sessionId: string,
  body: string,
): Promise<void> {
  await waitForCondition(
    async () => {
      const snapshot = await server.runtime.snapshot(sessionId);
      return snapshot.messages.some(
        (message) => message.speaker === "agent" && message.body === body,
      );
    },
    { describe: `agent message ${body} in ${sessionId}`, kind: "io", timeoutMs: 8_000 },
  );
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

function sandboxValue(options: readonly string[] | undefined): string | null {
  if (options === undefined) return null;
  const index = options.lastIndexOf("--sandbox");
  return index < 0 ? null : options[index + 1] ?? null;
}

function retryUrl(
  server: StartedLocalConsoleServer,
  sessionId: string,
  runId: string,
): URL {
  return new URL(
    `/api/local-console/sessions/${encodeURIComponent(sessionId)}/runs/${encodeURIComponent(runId)}/retry`,
    server.url,
  );
}

async function readFactEvents(logPath: string): Promise<Array<{
  type: string;
  payload: Record<string, unknown>;
}>> {
  return (await fs.readFile(logPath, "utf8"))
    .trimEnd()
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line) as {
      type: string;
      payload: Record<string, unknown>;
    });
}
