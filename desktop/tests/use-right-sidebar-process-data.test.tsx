/** @vitest-environment jsdom */

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { OperatorProcessDebugInvocation } from "@moebius/console-ui";

import { waitForCondition } from "../../src/testing/wait.js";
import type { ProcessDataSyncPort } from "../src/console-page/process-data-sync-contract.js";
import { useRightSidebarProcessData } from "../src/console-page/use-right-sidebar-process-data.js";
import { createTestConsoleErrorController } from "./console-error-test-controller.js";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

type ProcessBundle = ReturnType<typeof useRightSidebarProcessData>;

describe("right sidebar process data controller", () => {
  let host: HTMLDivElement;
  let root: Root;
  let latest: ProcessBundle;

  beforeEach(() => {
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    host.remove();
  });

  it("settles a slow invocation with its request port and uses the replacement port after rerender", async () => {
    const slow = deferred<OperatorProcessDebugInvocation>();
    const first = port(async () => await slow.promise);
    const replacement = port(async (input) => invocation(input.sessionId, input.runId, "replacement"));
    await render(first);
    act(() => latest.readInvocation("session-a", "run-a"));
    expect(first.loadInvocation).toHaveBeenCalledOnce();

    await render(replacement);
    await act(async () => slow.resolve(invocation("session-a", "run-a", "initial")));
    await waitFor(() => latest.invocations["session-a:run-a"]?.status === "ready");

    await act(async () => {
      latest.readInvocation("session-a", "run-b");
      await Promise.resolve();
      await Promise.resolve();
    });
    await waitFor(() => latest.invocations["session-a:run-b"]?.status === "ready");
    expect(first.loadInvocation).toHaveBeenCalledOnce();
    expect(replacement.loadInvocation).toHaveBeenCalledOnce();
    expect(latest.invocations["session-a:run-a"]).toMatchObject({
      invocation: { reason: "initial" },
    });
    expect(latest.invocations["session-a:run-b"]).toMatchObject({
      invocation: { reason: "replacement" },
    });
  });

  async function render(port: ProcessDataSyncPort): Promise<void> {
    await act(async () => root.render(<Harness port={port} />));
  }

  function Harness({ port }: { port: ProcessDataSyncPort }): null {
    latest = useRightSidebarProcessData(
      "http://127.0.0.1:8787/",
      null,
      "session-a",
      "session-a",
      port,
      (sessionId, runId) => `${sessionId}:${runId}`,
      createTestConsoleErrorController().controller,
    );
    return null;
  }
});

function port(
  loadInvocation: ProcessDataSyncPort["loadInvocation"],
): ProcessDataSyncPort & { loadInvocation: ReturnType<typeof vi.fn> } {
  return {
    loadOutput: vi.fn(),
    loadUpdate: vi.fn(),
    loadInvocation: vi.fn(loadInvocation),
  };
}

function invocation(
  sessionId: string,
  runId: string,
  reason: string,
): OperatorProcessDebugInvocation {
  return { status: "unavailable", sessionId, runId, reason };
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
    describe: "right sidebar process data condition",
    snapshot: () => ({ text: document.body.textContent }),
  });
}
