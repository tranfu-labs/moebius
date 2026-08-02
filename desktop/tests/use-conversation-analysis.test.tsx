/** @vitest-environment jsdom */

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { openRightSidebarSourceTab, type OperatorSession, type TranslationKey } from "@moebius/console-ui";

import { waitForCondition } from "../../src/testing/wait.js";
import type { LocalConsoleState } from "../src/console-page/console-state-contract.js";
import type { ConversationAnalysisReferencePort } from "../src/console-page/conversation-analysis-contract.js";
import { ConsoleStateCoordinator } from "../src/console-page/console-state-coordinator.js";
import { createRightSidebarTabsStore } from "../src/console-page/right-sidebar-tabs-store.js";
import { createSidebarConversationDraftStore } from "../src/console-page/sidebar-conversation-drafts.js";
import { useConversationAnalysis } from "../src/console-page/use-conversation-analysis.js";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

type AnalysisBundle = ReturnType<typeof useConversationAnalysis>;

describe("conversation analysis controller", () => {
  let host: HTMLDivElement;
  let root: Root;
  let latest: AnalysisBundle;
  let storage: MemoryStorage;
  let tabsStore: ReturnType<typeof createRightSidebarTabsStore>;
  let draftStore: ReturnType<typeof createSidebarConversationDraftStore>;

  beforeEach(() => {
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
    storage = new MemoryStorage();
    tabsStore = createRightSidebarTabsStore(storage);
    draftStore = createSidebarConversationDraftStore(storage);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    host.remove();
  });

  it("settles a slow request through current callbacks and uses replacement ports on later requests", async () => {
    const slow = deferred<{ fragment: { id: string; label: string; text: string } }>();
    const firstPort = { load: vi.fn(async () => await slow.promise) };
    const firstCommit = vi.fn();
    const firstError = vi.fn();
    await render(firstPort, firstCommit, firstError);
    let pending!: Promise<void>;
    act(() => {
      pending = latest.analyze({ kind: "message", sessionId: "root", runId: "run-a", messageId: 1 });
    });
    expect(firstPort.load).toHaveBeenCalledOnce();

    const replacementPort = {
      load: vi.fn(async () => ({ fragment: { id: "new", label: "new", text: "new" } })),
    };
    const replacementCommit = vi.fn();
    const replacementError = vi.fn();
    await render(replacementPort, replacementCommit, replacementError);
    await act(async () => slow.resolve({ fragment: { id: "slow", label: "slow", text: "slow" } }));
    await act(async () => pending);
    await waitFor(() => replacementCommit.mock.calls.length === 1);
    expect(firstCommit).not.toHaveBeenCalled();
    expect(replacementError).toHaveBeenLastCalledWith(null);
    expect(draftStore.list()[0]?.textFragments).toMatchObject([{ id: "slow", text: "slow" }]);

    await act(async () => latest.analyze({
      kind: "message",
      sessionId: "root",
      runId: "run-b",
      messageId: 2,
    }));
    expect(firstPort.load).toHaveBeenCalledOnce();
    expect(replacementPort.load).toHaveBeenCalledOnce();

    const failingPort = { load: vi.fn(async () => Promise.reject(new Error("reference failed"))) };
    const failureError = vi.fn();
    await render(failingPort, vi.fn(), failureError);
    await act(async () => latest.analyze({
      kind: "message",
      sessionId: "root",
      runId: "run-c",
      messageId: 3,
    }));
    expect(failureError).toHaveBeenCalledWith("reference failed");
  });

  async function render(
    port: ConversationAnalysisReferencePort,
    commitDrafts: ReturnType<typeof vi.fn>,
    setError: ReturnType<typeof vi.fn>,
  ): Promise<void> {
    await act(async () => root.render(
      <Harness port={port} commitDrafts={commitDrafts} setError={setError} />,
    ));
  }

  function Harness({
    port,
    commitDrafts,
    setError,
  }: {
    port: ConversationAnalysisReferencePort;
    commitDrafts: ReturnType<typeof vi.fn>;
    setError: ReturnType<typeof vi.fn>;
  }): null {
    const stateRef = { current: consoleState() };
    latest = useConversationAnalysis(
      "http://127.0.0.1:8787/",
      stateRef,
      { current: null },
      new ConsoleStateCoordinator(),
      { state: { status: "loading" } },
      draftStore,
      commitDrafts,
      {
        store: tabsStore,
        commitCurrent: vi.fn(),
        setOpen: vi.fn(),
      },
      { current: { projectId: "project-a", sessionId: "root" } },
      { current: true },
      vi.fn(),
      vi.fn(),
      vi.fn(),
      vi.fn(),
      vi.fn(),
      vi.fn(),
      openRightSidebarSourceTab,
      port,
      vi.fn(),
      setError,
      vi.fn(),
      (key: TranslationKey, values?: Record<string, string | number>) =>
        values?.index === undefined ? key : `${key}:${String(values.index)}`,
    );
    return null;
  }
});

function consoleState(): LocalConsoleState {
  const root = session();
  const project = {
    projectId: "project-a",
    sourceType: "local-folder" as const,
    title: "Project",
    folderPath: "/tmp/project-a",
    worktreeMode: false,
    workspaceCwd: "/tmp/project-a",
    workspaceMode: "direct" as const,
    worktreePath: null,
    worktreeUnavailableReason: null,
    workspaceUpdatedAt: null,
    branchName: null,
    sessions: [root],
    runningCount: 0,
    waitingCount: 0,
    stuckCount: 0,
    errorCount: 0,
  };
  return {
    projects: [project],
    project,
    selectedProjectId: "project-a",
    selectedSessionId: "root",
    selectedSession: root,
    messages: [],
    pendingPrimaryMessages: [],
    childSessions: [],
    memberIdentities: [],
    activeRun: null,
    activeRuns: [],
    workspaceDiff: { available: false, fileCount: null, reason: "unavailable" },
    sqlitePath: "/tmp/test.sqlite",
    lastError: null,
  };
}

function session(): OperatorSession {
  return {
    sessionId: "root",
    projectId: "project-a",
    analysisParentSessionId: null,
    workspaceMode: "direct",
    workspacePendingMode: null,
    title: "Root",
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

function deferred<T>(): { promise: Promise<T>; resolve(value: T): void } {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

async function waitFor(predicate: () => boolean): Promise<void> {
  await waitForCondition(predicate, {
    timeoutMs: 2_000,
    pollMs: 10,
    tick: async (ms) => act(async () => new Promise((resolve) => setTimeout(resolve, ms))),
    describe: "conversation analysis condition",
    snapshot: () => ({ text: document.body.textContent }),
  });
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
