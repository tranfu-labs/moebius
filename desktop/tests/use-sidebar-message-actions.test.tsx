/** @vitest-environment jsdom */

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { OperatorSession, OperatorSubSessionView } from "@moebius/console-ui";

import { createConversationDraftStore } from "../src/console-page/draft-store.js";
import type { SidebarMessagePort } from "../src/console-page/sidebar-message-contract.js";
import { useSidebarMessageActions } from "../src/console-page/use-sidebar-message-actions.js";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

type SidebarMessageBundle = ReturnType<typeof useSidebarMessageActions>;

describe("sidebar message actions controller", () => {
  let host: HTMLDivElement;
  let root: Root;
  let latest: SidebarMessageBundle;
  let draftStore: ReturnType<typeof createConversationDraftStore>;

  beforeEach(() => {
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
    draftStore = createConversationDraftStore(new MemoryStorage());
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    host.remove();
  });

  it("finishes a slow send through current callbacks and uses replacement ports afterward", async () => {
    const slow = deferred<void>();
    const firstPort = port({ submitMessage: vi.fn(async () => await slow.promise) });
    const firstViews = vi.fn();
    const firstRefresh = vi.fn(async () => true);
    const firstError = vi.fn();
    await render(firstPort, firstViews, firstRefresh, firstError, "first body");
    const pending = latest.sendMessage("child");

    const replacementPort = port();
    const replacementViews = vi.fn();
    const replacementRefresh = vi.fn(async () => true);
    const replacementError = vi.fn();
    await render(replacementPort, replacementViews, replacementRefresh, replacementError, "new body");
    await act(async () => {
      slow.resolve(undefined);
      await pending;
    });
    expect(firstViews).not.toHaveBeenCalled();
    expect(firstRefresh).not.toHaveBeenCalled();
    expect(replacementPort.loadView).toHaveBeenCalledWith("http://127.0.0.1:8787/", "child");
    expect(replacementViews).toHaveBeenCalledOnce();
    expect(replacementRefresh).toHaveBeenCalledWith({ projectId: "project-a", sessionId: "root" });
    expect(replacementError).toHaveBeenLastCalledWith(null);

    const failingPort = port({
      submitMessage: vi.fn(async () => Promise.reject(new Error("sidebar send failed"))),
    });
    const failureError = vi.fn();
    await render(failingPort, vi.fn(), vi.fn(async () => true), failureError, "later body");
    await act(async () => latest.sendMessage("child"));
    expect(failingPort.submitMessage).toHaveBeenCalledOnce();
    expect(replacementPort.submitMessage).not.toHaveBeenCalled();
    expect(failureError).toHaveBeenCalledWith("sidebar send failed");
  });

  async function render(
    messagePort: SidebarMessagePort,
    setViews: ReturnType<typeof vi.fn>,
    refresh: ReturnType<typeof vi.fn>,
    setError: ReturnType<typeof vi.fn>,
    body: string,
  ): Promise<void> {
    await act(async () => root.render(
      <Harness
        messagePort={messagePort}
        setViews={setViews}
        refresh={refresh}
        setError={setError}
        body={body}
      />,
    ));
  }

  function Harness({
    messagePort,
    setViews,
    refresh,
    setError,
    body,
  }: {
    messagePort: SidebarMessagePort;
    setViews: ReturnType<typeof vi.fn>;
    refresh: ReturnType<typeof vi.fn>;
    setError: ReturnType<typeof vi.fn>;
    body: string;
  }): null {
    latest = useSidebarMessageActions(
      "http://127.0.0.1:8787/",
      null,
      vi.fn(),
      { child: body },
      vi.fn(),
      [],
      vi.fn(),
      draftStore,
      { child: { status: "ready", view: subSessionView() } },
      setViews,
      { current: { projectId: "project-a", sessionId: "root" } },
      refresh,
      messagePort,
      setError,
    );
    return null;
  }
});

function port(overrides: Partial<SidebarMessagePort> = {}): SidebarMessagePort {
  return {
    submitMessage: vi.fn(async () => undefined),
    loadView: vi.fn(async () => subSessionView()),
    retryPending: vi.fn(async () => undefined),
    updatePending: vi.fn(async () => undefined),
    removePending: vi.fn(async () => undefined),
    ...overrides,
  };
}

function subSessionView(): OperatorSubSessionView {
  return {
    session: session(),
    messages: [],
    pendingPrimaryMessages: [],
    memberIdentities: [],
    activeRun: null,
    activeRuns: [],
  };
}

function session(): OperatorSession {
  return {
    sessionId: "child",
    projectId: "project-a",
    analysisParentSessionId: null,
    workspaceMode: "direct",
    workspacePendingMode: null,
    title: "Child",
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

class MemoryStorage implements Storage {
  private readonly values = new Map<string, string>();
  get length(): number { return this.values.size; }
  clear(): void { this.values.clear(); }
  getItem(key: string): string | null { return this.values.get(key) ?? null; }
  key(index: number): string | null { return [...this.values.keys()][index] ?? null; }
  removeItem(key: string): void { this.values.delete(key); }
  setItem(key: string, value: string): void { this.values.set(key, value); }
}
