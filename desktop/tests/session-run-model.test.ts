import { describe, expect, it } from "vitest";

import {
  decideSessionRunAvailability,
  planSubSessionComposerBody,
  planSubSessionMessage,
} from "../src/console-page/session-run-model.js";

describe("session run model", () => {
  it("distinguishes unavailable, busy, and available session actions", () => {
    expect(decideSessionRunAvailability({ apiBase: null, sending: false })).toEqual({
      kind: "unavailable",
    });
    expect(decideSessionRunAvailability({ apiBase: "http://local/", sending: true })).toEqual({
      kind: "busy",
    });
    expect(decideSessionRunAvailability({ apiBase: "http://local/", sending: false })).toEqual({
      kind: "available",
      apiBase: "http://local/",
    });
  });

  it("uses an active composer value and only sends meaningful body or attachments", () => {
    expect(planSubSessionComposerBody({ child: "edited" }, "child", "stored")).toBe("edited");
    expect(planSubSessionComposerBody({}, "child", "stored")).toBe("stored");
    expect(planSubSessionMessage({ body: "  ", attachmentIds: [] })).toEqual({ kind: "skip" });
    expect(planSubSessionMessage({ body: "", attachmentIds: ["attachment-a"] })).toEqual({
      kind: "send",
      body: "",
      attachmentIds: ["attachment-a"],
    });
  });
});
