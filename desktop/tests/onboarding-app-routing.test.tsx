/** @vitest-environment jsdom */

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { AiTeamBuilderIpcResponse } from "../src/ai-team-builder/contract.js";
import { App, type DesktopApi } from "../src/console-page/app.js";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe("desktop onboarding routing", () => {
  let host: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    window.localStorage.clear();
    window.history.replaceState({}, "", "/?api=http://127.0.0.1:8787/#/");
    Object.defineProperty(window, "innerWidth", { configurable: true, value: 1_200 });
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse(localConsoleState)));
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    host.remove();
    vi.unstubAllGlobals();
  });

  it("drives a fresh data root through the independent route and consumes its team pick once", async () => {
    const completeOnboarding = vi.fn(async () => ({
      completed: true,
      completedAt: "2026-07-24T00:00:00.000Z",
    }));
    const recordSuccessfulConversationAgentTeam = vi.fn();
    installApi({
      getOnboardingStatus: async () => ({ completed: false, completedAt: null }),
      completeOnboarding,
      checkOnboardingCodex: async () => ({
        status: "ok",
        message: "已找到",
        detail: "codex-cli 1.0",
      }),
      recordSuccessfulConversationAgentTeam,
    });

    await act(async () => root.render(<App />));
    await findElement('[data-testid="onboarding-step-1"]');
    expect(document.querySelector('[data-testid="operator-sidebar"]')).toBeNull();

    await clickButton("继续");
    const selectedTeam = await findElement<HTMLButtonElement>('button[aria-pressed="true"]');
    expect(selectedTeam.textContent).toContain("开发团队");
    await clickButton("继续");
    await findElement('[data-testid="onboarding-relay-demo-slot"]');
    expect(document.body.textContent).toContain("拆解任务");
    expect(document.querySelectorAll('[data-testid="relay-message-row"]')).toHaveLength(2);
    await clickButton("继续");
    await findElement('[data-testid="onboarding-step-4"]');
    await clickButton("开始使用");

    const teamSelect = await findElement<HTMLSelectElement>('select[aria-label="Agent 团队"]');
    await waitFor(() => teamSelect.value === "system:development");
    await waitFor(() => window.location.hash === "#/");
    await waitFor(() => window.history.state?.usr == null);

    expect(completeOnboarding).toHaveBeenCalledOnce();
    expect(teamSelect.value).toBe("system:development");
    expect(recordSuccessfulConversationAgentTeam).not.toHaveBeenCalled();
    expect(document.querySelector('[data-testid^="onboarding-step-"]')).toBeNull();
  });

  it("sends a completed data root straight to the operator console", async () => {
    installApi({
      getOnboardingStatus: async () => ({
        completed: true,
        completedAt: "2026-07-24T00:00:00.000Z",
      }),
    });

    await act(async () => root.render(<App />));

    await findElement('[data-testid="operator-sidebar"]');
    expect(document.querySelector('[data-testid^="onboarding-step-"]')).toBeNull();
    expect(window.location.hash).toBe("#/");
  });

  it("keeps Continue disabled until a failed Codex check succeeds", async () => {
    let codexReady = false;
    const checkOnboardingCodex = vi.fn(async () => codexReady
      ? { status: "ok" as const, message: "已找到", detail: "codex-cli 1.0" }
      : { status: "error" as const, message: "Codex 未找到" });
    installApi({
      getOnboardingStatus: async () => ({ completed: false, completedAt: null }),
      checkOnboardingCodex,
    });

    await act(async () => root.render(<App />));
    const continueButton = await findButton("继续");
    await waitFor(() => continueButton.disabled);
    expect(continueButton.disabled).toBe(true);

    codexReady = true;
    await clickButton("重新检查");
    await waitFor(() => !continueButton.disabled);

    expect(checkOnboardingCodex).toHaveBeenCalledTimes(2);
    expect(continueButton.disabled).toBe(false);
  });

  it("opens the existing AI team builder service inside step 2", async () => {
    const startOnboardingTeamBuilder = vi.fn(async () => ({
      ok: true as const,
      state: {
        phase: "idle" as const,
        messages: [{
          role: "assistant" as const,
          text: "你希望这支团队长期替你完成什么工作？",
        }],
        proposal: null,
        proposalRevision: null,
        error: null,
        actions: ["cancel" as const],
        selectedTeamId: null,
      },
    }));
    installApi({
      getOnboardingStatus: async () => ({ completed: false, completedAt: null }),
      checkOnboardingCodex: async () => ({ status: "ok", message: "已找到" }),
      startOnboardingTeamBuilder,
    });

    await act(async () => root.render(<App />));
    await findElement('[data-testid="onboarding-step-1"]');
    await clickButton("继续");
    await clickButton("跟 AI 聊出一支新团队");
    await findElement('[aria-label="返回选团队"]');

    expect(startOnboardingTeamBuilder).toHaveBeenCalledWith({ draftId: "onboarding-team-builder" });
    expect(document.body.textContent).toContain("仍在第 2 步");
  });

  it("shows the submitted AI builder message before the desktop IPC turn returns", async () => {
    let resolveSubmit: ((response: AiTeamBuilderIpcResponse) => void) | null = null;
    const submitOnboardingTeamBuilder = vi.fn(() => new Promise<AiTeamBuilderIpcResponse>(
      (resolve) => {
        resolveSubmit = resolve;
      },
    ));
    installApi({
      getOnboardingStatus: async () => ({ completed: false, completedAt: null }),
      checkOnboardingCodex: async () => ({ status: "ok", message: "已找到" }),
      startOnboardingTeamBuilder: async () => ({
        ok: true,
        state: {
          phase: "idle",
          messages: [{
            role: "assistant",
            text: "你希望这支团队长期替你完成什么工作？",
          }],
          proposal: null,
          proposalRevision: null,
          error: null,
          actions: ["cancel"],
          selectedTeamId: null,
        },
      }),
      submitOnboardingTeamBuilder,
    });

    await act(async () => root.render(<App />));
    await findElement('[data-testid="onboarding-step-1"]');
    await clickButton("继续");
    await clickButton("跟 AI 聊出一支新团队");
    const composer = await findElement<HTMLTextAreaElement>(
      'textarea[aria-label="描述团队目标或回答问题"]',
    );
    await changeTextarea(composer, "持续做产品发布");
    const sendButton = await findElement<HTMLButtonElement>('button[aria-label="发送"]');
    await act(async () => sendButton.click());

    const pendingMessage = await findElement('[data-testid="pending-team-builder-user-message"]');
    expect(pendingMessage.textContent).toContain("持续做产品发布");
    expect(document.querySelector('[role="status"][aria-label="AI 正在处理"]')).not.toBeNull();

    await act(async () => resolveSubmit?.({
      ok: true,
      state: {
        phase: "clarifying",
        messages: [
          { role: "assistant", text: "你希望这支团队长期替你完成什么工作？" },
          { role: "user", text: "持续做产品发布" },
          { role: "assistant", text: "主要面向谁？" },
        ],
        proposal: null,
        proposalRevision: null,
        error: null,
        actions: ["cancel"],
        selectedTeamId: null,
      },
    }));
    await waitFor(() =>
      document.querySelector('[data-testid="pending-team-builder-user-message"]') === null);

    expect((document.body.textContent?.match(/持续做产品发布/g) ?? [])).toHaveLength(1);
    expect(document.body.textContent).toContain("主要面向谁？");
  });

  function installApi(overrides: Partial<DesktopApi>): void {
    const api: DesktopApi = {
      getLocalConsoleAttachmentCapability: async () => null,
      listAgentTeams: async () => ({ status: "ready", teams: [developmentTeam] }),
      readLastUsedAgentTeam: async () => null,
      ...overrides,
    };
    Object.defineProperty(window, "moebius", {
      configurable: true,
      value: api,
    });
  }

  async function clickButton(name: string): Promise<void> {
    const button = await findButton(name);
    await act(async () => button.click());
  }
});

async function findButton(name: string): Promise<HTMLButtonElement> {
  let found: HTMLButtonElement | undefined;
  await waitFor(() => {
    found = Array.from(document.querySelectorAll("button")).find(
      (button) => button.textContent?.trim().includes(name),
    );
    return found !== undefined;
  });
  return found!;
}

async function findElement<T extends Element = Element>(selector: string): Promise<T> {
  let found: T | null = null;
  await waitFor(() => {
    found = document.querySelector<T>(selector);
    return found !== null;
  });
  return found!;
}

async function changeTextarea(textarea: HTMLTextAreaElement, value: string): Promise<void> {
  const setter = Object.getOwnPropertyDescriptor(
    HTMLTextAreaElement.prototype,
    "value",
  )?.set;
  await act(async () => {
    setter?.call(textarea, value);
    textarea.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

async function waitFor(predicate: () => boolean, timeoutMs = 2_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() >= deadline) {
      throw new Error(`timed out waiting for onboarding route: ${document.body.textContent ?? ""}`);
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

const developmentTeam = {
  id: "development",
  ownership: "system" as const,
  definition: {
    name: "开发团队",
    description: "把目标变成可验证的实现",
    primaryAgentSlug: "dev-manager",
    memberOrder: ["dev-manager", "dev"],
  },
  onboardingOrchestration: {
    status: "ready" as const,
    relayBeats: [
      { speakerSlug: "dev-manager", message: "拆解任务" },
      { speakerSlug: "dev", message: "完成实现" },
    ],
  },
  members: [
    { slug: "dev-manager", displayName: "技术负责人", description: "拆解并收尾" },
    { slug: "dev", displayName: "开发者", description: "实现和验证" },
  ],
  status: "usable" as const,
  canCreateConversation: true,
  issues: [],
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
  workspaceUpdatedAt: null,
  branchName: "main",
  isGitRepository: true,
  directoryAvailable: true,
  directoryUnavailableReason: null,
  sessions: [],
  runningCount: 0,
  waitingCount: 0,
  stuckCount: 0,
  errorCount: 0,
};

const localConsoleState = {
  projects: [project],
  project,
  selectedProjectId: "local",
  selectedSessionId: "default",
  selectedSession: null,
  messages: [],
  pendingPrimaryMessages: [],
  childSessions: [],
  activeRun: null,
  activeRuns: [],
  workspaceDiff: { available: false, fileCount: null, reason: "unavailable" },
  sqlitePath: "/tmp/local-console.sqlite",
  lastError: null,
};
