import { describe, expect, it } from "vitest";

import {
  assertAttachmentCloneTarget,
  planAttachmentContentScopeValue,
  planAttachmentDraftKey,
} from "../src/local-console/attachment-plan.js";

describe("local attachment plan", () => {
  it("keeps draft ownership and content scope bound to the session", () => {
    expect(planAttachmentDraftKey({ requestedDraftKey: undefined, sessionId: "session-a" }))
      .toBe("draft:session-a");
    expect(() => assertAttachmentCloneTarget({ targetDraftKey: "draft:other", sessionId: "session-a" }))
      .toThrow("Attachment target draft does not belong to the session");
    expect(planAttachmentContentScopeValue({ draftKey: undefined, sessionId: "session-a" })).toBe("session-a");
    expect(planAttachmentContentScopeValue({ draftKey: undefined, sessionId: undefined })).toBe("");
  });
});
