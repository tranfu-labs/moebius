import { describe, expect, it } from "vitest";

import {
  activateConversationComposerDraft,
  conversationSubmissionBlockReason,
  editConversationComposerDraft,
  sessionDraftKey,
} from "../src/console-page/conversation-draft-model.js";

describe("conversation controller", () => {
  it("keeps target draft ownership through rerender and blocks send during slow selection", () => {
    const sessionA = sessionDraftKey("session-a");
    const sessionB = sessionDraftKey("session-b");
    const a = editConversationComposerDraft({ key: sessionA, value: "" }, "draft A");
    const switched = activateConversationComposerDraft(a, sessionB, "persisted B");
    const b = editConversationComposerDraft(switched, "draft B");
    const parentRerender = activateConversationComposerDraft(b, sessionB, "stale persisted B");

    expect(parentRerender).toBe(b);
    expect(parentRerender).toEqual({ key: sessionB, value: "draft B" });
    expect(a).toEqual({ key: sessionA, value: "draft A" });
    expect(conversationSubmissionBlockReason({
      ownerKey: parentRerender.key,
      selectedSessionId: "session-b",
      transitionPending: true,
    })).toBe("transition-pending");
  });
});
