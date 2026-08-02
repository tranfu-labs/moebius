/** @vitest-environment jsdom */

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { OperatorProject, OperatorSession, RightSidebarTabsState } from "@moebius/console-ui";

import { ConsoleStateCoordinator } from "../src/console-page/console-state-coordinator.js";
import { useConversationNavigation } from "../src/console-page/use-conversation-navigation.js";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

type NavigationBundle = ReturnType<typeof useConversationNavigation>;
type NavigationInput = ReturnType<typeof input>;

describe("conversation navigation controller", () => {
  let host: HTMLDivElement;
  let root: Root;
  let latest: NavigationBundle;

  beforeEach(() => {
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    host.remove();
  });

  it("routes an analysis conversation through its origin using the latest parent ports", async () => {
    const first = ports();
    const current = ports();
    await render(input(first));
    await render(input(current));
    act(() => latest.selectConversation({ projectId: "local", sessionId: "analysis" }));

    expect(first.commitRoute).not.toHaveBeenCalled();
    expect(current.commitRoute).toHaveBeenCalledWith(expect.objectContaining({
      hostSessionId: "source",
      selectedSessionId: "analysis",
      rightConversationSessionId: "analysis",
    }));
    expect(current.activateComposer).toHaveBeenCalledWith("source");
    expect(current.selectSession).toHaveBeenCalledWith({ projectId: "local", sessionId: "source" });
    expect(current.tabsStore.write).toHaveBeenCalledWith(
      "source",
      expect.objectContaining({ activeTabId: "conversation-analysis" }),
    );
    expect(current.setRightSidebarOpen).toHaveBeenCalledWith(true);
    expect(current.queueTransition).toHaveBeenCalledWith("source", "analysis");
  });

  it("keeps navigation inert while a selection mutation owns the route", async () => {
    const current = ports();
    await render(input(current, true));
    act(() => latest.selectConversation({ projectId: "local", sessionId: "analysis" }));
    expect(current.commitRoute).not.toHaveBeenCalled();
    expect(current.selectSession).not.toHaveBeenCalled();
    expect(current.queueTransition).not.toHaveBeenCalled();
  });

  async function render(next: NavigationInput): Promise<void> {
    await act(async () => root.render(<Harness input={next} />));
  }

  function Harness(props: { input: NavigationInput }): null {
    const next = props.input;
    latest = useConversationNavigation(
      next.projects,
      next.coordinator,
      next.selectionRef,
      next.persistenceRef,
      next.runtime.dispatchNewConversation,
      next.runtime.commitRoute,
      next.runtime.activateComposer,
      next.runtime,
      next.runtime.tabsStore,
      next.runtime.openTab,
      next.runtime.commitTabs,
      next.runtime.setRightSidebarOpen,
      next.runtime,
    );
    return null;
  }
});

function input(runtime: ReturnType<typeof ports>, pending = false) {
  const coordinator = new ConsoleStateCoordinator();
  if (pending) coordinator.beginSelectionMutation("open-project");
  return {
    projects: [project()],
    coordinator,
    selectionRef: { current: { projectId: "local", sessionId: "source" } },
    persistenceRef: { current: false },
    runtime,
  };
}

function ports() {
  const tabs: RightSidebarTabsState = { tabs: [], activeTabId: null };
  return {
    dispatchNewConversation: vi.fn(),
    commitRoute: vi.fn(),
    activateComposer: vi.fn(),
    selectSession: vi.fn(),
    tabsStore: {
      read: vi.fn(() => tabs),
      write: vi.fn(),
      promoteConversationDraft: vi.fn(() => []),
      renameConversation: vi.fn(() => []),
      removeSession: vi.fn(),
      clearHosts: vi.fn(),
    },
    openTab: vi.fn((_state, source) => ({
      tabs: [{ ...source, closable: true as const }],
      activeTabId: source.id,
    })),
    commitTabs: vi.fn(),
    setRightSidebarOpen: vi.fn(),
    queueTransition: vi.fn(),
  };
}

function project(): OperatorProject {
  return {
    projectId: "local",
    sourceType: "local-folder",
    title: "Local",
    folderPath: "/tmp/local",
    worktreeMode: true,
    workspaceCwd: "/tmp/local",
    workspaceMode: "worktree",
    worktreePath: "/tmp/local",
    worktreeUnavailableReason: null,
    workspaceUpdatedAt: null,
    sessions: [session("source", null), session("analysis", "source")],
    runningCount: 0,
    waitingCount: 0,
    stuckCount: 0,
    errorCount: 0,
  };
}

function session(sessionId: string, originSessionId: string | null): OperatorSession {
  return {
    sessionId,
    projectId: "local",
    parentSessionId: null,
    originSessionId,
    entryTemplate: originSessionId === null ? null : "session-analysis",
    writePolicy: originSessionId === null ? "normal" : "confirm-current-plan-before-write",
    agentTeamOwnership: "system",
    agentTeamId: "general-assistant",
    agentTeamHealth: "usable",
    agentTeamHealthReason: null,
    analysisRecordAvailable: true,
    workspaceMode: "worktree",
    workspacePendingMode: null,
    workspaceUnavailableReason: null,
    branchName: "feature/navigation",
    title: sessionId,
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
    pinnedAt: null,
    createdAt: "2026-08-02T00:00:00.000Z",
    updatedAt: "2026-08-02T00:00:00.000Z",
  };
}
