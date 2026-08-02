/** @vitest-environment jsdom */

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { openRightSidebarSourceTab } from "@moebius/console-ui";

import { createRightSidebarTabsStore } from "../src/console-page/right-sidebar-tabs-store.js";
import type { SearchedSessionPort } from "../src/console-page/searched-session-contract.js";
import { useSearchedSessionNavigation } from "../src/console-page/use-searched-session-navigation.js";
import { createTestConsoleErrorSetter } from "./console-error-test-controller.js";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

type SearchNavigationBundle = ReturnType<typeof useSearchedSessionNavigation>;

describe("searched session navigation controller", () => {
  let host: HTMLDivElement;
  let root: Root;
  let latest: SearchNavigationBundle;
  let storage: MemoryStorage;

  beforeEach(() => {
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
    storage = new MemoryStorage();
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    host.remove();
  });

  it("settles a slow restore through current callbacks and uses a replacement port later", async () => {
    const slow = deferred<ReturnType<typeof childSession>>();
    const firstPort = { restore: vi.fn(async () => await slow.promise) };
    const firstRoute = vi.fn();
    await render(firstPort, firstRoute, vi.fn(), vi.fn());
    const pending = latest.openSearchedSession(searchResult(), true);

    const replacementPort = { restore: vi.fn(async () => childSession()) };
    const replacementRoute = vi.fn();
    const replacementSelection = vi.fn();
    const replacementError = vi.fn();
    await render(replacementPort, replacementRoute, replacementSelection, replacementError);
    slow.resolve(childSession());
    await expect(pending).resolves.toBe(true);
    expect(firstRoute).not.toHaveBeenCalled();
    expect(replacementRoute).toHaveBeenCalledOnce();
    expect(replacementSelection).toHaveBeenCalledWith({ projectId: "project-a", sessionId: "root" });
    expect(replacementPort.restore).not.toHaveBeenCalled();

    const failingPort = { restore: vi.fn(async () => Promise.reject(new Error("restore failed"))) };
    const failureError = vi.fn();
    await render(failingPort, vi.fn(), vi.fn(), failureError);
    await expect(latest.openSearchedSession(searchResult(), true)).resolves.toBe(false);
    expect(failingPort.restore).toHaveBeenCalledOnce();
    expect(failureError).toHaveBeenCalledWith("restore failed");
  });

  async function render(
    searchPort: SearchedSessionPort,
    commitRoute: ReturnType<typeof vi.fn>,
    selectSession: ReturnType<typeof vi.fn>,
    setError: ReturnType<typeof vi.fn>,
  ): Promise<void> {
    await act(async () => root.render(
      <Harness
        searchPort={searchPort}
        commitRoute={commitRoute}
        selectSession={selectSession}
        setError={setError}
      />,
    ));
  }

  function Harness({
    searchPort,
    commitRoute,
    selectSession,
    setError,
  }: {
    searchPort: SearchedSessionPort;
    commitRoute: ReturnType<typeof vi.fn>;
    selectSession: ReturnType<typeof vi.fn>;
    setError: ReturnType<typeof vi.fn>;
  }): null {
    const tabsStore = createRightSidebarTabsStore(storage);
    latest = useSearchedSessionNavigation(
      "http://127.0.0.1:8787/",
      { current: consoleState() },
      commitRoute,
      tabsStore,
      openRightSidebarSourceTab,
      vi.fn(),
      vi.fn(),
      selectSession,
      searchPort,
      createTestConsoleErrorSetter(setError),
    );
    return null;
  }
});

function searchResult() {
  return {
    session: childSession(),
    project: { projectId: "project-a", title: "Project" },
    archived: true,
    originAvailable: true,
  };
}

function consoleState() {
  const root = rootSession();
  const child = childSession();
  const project = projectState(root, child);
  return {
    projects: [project], project, selectedProjectId: "project-a", selectedSessionId: "root",
    selectedSession: root, messages: [], pendingPrimaryMessages: [], childSessions: [],
    memberIdentities: [], activeRun: null, activeRuns: [],
    workspaceDiff: { available: false as const, fileCount: null, reason: "unavailable" as const },
    sqlitePath: "/tmp/test.sqlite", lastError: null,
  };
}

function projectState(...sessions: Array<ReturnType<typeof rootSession>>) {
  return {
    projectId: "project-a", sourceType: "local-folder" as const, title: "Project",
    folderPath: "/tmp/project-a", worktreeMode: false, workspaceCwd: "/tmp/project-a",
    workspaceMode: "direct" as const, worktreePath: null, worktreeUnavailableReason: null,
    workspaceUpdatedAt: null, sessions, runningCount: 0, waitingCount: 0, stuckCount: 0, errorCount: 0,
  };
}

function rootSession() { return session("root", null); }
function childSession() { return session("child", "root"); }
function session(sessionId: string, originSessionId: string | null) {
  return {
    sessionId, projectId: "project-a", originSessionId, analysisParentSessionId: null,
    workspaceMode: "direct" as const, workspacePendingMode: null, title: sessionId,
    status: "idle" as const, awaitsHumanReason: null, unreadSince: null,
    runningCount: 0, waitingCount: 0, stuckCount: 0, errorCount: 0, interruptedCount: 0,
    createdAt: "2026-08-02T00:00:00.000Z", updatedAt: "2026-08-02T00:00:00.000Z",
  };
}

function deferred<T>(): { promise: Promise<T>; resolve(value: T): void } {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
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
