/** @vitest-environment jsdom */

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createConversationDraftStore } from "../src/console-page/draft-store.js";
import type { SessionRunPort } from "../src/console-page/session-run-contract.js";
import { useSessionRunActions } from "../src/console-page/use-session-run-actions.js";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

type SessionRunBundle = ReturnType<typeof useSessionRunActions>;

describe("session run actions controller", () => {
  let host: HTMLDivElement;
  let root: Root;
  let latest: SessionRunBundle;
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

  it("settles a slow send through current callbacks and uses replacement ports later", async () => {
    const slow = deferred<void>();
    const firstPort = port({ submitMessage: vi.fn(async () => await slow.promise) });
    const firstRefresh = vi.fn(async () => true);
    const firstClear = vi.fn();
    const firstError = vi.fn();
    await render(firstPort, firstRefresh, firstClear, firstError, "first body");

    let pending!: Promise<void>;
    act(() => { pending = latest.sendSubSessionMessage("child"); });
    expect(firstPort.submitMessage).toHaveBeenCalledWith(
      "http://127.0.0.1:8787/",
      "child",
      "first body",
      ["attachment-a"],
    );

    const replacementPort = port();
    const replacementRefresh = vi.fn(async () => true);
    const replacementClear = vi.fn();
    const replacementError = vi.fn();
    await render(
      replacementPort,
      replacementRefresh,
      replacementClear,
      replacementError,
      "replacement body",
    );
    await act(async () => {
      slow.resolve(undefined);
      await pending;
    });
    expect(firstRefresh).not.toHaveBeenCalled();
    expect(firstClear).not.toHaveBeenCalled();
    expect(replacementRefresh).toHaveBeenCalledWith({ projectId: "project-a", sessionId: "root" });
    expect(replacementClear).toHaveBeenCalledWith("draft:child");
    expect(replacementError).toHaveBeenLastCalledWith(null);

    const failedPort = port({
      submitMessage: vi.fn(async () => Promise.reject(new Error("send failed"))),
    });
    const failureError = vi.fn();
    await render(failedPort, vi.fn(async () => true), vi.fn(), failureError, "later body");
    await act(async () => latest.sendSubSessionMessage("child"));
    expect(failedPort.submitMessage).toHaveBeenCalledOnce();
    expect(replacementPort.submitMessage).not.toHaveBeenCalled();
    expect(failureError).toHaveBeenCalledWith("send failed");
  });

  async function render(
    runPort: SessionRunPort,
    refresh: ReturnType<typeof vi.fn>,
    clearDraft: ReturnType<typeof vi.fn>,
    setError: ReturnType<typeof vi.fn>,
    body: string,
  ): Promise<void> {
    await act(async () => root.render(
      <Harness
        runPort={runPort}
        refresh={refresh}
        clearDraft={clearDraft}
        setError={setError}
        body={body}
      />,
    ));
  }

  function Harness({
    runPort,
    refresh,
    clearDraft,
    setError,
    body,
  }: {
    runPort: SessionRunPort;
    refresh: ReturnType<typeof vi.fn>;
    clearDraft: ReturnType<typeof vi.fn>;
    setError: ReturnType<typeof vi.fn>;
    body: string;
  }): null {
    latest = useSessionRunActions(
      "http://127.0.0.1:8787/",
      { child: body },
      vi.fn(),
      ["attachment-a"],
      clearDraft,
      draftStore,
      { current: { projectId: "project-a", sessionId: "root" } },
      refresh,
      vi.fn(async () => undefined),
      runPort,
      setError,
    );
    return null;
  }
});

function port(overrides: Partial<SessionRunPort> = {}): SessionRunPort {
  return {
    interrupt: vi.fn(async () => "interrupted" as const),
    submitMessage: vi.fn(async () => undefined),
    retryRun: vi.fn(async () => undefined),
    ...overrides,
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
