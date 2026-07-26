import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { CodexRunOptions, CodexRunResult } from "../src/codex.js";
import {
  buildLocalResumePrompt,
  planLocalCodexRecovery,
  readLocalCodexRecoveryFacts,
  type LocalCodexResumeIntentFact,
} from "../src/local-console/codex-resume.js";
import { startLocalConsoleServer, type StartedLocalConsoleServer } from "../src/local-console/server.js";
import type { LocalConsoleMessage } from "../src/local-console/types.js";

const cleanupRoots: string[] = [];
const cleanupServers: StartedLocalConsoleServer[] = [];

afterEach(async () => {
  await Promise.all(cleanupServers.splice(0).map((server) => server.close().catch(() => undefined)));
  await Promise.all(cleanupRoots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});

describe("local Codex recovery planning", () => {
  const intent: LocalCodexResumeIntentFact = {
    sessionId: "session-a",
    intentId: "intent-a",
    targetRunId: "run-a",
    sourceMessageId: 7,
    role: "dev",
    reason: "retry",
    createdAt: "2026-07-23T00:00:00.000Z",
  };

  it("keeps ordinary turns full and resumes only the explicitly linked compatible run", () => {
    expect(planLocalCodexRecovery({
      sourceMessageId: 7,
      role: "dev",
      contextFingerprint: "context-a",
      intents: [],
      consumedIntentIds: new Set(),
      threadLinks: [],
    })).toEqual({ kind: "full", intent: null, reason: "no-resume-intent" });

    expect(planLocalCodexRecovery({
      sourceMessageId: 7,
      role: "dev",
      contextFingerprint: "context-a",
      intents: [intent],
      consumedIntentIds: new Set(),
      threadLinks: [{
        sessionId: "session-a",
        runId: "run-a",
        sourceMessageId: 7,
        role: "dev",
        threadId: "thread-a",
        startedAt: "2026-07-23T00:00:01.000Z",
        contextFingerprint: "context-a",
      }],
    })).toMatchObject({ kind: "resume", threadId: "thread-a", reason: "compatible" });
  });

  it("falls back to full for legacy links and changed context", () => {
    const base = {
      sourceMessageId: 7,
      role: "dev",
      contextFingerprint: "context-b",
      intents: [intent],
      consumedIntentIds: new Set<string>(),
    };
    expect(planLocalCodexRecovery({
      ...base,
      threadLinks: [{
        sessionId: "session-a",
        runId: "run-a",
        sourceMessageId: 7,
        role: "dev",
        threadId: "thread-a",
        startedAt: "2026-07-23T00:00:01.000Z",
      }],
    })).toMatchObject({ kind: "full-fallback", reason: "legacy-thread-link" });
    expect(planLocalCodexRecovery({
      ...base,
      threadLinks: [{
        sessionId: "session-a",
        runId: "run-a",
        sourceMessageId: 7,
        role: "dev",
        threadId: "thread-a",
        startedAt: "2026-07-23T00:00:01.000Z",
        contextFingerprint: "context-a",
      }],
    })).toMatchObject({ kind: "full-fallback", reason: "context-mismatch" });
  });

  it("renders edit-and-resend as an overriding correction delta", () => {
    const prompt = buildLocalResumePrompt({
      reason: "edit-resend",
      correctionBody: "不要改配置，改成只更新测试。",
    });
    expect(prompt).toContain("覆盖与原指令冲突的部分");
    expect(prompt).toContain("不要改配置，改成只更新测试。");
  });
});

describe("local Codex recovery runtime", { timeout: 15_000 }, () => {
  it("creates a new full run for Retry and persists cached input usage", async () => {
    const root = await fixtureRoot();
    let call = 0;
    const runCodex = vi.fn(async (options: CodexRunOptions): Promise<CodexRunResult> => {
      call += 1;
      await options.onThreadStarted?.("thread-retry");
      if (call === 1) {
        return failed(options, "idle-timeout:10ms");
      }
      return {
        ok: true,
        finalText: "resumed",
        threadId: "thread-retry",
        cachedInputTokens: 321,
        runDir: options.runDir,
        stdoutPath: path.join(options.runDir, "stdout.jsonl"),
        stderrPath: path.join(options.runDir, "stderr.log"),
      };
    });
    const server = await startFixtureServer(root, runCodex);

    await postSessionMessage(server.url, "default", "@dev implement");
    const stuck = await waitForState(server.url, (messages) =>
      messages.find((message) => message.systemEventKind === "run-stuck") ?? null);
    expect(stuck.runId).not.toBeNull();

    const retry = await fetch(new URL(
      `/api/local-console/sessions/default/runs/${encodeURIComponent(stuck.runId!)}/retry`,
      server.url,
    ), { method: "POST" });
    expect(retry.status).toBe(202);
    await waitForState(server.url, (messages) =>
      messages.find((message) => message.speaker === "agent" && message.body === "resumed") ?? null);

    expect(runCodex).toHaveBeenCalledTimes(2);
    expect(runCodex.mock.calls[1]?.[0].mode).toEqual({ kind: "full" });
    const facts = await fs.readFile(server.runtime.getSessionFactLogPath("default"), "utf8");
    expect(facts).toContain('"reason":"retry"');
    expect(facts).toContain('"reason":"explicit-retry"');
    expect(facts).toContain('"cachedInputTokens":321');
  });

  it("persists a graceful intent before shutdown and auto-resumes after restart", async () => {
    const root = await fixtureRoot();
    const firstRun = vi.fn(async (options: CodexRunOptions): Promise<CodexRunResult> => {
      await options.onThreadStarted?.("thread-shutdown");
      return await new Promise<CodexRunResult>((resolve) => {
        options.signal?.addEventListener("abort", () => resolve(failed(
          options,
          `interrupted:${String(options.signal?.reason)}`,
        )), { once: true });
      });
    });
    const first = await startFixtureServer(root, firstRun);
    await postSessionMessage(first.url, "default", "@dev keep working");
    const firstActiveRun = await waitForActiveRun(first.url);
    await first.close();
    cleanupServers.splice(cleanupServers.indexOf(first), 1);

    const recoveryFacts = await readLocalCodexRecoveryFacts(
      first.runtime.getSessionFactLogPath("default"),
      "default",
    );
    expect(recoveryFacts.intents).toContainEqual(expect.objectContaining({
      reason: "graceful-shutdown",
      role: "dev",
    }));

    const secondRun = vi.fn(async (options: CodexRunOptions): Promise<CodexRunResult> => {
      await options.onThreadStarted?.("thread-shutdown");
      return {
        ok: true,
        finalText: "continued after restart",
        threadId: "thread-shutdown",
        cachedInputTokens: 99,
        runDir: options.runDir,
        stdoutPath: path.join(options.runDir, "stdout.jsonl"),
        stderrPath: path.join(options.runDir, "stderr.log"),
      };
    });
    const second = await startFixtureServer(root, secondRun);
    await waitForState(second.url, (messages) =>
      messages.find((message) => message.speaker === "agent" && message.body === "continued after restart") ?? null);
    expect(secondRun.mock.calls[0]?.[0].mode).toEqual({ kind: "resume", threadId: "thread-shutdown" });
    const messages = await getMessages(second.url);
    expect(messages.some((message) => message.systemEventKind === "run-stuck")).toBe(false);
    expect(messages.some((message) => message.systemEventKind === "user-stopped")).toBe(false);
    const continued = messages.find((message) => message.body === "continued after restart");
    expect(continued?.runId).toBe(firstActiveRun.runId);
    expect(continued?.runTiming).toMatchObject({
      attempt: firstActiveRun.attempt,
      status: "completed",
    });
    const lifecycleFacts = (await fs.readFile(
      second.runtime.getSessionFactLogPath("default"),
      "utf8",
    )).split("\n").filter(Boolean).map((line) => JSON.parse(line) as {
      type?: string;
      payload?: { runId?: string; phase?: string };
    });
    const sameRunLifecycle = lifecycleFacts.filter((fact) =>
      fact.type === "run_lifecycle" && fact.payload?.runId === firstActiveRun.runId);
    expect(sameRunLifecycle.filter((fact) => fact.payload?.phase === "created")).toHaveLength(1);
    expect(sameRunLifecycle.some((fact) => fact.payload?.phase === "paused")).toBe(true);
    expect(sameRunLifecycle.some((fact) => fact.payload?.phase === "resumed")).toBe(true);
  });

  it("does not rerun automatically when graceful recovery is unavailable", async () => {
    const root = await fixtureRoot();
    const firstRun = vi.fn(async (options: CodexRunOptions): Promise<CodexRunResult> => {
      await options.onThreadStarted?.("thread-unavailable");
      return await new Promise<CodexRunResult>((resolve) => {
        options.signal?.addEventListener("abort", () => resolve(failed(
          options,
          `interrupted:${String(options.signal?.reason)}`,
        )), { once: true });
      });
    });
    const first = await startFixtureServer(root, firstRun);
    await postSessionMessage(first.url, "default", "@dev keep working");
    const firstActiveRun = await waitForActiveRun(first.url);
    await first.close();
    cleanupServers.splice(cleanupServers.indexOf(first), 1);

    const replacementRun = vi.fn(async (options: CodexRunOptions): Promise<CodexRunResult> => ({
      ok: true,
      finalText: "restarted explicitly",
      threadId: "thread-replacement",
      cachedInputTokens: 0,
      runDir: options.runDir,
      stdoutPath: path.join(options.runDir, "stdout.jsonl"),
      stderrPath: path.join(options.runDir, "stderr.log"),
    }));
    const second = await startFixtureServer(root, replacementRun, async () => false);
    const unavailable = await waitForState(second.url, (messages) =>
      messages.find((message) => message.systemEventKind === "resume-unavailable") ?? null);
    expect(replacementRun).not.toHaveBeenCalled();
    expect(unavailable.runId).toBe(firstActiveRun.runId);
    expect(unavailable.runTiming).toMatchObject({
      attempt: firstActiveRun.attempt,
      status: "failed",
    });

    const retry = await fetch(new URL(
      `/api/local-console/sessions/default/runs/${encodeURIComponent(unavailable.runId!)}/retry`,
      second.url,
    ), { method: "POST" });
    expect(retry.status).toBe(202);
    await waitForState(second.url, (messages) =>
      messages.find((message) => message.body === "restarted explicitly") ?? null);
    expect(replacementRun).toHaveBeenCalledTimes(1);
    expect(replacementRun.mock.calls[0]?.[0].mode).toEqual({ kind: "full" });
  });

  it("continues an interrupted thread with the edited resend as an overriding delta", async () => {
    const root = await fixtureRoot();
    let call = 0;
    const runCodex = vi.fn(async (options: CodexRunOptions): Promise<CodexRunResult> => {
      call += 1;
      await options.onThreadStarted?.("thread-edit");
      if (call === 1) {
        return failed(options, "interrupted:user-interrupted");
      }
      return {
        ok: true,
        finalText: "edited instruction applied",
        threadId: "thread-edit",
        cachedInputTokens: 77,
        runDir: options.runDir,
        stdoutPath: path.join(options.runDir, "stdout.jsonl"),
        stderrPath: path.join(options.runDir, "stderr.log"),
      };
    });
    const server = await startFixtureServer(root, runCodex);
    await postSessionMessage(server.url, "default", "@dev 修改配置");
    const stopped = await waitForState(server.url, (messages) =>
      messages.find((message) => message.systemEventKind === "user-stopped") ?? null);

    const resend = await fetch(new URL("/api/local-console/sessions/default/messages", server.url), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        body: "@dev 不要改配置，只更新测试",
        resumeRunId: stopped.runId,
      }),
    });
    expect(resend.status).toBe(202);
    await waitForState(server.url, (messages) =>
      messages.find((message) => message.speaker === "agent" && message.body === "edited instruction applied") ?? null);

    expect(runCodex.mock.calls[1]?.[0].mode).toEqual({ kind: "resume", threadId: "thread-edit" });
    expect(runCodex.mock.calls[1]?.[0].prompt).toContain("覆盖与原指令冲突的部分");
    expect(runCodex.mock.calls[1]?.[0].prompt).toContain("不要改配置，只更新测试");
  });

  it("falls back to a full prompt when the linked rollout is unavailable", async () => {
    const root = await fixtureRoot();
    let call = 0;
    const runCodex = vi.fn(async (options: CodexRunOptions): Promise<CodexRunResult> => {
      call += 1;
      await options.onThreadStarted?.("thread-missing");
      if (call === 1) {
        return failed(options, "interrupted:user-interrupted");
      }
      return {
        ok: true,
        finalText: "full fallback completed",
        threadId: "thread-replacement",
        cachedInputTokens: 0,
        runDir: options.runDir,
        stdoutPath: path.join(options.runDir, "stdout.jsonl"),
        stderrPath: path.join(options.runDir, "stderr.log"),
      };
    });
    const server = await startFixtureServer(root, runCodex, async () => false);
    await postSessionMessage(server.url, "default", "@dev 修改配置");
    const stopped = await waitForState(server.url, (messages) =>
      messages.find((message) => message.systemEventKind === "user-stopped") ?? null);

    const resend = await fetch(new URL("/api/local-console/sessions/default/messages", server.url), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        body: "@dev 改成只更新测试",
        resumeRunId: stopped.runId,
      }),
    });
    expect(resend.status).toBe(202);
    await waitForState(server.url, (messages) =>
      messages.find((message) => message.speaker === "agent" && message.body === "full fallback completed") ?? null);

    expect(runCodex.mock.calls[1]?.[0].mode).toEqual({ kind: "full" });
    expect(runCodex.mock.calls[1]?.[0].prompt).toContain("当前本地对话时间线");
    const facts = await fs.readFile(server.runtime.getSessionFactLogPath("default"), "utf8");
    expect(facts).toContain('"mode":"full-fallback"');
    expect(facts).toContain('"reason":"rollout-unavailable"');
  });
});

async function fixtureRoot(): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "moebius-resume-"));
  cleanupRoots.push(root);
  return root;
}

async function startFixtureServer(
  root: string,
  runCodex: (options: CodexRunOptions) => Promise<CodexRunResult>,
  isCodexThreadAvailable: (threadId: string) => Promise<boolean> = async () => true,
): Promise<StartedLocalConsoleServer> {
  const server = await startLocalConsoleServer({
    projectRoot: root,
    sqlitePath: path.join(root, ".state", "local-console.sqlite"),
    sessionLogRoot: path.join(root, "sessions"),
    listAgentFiles: async () => [{ name: "dev", agentMarkdown: "# Dev\n\nImplement." }],
    runCodex,
    isCodexThreadAvailable,
    codexIdleTimeoutMs: 5_000,
    codexMaxDurationMs: 10_000,
  });
  cleanupServers.push(server);
  return server;
}

async function postSessionMessage(url: string, sessionId: string, body: string): Promise<void> {
  const response = await fetch(new URL(
    `/api/local-console/sessions/${encodeURIComponent(sessionId)}/messages`,
    url,
  ), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ body }),
  });
  expect(response.status).toBe(202);
}

async function getMessages(url: string): Promise<LocalConsoleMessage[]> {
  const response = await fetch(new URL("/api/local-console/messages", url));
  const body = await response.json() as { messages: LocalConsoleMessage[] };
  return body.messages;
}

async function waitForState<T>(
  url: string,
  select: (messages: LocalConsoleMessage[]) => T | null,
): Promise<T> {
  const deadline = Date.now() + 8_000;
  let latest: LocalConsoleMessage[] = [];
  while (Date.now() < deadline) {
    latest = await getMessages(url);
    const selected = select(latest);
    if (selected !== null) {
      return selected;
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error(`timed out waiting for local console state: ${JSON.stringify(latest)}`);
}

async function waitForActiveRun(url: string): Promise<{ runId: string; attempt: number }> {
  const deadline = Date.now() + 8_000;
  while (Date.now() < deadline) {
    const response = await fetch(new URL("/api/local-console/messages", url));
    const body = await response.json() as {
      activeRun: { runId: string; attempt: number } | null;
    };
    if (body.activeRun !== null) {
      return body.activeRun;
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error("timed out waiting for active run");
}

function failed(options: CodexRunOptions, reason: string): CodexRunResult {
  return {
    ok: false,
    reason,
    runDir: options.runDir,
    stdoutPath: path.join(options.runDir, "stdout.jsonl"),
    stderrPath: path.join(options.runDir, "stderr.log"),
  };
}
