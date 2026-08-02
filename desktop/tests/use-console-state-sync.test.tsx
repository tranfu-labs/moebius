/** @vitest-environment jsdom */

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { waitForCondition } from "../../src/testing/wait.js";
import type { ConsoleStateSyncPort } from "../src/console-page/console-state-sync-contract.js";
import { ConsoleStateCoordinator } from "../src/console-page/console-state-coordinator.js";
import { useConsoleStateSync } from "../src/console-page/use-console-state-sync.js";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

interface SyncState {
  selectedProjectId: string;
  selectedSessionId: string;
  selectedSession: { sessionId: string; unreadSince: string | null } | null;
  messages: Array<{ speaker: string; createdAt: string }>;
}

describe("console state sync controller", () => {
  let host: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    host.remove();
  });

  it("routes a slow acknowledgement refresh through the latest parent callbacks and port", async () => {
    const acknowledgement = deferred<void>();
    const initial = input("initial", acknowledgement.promise);
    const replacement = input("replacement", Promise.resolve());
    replacement.state = initial.state;
    replacement.coordinator = initial.coordinator;
    replacement.acknowledged = initial.acknowledged;
    await render(initial);
    await waitFor(() => initial.commitState.mock.calls.length === 1);

    await render(replacement);
    await act(async () => acknowledgement.resolve(undefined));
    await waitFor(() => replacement.commitState.mock.calls.length === 1);

    expect(initial.port.acknowledgeDisplayedResult).toHaveBeenCalledOnce();
    expect(replacement.port.acknowledgeDisplayedResult).not.toHaveBeenCalled();
    expect(initial.port.fetch).toHaveBeenCalledOnce();
    expect(replacement.port.fetch).toHaveBeenCalledOnce();
    expect(replacement.commitSelection).toHaveBeenCalledWith({
      projectId: "project-replacement",
      sessionId: "session-replacement",
    });
    expect(initial.setError).toHaveBeenLastCalledWith(null);
    expect(replacement.setError).toHaveBeenLastCalledWith(null);
  });

  async function render(next: SyncInput): Promise<void> {
    await act(async () => root.render(<Harness input={next} />));
  }
});

interface SyncInput {
  state: SyncState;
  coordinator: ConsoleStateCoordinator;
  selectionRef: { current: { projectId: string; sessionId: string } };
  commitState: ReturnType<typeof vi.fn>;
  commitSelection: ReturnType<typeof vi.fn>;
  setError: ReturnType<typeof vi.fn>;
  activateComposer: ReturnType<typeof vi.fn>;
  acknowledged: { current: Set<string> };
  port: ConsoleStateSyncPort & {
    fetch: ReturnType<typeof vi.fn>;
    acknowledgeDisplayedResult: ReturnType<typeof vi.fn>;
  };
}

function Harness({ input }: { input: SyncInput }): null {
  useConsoleStateSync(
    "http://127.0.0.1:8787/",
    input.state,
    input.coordinator,
    input.selectionRef,
    input.commitState,
    input.commitSelection,
    input.setError,
    true,
    input.state.selectedSessionId,
    input.activateComposer,
    input.acknowledged,
    input.port,
  );
  return null;
}

function input(owner: string, acknowledgement: Promise<void>): SyncInput {
  const responseState: SyncState = {
    selectedProjectId: `project-${owner}`,
    selectedSessionId: `session-${owner}`,
    selectedSession: {
      sessionId: "session-visible",
      unreadSince: "2026-08-02T00:00:00.000Z",
    },
    messages: [{ speaker: "agent", createdAt: "2026-08-02T00:00:01.000Z" }],
  };
  return {
    state: responseState,
    coordinator: new ConsoleStateCoordinator(),
    selectionRef: { current: { projectId: `project-${owner}`, sessionId: `session-${owner}` } },
    commitState: vi.fn(),
    commitSelection: vi.fn(),
    setError: vi.fn(),
    activateComposer: vi.fn(),
    acknowledged: { current: new Set() },
    port: {
      fetch: vi.fn(async () => jsonResponse(responseState)),
      acknowledgeDisplayedResult: vi.fn(async () => await acknowledgement),
    },
  };
}

function deferred<T>(): { promise: Promise<T>; resolve(value: T): void } {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

function jsonResponse(value: unknown): Response {
  return new Response(JSON.stringify(value), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

async function waitFor(predicate: () => boolean): Promise<void> {
  await waitForCondition(predicate, {
    timeoutMs: 2_000,
    pollMs: 10,
    tick: async (ms) => act(async () => new Promise((resolve) => setTimeout(resolve, ms))),
    describe: "console state sync controller condition",
    snapshot: () => ({ text: document.body.textContent }),
  });
}
