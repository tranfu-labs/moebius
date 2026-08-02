/** @vitest-environment jsdom */

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createRightSidebarTabsStore } from "../src/console-page/right-sidebar-tabs-store.js";
import type { SidebarDraftPort } from "../src/console-page/sidebar-draft-contract.js";
import {
  createSidebarConversationDraft,
  createSidebarConversationDraftStore,
} from "../src/console-page/sidebar-conversation-drafts.js";
import { useSidebarDraftActions } from "../src/console-page/use-sidebar-draft-actions.js";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

type SidebarDraftBundle = ReturnType<typeof useSidebarDraftActions>;
type SidebarDraftArguments = Parameters<typeof useSidebarDraftActions>;

describe("sidebar draft actions controller", () => {
  let host: HTMLDivElement;
  let root: Root;
  let latest: SidebarDraftBundle;
  let storage: MemoryStorage;
  let draftStore: ReturnType<typeof createSidebarConversationDraftStore>;

  beforeEach(() => {
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
    storage = new MemoryStorage();
    draftStore = createSidebarConversationDraftStore(storage);
    writeDraft("draft-a");
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    host.remove();
  });

  it("settles a slow creation through current callbacks and uses a replacement port later", async () => {
    const slow = deferred<{ sessionId: string; title?: string }>();
    const firstPort = port({ createConversation: vi.fn(async () => await slow.promise) });
    const firstCommitRoute = vi.fn();
    const firstError = vi.fn();
    await render(firstPort, firstCommitRoute, firstError);
    const pending = latest.submitDraft("draft-a");

    const replacementPort = port();
    const replacementCommitRoute = vi.fn();
    const replacementError = vi.fn();
    await render(replacementPort, replacementCommitRoute, replacementError);
    await act(async () => {
      slow.resolve({ sessionId: "created", title: "Created" });
      await pending;
    });
    expect(firstCommitRoute).not.toHaveBeenCalled();
    expect(replacementCommitRoute).toHaveBeenCalledOnce();
    expect(replacementPort.recordSuccessfulTeam).toHaveBeenCalledOnce();
    expect(replacementError).toHaveBeenLastCalledWith(null);
    expect(draftStore.read("draft-a")).toBeNull();

    writeDraft("draft-b");
    const failingPort = port({
      createConversation: vi.fn(async () => Promise.reject(new Error("create failed"))),
    });
    const failureError = vi.fn();
    await render(failingPort, vi.fn(), failureError);
    await act(async () => latest.submitDraft("draft-b"));
    expect(failingPort.createConversation).toHaveBeenCalledOnce();
    expect(replacementPort.createConversation).not.toHaveBeenCalled();
    expect(failureError).toHaveBeenCalledWith("create failed");
    expect(draftStore.read("draft-b")).not.toBeNull();
  });

  async function render(
    draftPort: SidebarDraftPort,
    commitRoute: ReturnType<typeof vi.fn>,
    setError: ReturnType<typeof vi.fn>,
  ): Promise<void> {
    await act(async () => root.render(
      <Harness draftPort={draftPort} commitRoute={commitRoute} setError={setError} />,
    ));
  }

  function Harness({
    draftPort,
    commitRoute,
    setError,
  }: {
    draftPort: SidebarDraftPort;
    commitRoute: ReturnType<typeof vi.fn>;
    setError: ReturnType<typeof vi.fn>;
  }): null {
    const tabsStore = createRightSidebarTabsStore(storage);
    latest = useSidebarDraftActions(
      "http://127.0.0.1:8787/",
      null,
      vi.fn(),
      [project()],
      catalog() as SidebarDraftArguments[4],
      [],
      false,
      vi.fn(),
      draftStore,
      vi.fn(),
      vi.fn(),
      tabsStore,
      vi.fn(),
      { current: null },
      { current: { projectId: "project-a", sessionId: "root" } },
      commitRoute,
      vi.fn(async () => true),
      undefined,
      draftPort,
      setError,
      (key) => key,
    );
    return null;
  }

  function writeDraft(draftId: string): void {
    draftStore.write({
      ...createSidebarConversationDraft({
        draftId,
        hostSessionId: "root",
        originSessionId: "root",
        entryTemplate: "session-analysis",
        context: {
          projectId: "project-a",
          workspaceMode: "direct",
          teamKey: "system:general-assistant",
        },
        now: "2026-08-02T00:00:00.000Z",
      }),
      body: "Analyze this",
    });
  }
});

function port(overrides: Partial<SidebarDraftPort> = {}): SidebarDraftPort {
  return {
    createConversation: vi.fn(async () => ({ sessionId: "created", title: "Created" })),
    recordSuccessfulTeam: vi.fn(async () => "recorded" as const),
    ...overrides,
  };
}

function catalog() {
  return {
    state: {
      status: "ready",
      teams: [{
        teamKey: "system:general-assistant",
        id: "general-assistant",
        ownership: "system",
        createdAt: null,
        officialSourceName: null,
        name: "General",
        description: null,
        primaryAgentSlug: "ceo",
        memberOrder: [],
        members: [],
        status: "usable",
        canCreateConversation: true,
        canEditContent: false,
        canDeleteTeam: false,
        issues: [],
        officialManagement: null,
      }],
    },
    setState: vi.fn(),
    lastUsedTeamKey: null,
    setLastUsedTeamKey: vi.fn(),
    selection: null,
    setSelection: vi.fn(),
    replaceTeams: vi.fn(),
    refresh: vi.fn(),
  };
}

function project() {
  return {
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
    sessions: [{
      sessionId: "root",
      projectId: "project-a",
      analysisParentSessionId: null,
      workspaceMode: "direct" as const,
      workspacePendingMode: null,
      title: "Root",
      status: "idle" as const,
      awaitsHumanReason: null,
      unreadSince: null,
      runningCount: 0,
      waitingCount: 0,
      stuckCount: 0,
      errorCount: 0,
      interruptedCount: 0,
      createdAt: "2026-08-02T00:00:00.000Z",
      updatedAt: "2026-08-02T00:00:00.000Z",
    }],
    runningCount: 0,
    waitingCount: 0,
    stuckCount: 0,
    errorCount: 0,
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
