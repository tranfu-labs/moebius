/** @vitest-environment jsdom */

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Translate } from "@moebius/console-ui";

import type { ConversationDraftKey } from "../src/console-page/conversation-draft-model.js";
import { useConversationTransition } from "../src/console-page/use-conversation-transition.js";
import { createTestConsoleErrorSetter } from "./console-error-test-controller.js";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

interface TransitionInput {
  composerOwnerKey: ConversationDraftKey;
  selectedSessionId: string;
  transitionSessionView(previousSessionId: string, viewedSessionId: string): Promise<string | null>;
  sendMessage(): Promise<void>;
  setError(error: string | null): void;
  t: Translate;
}
type TransitionBundle = ReturnType<typeof useConversationTransition>;

describe("conversation transition controller", () => {
  let host: HTMLDivElement;
  let root: Root;
  let latest: TransitionBundle;

  beforeEach(() => {
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    host.remove();
  });

  it("serializes rapid round trips and uses the callback owner captured for each generation", async () => {
    const first = deferred<string | null>();
    const second = deferred<string | null>();
    const firstTransition = vi.fn(async () => first.promise);
    const latestTransition = vi.fn(async () => second.promise);
    const firstSend = vi.fn(async () => undefined);
    const latestSend = vi.fn(async () => undefined);
    const firstError = vi.fn();
    const latestError = vi.fn();
    await render(input(firstTransition, firstSend, firstError));
    act(() => latest.queueTransition("session-a", "session-b"));

    await render(input(latestTransition, latestSend, latestError));
    act(() => latest.queueTransition("session-b", "session-a"));
    expect(firstTransition).toHaveBeenCalledWith("session-a", "session-b");
    expect(latestTransition).not.toHaveBeenCalled();
    expect(latest.transitionPending).toBe(true);

    act(() => latest.sendMainComposer());
    expect(firstError).not.toHaveBeenCalled();
    expect(latestError).toHaveBeenCalledWith("desktop.composer.transitionPending");
    await act(async () => {
      first.resolve(null);
      await first.promise;
      await Promise.resolve();
    });
    expect(latestTransition).toHaveBeenCalledWith("session-b", "session-a");
    expect(latest.transitionPending).toBe(true);

    await act(async () => {
      second.resolve("view state rejected");
      await second.promise;
      await Promise.resolve();
    });
    expect(latest.transitionPending).toBe(false);
    expect(latest.transitionError).toBe("view state rejected");
    act(() => latest.sendMainComposer());
    expect(firstSend).not.toHaveBeenCalled();
    expect(latestSend).toHaveBeenCalledOnce();
  });

  async function render(next: TransitionInput): Promise<void> {
    await act(async () => root.render(<Harness input={next} />));
  }

  function Harness(props: { input: TransitionInput }): null {
    latest = useConversationTransition(
      props.input.composerOwnerKey,
      props.input.selectedSessionId,
      props.input,
      createTestConsoleErrorSetter(props.input.setError),
      props.input.t,
    );
    return null;
  }
});

function input(
  transitionSessionView: TransitionInput["transitionSessionView"],
  sendMessage: TransitionInput["sendMessage"],
  setError: TransitionInput["setError"],
): TransitionInput {
  return {
    composerOwnerKey: "draft:session-a",
    selectedSessionId: "session-a",
    transitionSessionView,
    sendMessage,
    setError,
    t: ((key: string) => key) as Translate,
  };
}

function deferred<T>(): { promise: Promise<T>; resolve(value: T): void } {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}
