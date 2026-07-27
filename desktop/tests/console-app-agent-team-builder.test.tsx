/** @vitest-environment jsdom */

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { App } from "../src/console-page/app.js";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe("desktop App Agent Teams AI builder wiring", () => {
  let root: Root;
  let host: HTMLDivElement;

  beforeEach(() => {
    window.localStorage.clear();
    window.localStorage.setItem(
      "moebius.console.selection",
      JSON.stringify({ projectId: "local", sessionId: "session-a" }),
    );
    window.history.replaceState({}, "", "/?api=http://127.0.0.1:8787/");
    Object.defineProperty(window, "innerWidth", { configurable: true, value: 1_200 });
    vi.stubGlobal("fetch", vi.fn(async (input: string | URL | Request) => {
      const url = input instanceof URL
        ? input
        : new URL(typeof input === "string" ? input : input.url);
      if (url.pathname === "/api/local-console/state") {
        return jsonResponse(consoleState);
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

  it("consumes the preload service from the outer App entry and opens the selected team detail", async () => {
    let committed = false;
    const recordSuccessfulConversationAgentTeam = vi.fn();
    const listAgentTeams = vi.fn(async () => ({
      status: "ready" as const,
      teams: committed ? [builtInTeam, aiBuiltTeam] : [builtInTeam],
    }));
    const startAiTeamBuilder = vi.fn(async () => ({
      ok: true as const,
      state: proposalBuilderState,
    }));
    const commitAiTeamBuilder = vi.fn(async (_draftId: string, proposalRevision: number) => {
      expect(proposalRevision).toBe(1);
      committed = true;
      return {
        ok: true as const,
        state: {
          ...proposalBuilderState,
          phase: "selected" as const,
          actions: [],
          selectedTeamId: aiBuiltTeam.id,
        },
      };
    });
    const readAgentTeamMember = vi.fn(async () => ({
      slug: "launch-lead",
      displayName: "发布负责人",
      description: "统筹发布并收尾",
      available: true,
      agentMarkdown: "# 发布负责人\n\n统筹发布并收尾\n",
    }));

    Object.defineProperty(window, "moebius", {
      configurable: true,
      value: {
        getLocalConsoleAttachmentCapability: async () => null,
        listAgentTeams,
        readLastUsedAgentTeam: async () => ({ ownership: "system", teamId: "development" }),
        startAiTeamBuilder,
        submitAiTeamBuilder: vi.fn(),
        adjustAiTeamBuilder: vi.fn(),
        retryAiTeamBuilder: vi.fn(),
        commitAiTeamBuilder,
        readAgentTeamMember,
        recordSuccessfulConversationAgentTeam,
      },
    });

    await act(async () => root.render(<App />));
    await act(async () => (await findButton("Agent 团队")).click());
    const createButton = await findButton("新建团队");
    await act(async () => {
      createButton.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }));
    });
    const aiEntry = await findElement<HTMLElement>('[role="menuitem"]', (element) =>
      element.textContent?.includes("跟 AI 聊出一支新团队") === true);
    await act(async () => aiEntry.click());

    await waitFor(() => startAiTeamBuilder.mock.calls.length === 1);
    await findElement("h1", (element) => element.textContent === "AI 团队设计器");
    expect(host.querySelector('[role="dialog"][aria-label="新建团队"]')).toBeNull();

    await act(async () => (await findButton("创建并选中")).click());
    await findElement<HTMLElement>(
      '[data-testid="agent-team-detail-view"][data-team-key="user:launch-team"]',
    );

    expect(listAgentTeams).toHaveBeenCalledTimes(2);
    expect(readAgentTeamMember).toHaveBeenCalledWith({
      teamId: "launch-team",
      ownership: "user",
      memberSlug: "launch-lead",
    });
    expect(recordSuccessfulConversationAgentTeam).not.toHaveBeenCalled();
    expect(window.localStorage.getItem("moebius.agent-teams.ai-builder-draft")).toBeNull();

    await act(async () => (await findButton("新建对话")).click());
    const teamSelector = await findElement<HTMLSelectElement>('select[aria-label="Agent 团队"]');
    expect(teamSelector.value).toBe("system:development");
  });

  it("uses the committed English locale in callback error paths after a live language switch", async () => {
    let localeListener: ((locale: "zh-CN" | "en") => void) | undefined;
    Object.defineProperty(window, "moebius", {
      configurable: true,
      value: {
        getLocalConsoleAttachmentCapability: async () => null,
        listAgentTeams: async () => ({ status: "ready" as const, teams: [builtInTeam] }),
        readLastUsedAgentTeam: async () => ({ ownership: "system", teamId: "development" }),
        onLanguagePreferenceChanged: (listener: (locale: "zh-CN" | "en") => void) => {
          localeListener = listener;
          return () => undefined;
        },
      },
    });

    await act(async () => root.render(<App />));
    await waitFor(() => localeListener !== undefined);
    await act(async () => localeListener?.("en"));

    await act(async () => (await findButton("Agent teams")).click());
    const createButton = await findButton("New team");
    await act(async () => {
      createButton.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }));
    });
    const aiEntry = await findElement<HTMLElement>('[role="menuitem"]', (element) =>
      element.textContent?.includes("Design a new team with AI") === true);
    await act(async () => aiEntry.click());

    await findElement("h1", (element) => element.textContent === "AI Team Designer");
    await findElement<HTMLElement>("[role='alert']", (element) =>
      element.textContent?.includes(
        "The AI team designer is temporarily unavailable. Try again shortly.",
      ) === true);
    expect(host.textContent).not.toContain("AI 团队设计器暂时不可用");
  });
});

async function findButton(name: string): Promise<HTMLButtonElement> {
  return findElement<HTMLButtonElement>("button", (element) =>
    element.getAttribute("aria-label") === name || element.textContent?.trim() === name);
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

const builtInTeam = {
  id: "development",
  ownership: "system" as const,
  definition: {
    name: "开发团队",
    description: "负责软件开发",
    primaryAgentSlug: "manager",
    memberOrder: ["manager"],
  },
  members: [{
    slug: "manager",
    displayName: "开发经理",
    description: "默认接单",
    available: true,
  }],
  status: "usable" as const,
  canCreateConversation: true,
  issues: [],
};

const aiBuiltTeam = {
  id: "launch-team",
  ownership: "user" as const,
  definition: {
    name: "产品发布团队",
    description: "持续完成产品发布",
    primaryAgentSlug: "launch-lead",
    memberOrder: ["launch-lead", "content-planner"],
  },
  members: [
    {
      slug: "launch-lead",
      displayName: "发布负责人",
      description: "统筹发布并收尾",
      available: true,
    },
    {
      slug: "content-planner",
      displayName: "内容策划",
      description: "准备发布内容",
      available: true,
    },
  ],
  status: "usable" as const,
  canCreateConversation: true,
  issues: [],
};

const proposal = {
  team: { name: "产品发布团队", purpose: "持续完成产品发布" },
  members: [
    {
      slug: "launch-lead",
      name: "发布负责人",
      role: "统筹发布并收尾",
      responsibilities: ["拆解工作", "复核证据"],
      handoffs: ["content-planner"],
    },
    {
      slug: "content-planner",
      name: "内容策划",
      role: "准备发布内容",
      responsibilities: ["准备渠道素材"],
      handoffs: ["launch-lead"],
    },
  ],
  primaryAgentSlug: "launch-lead",
  relayBeats: [
    { speakerSlug: "launch-lead", message: "分派内容工作。" },
    { speakerSlug: "content-planner", message: "提交内容。" },
  ],
};

const proposalBuilderState = {
  phase: "proposal" as const,
  messages: [{
    role: "assistant" as const,
    text: "我整理了一版团队方案。",
  }],
  proposal,
  proposalRevision: 1,
  error: null,
  actions: ["adjust", "commit", "cancel"] as const,
  selectedTeamId: null,
};

const session = {
  sessionId: "session-a",
  projectId: "local",
  parentSessionId: null,
  agentTeamOwnership: null,
  agentTeamId: null,
  agentTeamHealth: null,
  agentTeamHealthReason: null,
  workspaceMode: "direct",
  workspacePendingMode: null,
  workspaceUnavailableReason: null,
  branchName: "main",
  title: "默认会话",
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
  createdAt: "2026-07-24T00:00:00.000Z",
  updatedAt: "2026-07-24T00:00:01.000Z",
};

const project = {
  projectId: "local",
  sourceType: "local-folder",
  title: "moebius",
  folderPath: "/tmp/moebius",
  worktreeMode: false,
  workspaceCwd: "/tmp/moebius",
  workspaceMode: "direct",
  worktreePath: null,
  worktreeUnavailableReason: null,
  workspaceUpdatedAt: "2026-07-24T00:00:00.000Z",
  branchName: "main",
  isGitRepository: true,
  directoryAvailable: true,
  directoryUnavailableReason: null,
  sessions: [session],
  runningCount: 0,
  waitingCount: 0,
  stuckCount: 0,
  errorCount: 0,
};

const consoleState = {
  projects: [project],
  project,
  selectedProjectId: "local",
  selectedSessionId: "session-a",
  selectedSession: session,
  messages: [],
  pendingPrimaryMessages: [],
  childSessions: [],
  activeRun: null,
  activeRuns: [],
  workspaceDiff: { available: true, fileCount: 0, reason: null },
  sqlitePath: "/tmp/local-console.sqlite",
  lastError: null,
};
