import { describe, expect, it } from "vitest";

import {
  activateConversationComposerDraft,
  clearConversationComposerDraft,
  conversationSubmissionBlockReason,
  createConversationDraftStore,
  editConversationComposerDraft,
  NEW_CONVERSATION_DRAFT_KEY,
  sessionDraftKey,
} from "../src/console-page/draft-store.js";

describe("conversation draft store", () => {
  it("keeps new-conversation and per-session drafts isolated across store instances", () => {
    const storage = new MemoryStorage();
    const firstRun = createConversationDraftStore(storage);
    firstRun.write(NEW_CONVERSATION_DRAFT_KEY, "new draft");
    firstRun.write(sessionDraftKey("session-a"), "session A draft");
    firstRun.write(sessionDraftKey("session-b"), "session B draft");

    const restarted = createConversationDraftStore(storage);
    expect(restarted.read(NEW_CONVERSATION_DRAFT_KEY)).toBe("new draft");
    expect(restarted.read(sessionDraftKey("session-a"))).toBe("session A draft");
    expect(restarted.read(sessionDraftKey("session-b"))).toBe("session B draft");
  });

  it("clears only draft:new after a successful creation", () => {
    const storage = new MemoryStorage();
    const drafts = createConversationDraftStore(storage);
    drafts.write(NEW_CONVERSATION_DRAFT_KEY, "new draft");
    drafts.write(sessionDraftKey("session-a"), "existing draft");

    drafts.clear(NEW_CONVERSATION_DRAFT_KEY);

    expect(drafts.read(NEW_CONVERSATION_DRAFT_KEY)).toBe("");
    expect(drafts.read(sessionDraftKey("session-a"))).toBe("existing draft");
  });

  it("persists edit-and-resend recovery metadata separately from visible draft text", () => {
    const storage = new MemoryStorage();
    const key = sessionDraftKey("session-a");
    const firstRun = createConversationDraftStore(storage);
    firstRun.write(key, "修正后的指令");
    firstRun.writeResumeRunId(key, "run-stopped");

    const restarted = createConversationDraftStore(storage);
    expect(restarted.read(key)).toBe("修正后的指令");
    expect(restarted.readResumeRunId(key)).toBe("run-stopped");

    restarted.clearResumeRunId(key);
    expect(restarted.read(key)).toBe("修正后的指令");
    expect(restarted.readResumeRunId(key)).toBeNull();
  });

  it("keeps the live value owned by the activated session", () => {
    const sessionA = sessionDraftKey("session-a");
    const sessionB = sessionDraftKey("session-b");
    const activated = activateConversationComposerDraft(
      { key: sessionA, value: "session A draft" },
      sessionB,
      "persisted B draft",
    );
    const edited = editConversationComposerDraft(activated, "live B draft");

    expect(edited).toEqual({ key: sessionB, value: "live B draft" });
    expect(activateConversationComposerDraft(edited, sessionB, "")).toBe(edited);
    expect(clearConversationComposerDraft(edited, sessionA)).toBe(edited);
    expect(clearConversationComposerDraft(edited, sessionB)).toEqual({
      key: sessionB,
      value: "",
    });
  });

  it("returns semantic submission blocks without changing the draft", () => {
    const draft = { key: sessionDraftKey("session-b"), value: "keep me" };

    expect(conversationSubmissionBlockReason({
      ownerKey: draft.key,
      selectedSessionId: "session-b",
      transitionPending: true,
    })).toBe("transition-pending");
    expect(conversationSubmissionBlockReason({
      ownerKey: draft.key,
      selectedSessionId: "session-a",
      transitionPending: false,
    })).toBe("owner-mismatch");
    expect(conversationSubmissionBlockReason({
      ownerKey: draft.key,
      selectedSessionId: "session-b",
      transitionPending: false,
    })).toBeNull();
    expect(draft).toEqual({ key: sessionDraftKey("session-b"), value: "keep me" });
  });
});

class MemoryStorage implements Storage {
  private readonly values = new Map<string, string>();

  get length(): number {
    return this.values.size;
  }

  clear(): void {
    this.values.clear();
  }

  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  key(index: number): string | null {
    return [...this.values.keys()][index] ?? null;
  }

  removeItem(key: string): void {
    this.values.delete(key);
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value);
  }
}
