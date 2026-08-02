/** @vitest-environment jsdom */

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  openRightSidebarSourceTab,
  type OperatorSession,
  type TranslationKey,
} from "@moebius/console-ui";

import { createRightSidebarTabsStore } from "../src/console-page/right-sidebar-tabs-store.js";
import type { ConsoleSelection } from "../src/console-page/console-state-coordinator.js";
import { useAnalysisPanelNavigation } from "../src/console-page/use-analysis-panel-navigation.js";
import { createTestConsoleErrorSetter } from "./console-error-test-controller.js";
import type { RightSidebarTabsBundle } from "../src/console-page/use-right-sidebar-tabs.js";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

type AnalysisBundle = ReturnType<typeof useAnalysisPanelNavigation>;

describe("analysis panel navigation controller", () => {
  let host: HTMLDivElement;
  let root: Root;
  let latest: AnalysisBundle;
  const selectionRef: { current: ConsoleSelection } = {
    current: { projectId: "project-a", sessionId: "other" },
  };
  const storage = new MemoryStorage();
  const tabsStore = createRightSidebarTabsStore(storage);
  const commitCurrent = vi.fn();
  const setOpen = vi.fn();
  const requestFocus = vi.fn();
  const commitRoute = vi.fn();
  const writeReadingPosition = vi.fn();

  beforeEach(() => {
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
    selectionRef.current = { projectId: "project-a", sessionId: "other" };
    tabsStore.clearHosts(["root"]);
    commitCurrent.mockReset();
    setOpen.mockReset();
    requestFocus.mockReset();
    commitRoute.mockReset();
    writeReadingPosition.mockReset();
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    host.remove();
  });

  it("uses current parent callbacks after rerender and preserves hosted versus direct navigation", async () => {
    const firstSelect = vi.fn();
    const firstError = vi.fn();
    await render(firstSelect, firstError);

    act(() => latest.openEntry("root", { sessionId: "child", title: "Child" }));
    expect(firstSelect).toHaveBeenCalledWith({ projectId: "project-a", sessionId: "root" });
    expect(commitRoute).toHaveBeenCalledWith(expect.objectContaining({ hostSessionId: "root" }));
    expect(tabsStore.read("root").tabs).toMatchObject([{
      type: "conversation",
      sourceKey: "conversation:child",
    }]);
    expect(commitCurrent).toHaveBeenCalledOnce();
    expect(setOpen).toHaveBeenCalledWith(true);
    expect(requestFocus).toHaveBeenCalledWith(expect.objectContaining({ hostSessionId: "root" }));

    const replacementSelect = vi.fn();
    const replacementError = vi.fn();
    await render(replacementSelect, replacementError);
    act(() => latest.openReference({ scope: "message", sessionId: "root", messageId: 42 }));
    expect(firstSelect).toHaveBeenCalledOnce();
    expect(replacementSelect).toHaveBeenCalledWith({ projectId: "project-a", sessionId: "root" });
    expect(writeReadingPosition).toHaveBeenCalledWith("root", 42);
    expect(latest.messageNavigation).toMatchObject({ sessionId: "root", messageId: 42 });
    const requestId = latest.messageNavigation!.requestId;
    act(() => latest.handleMessageNavigation(requestId));
    expect(latest.messageNavigation).toBeNull();

    act(() => latest.openReference({ scope: "conversation", sessionId: "missing" }));
    expect(firstError).toHaveBeenCalledTimes(1);
    expect(firstError).toHaveBeenCalledWith(null);
    expect(replacementError).toHaveBeenCalledWith("console.sessionAnalysis.sourceUnavailable");
  });

  async function render(selectSession: ReturnType<typeof vi.fn>, setError: ReturnType<typeof vi.fn>) {
    await act(async () => root.render(
      <Harness selectSession={selectSession} setError={setError} />,
    ));
  }

  function Harness({
    selectSession,
    setError,
  }: {
    selectSession: ReturnType<typeof vi.fn>;
    setError: ReturnType<typeof vi.fn>;
  }): null {
    latest = useAnalysisPanelNavigation(
      [session("root", "Root"), session("child", "Child", "root")],
      "en-US",
      selectionRef,
      { selectSession },
      commitRoute,
      {
        store: tabsStore,
        commitCurrent,
        setOpen,
        requestFocus,
      } satisfies Pick<RightSidebarTabsBundle,
        "store" | "commitCurrent" | "setOpen" | "requestFocus">,
      openRightSidebarSourceTab,
      writeReadingPosition,
      createTestConsoleErrorSetter(setError),
      (key: TranslationKey) => key,
    );
    return null;
  }
});

function session(sessionId: string, title: string, parent: string | null = null): OperatorSession {
  return {
    sessionId,
    projectId: "project-a",
    analysisParentSessionId: parent,
    workspaceMode: "direct",
    workspacePendingMode: null,
    title,
    status: "idle",
    awaitsHumanReason: null,
    unreadSince: null,
    runningCount: 0,
    waitingCount: 0,
    stuckCount: 0,
    errorCount: 0,
    interruptedCount: 0,
    createdAt: "2026-08-02T00:00:00.000Z",
    updatedAt: "2026-08-02T00:00:00.000Z",
  };
}

class MemoryStorage implements Storage {
  private readonly values = new Map<string, string>();
  get length(): number { return this.values.size; }
  clear(): void { this.values.clear(); }
  getItem(key: string): string | null { return this.values.get(key) ?? null; }
  key(index: number): string | null { return [...this.values.keys()][index] ?? null; }
  removeItem(key: string): void { this.values.delete(key); }
  setItem(key: string, value: string): void { this.values.set(key, value); }
}
