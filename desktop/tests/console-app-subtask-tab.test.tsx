/** @vitest-environment jsdom */

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { App } from "../src/console-page/app.js";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe("desktop App subtask tab wiring", () => {
  let root: Root;
  let host: HTMLDivElement;
  const requests: Array<{ path: string; method: string; body: unknown }> = [];

  beforeEach(() => {
    requests.length = 0;
    window.localStorage.clear();
    window.localStorage.setItem(
      "moebius.console.selection",
      JSON.stringify({ projectId: "local", sessionId: "parent-a" }),
    );
    window.history.replaceState({}, "", "/?api=http://127.0.0.1:8787/");
    Object.defineProperty(window, "innerWidth", { configurable: true, value: 1_200 });
    Object.defineProperty(window, "moebius", {
      configurable: true,
      value: {
        getLocalConsoleAttachmentCapability: async () => null,
        listAgentTeams: async () => ({ status: "configuration-error" }),
      },
    });
    vi.stubGlobal("fetch", vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = input instanceof URL
        ? input
        : new URL(typeof input === "string" ? input : input.url);
      const method = init?.method ?? "GET";
      const body = typeof init?.body === "string" ? JSON.parse(init.body) as unknown : null;
      requests.push({ path: url.pathname, method, body });

      if (url.pathname === "/api/local-console/state") {
        return jsonResponse(parentState);
      }
      if (url.pathname === "/api/local-console/sessions/child-a/view") {
        return jsonResponse(childView);
      }
      if (url.pathname === "/api/local-console/sessions/child-a/messages") {
        return jsonResponse({ accepted: true }, 202);
      }
      if (url.pathname === "/api/local-console/sessions/child-a/runs/child-failed-run/retry") {
        return jsonResponse({ accepted: true }, 202);
      }
      if (url.pathname === "/api/local-console/sessions/child-a/interrupt") {
        return jsonResponse({ interrupted: true }, 202);
      }
      return jsonResponse({ error: `unexpected request: ${url.pathname}` }, 404);
    }));

    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    host.remove();
    vi.unstubAllGlobals();
  });

  it("opens from the parent card and advances only the corresponding child session", async () => {
    await act(async () => root.render(<App />));
    const childRow = await findElement<HTMLButtonElement>('[data-testid="sub-session-card-row"][data-session-id="child-a"]');

    await act(async () => childRow.click());
    const subtask = await findElement<HTMLElement>('[data-testid="subtask-tab"][data-session-id="child-a"]');
    expect(subtask.textContent).toContain("空状态验收");
    expect(subtask.textContent).toContain("测试");
    expect(subtask.textContent).toContain("没跑起来");
    expect(subtask.textContent).toContain("正在核对空状态的验收语句");
    expect(childRow.getAttribute("aria-pressed")).toBe("true");

    const input = subtask.querySelector<HTMLTextAreaElement>('textarea[aria-label="消息内容"]');
    expect(input).not.toBeNull();
    await act(async () => {
      setInputValue(input!, "@qa 请继续验收");
    });
    const send = subtask.querySelector<HTMLButtonElement>('button[aria-label="发送消息"]');
    expect(send?.disabled).toBe(false);
    await act(async () => send!.click());
    await waitFor(() => requests.some((request) =>
      request.path === "/api/local-console/sessions/child-a/messages"
      && (request.body as { body?: string }).body === "@qa 请继续验收"));

    const retry = Array.from(subtask.querySelectorAll("button")).find((button) => button.textContent === "重试");
    expect(retry).toBeDefined();
    await act(async () => retry!.click());
    await waitFor(() => requests.some((request) =>
      request.path === "/api/local-console/sessions/child-a/runs/child-failed-run/retry"
      && request.method === "POST"));

    const stop = await findElement<HTMLButtonElement>(
      '[data-testid="subtask-tab"] button[aria-label="停下当前这一步"]',
    );
    await act(async () => stop.click());
    await waitFor(() => requests.some((request) =>
      request.path === "/api/local-console/sessions/child-a/interrupt"
      && (request.body as { runId?: string }).runId === "child-run"));

    expect(requests.some((request) =>
      request.method === "POST"
      && (
        request.path === "/api/local-console/sessions/parent-a/messages"
        || request.path === "/api/local-console/sessions/parent-a/interrupt"
      ))).toBe(false);
    expect(subtask.textContent).not.toMatch(/行级对比|文件树|提交|推送|切分支|新建子任务|重命名子任务|删除子任务/u);

    const interruptCount = requests.filter((request) => request.path.endsWith("/interrupt")).length;
    const close = host.querySelector<HTMLButtonElement>('button[aria-label="关闭标签：空状态验收"]');
    expect(close).not.toBeNull();
    await act(async () => close!.click());
    expect(host.querySelector('[data-testid="subtask-tab"]')).toBeNull();
    expect(childRow.getAttribute("aria-pressed")).toBe("false");
    expect(requests.filter((request) => request.path.endsWith("/interrupt"))).toHaveLength(interruptCount);
  });
});

function setInputValue(input: HTMLTextAreaElement, value: string): void {
  const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set;
  setter?.call(input, value);
  input.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: value }));
}

async function findElement<T extends Element>(selector: string): Promise<T> {
  let found: T | null = null;
  await waitFor(() => {
    found = document.querySelector<T>(selector);
    return found !== null;
  });
  return found!;
}

async function waitFor(predicate: () => boolean, timeoutMs = 2_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() >= deadline) {
      throw new Error(`timed out waiting for desktop App state: ${document.body.textContent ?? ""}`);
    }
    await act(async () => {
      await new Promise((resolve) => window.setTimeout(resolve, 10));
    });
  }
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

const parentSession = {
  sessionId: "parent-a",
  projectId: "local",
  parentSessionId: null,
  agentTeamOwnership: null,
  agentTeamId: null,
  agentTeamHealth: null,
  agentTeamHealthReason: null,
  workspaceMode: "worktree",
  workspacePendingMode: null,
  workspaceUnavailableReason: null,
  branchName: "agent/parent-a",
  title: "主会话",
  status: "idle",
  awaitsHumanReason: null,
  unreadSince: null,
  unresolvedSystemEventKind: null,
  lastMessageMentionsAgent: false,
  hasPendingControlWork: false,
  runningCount: 0,
  waitingCount: 0,
  stuckCount: 0,
  errorCount: 0,
  interruptedCount: 0,
  childCount: 1,
  createdAt: "2026-07-23T00:00:00.000Z",
  updatedAt: "2026-07-23T00:00:01.000Z",
};

const childSession = {
  ...parentSession,
  sessionId: "child-a",
  parentSessionId: "parent-a",
  title: "空状态验收",
  status: "running",
  runningCount: 1,
};

const project = {
  projectId: "local",
  sourceType: "local-folder",
  title: "moebius",
  folderPath: "/tmp/moebius",
  worktreeMode: true,
  workspaceCwd: "/tmp/worktree",
  workspaceMode: "worktree",
  worktreePath: "/tmp/worktree",
  worktreeUnavailableReason: null,
  workspaceUpdatedAt: "2026-07-23T00:00:00.000Z",
  branchName: "agent/parent-a",
  isGitRepository: true,
  directoryAvailable: true,
  directoryUnavailableReason: null,
  sessions: [parentSession, childSession],
  runningCount: 1,
  waitingCount: 0,
  stuckCount: 0,
  errorCount: 0,
};

const parentState = {
  projects: [project],
  project,
  selectedProjectId: "local",
  selectedSessionId: "parent-a",
  selectedSession: parentSession,
  messages: [{
    id: 1,
    sessionId: "parent-a",
    speaker: "system",
    role: null,
    body: JSON.stringify({ version: 1, childSessionIds: ["child-a"] }),
    status: "completed",
    runId: null,
    runDir: null,
    error: null,
    sourceKind: "local-child-session-card",
    sourceId: null,
    createdAt: "2026-07-23T00:00:00.000Z",
    updatedAt: "2026-07-23T00:00:00.000Z",
  }],
  childSessions: [{
    sessionId: "child-a",
    title: "空状态验收",
    memberName: "测试",
    status: "not-started",
    statusLabel: "没跑起来",
  }],
  activeRun: null,
  workspaceDiff: { available: true, fileCount: 0, reason: null },
  sqlitePath: "/tmp/local-console.sqlite",
  lastError: null,
};

const childView = {
  session: childSession,
  messages: [{
    id: 2,
    sessionId: "child-a",
    speaker: "agent",
    role: "qa",
    body: "正在核对空状态的验收语句…",
    status: "completed",
    runId: "child-failed-run",
    runDir: null,
    error: null,
    sourceKind: null,
    sourceId: null,
    createdAt: "2026-07-23T00:00:00.000Z",
    updatedAt: "2026-07-23T00:00:00.000Z",
  }, {
    id: 3,
    sessionId: "child-a",
    speaker: "system",
    role: "qa",
    body: "退出码 1",
    status: "failed",
    runId: "child-failed-run",
    runDir: null,
    error: "退出码 1",
    systemEventKind: "run-not-started",
    sourceKind: null,
    sourceId: null,
    createdAt: "2026-07-23T00:00:01.000Z",
    updatedAt: "2026-07-23T00:00:01.000Z",
  }],
  activeRun: {
    sessionId: "child-a",
    runId: "child-run",
    role: "qa",
    status: "running",
    startedAt: "2026-07-23T00:00:00.000Z",
    elapsedMs: 1_000,
    runDir: null,
    cwd: null,
    workspaceMode: "worktree",
    worktreeUnavailableReason: null,
    stdoutTail: "running",
    stderrTail: null,
    liveMarkdown: "正在继续核对…",
    lastOutputSummary: "正在继续核对…",
    tailDiagnostic: null,
    interruptible: true,
  },
};
