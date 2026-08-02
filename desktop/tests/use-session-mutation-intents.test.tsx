/** @vitest-environment jsdom */

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { ConsoleStateActions } from "../src/console-page/console-state-actions.js";
import type { useConversationSearch } from "../src/console-page/use-conversation-search.js";
import { useSessionMutationIntents } from "../src/console-page/use-session-mutation-intents.js";
import type { RightSidebarTabsBundle } from "../src/console-page/use-right-sidebar-tabs.js";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe("session mutation intents", () => {
  let host: HTMLDivElement;
  let root: Root;
  let latest: ReturnType<typeof useSessionMutationIntents>;

  beforeEach(() => {
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    host.remove();
  });

  it("finishes a slow rename through current tab callbacks and resumes search after failure", async () => {
    const slow = deferred<void>();
    const resumeFirst = vi.fn();
    await render({
      renameSession: vi.fn(async () => slow.promise),
      suspendForMutation: vi.fn(() => resumeFirst),
      renameConversation: vi.fn(),
      showHost: vi.fn(),
    });
    const pending = latest.renameSession({ id: "session-a", titleRevision: 1 }, " Renamed ");

    const replacementRename = vi.fn();
    const replacementShow = vi.fn();
    await render({
      renameSession: vi.fn(async () => undefined),
      suspendForMutation: vi.fn(() => vi.fn()),
      renameConversation: replacementRename,
      showHost: replacementShow,
    });
    slow.resolve(undefined);
    await act(async () => pending);
    expect(replacementRename).toHaveBeenCalledWith("session-a", "Renamed");
    expect(replacementShow).toHaveBeenCalledWith("host-current");
    expect(resumeFirst).toHaveBeenCalledOnce();

    const resumeFailure = vi.fn();
    await render({
      renameSession: vi.fn(async () => Promise.reject(new Error("rename failed"))),
      suspendForMutation: vi.fn(() => resumeFailure),
      renameConversation: vi.fn(),
      showHost: vi.fn(),
    });
    await expect(latest.renameSession({ id: "session-a" }, "Broken")).rejects.toThrow("rename failed");
    expect(resumeFailure).toHaveBeenCalledOnce();
  });

  async function render(input: {
    renameSession: ReturnType<typeof vi.fn>;
    suspendForMutation: ReturnType<typeof vi.fn>;
    renameConversation: ReturnType<typeof vi.fn>;
    showHost: ReturnType<typeof vi.fn>;
  }): Promise<void> {
    await act(async () => root.render(<Harness input={input} />));
  }

  function Harness({ input }: { input: Parameters<typeof render>[0] }): null {
    latest = useSessionMutationIntents(
      { renameSession: input.renameSession } as unknown as ConsoleStateActions,
      { suspendForMutation: input.suspendForMutation } as unknown as ReturnType<typeof useConversationSearch>,
      {
        store: { renameConversation: input.renameConversation },
        showHost: input.showHost,
      } as unknown as RightSidebarTabsBundle,
      { current: { selectedSessionId: "other", hostSessionId: "host-current" } } as never,
      { current: { projectId: "project-a", sessionId: "session-current" } },
      vi.fn(),
      vi.fn(),
      undefined,
    );
    return null;
  }
});

function deferred<T>(): { promise: Promise<T>; resolve(value: T): void } {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}
