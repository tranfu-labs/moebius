import { describe, expect, it } from "vitest";
import {
  createAgentFormDraft,
  toggleOption,
  type AgentFormSpec,
} from "@moebius/console-ui";

import {
  agentFormDraftKey,
  agentFormSubmittedKey,
} from "../src/console-page/conversation-draft-model.js";
import {
  discardAgentForm,
  isAgentFormSubmitted,
  markAgentFormSubmitted,
  readAgentFormDraft,
  writeAgentFormDraft,
} from "../src/console-page/agent-form-draft.js";
import { createConversationDraftStore } from "../src/console-page/draft-store.js";

const spec: AgentFormSpec = {
  id: "decision",
  memberName: "开发",
  questions: [{
    id: "choice",
    kind: "single",
    title: "下一步？",
    options: [{ id: "keep", title: "保留" }],
  }],
};

describe("desktop agent form draft persistence", () => {
  it("round-trips answers per source message and drops malformed storage", () => {
    const store = createConversationDraftStore(new MemoryStorage());
    const key = agentFormDraftKey("session-a", 7);
    const question = spec.questions[0]!;
    if (question.kind !== "single") throw new Error("fixture question must be single choice");
    const draft = toggleOption(createAgentFormDraft(spec), question, "keep");

    writeAgentFormDraft(store, key, draft);
    expect(readAgentFormDraft(store, key, spec)).toEqual(draft);

    store.write(key, "{bad json");
    expect(readAgentFormDraft(store, key, spec)).toEqual(createAgentFormDraft(spec));
  });

  it("persists the submitted marker separately from the answer draft", () => {
    const store = createConversationDraftStore(new MemoryStorage());
    const key = agentFormSubmittedKey("session-a", 7);

    expect(isAgentFormSubmitted(store, key)).toBe(false);
    markAgentFormSubmitted(store, key);
    expect(isAgentFormSubmitted(store, key)).toBe(true);
  });

  it("discards the answer draft while retaining the submitted marker", () => {
    const store = createConversationDraftStore(new MemoryStorage());
    const draftKey = agentFormDraftKey("session-a", 7);
    const submittedKey = agentFormSubmittedKey("session-a", 7);
    writeAgentFormDraft(store, draftKey, createAgentFormDraft(spec));

    discardAgentForm(store, draftKey, submittedKey);

    expect(store.read(draftKey)).toBe("");
    expect(isAgentFormSubmitted(store, submittedKey)).toBe(true);
  });
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
