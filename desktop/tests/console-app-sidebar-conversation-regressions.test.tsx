/** @vitest-environment jsdom */

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { waitForCondition } from "../../src/testing/wait.js";
import { App } from "../src/console-page/app.js";
import {
  ordinaryPresentationRoute,
  sidebarPresentationRoute,
  createConsolePresentationRouteStore,
} from "../src/console-page/presentation-route.js";
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
  let referenceFailure: boolean;
  let referenceResponsePromise: Promise<Response> | null;
  let referenceUrls: URL[];
  let timelineMessages: Array<Record<string, unknown>>;
  let projectDirectoryAvailable: boolean;
  let includeAvailableAlternativeProject: boolean;
  let stateRequestCount: number;
  let ordinaryCreateFailure: boolean;
  let preferenceRecordFailure: boolean;
  let preferenceRecordAttemptCount: number;
  let pinRequestCount: number;

  beforeEach(() => {
    sessions = [createSession("source-a", "来源会话")];
    archivedSessionIds = new Set();
    referenceFailure = false;
    referenceResponsePromise = null;
    referenceUrls = [];
    timelineMessages = [];
    projectDirectoryAvailable = true;
    includeAvailableAlternativeProject = false;
    stateRequestCount = 0;
    ordinaryCreateFailure = false;
    preferenceRecordFailure = false;
    preferenceRecordAttemptCount = 0;
    pinRequestCount = 0;
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
        recordSuccessfulConversationAgentTeam: async () => {
          preferenceRecordAttemptCount += 1;
          if (preferenceRecordFailure) {
            throw new Error("preference unavailable");
          }
        },
      },
    });
    vi.stubGlobal("CSS", { escape: (value: string) => value });
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
        stateRequestCount += 1;
        return Promise.resolve(jsonResponse(createState(url.searchParams.get("sessionId") ?? "source-a")));
      }
      if (url.pathname.endsWith("/reference-text")) {
        referenceUrls.push(url);
        if (referenceResponsePromise !== null) {
          return referenceResponsePromise;
        }
        return Promise.resolve(referenceFailure
          ? jsonResponse({ error: "reference unavailable" }, 500)
          : jsonResponse({
              fragment: {
                id: `fragment-${referenceUrls.length}`,
                label: "文本片段",
                text: `Moebius 会话记录：/tmp/${url.pathname.includes("source-b") ? "source-b" : "source-a"}.jsonl`,
              },
            }));
      }
      if (url.pathname === "/api/local-console/sessions" && init?.method === "POST") {
        const request = JSON.parse(String(init.body)) as { attachmentDraftKey?: unknown };
        const sidebarConversation = typeof request.attachmentDraftKey === "string";
        if (!sidebarConversation && ordinaryCreateFailure) {
          return Promise.resolve(jsonResponse({ error: "create rejected" }, 500));
        }
        const created = sidebarConversation
          ? createSession("analysis-created", "分析 Agent 运行耗时", "source-a")
          : createSession("created-b", "新会话 B");
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
      const pinMatch = /^\/api\/local-console\/sessions\/(.+)\/pin$/u.exec(url.pathname);
      if (pinMatch !== null && init?.method === "POST") {
        const sessionId = decodeURIComponent(pinMatch[1]!);
        const request = JSON.parse(String(init.body)) as { pinned?: unknown };
        const sessionIndex = sessions.findIndex((candidate) => candidate.sessionId === sessionId);
        const session = sessions[sessionIndex];
        if (session === undefined || typeof request.pinned !== "boolean") {
          return Promise.resolve(jsonResponse({ error: "invalid pin request" }, 400));
        }
        const updated = {
          ...session,
          pinnedAt: request.pinned ? "2026-07-31T00:00:00.000Z" : null,
        };
        sessions[sessionIndex] = updated;
        pinRequestCount += 1;
        return Promise.resolve(jsonResponse({ session: updated }));
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

  it("keeps the newly created ordinary conversation aligned across main content, sidebar, refresh, and reload", async () => {
    createConsolePresentationRouteStore(window.localStorage).write(ordinaryPresentationRoute({
      projectId: "local",
      sessionId: "source-a",
    }));

    await act(async () => root.render(<App />));
    await submitGlobalConversation("新会话 B");

    await waitFor(() => host.querySelector("main h1")?.textContent === "新会话 B");
    expectSelectedMainConversation("created-b", "新会话 B");
    expect(createConsolePresentationRouteStore(window.localStorage).read())
      .toEqual(ordinaryPresentationRoute({ projectId: "local", sessionId: "created-b" }));
    expect(window.localStorage.getItem("moebius.console.selection")).toBe(JSON.stringify({
      projectId: "local",
      sessionId: "created-b",
    }));

    const requestsAfterCreation = stateRequestCount;
    await waitFor(() => stateRequestCount > requestsAfterCreation, 2_000);
    expectSelectedMainConversation("created-b", "新会话 B");

    await act(async () => root.unmount());
    root = createRoot(host);
    await act(async () => root.render(<App />));
    await waitFor(() => host.querySelector("main h1")?.textContent === "新会话 B");
    expectSelectedMainConversation("created-b", "新会话 B");

    const sourceRow = await findElement<HTMLButtonElement>(
      '[data-testid="conversation-sidebar-session"][data-session-id="source-a"]',
    );
    await act(async () => sourceRow.click());
    await waitFor(() => host.querySelector("main h1")?.textContent === "来源会话");
    expectSelectedMainConversation("source-a", "来源会话");

    const createdRow = await findElement<HTMLButtonElement>(
      '[data-testid="conversation-sidebar-session"][data-session-id="created-b"]',
    );
    await act(async () => createdRow.click());
    await waitFor(() => host.querySelector("main h1")?.textContent === "新会话 B");
    expectSelectedMainConversation("created-b", "新会话 B");
  });

  it("keeps the previous route and draft when ordinary conversation creation fails", async () => {
    ordinaryCreateFailure = true;
    createConsolePresentationRouteStore(window.localStorage).write(ordinaryPresentationRoute({
      projectId: "local",
      sessionId: "source-a",
    }));

    await act(async () => root.render(<App />));
    const draftRegion = await submitGlobalConversation("保留失败草稿");
    await waitFor(() => draftRegion.textContent?.includes("创建失败，请检查当前项目和 Agent 团队后重试。") === true);

    expect(draftRegion.querySelector<HTMLTextAreaElement>('textarea[aria-label="消息内容"]')?.value)
      .toBe("保留失败草稿");
    expect(createConsolePresentationRouteStore(window.localStorage).read())
      .toEqual(ordinaryPresentationRoute({ projectId: "local", sessionId: "source-a" }));
    expect(window.localStorage.getItem("moebius.console.selection")).toBe(JSON.stringify({
      projectId: "local",
      sessionId: "source-a",
    }));
  });

  it("pins a conversation from its context menu through receiver-safe browser fetch", async () => {
    await act(async () => root.render(<App />));
    const sourceRow = await findElement<HTMLButtonElement>(
      '[data-testid="conversation-sidebar-session"][data-session-id="source-a"]',
    );

    await act(async () => {
      sourceRow.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true }));
    });
    const pin = await findElement<HTMLElement>('[role="menuitem"]', (element) =>
      element.textContent?.trim() === "置顶");
    await act(async () => pin.click());

    await waitFor(() => pinRequestCount === 1 && host.querySelector(
      '[aria-label="置顶"] [data-session-id="source-a"]',
    ) !== null);
    expect(host.textContent).not.toContain("Illegal invocation");
  });

  it("selects the created conversation even when recording the team preference fails", async () => {
    preferenceRecordFailure = true;
    createConsolePresentationRouteStore(window.localStorage).write(ordinaryPresentationRoute({
      projectId: "local",
      sessionId: "source-a",
    }));

    await act(async () => root.render(<App />));
    await submitGlobalConversation("新会话 B");

    await waitFor(() => host.querySelector("main h1")?.textContent === "新会话 B");
    expectSelectedMainConversation("created-b", "新会话 B");
    expect(preferenceRecordAttemptCount).toBe(1);
    expect(createConsolePresentationRouteStore(window.localStorage).read())
      .toEqual(ordinaryPresentationRoute({ projectId: "local", sessionId: "created-b" }));
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

  it("projects canonical session titles and hides unresolved stored titles", async () => {
    createRightSidebarTabsStore(window.localStorage).write("source-a", {
      tabs: [
        {
          id: "canonical-tab",
          type: "conversation",
          title: "陈旧标题",
          sourceKey: conversationTabSourceKey("source-a"),
          closable: true,
        },
        {
          id: "unresolved-tab",
          type: "conversation",
          title: "不得回显的旧标题",
          sourceKey: conversationTabSourceKey("missing-session"),
          closable: true,
        },
      ],
      activeTabId: "canonical-tab",
    });

    await act(async () => root.render(<App />));

    await findElement<HTMLElement>('[role="tab"]', (element) =>
      element.textContent?.includes("来源会话") === true);
    await findElement<HTMLElement>('[role="tab"]', (element) =>
      element.textContent?.includes("标题更新中") === true);
    expect(host.textContent).not.toContain("陈旧标题");
    expect(host.textContent).not.toContain("不得回显的旧标题");
  });

  it("keeps same-title sessions unique when project, branch, and creation minute all match", async () => {
    sessions = [
      createSession("source-a", "同名会话"),
      createSession("source-b", "同名会话"),
    ];
    createRightSidebarTabsStore(window.localStorage).write("source-a", {
      tabs: [
        {
          id: "same-a",
          type: "conversation",
          title: "同名会话",
          sourceKey: conversationTabSourceKey("source-a"),
          closable: true,
        },
        {
          id: "same-b",
          type: "conversation",
          title: "同名会话",
          sourceKey: conversationTabSourceKey("source-b"),
          closable: true,
        },
      ],
      activeTabId: "same-a",
    });

    await act(async () => root.render(<App />));

    const first = await findElement<HTMLElement>('[role="tab"]', (element) =>
      element.getAttribute("aria-label")?.includes("同刻第 1 个") === true);
    const second = await findElement<HTMLElement>('[role="tab"]', (element) =>
      element.getAttribute("aria-label")?.includes("同刻第 2 个") === true);
    expect(first.getAttribute("aria-label")).not.toBe(second.getAttribute("aria-label"));
    expect(first.textContent).toContain("同刻第 1 个");
    expect(second.textContent).toContain("同刻第 2 个");
  });

  it("keeps multiple unresolved titles unique and exposes a manual retry", async () => {
    createRightSidebarTabsStore(window.localStorage).write("source-a", {
      tabs: [
        {
          id: "missing-a",
          type: "conversation",
          title: "旧标题 A",
          sourceKey: conversationTabSourceKey("missing-a"),
          closable: true,
        },
        {
          id: "missing-b",
          type: "conversation",
          title: "旧标题 B",
          sourceKey: conversationTabSourceKey("missing-b"),
          closable: true,
        },
      ],
      activeTabId: "missing-a",
    });

    await act(async () => root.render(<App />));

    const first = await findElement<HTMLElement>('[role="tab"]', (element) =>
      element.getAttribute("aria-label")?.includes("会话 · 同刻第 1 个") === true);
    const second = await findElement<HTMLElement>('[role="tab"]', (element) =>
      element.getAttribute("aria-label")?.includes("会话 · 同刻第 2 个") === true);
    expect(first.getAttribute("aria-label")).not.toBe(second.getAttribute("aria-label"));
    expect(host.textContent).toContain("会话名称已保存，标签标题正在重试");
    const retry = await findElement<HTMLButtonElement>("button", (element) =>
      element.textContent?.trim() === "重试标题");
    sessions.push(
      createSession("missing-a", "恢复后的标题 A"),
      createSession("missing-b", "恢复后的标题 B"),
    );
    await act(async () => retry.click());
    await findElement<HTMLElement>('[role="tab"]', (element) =>
      element.textContent?.includes("恢复后的标题 A") === true);
    await findElement<HTMLElement>('[role="tab"]', (element) =>
      element.textContent?.includes("恢复后的标题 B") === true);
    expect(host.textContent).not.toContain("旧标题 A");
    expect(host.textContent).not.toContain("旧标题 B");
    expect(host.textContent).not.toContain("会话名称已保存，标签标题正在重试");
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

  it("atomically selects a non-current conversation and opens its conversation-scoped analysis draft", async () => {
    sessions = [
      createSession("source-a", "来源会话 A"),
      createSession("source-b", "来源会话 B"),
    ];

    await act(async () => root.render(<App />));
    const targetRow = await findElement<HTMLButtonElement>(
      '[data-testid="conversation-sidebar-session"][data-session-id="source-b"]',
    );
    await act(async () => {
      targetRow.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true }));
    });
    const analyze = await findElement<HTMLElement>('[role="menuitem"]', (element) =>
      element.textContent?.trim() === "在右侧栏分析这段对话");
    await act(async () => analyze.click());

    await findElement<HTMLElement>('[aria-label^="文本片段 1："]');
    const selected = await findElement<HTMLButtonElement>(
      '[data-testid="conversation-sidebar-session"][aria-current="page"]',
    );
    expect(selected.dataset.sessionId).toBe("source-b");
    expect(host.querySelector('main h1')?.textContent).toBe("来源会话 B");
    expect(host.querySelector('[aria-label^="文本片段 1："]')?.getAttribute("aria-label"))
      .toContain("Moebius 会话记录：/tmp/source-b.jsonl");
    expect(referenceUrls).toHaveLength(1);
    expect(referenceUrls[0]!.searchParams.get("scope")).toBe("conversation");
    expect(referenceUrls[0]!.searchParams.has("runId")).toBe(false);
  });

  it("keeps the current source route while requesting an exact message-scoped fragment", async () => {
    timelineMessages = [{
      id: 7,
      sessionId: "source-a",
      speaker: "agent",
      role: "assistant",
      body: "请分析这一条消息。",
      status: "displayed",
      runId: "run-7",
      runDir: null,
      error: null,
      systemEventKind: "other",
      createdAt: "2026-07-29T00:00:00.000Z",
      updatedAt: "2026-07-29T00:00:01.000Z",
    }];

    await act(async () => root.render(<App />));
    const messageTarget = await findElement<HTMLElement>(
      '[data-testid="timeline-message-7"] [tabindex="0"]',
    );
    await act(async () => {
      messageTarget.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true }));
    });
    const analyze = await findElement<HTMLElement>('[role="menuitem"]', (element) =>
      element.textContent?.trim() === "在右侧栏分析这条消息");
    await act(async () => analyze.click());

    await findElement<HTMLElement>('[aria-label^="文本片段 1："]');
    expect(referenceUrls).toHaveLength(1);
    expect(referenceUrls[0]!.searchParams.get("scope")).toBe("message");
    expect(referenceUrls[0]!.searchParams.get("runId")).toBe("run-7");
    expect(host.querySelector('main h1')?.textContent).toBe("来源会话");
    expect(host.querySelector(
      '[data-testid="conversation-sidebar-session"][aria-current="page"]',
    )?.getAttribute("data-session-id")).toBe("source-a");
  });

  it("keeps the previous selection and leaves no draft when a non-current reference fails", async () => {
    sessions = [
      createSession("source-a", "来源会话 A"),
      createSession("source-b", "来源会话 B"),
    ];
    referenceFailure = true;

    await act(async () => root.render(<App />));
    const targetRow = await findElement<HTMLButtonElement>(
      '[data-testid="conversation-sidebar-session"][data-session-id="source-b"]',
    );
    await act(async () => {
      targetRow.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true }));
    });
    const analyze = await findElement<HTMLElement>('[role="menuitem"]', (element) =>
      element.textContent?.trim() === "在右侧栏分析这段对话");
    await act(async () => analyze.click());

    await waitFor(() => host.textContent?.includes("暂时无法打开分析草稿，原对话未切换，请重试") === true);
    const selected = host.querySelector<HTMLButtonElement>(
      '[data-testid="conversation-sidebar-session"][aria-current="page"]',
    );
    expect(selected?.dataset.sessionId).toBe("source-a");
    expect(host.querySelector('main h1')?.textContent).toBe("来源会话 A");
    expect(createSidebarConversationDraftStore(window.localStorage).list()).toEqual([]);
    expect(createRightSidebarTabsStore(window.localStorage).read("source-b").tabs).toEqual([]);
  });

  it("shows an accessible analysis failure while preserving the global new-conversation page", async () => {
    sessions = [
      createSession("source-a", "来源会话 A"),
      createSession("source-b", "来源会话 B"),
    ];
    referenceFailure = true;

    await act(async () => root.render(<App />));
    const newConversation = await findElement<HTMLButtonElement>("button", (element) =>
      element.getAttribute("aria-label") === "新建对话");
    await act(async () => newConversation.click());
    const newConversationPage = await findElement<HTMLElement>('section[aria-label="新建对话"]');

    const targetRow = await findElement<HTMLButtonElement>(
      '[data-testid="conversation-sidebar-session"][data-session-id="source-b"]',
    );
    await act(async () => {
      targetRow.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true }));
    });
    const analyze = await findElement<HTMLElement>('[role="menuitem"]', (element) =>
      element.textContent?.trim() === "在右侧栏分析这段对话");
    await act(async () => analyze.click());

    const notice = await findElement<HTMLElement>('[role="alert"]', (element) =>
      element.textContent?.trim() === "暂时无法打开分析草稿，原对话未切换，请重试");
    expect(newConversationPage.contains(notice)).toBe(true);
    expect(host.querySelector('main h1')?.textContent).toBe("新对话");
    expect(newConversation.getAttribute("aria-current")).toBe("page");
    expect(window.localStorage.getItem("moebius.console.selection")).toBe(JSON.stringify({
      projectId: "local",
      sessionId: "source-a",
    }));
    expect(createSidebarConversationDraftStore(window.localStorage).list()).toEqual([]);
    expect(createRightSidebarTabsStore(window.localStorage).read("source-b").tabs).toEqual([]);
    expect(host.querySelector('[aria-label^="文本片段 1："]')).toBeNull();
  });

  it("opens a conversation draft while its source project directory is unavailable", async () => {
    projectDirectoryAvailable = false;
    includeAvailableAlternativeProject = true;

    await act(async () => root.render(<App />));
    const sourceRow = await findElement<HTMLButtonElement>(
      '[data-testid="conversation-sidebar-session"][data-session-id="source-a"]',
    );
    await act(async () => {
      sourceRow.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true }));
    });
    const analyze = await findElement<HTMLElement>('[role="menuitem"]', (element) =>
      element.textContent?.trim() === "在右侧栏分析这段对话");
    expect(analyze.getAttribute("aria-disabled")).not.toBe("true");
    await act(async () => analyze.click());

    await findElement<HTMLElement>('[aria-label^="文本片段 1："]');
    expect(host.querySelector(
      '[data-testid="conversation-sidebar-session"][aria-current="page"]',
    )?.getAttribute("data-session-id")).toBe("source-a");
    const analysisDraftRegion = await findElement<HTMLElement>('section[aria-label="新建对话"]');
    const send = analysisDraftRegion.querySelector<HTMLButtonElement>('button[aria-label="发送消息"]');
    expect(send?.disabled).toBe(true);
    const unavailableProject = analysisDraftRegion.querySelector<HTMLButtonElement>('button[aria-invalid="true"]');
    expect(unavailableProject?.textContent?.trim()).toBe("Moebius");
    expect(analysisDraftRegion.textContent).toContain("当前项目不可用，请修复项目目录或改选可用项目");
    expect(referenceUrls[0]?.searchParams.get("scope")).toBe("conversation");

    const suggestion = await findElement<HTMLButtonElement>("button", (element) =>
      element.textContent?.trim() === "Agent 运行不符合预期？");
    await act(async () => suggestion.click());
    expect(send?.disabled).toBe(true);

    await act(async () => {
      unavailableProject!.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }));
    });
    const availableProject = await findElement<HTMLElement>('[role="menuitemcheckbox"]', (element) =>
      element.textContent?.trim() === "可用项目");
    await act(async () => availableProject.click());

    await waitFor(() => analysisDraftRegion.querySelector<HTMLButtonElement>(
      'button[aria-label="发送消息"]',
    )?.disabled === false);
    expect(host.querySelector('[aria-label^="文本片段 1："]')?.getAttribute("aria-label"))
      .toContain("Moebius 会话记录：/tmp/source-a.jsonl");
  });

  it("atomically leaves the global new-conversation page for an unavailable source conversation", async () => {
    projectDirectoryAvailable = false;
    includeAvailableAlternativeProject = true;

    await act(async () => root.render(<App />));
    const newConversation = await findElement<HTMLButtonElement>("button", (element) =>
      element.getAttribute("aria-label") === "新建对话");
    await act(async () => newConversation.click());
    await findElement<HTMLElement>('section[aria-label="新建对话"]');

    const sourceRow = await findElement<HTMLButtonElement>(
      '[data-testid="conversation-sidebar-session"][data-session-id="source-a"]',
    );
    await act(async () => {
      sourceRow.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true }));
    });
    const analyze = await findElement<HTMLElement>('[role="menuitem"]', (element) =>
      element.textContent?.trim() === "在右侧栏分析这段对话");
    await act(async () => analyze.click());

    await findElement<HTMLElement>('[aria-label^="文本片段 1："]');
    expect(host.querySelector(
      '[data-testid="conversation-sidebar-session"][aria-current="page"]',
    )?.getAttribute("data-session-id")).toBe("source-a");
    expect(host.querySelector('main h1')?.textContent).toBe("来源会话");
    const analysisDraftRegion = await findElement<HTMLElement>('section[aria-label="新建对话"]');
    expect(analysisDraftRegion.querySelector('button[aria-invalid="true"]')?.textContent?.trim())
      .toBe("Moebius");
    expect(analysisDraftRegion.textContent).toContain("当前项目不可用，请修复项目目录或改选可用项目");
  });

  it("keeps the requested conversation across a slow reference response and parent rerender", async () => {
    sessions = [
      createSession("source-a", "来源会话 A"),
      createSession("source-b", "来源会话 B"),
    ];
    let resolveReferenceResponse: ((response: Response) => void) | null = null;
    referenceResponsePromise = new Promise<Response>((resolve) => {
      resolveReferenceResponse = resolve;
    });

    await act(async () => root.render(<App />));
    const targetRow = await findElement<HTMLButtonElement>(
      '[data-testid="conversation-sidebar-session"][data-session-id="source-b"]',
    );
    await act(async () => {
      targetRow.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true }));
    });
    const analyze = await findElement<HTMLElement>('[role="menuitem"]', (element) =>
      element.textContent?.trim() === "在右侧栏分析这段对话");
    await act(async () => analyze.click());
    await waitFor(() => referenceUrls.length === 1);

    await act(async () => root.render(<App />));
    expect(host.querySelector(
      '[data-testid="conversation-sidebar-session"][aria-current="page"]',
    )?.getAttribute("data-session-id")).toBe("source-a");

    await act(async () => {
      resolveReferenceResponse?.(jsonResponse({
        fragment: {
          id: "fragment-slow-source-b",
          label: "文本片段",
          text: "Moebius 会话记录：/tmp/source-b.jsonl",
        },
      }));
      await referenceResponsePromise;
    });

    await findElement<HTMLElement>('[aria-label^="文本片段 1："]');
    expect(host.querySelector(
      '[data-testid="conversation-sidebar-session"][aria-current="page"]',
    )?.getAttribute("data-session-id")).toBe("source-b");
    expect(host.querySelector('main h1')?.textContent).toBe("来源会话 B");
    expect(host.querySelectorAll('[aria-label^="文本片段 "]')).toHaveLength(1);
    expect(referenceUrls).toHaveLength(1);
  });

  function createState(selectedSessionId = "source-a") {
    const visibleSessions = sessions.filter((session) => !archivedSessionIds.has(session.sessionId));
    const source = visibleSessions.find((session) => session.sessionId === selectedSessionId)
      ?? visibleSessions[0]
      ?? null;
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
      directoryAvailable: projectDirectoryAvailable,
      directoryUnavailableReason: projectDirectoryAvailable ? null : "项目目录不可用",
      sessions: visibleSessions,
      runningCount: 0,
      waitingCount: 0,
      stuckCount: 0,
      errorCount: 0,
    };
    const alternativeProject = {
      ...project,
      projectId: "available",
      title: "可用项目",
      folderPath: "/tmp/available",
      workspaceCwd: "/tmp/available-worktree",
      worktreePath: "/tmp/available-worktree",
      directoryAvailable: true,
      directoryUnavailableReason: null,
      sessions: [],
    };
    return {
      projects: includeAvailableAlternativeProject ? [project, alternativeProject] : [project],
      project,
      selectedProjectId: "local",
      selectedSessionId: source?.sessionId ?? "source-a",
      selectedSession: source,
      messages: timelineMessages,
      childSessions: [],
      activeRun: null,
      workspaceDiff: { available: true, fileCount: 0, reason: null },
      sqlitePath: "/tmp/local-console.sqlite",
      lastError: null,
    };
  }

  function expectSelectedMainConversation(sessionId: string, title: string): void {
    const selected = host.querySelectorAll<HTMLButtonElement>(
      '[data-testid="conversation-sidebar-session"][aria-current="page"]',
    );
    expect(selected).toHaveLength(1);
    expect(selected[0]?.dataset.sessionId).toBe(sessionId);
    expect(host.querySelector("main h1")?.textContent).toBe(title);
  }

  async function submitGlobalConversation(message: string): Promise<HTMLElement> {
    const projectNewConversation = await findElement<HTMLButtonElement>("button", (element) =>
      element.getAttribute("aria-label") === "在 Moebius 中新建会话");
    await act(async () => projectNewConversation.click());
    const draftRegion = await findElement<HTMLElement>('section[aria-label="新建对话"]');
    const textarea = draftRegion.querySelector<HTMLTextAreaElement>('textarea[aria-label="消息内容"]');
    expect(textarea).not.toBeNull();
    await act(async () => setInputValue(textarea!, message));
    const send = draftRegion.querySelector<HTMLButtonElement>('button[aria-label="发送消息"]');
    await waitFor(() => send?.disabled === false);
    await act(async () => send!.click());
    return draftRegion;
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
    analysisRecordAvailable: true,
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
    pinnedAt: null as string | null,
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

function setInputValue(input: HTMLTextAreaElement, value: string): void {
  const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set;
  setter?.call(input, value);
  input.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: value }));
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

async function waitFor(predicate: () => boolean, timeoutMs?: number): Promise<void> {
  await waitForCondition(predicate, {
    describe: "desktop App state",
    ...(timeoutMs === undefined ? {} : { timeoutMs }),
    pollMs: 10,
    tick: async (ms) => {
      await act(async () => {
        await new Promise((resolve) => window.setTimeout(resolve, ms));
      });
    },
    snapshot: () => document.body.textContent ?? "",
  });
}
