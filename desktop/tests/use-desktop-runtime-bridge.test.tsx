/** @vitest-environment jsdom */

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { waitForCondition } from "../../src/testing/wait.js";
import type { DesktopApi } from "../src/console-page/desktop-api-contract.js";
import { useDesktopRuntimeBridge } from "../src/console-page/use-desktop-runtime-bridge.js";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe("desktop runtime bridge", () => {
  let host: HTMLDivElement;
  let root: Root;
  let latest: ReturnType<typeof useDesktopRuntimeBridge>;

  beforeEach(() => {
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    host.remove();
  });

  it("ignores a stale preload result and recovers registry loading through current ports", async () => {
    const staleUrl = deferred<string | null>();
    await render({ getLocalConsoleUrl: vi.fn(async () => staleUrl.promise) }, failingLoader);

    const currentUrl = deferred<string | null>();
    const currentApi = { getLocalConsoleUrl: vi.fn(async () => currentUrl.promise) };
    await render(currentApi, failingLoader);
    await act(async () => {
      staleUrl.resolve("http://stale/");
      currentUrl.resolve("http://current/");
    });
    await waitFor(() => latest.apiBase === "http://current/");
    await waitFor(() => latest.executionRegistryState.status === "error");

    const registry = { models: [], providers: [] } as never;
    const recoveryLoader = vi.fn(async () => registry);
    await render(currentApi, recoveryLoader);
    await waitFor(() => latest.executionRegistryState.status === "ready");
    expect(recoveryLoader).toHaveBeenCalledWith(expect.objectContaining({ apiBase: "http://current/" }));
    expect(latest.executionRegistryState).toEqual({ status: "ready", registry });
  });

  async function render(
    api: DesktopApi,
    loader: Parameters<typeof useDesktopRuntimeBridge>[3],
  ): Promise<void> {
    await act(async () => root.render(<Harness api={api} loader={loader} />));
  }

  function Harness({
    api,
    loader,
  }: {
    api: DesktopApi;
    loader: Parameters<typeof useDesktopRuntimeBridge>[3];
  }): null {
    latest = useDesktopRuntimeBridge(api, undefined, "", loader, fakeFetch);
    return null;
  }
});

const failingLoader: Parameters<typeof useDesktopRuntimeBridge>[3] = vi.fn(async () => {
  throw new Error("registry unavailable");
});
const fakeFetch = vi.fn();

async function waitFor(predicate: () => boolean): Promise<void> {
  await waitForCondition(predicate, {
    timeoutMs: 2_000,
    pollMs: 10,
    tick: async (ms) => act(async () => new Promise((resolve) => setTimeout(resolve, ms))),
    describe: "desktop runtime bridge state",
    snapshot: () => ({ body: document.body.textContent }),
  });
}

function deferred<T>(): { promise: Promise<T>; resolve(value: T): void } {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}
