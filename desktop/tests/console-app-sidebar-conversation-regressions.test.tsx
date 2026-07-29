/** @vitest-environment jsdom */

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { App } from "../src/console-page/app.js";
import { sidebarPresentationRoute, createConsolePresentationRouteStore } from "../src/console-page/presentation-route.js";
import {
  conversationDraftTabSourceKey,
  conversationTabSourceKey,
  createRightSidebarTabsStore,
} from "../src/console-page/right-sidebar-tabs-store.js";
import {
  createSidebarConversationDraft,
  createSidebarConversationDraftStore,
} from "../src/console-page/sidebar-conversation-drafts.js";
import { writeRightSidebarVisibilityPreference } from "../src/console-page/right-sidebar-preference.js";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe("desktop App sidebar conversation regressions", () => {
  let root: Root;
  let host: HTMLDivElement;
  let sessions: ReturnType<typeof createSession>[];
  let archivedSessionIds: Set<string>;

  beforeEach(() => {
    sessions = [createSession("source-a", "来源会话")];
    archivedSessionIds = new Set();
    window.localStorage.clear();
    window.localStorage.setItem(
      "moebius.console.selection",
      JSON.stringify({ projectId: "local", sessionId: "source-a" }),
    );
    writeRightSidebarVisibilityPreference(window.localStorage, "open");
    window.history.replaceState({}, "", "/?api=http://127.0.0.1:8787/");
    Object.defineProperty(window, "innerWidth", { configurable: true, value: 1_280 });
    Object.defineProperty(window, "moebius", {
      configurable: true,
      value: {
        getLocalConsoleAttachmentCapability: async () => null,
        listAgentTeams: async () => ({ status: "ready", teams: [generalAssistantTeam] }),
        readLastUsedAgentTeam: async () => ({ ownership: "system", teamId: "general-assistant" }),
        recordSuccessfulConversationAgentTeam: async () => undefined,
      },
    });
    vi.stubGlobal("fetch", vi.fn(function (
      this: unknown,
      input: string | URL | Request,
      init?: RequestInit,
    ) {
      if (this !== undefined && this !== globalThis) {
        throw new TypeError("Illegal invocation");
      }
      const url = input instanceof URL
        ? input
        : new URL(typeof input === "string" ? input : input.url);
      if (url.pathname === "/api/local-console/state") {
        return Promise.resolve(jsonResponse(createState()));
      }
      if (url.pathname === "/api/local-console/sessions" && init?.method === "POST") {
        const created = createSession(
          "analysis-created",
          "分析 Agent 运行耗时",
          "source-a",
        );
        sessions.push(created);
        return Promise.resolve(jsonResponse({ session: created }, 201));
      }
      if (url.pathname.endsWith("/view")) {
        const sessionId = decodeURIComponent(
          url.pathname.slice("/api/local-console/sessions/".length, -"/view".length),
        );
        const session = sessions.find((candidate) => candidate.sessionId === sessionId);
        return Promise.resolve(session === undefined
          ? jsonResponse({ error: "missing session" }, 404)
          : jsonResponse(createSessionView(session)));
      }
      const archiveMatch = /^\/api\/local-console\/sessions\/(.+)\/archive$/u.exec(url.pathname);
      if (archiveMatch !== null && init?.method === "POST") {
        const sessionId = decodeURIComponent(archiveMatch[1]!);
        archivedSessionIds.add(sessionId);
        return Promise.resolve(jsonResponse({
          sessionId,
          projectId: "local",
          selectedSessionId: "source-a",
        }));
      }
      return Promise.resolve(jsonResponse({ error: `unexpected request: ${url.pathname}` }, 404));
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

  it("uses the native fetch receiver and persists the generated title after first send", async () => {
    const draft = {
      ...createSidebarConversationDraft({
        draftId: "draft-a",
        hostSessionId: "source-a",
        originSessionId: "source-a",
        entryTemplate: "session-analysis",
        context: {
          projectId: "local",
          workspaceMode: "worktree" as const,
          teamKey: "system:general-assistant",
        },
        now: "2026-07-29T00:00:00.000Z",
      }),
      body: "分析 Agent 运行耗时",
    };
    createSidebarConversationDraftStore(window.localStorage).write(draft);
    createRightSidebarTabsStore(window.localStorage).write("source-a", {
      tabs: [{
        id: "draft-tab",
        type: "conversation",
        title: "新会话",
        sourceKey: conversationDraftTabSourceKey(draft.draftId),
        closable: true,
      }],
      activeTabId: "draft-tab",
    });

    await act(async () => root.render(<App />));
    const draftRegion = await findElement<HTMLElement>('section[aria-label="新建对话"]');
    const send = draftRegion.querySelector<HTMLButtonElement>('button[aria-label="发送消息"]');
    await waitFor(() => send?.disabled === false);
    await act(async () => send!.click());

    await findElement<HTMLElement>('[role="tab"]', (element) =>
      element.textContent?.trim() === "分析 Agent 运行耗时");
    expect(createRightSidebarTabsStore(window.localStorage).read("source-a")).toMatchObject({
      tabs: [{
        title: "分析 Agent 运行耗时",
        sourceKey: conversationTabSourceKey("analysis-created"),
      }],
      activeTabId: "draft-tab",
    });
  });

  it("removes an archived non-current sidebar tab from the live DOM without disturbing its sibling", async () => {
    sessions = [
      createSession("source-a", "来源会话"),
      createSession("analysis-a", "待归档分析", "source-a"),
      createSession("analysis-b", "保留分析", "source-a"),
    ];
    createConsolePresentationRouteStore(window.localStorage).write(sidebarPresentationRoute({
      sidebarProjectId: "local",
      sidebarSessionId: "analysis-b",
      originSessionId: "source-a",
      originAvailable: true,
    }));
    createRightSidebarTabsStore(window.localStorage).write("source-a", {
      tabs: [
        {
          id: "analysis-a-tab",
          type: "conversation",
          title: "待归档分析",
          sourceKey: conversationTabSourceKey("analysis-a"),
          closable: true,
        },
        {
          id: "analysis-b-tab",
          type: "conversation",
          title: "保留分析",
          sourceKey: conversationTabSourceKey("analysis-b"),
          closable: true,
        },
      ],
      activeTabId: "analysis-b-tab",
    });

    await act(async () => root.render(<App />));
    await findElement<HTMLElement>('[role="tab"][aria-selected="true"]', (element) =>
      element.textContent?.trim() === "保留分析");
    const archivedRow = await findElement<HTMLButtonElement>(
      '[data-testid="conversation-sidebar-session"][data-session-id="analysis-a"]',
    );
    await act(async () => {
      archivedRow.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true }));
    });
    const archive = await findElement<HTMLElement>('[role="menuitem"]', (element) =>
      element.textContent?.trim() === "归档");
    await act(async () => archive.click());

    await waitFor(() => host.querySelector('[role="tab"]')?.textContent?.trim() === "保留分析"
      && host.querySelectorAll('[role="tab"]').length === 1);
    expect(host.textContent).not.toContain("待归档分析");
    expect(host.querySelector('[role="tab"][aria-selected="true"]')?.textContent).toContain("保留分析");
    expect(createRightSidebarTabsStore(window.localStorage).read("source-a")).toMatchObject({
      tabs: [{ id: "analysis-b-tab", title: "保留分析" }],
      activeTabId: "analysis-b-tab",
    });
  });

  function createState() {
    const visibleSessions = sessions.filter((session) => !archivedSessionIds.has(session.sessionId));
    const source = visibleSessions.find((session) => session.sessionId === "source-a") ?? visibleSessions[0] ?? null;
    const project = {
      projectId: "local",
      sourceType: "local-folder",
      title: "Moebius",
      folderPath: "/tmp/moebius",
      worktreeMode: true,
      workspaceCwd: "/tmp/moebius-worktree",
      workspaceMode: "worktree",
      worktreePath: "/tmp/moebius-worktree",
      worktreeUnavailableReason: null,
      workspaceUpdatedAt: "2026-07-29T00:00:00.000Z",
      branchName: "feature/sidebar-chat",
      isGitRepository: true,
      directoryAvailable: true,
      directoryUnavailableReason: null,
      sessions: visibleSessions,
      runningCount: 0,
      waitingCount: 0,
      stuckCount: 0,
      errorCount: 0,
    };
    return {
      projects: [project],
      project,
      selectedProjectId: "local",
      selectedSessionId: source?.sessionId ?? "source-a",
      selectedSession: source,
      messages: [],
      childSessions: [],
      activeRun: null,
      workspaceDiff: { available: true, fileCount: 0, reason: null },
      sqlitePath: "/tmp/local-console.sqlite",
      lastError: null,
    };
  }
});

function createSession(sessionId: string, title: string, originSessionId: string | null = null) {
  return {
    sessionId,
    projectId: "local",
    parentSessionId: null,
    originSessionId,
    entryTemplate: originSessionId === null ? null : "session-analysis",
    writePolicy: originSessionId === null ? "normal" : "confirm-current-plan-before-write",
    proposalVersion: null,
    writeLeaseVersion: null,
    agentTeamOwnership: "system",
    agentTeamId: "general-assistant",
    agentTeamHealth: "usable",
    agentTeamHealthReason: null,
    workspaceMode: "worktree",
    workspacePendingMode: null,
    workspaceUnavailableReason: null,
    branchName: "feature/sidebar-chat",
    title,
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
    childCount: 0,
    createdAt: "2026-07-29T00:00:00.000Z",
    updatedAt: "2026-07-29T00:00:00.000Z",
  };
}

function createSessionView(session: ReturnType<typeof createSession>) {
  return {
    session,
    messages: [],
    childSessions: [],
    activeRun: null,
    workspaceDiff: { available: true, fileCount: 0, reason: null },
  };
}

const generalAssistantTeam = {
  id: "general-assistant",
  ownership: "system",
  definition: {
    name: "通用助手",
    description: "用于通用对话",
    primaryAgentSlug: "assistant",
    memberOrder: ["assistant"],
  },
  members: [{
    slug: "assistant",
    displayName: "通用助手",
    description: "处理一般对话与任务",
    available: true,
  }],
  status: "usable",
  canCreateConversation: true,
  issues: [],
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

async function findElement<T extends Element>(
  selector: string,
  predicate: (element: T) => boolean = () => true,
): Promise<T> {
  let found: T | undefined;
  await waitFor(() => {
    found = [...document.querySelectorAll<T>(selector)].find(predicate);
    return found !== undefined;
  });
  return found!;
}

async function waitFor(predicate: () => boolean, timeoutMs = 3_000): Promise<void> {
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
