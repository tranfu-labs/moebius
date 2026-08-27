/** @vitest-environment jsdom */

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createAgentFormDraft, type AgentFormSpec } from "@moebius/console-ui";

import { agentFormDraftKey, agentFormSubmittedKey } from "../src/console-page/conversation-draft-model.js";
import { createConversationDraftStore, type ConversationDraftStore } from "../src/console-page/draft-store.js";
import { readAgentFormDraft, writeAgentFormDraft } from "../src/console-page/agent-form-draft.js";
import {
  useAgentFormController,
  type AgentFormControllerBundle,
} from "../src/console-page/use-agent-form-controller.js";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const spec: AgentFormSpec = {
  id: "decision",
  memberName: "开发",
  memberSlug: "dev",
  questions: [{
    id: "choice",
    kind: "single",
    title: "下一步？",
    options: [{ id: "keep", title: "保留" }],
  }],
};

describe("agent form host controller", () => {
  let host: HTMLDivElement;
  let root: Root;
  let latest: AgentFormControllerBundle;
  let store: ConversationDraftStore;

  beforeEach(() => {
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
    store = createConversationDraftStore(new MemoryStorage());
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    host.remove();
  });

  it("skips the whole form and clears its persisted answer", async () => {
    const draftKey = agentFormDraftKey("session-a", 7);
    const submittedKey = agentFormSubmittedKey("session-a", 7);
    writeAgentFormDraft(store, draftKey, createAgentFormDraft(spec));
    await render({ sendFormMessage: vi.fn(async () => true) });
    await act(async () => latest.controller?.onSkip?.());

    expect(store.read(draftKey)).toBe("");
    expect(store.read(submittedKey)).toBe("1");
    expect(latest.controller).toBeNull();
  });

  it("discards the form only after a successful answer send", async () => {
    const sendFormMessage = vi.fn(async () => true);
    const draftKey = agentFormDraftKey("session-a", 7);
    writeAgentFormDraft(store, draftKey, createAgentFormDraft(spec));
    await render({ sendFormMessage });
    await act(async () => latest.controller?.onSubmit?.("下一步？：保留", createAgentFormDraft(spec)));

    expect(sendFormMessage).toHaveBeenCalledWith("下一步？：保留");
    expect(store.read(draftKey)).toBe("");
    expect(store.read(agentFormSubmittedKey("session-a", 7))).toBe("1");
    expect(latest.controller).toBeNull();
  });

  it("keeps the form and answer draft when the answer send fails", async () => {
    const sendFormMessage = vi.fn(async () => false);
    const draft = createAgentFormDraft(spec);
    const draftKey = agentFormDraftKey("session-a", 7);
    writeAgentFormDraft(store, draftKey, draft);
    await render({ sendFormMessage });
    await act(async () => latest.controller?.onSubmit?.("下一步？：保留", createAgentFormDraft(spec)));

    expect(readAgentFormDraft(store, draftKey, spec)).toEqual(draft);
    expect(store.read(agentFormSubmittedKey("session-a", 7))).toBe("");
    expect(latest.controller).not.toBeNull();
  });

  it("blocks a reentrant form submit while the first answer is in flight", async () => {
    const sendResult = deferred<boolean>();
    const sendFormMessage = vi.fn(() => sendResult.promise);
    await render({ sendFormMessage });
    const controller = latest.controller;
    expect(controller).not.toBeNull();

    await act(async () => {
      controller?.onSubmit?.("第一次", createAgentFormDraft(spec));
      controller?.onSubmit?.("第二次", createAgentFormDraft(spec));
    });

    expect(sendFormMessage).toHaveBeenCalledOnce();
    expect(sendFormMessage).toHaveBeenCalledWith("第一次");
    await act(async () => sendResult.resolve(true));
    expect(latest.controller).toBeNull();
  });

  it("discards the active form after an independent composer send succeeds", async () => {
    const draftKey = agentFormDraftKey("session-a", 7);
    writeAgentFormDraft(store, draftKey, createAgentFormDraft(spec));
    await render({ sendFormMessage: vi.fn(async () => true) });
    await act(async () => latest.onIndependentMessageResult(true));

    expect(store.read(draftKey)).toBe("");
    expect(store.read(agentFormSubmittedKey("session-a", 7))).toBe("1");
    expect(latest.controller).toBeNull();
  });

  it("keeps the active form after an independent composer send fails", async () => {
    const draftKey = agentFormDraftKey("session-a", 7);
    const draft = createAgentFormDraft(spec);
    writeAgentFormDraft(store, draftKey, draft);
    await render({ sendFormMessage: vi.fn(async () => true) });
    await act(async () => latest.onIndependentMessageResult(false));

    expect(readAgentFormDraft(store, draftKey, spec)).toEqual(draft);
    expect(store.read(agentFormSubmittedKey("session-a", 7))).toBe("");
    expect(latest.controller).not.toBeNull();
  });

  async function render(input: { sendFormMessage(message: string): Promise<boolean> }): Promise<void> {
    await act(async () => root.render(<Harness sendFormMessage={input.sendFormMessage} />));
    await act(async () => Promise.resolve());
  }

  function Harness(props: { sendFormMessage(message: string): Promise<boolean> }): null {
    latest = useAgentFormController({
      selectedSession: { sessionId: "session-a" },
      agentForm: { spec, sourceMessageId: 7 },
      conversationDraftStore: store,
      sendFormMessage: props.sendFormMessage,
      transitionPending: false,
    });
    return null;
  }
});

class MemoryStorage implements Storage {
  private readonly values = new Map<string, string>();

  get length(): number { return this.values.size; }
  clear(): void { this.values.clear(); }
  getItem(key: string): string | null { return this.values.get(key) ?? null; }
  key(index: number): string | null { return [...this.values.keys()][index] ?? null; }
  removeItem(key: string): void { this.values.delete(key); }
  setItem(key: string, value: string): void { this.values.set(key, value); }
}

function deferred<T>(): { promise: Promise<T>; resolve(value: T): void } {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}
