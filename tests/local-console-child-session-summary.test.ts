import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { CodexRunOptions, CodexRunResult } from "../src/codex.js";
import {
  resolveChildSessionMember,
  summarizeChildSessions,
  type ChildSessionSummarySource,
} from "../src/local-console/child-session-summary.js";
import { startLocalConsoleServer, type StartedLocalConsoleServer } from "../src/local-console/start.js";

const roots: string[] = [];
const servers: StartedLocalConsoleServer[] = [];

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => server.close()));
  await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});

describe("child session summaries", () => {
  it("maps current session facts and resolves the responsible member", () => {
    const sources: ChildSessionSummarySource[] = [
      source({ sessionId: "running", status: "running", latestAgentRole: "dev" }),
      source({ sessionId: "failed", status: "failed", unresolvedSystemEventKind: "run-not-started", latestAgentRole: null }),
      source({ sessionId: "finished", status: "idle", latestAgentRole: "qa" }),
    ];

    expect(summarizeChildSessions("parent", sources)).toEqual([
      expect.objectContaining({ sessionId: "running", memberName: "开发", status: "running", statusLabel: "进行中" }),
      expect.objectContaining({ sessionId: "failed", memberName: "技术负责人", status: "not-started", statusLabel: "没跑起来" }),
      expect.objectContaining({ sessionId: "finished", memberName: "测试", status: "finished", statusLabel: "已结束" }),
    ]);
    expect(resolveChildSessionMember(null, "Initial handoff:\n@product-manager 请接手")).toBe("产品");
    expect(resolveChildSessionMember("plan-executor", null, {
      members: [{
        name: "plan-executor",
        agentMarkdown: "---\ndisplay_name: 方案执行者\ndescription: 负责执行\n---\n\nprivate",
      }],
    })).toBe("方案执行者");
  });

  it("returns an empty aggregate and degrades corrupt or missing child chains deterministically", () => {
    expect(summarizeChildSessions("parent", [])).toEqual([]);
    expect(summarizeChildSessions("parent", [
      source({
        sessionId: "missing-child",
        title: null,
        parentSessionId: null,
        status: null,
        chainValid: false,
        initialBody: null,
      }),
    ])).toEqual([{
      sessionId: "missing-child",
      title: "子任务不可用",
      memberName: "成员未知",
      status: "unavailable",
      statusLabel: "不可用",
    }]);
  });

  it("serves the aggregate from the real HTTP server without changing persisted parent-child selection semantics", async () => {
    const started = await startFixtureServer();
    const parent = await createSession(started, "父会话");
    await createChild(started, parent.sessionId, "child-running", "落地页文案", "dev");
    await createChild(started, parent.sessionId, "child-failed", "空状态验收", "qa");
    await createChild(started, parent.sessionId, "child-missing", "丢失任务", "dev-manager");

    const database = new DatabaseSync(started.sqlitePath);
    try {
      database.prepare("UPDATE session_messages SET status = 'running' WHERE session_id = ?").run("child-running");
      database.prepare(
        "UPDATE session_messages SET status = 'failed', system_event_kind = 'run-not-started' WHERE session_id = ?",
      ).run("child-failed");
      database.prepare("DELETE FROM session_messages WHERE session_id = ?").run("child-missing");
      database.prepare("DELETE FROM sessions WHERE session_id = ?").run("child-missing");
    } finally {
      database.close();
    }

    const aggregateResponse = await fetch(new URL(
      `/api/local-console/sessions/${encodeURIComponent(parent.sessionId)}/children`,
      started.url,
    ));
    expect(aggregateResponse.status).toBe(200);
    await expect(aggregateResponse.json()).resolves.toEqual({
      childSessions: [
        expect.objectContaining({ sessionId: "child-running", title: "落地页文案", memberName: "开发", statusLabel: "进行中" }),
        expect.objectContaining({ sessionId: "child-failed", title: "空状态验收", memberName: "测试", statusLabel: "没跑起来" }),
        expect.objectContaining({ sessionId: "child-missing", title: "子任务不可用", memberName: "成员未知", statusLabel: "不可用" }),
      ],
    });

    const stateResponse = await fetch(new URL(
      "/api/local-console/state?projectId=local&sessionId=child-running",
      started.url,
    ));
    await expect(stateResponse.json()).resolves.toMatchObject({
      selectedSessionId: "child-running",
      selectedSession: { sessionId: "child-running", parentSessionId: parent.sessionId },
    });

    const fallbackResponse = await fetch(new URL(
      "/api/local-console/state?projectId=local&sessionId=missing-session",
      started.url,
    ));
    await expect(fallbackResponse.json()).resolves.toMatchObject({
      selectedSessionId: parent.sessionId,
      selectedSession: { sessionId: parent.sessionId, parentSessionId: null },
    });
  });

  it("never selects a hidden child as the sidebar fallback when its parent is archived through HTTP", async () => {
    const started = await startFixtureServer();
    const fallback = await createSession(started, "保留在侧边栏");
    const parent = await createSession(started, "准备归档");
    await createChild(started, parent.sessionId, "hidden-child", "内部子任务", "dev");

    const response = await fetch(new URL(
      `/api/local-console/sessions/${encodeURIComponent(parent.sessionId)}/archive`,
      started.url,
    ), { method: "POST" });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      sessionId: parent.sessionId,
      selectedSessionId: fallback.sessionId,
    });
  });

  it("copies the parent's effective team snapshot to children and preserves the unbound fallback contract through HTTP", async () => {
    const started = await startFixtureServer();
    const boundResponse = await fetch(new URL("/api/local-console/sessions", started.url), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        projectId: "local",
        title: "绑定团队父会话",
        agentTeamOwnership: "user",
        agentTeamId: "team-a",
      }),
    });
    expect(boundResponse.status).toBe(201);
    const boundParent = await boundResponse.json() as { session: { sessionId: string } };
    await createChild(started, boundParent.session.sessionId, "bound-child", "继承快照", "dev");

    const unboundParent = await createSession(started, "未绑定存量父会话");
    await createChild(started, unboundParent.sessionId, "unbound-child", "共享名单兼容", "dev");

    const database = new DatabaseSync(started.sqlitePath, { readOnly: true });
    try {
      expect(database.prepare(
        "SELECT agent_team_ownership, agent_team_id FROM sessions WHERE session_id = ?",
      ).get("bound-child")).toEqual({ agent_team_ownership: "user", agent_team_id: "team-a" });
      expect(database.prepare(
        "SELECT member_name, agent_markdown FROM session_agent_team_members WHERE session_id = ? AND slot = 'effective'",
      ).all("bound-child")).toEqual([{ member_name: "dev", agent_markdown: "# 开发\n\n选择时内容\n" }]);
      expect(database.prepare(
        "SELECT agent_team_ownership, agent_team_id FROM sessions WHERE session_id = ?",
      ).get("unbound-child")).toEqual({ agent_team_ownership: null, agent_team_id: null });
      expect(database.prepare(
        "SELECT COUNT(*) AS count FROM session_agent_team_members WHERE session_id = ?",
      ).get("unbound-child")).toEqual({ count: 0 });
    } finally {
      database.close();
    }

    const writer = new DatabaseSync(started.sqlitePath);
    try {
      writer.prepare(
        `UPDATE session_agent_team_members
         SET member_name = 'replacement', agent_markdown = '# 替换团队\n\n父会话后续改选\n'
         WHERE session_id = ? AND slot = 'effective'`,
      ).run(boundParent.session.sessionId);
    } finally {
      writer.close();
    }
    const childViewResponse = await fetch(new URL(
      "/api/local-console/sessions/bound-child/view",
      started.url,
    ));
    expect(childViewResponse.status).toBe(200);
    await expect(childViewResponse.json()).resolves.toMatchObject({
      session: { sessionId: "bound-child", parentSessionId: boundParent.session.sessionId },
      memberIdentities: [{ slug: "dev", displayName: "开发" }],
    });
  });
});

function source(overrides: Partial<ChildSessionSummarySource>): ChildSessionSummarySource {
  return {
    sessionId: "child",
    title: "任务",
    parentSessionId: "parent",
    status: "waiting",
    unresolvedSystemEventKind: null,
    latestAgentRole: null,
    initialBody: "Initial handoff:\n@dev-manager 请推进",
    agentTeamSnapshot: null,
    chainValid: true,
    ...overrides,
  };
}

async function startFixtureServer(): Promise<StartedLocalConsoleServer> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "moebius-child-summary-"));
  roots.push(root);
  const started = await startLocalConsoleServer({
    projectRoot: root,
    port: 0,
    storeTimeoutMs: 2_000,
    loadAgentTeamSnapshot: async () => ({
      members: [{ name: "dev", agentMarkdown: "# 开发\n\n选择时内容\n" }],
    }),
    runCodex: vi.fn(async (options: CodexRunOptions): Promise<CodexRunResult> => ({
      ok: true,
      finalText: "完成\n\n<!-- moebius:stage=in-progress -->",
      threadId: null,
      cachedInputTokens: null,
      runDir: options.runDir,
      stdoutPath: path.join(options.runDir, "stdout.jsonl"),
      stderrPath: path.join(options.runDir, "stderr.log"),
    })),
  });
  servers.push(started);
  return started;
}

async function createSession(started: StartedLocalConsoleServer, title: string) {
  return await started.runtime.createSession(title);
}

async function createChild(
  started: StartedLocalConsoleServer,
  parentSessionId: string,
  childSessionId: string,
  title: string,
  role: string,
): Promise<void> {
  const response = await fetch(new URL("/api/local-console/child-sessions", started.url), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      parentSessionId,
      childSessionId,
      projectId: "local",
      title,
      hiddenKey: `key:${childSessionId}`,
      initialRole: role,
      initialBody: `Initial handoff:\n@${role} 请推进`,
    }),
  });
  expect(response.status).toBe(201);
}
