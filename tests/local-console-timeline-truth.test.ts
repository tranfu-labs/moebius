import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { CodexRunOptions, CodexRunResult } from "../src/codex.js";
import { createSqliteLocalConsoleStore } from "../src/local-console/store.js";
import { startLocalConsoleServer, type StartedLocalConsoleServer } from "../src/local-console/server.js";
import {
  LOCAL_CONSOLE_DEFAULT_SESSION_ID,
  type LocalConsoleMessage,
  type LocalConsoleSessionSummary,
} from "../src/local-console/types.js";
import { addAgentTeamMember, createAgentTeam, trashUserAgentTeam } from "../desktop/src/team-ipc.js";
import { serializeTeamDefinition } from "../desktop/src/team-model.js";
import {
  listSessionAgentFiles,
  loadAgentTeamSnapshot,
  resolveSessionAgentTeamHealth,
} from "../desktop/src/team-runtime-binding.js";
import { resolveTeamLocation } from "../desktop/src/team-store.js";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => fs.rm(root, {
    recursive: true,
    force: true,
    maxRetries: 5,
    retryDelay: 20,
  })));
});

describe("main conversation timeline truth through the HTTP assembly", () => {
  it("keeps the registered shared-agent fallback for an unbound legacy session", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "moebius-timeline-truth-legacy-"));
    roots.push(root);
    await fs.mkdir(path.join(root, "agents"), { recursive: true });
    await fs.writeFile(path.join(root, "agents", "legacy-primary.md"), "# Legacy primary\n", "utf8");
    const store = await createSqliteLocalConsoleStore({ sqlitePath: path.join(root, ".state", "local-console.sqlite") });
    const findSession = async (sessionId: string): Promise<LocalConsoleSessionSummary> => {
      const session = (await store.listSessions()).find((candidate) => candidate.sessionId === sessionId);
      if (session === undefined) throw new Error(`missing session: ${sessionId}`);
      return session;
    };
    const started = await startLocalConsoleServer({
      projectRoot: root,
      port: 0,
      store,
      listAgentFiles: async (sessionId) => listSessionAgentFiles({ dataRoot: root, session: await findSession(sessionId) }),
      resolveAgentTeamHealth: async (session) => resolveSessionAgentTeamHealth({ dataRoot: root, session }),
      runCodex: async (options) => codexOk(options, "存量会话继续推进"),
      makeRunDir: (count) => path.join(root, "runs", String(count)),
      storeTimeoutMs: 2_000,
    });
    try {
      expect((await postMessage(started.url, LOCAL_CONSOLE_DEFAULT_SESSION_ID, "请继续这段旧对话")).status).toBe(202);
      const state = await waitForState(started.url, LOCAL_CONSOLE_DEFAULT_SESSION_ID, (snapshot) =>
        snapshot.activeRun === null && snapshot.messages.some((message) => message.speaker === "agent"),
      );
      expect(state.selectedSession).toMatchObject({ agentTeamOwnership: null, agentTeamId: null });
      expect(state.selectedSession.continuation.canContinue).toBe(true);
      expect(state.messages).toEqual(expect.arrayContaining([
        expect.objectContaining({ speaker: "agent", role: "legacy-primary", body: "存量会话继续推进" }),
      ]));
    } finally {
      await started.close();
    }
  }, 20_000);

  it("sends an unmentioned message to the real team's primary Agent", async () => {
    const harness = await startHarness(async (options) => codexOk(options, "主 Agent 已接手"));
    try {
      const session = await createSession(harness.started.url, "primary routing", "system", "development");
      expect((await postMessage(harness.started.url, session.sessionId, "请继续完成这件事")).status).toBe(202);
      const state = await waitForState(harness.started.url, session.sessionId, (snapshot) =>
        snapshot.activeRun === null && snapshot.messages.some((message) => message.speaker === "agent"),
      );
      expect(state.messages).toEqual(expect.arrayContaining([
        expect.objectContaining({ speaker: "agent", role: "manager", body: "主 Agent 已接手" }),
      ]));
    } finally {
      await harness.started.close();
    }
  }, 20_000);

  it("lets the primary Agent redirect an active member after a user asks for a new instruction", async () => {
    let managerCallCount = 0;
    let devCallCount = 0;
    const roles: string[] = [];
    const harness = await startHarness(async (options) => {
      const role = roleFromPrompt(options.prompt);
      roles.push(role);
      if (role === "manager") {
        managerCallCount += 1;
        return codexOk(
          options,
          managerCallCount === 1
            ? "@dev 先做旧任务"
            : managerCallCount === 2
              ? "@dev 改按这条新指令做"
              : "重新安排完成",
        );
      }
      devCallCount += 1;
      return devCallCount === 1 ? waitForAbort(options) : codexOk(options, "已按新指令重新开始");
    });
    try {
      const session = await createSession(harness.started.url, "redirect active", "system", "development");
      expect((await postMessage(harness.started.url, session.sessionId, "@dev 先做旧任务")).status).toBe(202);
      await waitForState(harness.started.url, session.sessionId, (snapshot) =>
        snapshot.activeRun === null && snapshot.activeRuns.some((run) => run.role === "dev")
      );

      expect((await postMessage(harness.started.url, session.sessionId, "@dev 改按这条新指令做")).status).toBe(202);
      const restarted = await waitForState(harness.started.url, session.sessionId, (snapshot) =>
        snapshot.activeRuns.length === 0
        && snapshot.messages.some((message) => message.speaker === "agent" && message.body === "重新安排完成"),
      );
      expect(roles).toEqual(["manager", "dev", "manager", "dev", "manager"]);
      expect(restarted.messages).toEqual(expect.arrayContaining([
        expect.objectContaining({
          speaker: "system",
          systemEventKind: "other",
          body: expect.stringContaining("新的指令"),
        }),
      ]));
      expect(restarted.messages.some((message) => message.systemEventKind === "user-stopped")).toBe(false);
    } finally {
      await harness.started.close();
    }
  }, 60_000);

  it("runs the primary Agent beside an active member without interrupting the member", async () => {
    let devOptions!: CodexRunOptions;
    let finishDev!: (result: CodexRunResult) => void;
    let managerOptions!: CodexRunOptions;
    let finishManager!: (result: CodexRunResult) => void;
    let managerCallCount = 0;
    const harness = await startHarness((options) => {
      const role = roleFromPrompt(options.prompt);
      if (role === "dev") {
        devOptions = options;
        return new Promise<CodexRunResult>((resolve) => {
          finishDev = resolve;
        });
      }
      managerCallCount += 1;
      if (managerCallCount === 1) {
        return Promise.resolve(codexOk(options, "@dev 先做旧任务"));
      }
      if (managerCallCount > 2) {
        return Promise.resolve(codexOk(options, "主理人已接回执行结果"));
      }
      managerOptions = options;
      return new Promise<CodexRunResult>((resolve) => {
        finishManager = resolve;
      });
    });
    try {
      const session = await createSession(harness.started.url, "supplement active run", "system", "development");
      expect((await postMessage(harness.started.url, session.sessionId, "@dev 先做旧任务")).status).toBe(202);
      await waitForState(harness.started.url, session.sessionId, (snapshot) =>
        snapshot.activeRun === null && snapshot.activeRuns.some((run) => run.role === "dev")
      );

      expect((await postMessage(harness.started.url, session.sessionId, "补一句话给主 Agent")).status).toBe(202);
      const supplemented = await waitForState(harness.started.url, session.sessionId, (snapshot) =>
        snapshot.activeRun?.role === "manager"
        && snapshot.activeRuns.some((run) => run.role === "dev")
      );
      expect(devOptions.signal?.aborted).toBe(false);
      expect(supplemented.pendingPrimaryMessages).toEqual([]);
      expect(supplemented.messages).toEqual(expect.arrayContaining([
        expect.objectContaining({ speaker: "user", body: "补一句话给主 Agent", status: "running" }),
      ]));

      finishManager(codexOk(managerOptions, "补充已送达主 Agent"));
      await waitForState(harness.started.url, session.sessionId, (snapshot) =>
        snapshot.activeRun === null && snapshot.activeRuns.some((run) => run.role === "dev")
      );
      expect(devOptions.signal?.aborted).toBe(false);
      finishDev(codexOk(devOptions, "旧步骤完成"));
      const completed = await waitForState(harness.started.url, session.sessionId, (snapshot) =>
        snapshot.activeRuns.length === 0
        && snapshot.messages.some((message) => message.speaker === "agent" && message.body === "补充已送达主 Agent"),
      );
      expect(completed.messages).toEqual(expect.arrayContaining([
        expect.objectContaining({ speaker: "agent", role: "manager", body: "补充已送达主 Agent" }),
      ]));
      expect(devOptions.signal?.aborted).toBe(false);
    } finally {
      await harness.started.close();
    }
  }, 60_000);

  it("reports a deleted team as read-only, then recovers through the HTTP team switch without losing history", async () => {
    const harness = await startHarness(async (options) => codexOk(options, "新团队继续推进"));
    try {
      const draft = await createAgentTeam(harness.root, { name: "临时团队", description: "删除恢复测试" });
      await addAgentTeamMember(harness.root, { teamId: draft.id, ownership: "user" });
      const session = await createSession(harness.started.url, "deleted team", "user", draft.id);
      await harness.store.recordSystemMessage({
        sessionId: session.sessionId,
        body: "这里是删除前的历史。",
        runId: null,
        runDir: null,
        error: null,
        now: "2026-07-22T02:00:00.000Z",
      });
      await trashUserAgentTeam(harness.root, { teamId: draft.id, ownership: "user" }, async (targetPath) => {
        const trash = path.join(harness.root, "trash", path.basename(targetPath));
        await fs.mkdir(path.dirname(trash), { recursive: true });
        await fs.rename(targetPath, trash);
      });

      const deleted = await getState(harness.started.url, session.sessionId);
      expect(deleted.selectedSession).toMatchObject({
        agentTeamHealth: "deleted",
        continuation: { canContinue: false, kind: "team-deleted", recoveryAction: "select-team" },
      });
      expect(deleted.messages).toEqual(expect.arrayContaining([
        expect.objectContaining({ body: "这里是删除前的历史。" }),
        expect.objectContaining({ speaker: "system", systemEventKind: "other", body: expect.stringContaining("已经被删除") }),
      ]));
      expect((await postMessage(harness.started.url, session.sessionId, "不能发送")).status).toBe(503);

      const switched = await switchTeam(harness.started.url, session.sessionId, "system", "development");
      expect(switched.status).toBe(200);
      expect((await postMessage(harness.started.url, session.sessionId, "请接着历史继续")).status).toBe(202);
      const recovered = await waitForState(harness.started.url, session.sessionId, (snapshot) =>
        snapshot.activeRun === null && snapshot.messages.some((message) => message.speaker === "agent" && message.body === "新团队继续推进"),
      );
      expect(recovered.selectedSession.continuation).toMatchObject({ canContinue: true, kind: "available" });
      expect(recovered.messages.some((message) => message.body === "这里是删除前的历史。")).toBe(true);
    } finally {
      await harness.started.close();
    }
  }, 20_000);

  it("automatically unblocks a repaired team on the next HTTP state refresh", async () => {
    const harness = await startHarness(async (options) => codexOk(options, "修复后继续"));
    try {
      const session = await createSession(harness.started.url, "repair team", "system", "development");
      const team = resolveTeamLocation({ dataRoot: harness.root, teamId: "development", ownership: "system" });
      await fs.rm(path.join(team.directory, "members", "dev", "AGENT.md"));

      const broken = await getState(harness.started.url, session.sessionId);
      expect(broken.selectedSession).toMatchObject({
        agentTeamHealth: "needs-repair",
        continuation: { canContinue: false, kind: "team-needs-repair", recoveryAction: "repair-or-select-team" },
      });
      expect(broken.messages).toEqual(expect.arrayContaining([
        expect.objectContaining({
          speaker: "system",
          systemEventKind: "other",
          body: expect.stringContaining("需要修复"),
        }),
      ]));
      expect((await postMessage(harness.started.url, session.sessionId, "暂时不能发送")).status).toBe(503);

      await fs.writeFile(path.join(team.directory, "members", "dev", "AGENT.md"), "# 开发\n\nROLE:dev\n", "utf8");
      const repaired = await getState(harness.started.url, session.sessionId);
      expect(repaired.selectedSession).toMatchObject({
        agentTeamHealth: "usable",
        continuation: { canContinue: true, kind: "available" },
      });
      expect((await postMessage(harness.started.url, session.sessionId, "修复后继续")).status).toBe(202);
      const continued = await waitForState(harness.started.url, session.sessionId, (snapshot) =>
        snapshot.activeRun === null && snapshot.messages.some((message) => message.speaker === "agent" && message.body === "修复后继续"),
      );
      expect(continued.selectedSession.continuation).toMatchObject({ canContinue: true, kind: "available" });
    } finally {
      await harness.started.close();
    }
  }, 20_000);

  it("lets an active run with a persisted team snapshot finish its step when the team becomes unhealthy", async () => {
    let finishRun: (() => void) | null = null;
    let abortReason: string | null = null;
    const harness = await startHarness(async (options) => new Promise<CodexRunResult>((resolve) => {
      finishRun = () => resolve(codexOk(options, "隔离团队快照完成了当前步骤"));
      options.signal?.addEventListener("abort", () => {
        abortReason = String(options.signal?.reason ?? "abort");
        resolve({
          ok: false,
          reason: `interrupted:${abortReason}`,
          runDir: options.runDir,
          stdoutPath: path.join(options.runDir, "stdout.jsonl"),
          stderrPath: path.join(options.runDir, "stderr.log"),
        });
      }, { once: true });
    }));
    try {
      const session = await createSession(harness.started.url, "snapshot survives team damage", "system", "development");
      expect((await postMessage(harness.started.url, session.sessionId, "@manager 完成当前步骤")).status).toBe(202);
      await waitForState(harness.started.url, session.sessionId, (snapshot) => snapshot.activeRun?.role === "manager");

      const team = resolveTeamLocation({ dataRoot: harness.root, teamId: "development", ownership: "system" });
      await fs.rm(path.join(team.directory, "members", "dev", "AGENT.md"));
      const unhealthy = await getState(harness.started.url, session.sessionId);
      expect(unhealthy.selectedSession.continuation).toMatchObject({ canContinue: false, kind: "team-needs-repair" });
      expect(unhealthy.activeRun?.role).toBe("manager");
      expect(abortReason).toBeNull();

      expect(finishRun).not.toBeNull();
      finishRun!();
      const finished = await waitForState(harness.started.url, session.sessionId, (snapshot) =>
        snapshot.activeRun === null && snapshot.messages.some((message) => message.body === "隔离团队快照完成了当前步骤"),
      );
      expect(finished.selectedSession.continuation).toMatchObject({ canContinue: false, kind: "team-needs-repair" });
      expect(abortReason).toBeNull();
    } finally {
      await harness.started.close();
    }
  }, 20_000);

  it("stops an active run without a team snapshot, records why, and resumes after the team is repaired", async () => {
    let callCount = 0;
    const harness = await startHarness(async (options) => {
      callCount += 1;
      return callCount === 1 ? waitForAbort(options) : codexOk(options, "团队修复后重新推进");
    });
    try {
      const session = await harness.store.createSession({
        sessionId: "local:legacy-without-team-snapshot",
        title: "legacy without snapshot",
        agentTeamOwnership: "system",
        agentTeamId: "development",
        now: "2026-07-22T03:00:00.000Z",
      });
      expect(await harness.store.listSessionAgentTeamSnapshot?.(session.sessionId)).toBeNull();
      expect((await postMessage(harness.started.url, session.sessionId, "@manager 先执行")).status).toBe(202);
      await waitForState(harness.started.url, session.sessionId, (snapshot) => snapshot.activeRun?.role === "manager");

      const team = resolveTeamLocation({ dataRoot: harness.root, teamId: "development", ownership: "system" });
      const damagedAgent = path.join(team.directory, "members", "dev", "AGENT.md");
      await fs.rm(damagedAgent);
      const stopped = await waitForState(harness.started.url, session.sessionId, (snapshot) =>
        snapshot.activeRun === null && snapshot.messages.some((message) => message.error?.includes("agent-team-unavailable") === true),
      );
      expect(stopped.selectedSession.continuation).toMatchObject({ canContinue: false, kind: "team-needs-repair" });
      expect(stopped.messages).toEqual(expect.arrayContaining([
        expect.objectContaining({
          speaker: "system",
          systemEventKind: "other",
          body: expect.stringContaining("项目或团队内容已经不可用"),
        }),
      ]));

      await fs.writeFile(damagedAgent, "# 开发\n\nROLE:dev\n", "utf8");
      expect((await getState(harness.started.url, session.sessionId)).selectedSession.continuation)
        .toMatchObject({ canContinue: true, kind: "available" });
      expect((await postMessage(harness.started.url, session.sessionId, "修复后继续")).status).toBe(202);
      const resumed = await waitForState(harness.started.url, session.sessionId, (snapshot) =>
        snapshot.activeRun === null && snapshot.messages.some((message) => message.body === "团队修复后重新推进"),
      );
      expect(resumed.selectedSession.continuation).toMatchObject({ canContinue: true, kind: "available" });
      expect(callCount).toBe(2);
    } finally {
      await harness.started.close();
    }
  }, 20_000);
});

async function startHarness(runCodex: (options: CodexRunOptions) => Promise<CodexRunResult>): Promise<{
  root: string;
  store: Awaited<ReturnType<typeof createSqliteLocalConsoleStore>>;
  started: StartedLocalConsoleServer;
}> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "moebius-timeline-truth-"));
  roots.push(root);
  await writeBuiltInTeam(root);
  const store = await createSqliteLocalConsoleStore({ sqlitePath: path.join(root, ".state", "local-console.sqlite") });
  const findSession = async (sessionId: string): Promise<LocalConsoleSessionSummary> => {
    const session = (await store.listSessions()).find((candidate) => candidate.sessionId === sessionId);
    if (session === undefined) throw new Error(`missing session: ${sessionId}`);
    return session;
  };
  const started = await startLocalConsoleServer({
    projectRoot: root,
    port: 0,
    store,
    listAgentFiles: async (sessionId) => listSessionAgentFiles({ dataRoot: root, session: await findSession(sessionId) }),
    loadAgentTeamSnapshot: async (binding) => loadAgentTeamSnapshot({ dataRoot: root, ownership: binding.ownership, teamId: binding.id }),
    resolveAgentTeamHealth: async (session) => resolveSessionAgentTeamHealth({ dataRoot: root, session }),
    runCodex,
    isCodexThreadAvailable: async () => true,
    makeRunDir: (count) => path.join(root, "runs", String(count)),
    storeTimeoutMs: 2_000,
  });
  return { root, store, started };
}

async function writeBuiltInTeam(dataRoot: string): Promise<void> {
  const team = resolveTeamLocation({ dataRoot, teamId: "development", ownership: "system" });
  await fs.mkdir(team.directory, { recursive: true });
  await fs.writeFile(path.join(team.directory, "team.json"), serializeTeamDefinition({
    name: "开发团队",
    description: "测试团队",
    primaryAgentSlug: "manager",
    memberOrder: ["dev", "manager"],
  }), "utf8");
  for (const [slug, title] of [["dev", "开发"], ["manager", "主 Agent"]] as const) {
    const memberDirectory = path.join(team.directory, "members", slug);
    await fs.mkdir(memberDirectory, { recursive: true });
    await fs.writeFile(path.join(memberDirectory, "AGENT.md"), `# ${title}\n\nROLE:${slug}\n`, "utf8");
  }
}

async function createSession(
  url: string,
  title: string,
  ownership: "system" | "user",
  id: string,
): Promise<LocalConsoleSessionSummary> {
  const response = await fetch(new URL("/api/local-console/sessions", url), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ title, agentTeamOwnership: ownership, agentTeamId: id }),
  });
  expect(response.status).toBe(201);
  return ((await response.json()) as { session: LocalConsoleSessionSummary }).session;
}

async function postMessage(url: string, sessionId: string, body: string): Promise<Response> {
  return fetch(new URL(`/api/local-console/sessions/${encodeURIComponent(sessionId)}/messages`, url), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ body }),
  });
}

async function switchTeam(url: string, sessionId: string, ownership: "system" | "user", id: string): Promise<Response> {
  return fetch(new URL(`/api/local-console/sessions/${encodeURIComponent(sessionId)}/team`, url), {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ agentTeamOwnership: ownership, agentTeamId: id }),
  });
}

interface StateResponse {
  selectedSession: LocalConsoleSessionSummary & { continuation: { canContinue: boolean; kind: string; recoveryAction: string | null } };
  messages: LocalConsoleMessage[];
  pendingPrimaryMessages: LocalConsoleMessage[];
  activeRuns: Array<{ role: string | null; runId: string }>;
  activeRun: { role: string | null } | null;
}

async function getState(url: string, sessionId: string): Promise<StateResponse> {
  const stateUrl = new URL("/api/local-console/state", url);
  stateUrl.searchParams.set("sessionId", sessionId);
  const response = await fetch(stateUrl);
  expect(response.status).toBe(200);
  return (await response.json()) as StateResponse;
}

async function waitForState(url: string, sessionId: string, predicate: (state: StateResponse) => boolean): Promise<StateResponse> {
  const deadline = Date.now() + 20_000;
  let latest: StateResponse | null = null;
  while (Date.now() < deadline) {
    latest = await getState(url, sessionId);
    if (predicate(latest)) return latest;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error(`timed out waiting for state: ${JSON.stringify(latest)}`);
}

function codexOk(options: CodexRunOptions, finalText: string): CodexRunResult {
  return {
    ok: true,
    finalText,
    threadId: options.mode?.kind === "resume" ? options.mode.threadId : "thread-timeline-truth",
    cachedInputTokens: null,
    runDir: options.runDir,
    stdoutPath: path.join(options.runDir, "stdout.jsonl"),
    stderrPath: path.join(options.runDir, "stderr.log"),
  };
}

function waitForAbort(options: CodexRunOptions): Promise<CodexRunResult> {
  return new Promise((resolve) => options.signal?.addEventListener("abort", () => resolve({
    ok: false,
    reason: `interrupted:${String(options.signal?.reason ?? "abort")}`,
    runDir: options.runDir,
    stdoutPath: path.join(options.runDir, "stdout.jsonl"),
    stderrPath: path.join(options.runDir, "stderr.log"),
  }), { once: true }));
}

function roleFromPrompt(prompt: string): string {
  for (const role of ["manager", "dev"]) {
    if (
      prompt.includes(`ROLE:${role}`)
      || prompt.includes(`不是你自己 <${role}> 发出的消息`)
    ) {
      return role;
    }
  }
  throw new Error(`Unable to detect role from prompt: ${prompt.slice(0, 160)}`);
}
