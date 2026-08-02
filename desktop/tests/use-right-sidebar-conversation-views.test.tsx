/** @vitest-environment jsdom */

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { waitForCondition } from "../../src/testing/wait.js";
import type {
  ConversationView,
  ConversationViewSyncPort,
} from "../src/console-page/conversation-view-sync-contract.js";
import { useRightSidebarConversationViews } from "../src/console-page/use-right-sidebar-conversation-views.js";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

type ViewsBundle = ReturnType<typeof useRightSidebarConversationViews>;

describe("right sidebar conversation view controller", () => {
  let host: HTMLDivElement;
  let root: Root;
  let latest: ViewsBundle;

  beforeEach(() => {
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    host.remove();
  });

  it("keeps a slow request with its invocation port and uses the replacement port after parent rerender", async () => {
    const slow = deferred<ConversationView>();
    const firstPort = port(async () => await slow.promise);
    const replacementPort = port(async () => view("replacement"));
    await render(firstPort);
    await waitFor(() => firstPort.load.mock.calls.length === 1);

    await render(replacementPort);
    await act(async () => slow.resolve(view("initial")));
    await waitFor(() => latest.subSessionViews["session-a"]?.status === "ready");
    expect(readTitle()).toBe("initial");

    await act(async () => latest.refreshSubSessionNow("session-a"));
    expect(readTitle()).toBe("replacement");
    expect(firstPort.load).toHaveBeenCalledOnce();
    expect(replacementPort.load).toHaveBeenCalledOnce();
  });

  async function render(port: ConversationViewSyncPort): Promise<void> {
    await act(async () => root.render(<Harness port={port} />));
  }

  function readTitle(): string | null {
    const state = latest.subSessionViews["session-a"];
    return state?.status === "ready" ? state.view.session.title : null;
  }

  function Harness({ port }: { port: ConversationViewSyncPort }): null {
    latest = useRightSidebarConversationViews(
      "http://127.0.0.1:8787/",
      "session-a",
      null,
      port,
    );
    return null;
  }
});

function port(load: ConversationViewSyncPort["load"]): ConversationViewSyncPort & {
  load: ReturnType<typeof vi.fn>;
} {
  return { load: vi.fn(load) };
}

function view(title: string): ConversationView {
  return {
    session: { sessionId: "session-a", title } as ConversationView["session"],
    messages: [],
    activeRun: null,
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
    describe: "right sidebar conversation view condition",
    snapshot: () => ({ text: document.body.textContent }),
  });
}
