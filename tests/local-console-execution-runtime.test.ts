import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

import { afterEach, describe, expect, it, vi } from "vitest";

import type { CodexRunOptions, CodexRunResult } from "../src/codex.js";
import type { KimiAcpRunOptions } from "../src/kimi.js";
import { createLocalExecutionRunner } from "../src/local-console/execution-driver.js";
import { startLocalConsoleServer, type StartedLocalConsoleServer } from "../src/local-console/server.js";
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
      await options.onSessionStarted?.(`kimi-mixed-${String(kimiCall)}`);
      return {
        ok: true,
        finalText: kimiCall === 1 ? "@dev implement the change" : "manager completed",
        threadId: `kimi-mixed-${String(kimiCall)}`,
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
    expect(kimi).toHaveBeenCalledTimes(1);
    expect(kimi.mock.calls[0]?.[0]).toMatchObject({
      profile: kimiProfile,
      mode: { kind: "full" },
    });
    expect(codex).not.toHaveBeenCalled();

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
      ).get()).toEqual({ count: 1 });
      expect(database.prepare(
        "SELECT COUNT(*) AS count FROM local_execution_session_links WHERE session_id = 'default'",
      ).get()).toEqual({ count: 1 });
    } finally {
      database.close();
    }
  });

  it("keeps a NULL legacy snapshot on Codex without profile options", async () => {
    const root = await fixtureRoot();
    const codex = vi.fn(async (options: CodexRunOptions) => {
      await options.onThreadStarted?.("legacy-thread");
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

  it("retries the original input as a new current-team run after a team switch", async () => {
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
      await options.onSessionStarted?.(`kimi-session-${String(call)}`);
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
        threadId: `kimi-session-${String(call)}`,
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
    const logPath = server.runtime.getSessionFactLogPath("default");
    const lines = (await fs.readFile(logPath, "utf8")).trimEnd().split("\n");
    const tampered = lines.map((line) => {
      const event = JSON.parse(line) as {
        type?: string;
        payload?: { runId?: string; profileFingerprint?: string };
      };
      if (event.type === "execution_session_link" && event.payload?.runId === stopped.runId) {
        event.payload.profileFingerprint = "tampered-profile";
      }
      return JSON.stringify(event);
    }).join("\n");
    await fs.writeFile(logPath, `${tampered}\n`, "utf8");

    const retry = await fetch(new URL(
      `/api/local-console/sessions/default/runs/${encodeURIComponent(stopped.runId!)}/retry`,
      server.url,
    ), { method: "POST" });
    expect(retry.status).toBe(202);
    await waitForAgent(server.url, "new Codex retry completed");

    expect(kimi).toHaveBeenCalledTimes(1);
    expect(codex).toHaveBeenCalledTimes(1);
    expect(codex.mock.calls[0]?.[0]).toMatchObject({
      mode: { kind: "full" },
    });
    expect(codex.mock.calls[0]?.[0].prompt).toContain("new Codex rules");
    expect(codex.mock.calls[0]?.[0].prompt).not.toContain("old Kimi rules");
  });

  it("does not require the old run context when explicit retry creates a new run", async () => {
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
    await waitForAgent(server.url, "new Codex retry completed");

    expect(kimi).not.toHaveBeenCalled();
    expect(codex).toHaveBeenCalledTimes(1);
    expect(codex.mock.calls[0]?.[0]).toMatchObject({ mode: { kind: "full" } });
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
