import { describe, expect, it } from "vitest";

import {
  decideSidebarMessageAvailability,
  decideSidebarViewRefresh,
  planSidebarComposerBody,
  planSidebarMessageSubmission,
} from "../src/console-page/sidebar-message-model.js";

describe("sidebar message model", () => {
  it("only sends through an available idle console", () => {
    expect(decideSidebarMessageAvailability({ apiBase: null, sending: false })).toEqual({ kind: "skip" });
    expect(decideSidebarMessageAvailability({ apiBase: "http://local/", sending: true })).toEqual({ kind: "skip" });
    expect(decideSidebarMessageAvailability({ apiBase: "http://local/", sending: false })).toEqual({
      kind: "available",
      apiBase: "http://local/",
    });
    expect(planSidebarMessageSubmission({ body: "  ", attachmentIds: [] })).toEqual({ kind: "skip" });
    expect(planSidebarMessageSubmission({ body: "hello", attachmentIds: [] })).toMatchObject({
      kind: "send",
      body: "hello",
    });
  });

  it("uses active composer text and refreshes only a mounted sidebar view", () => {
    expect(planSidebarComposerBody({ child: "edited" }, "child", "stored")).toBe("edited");
    expect(planSidebarComposerBody({}, "child", "stored")).toBe("stored");
    expect(decideSidebarViewRefresh({ apiBase: null, hasView: true })).toEqual({ kind: "skip" });
    expect(decideSidebarViewRefresh({ apiBase: "http://local/", hasView: false })).toEqual({ kind: "skip" });
    expect(decideSidebarViewRefresh({ apiBase: "http://local/", hasView: true })).toEqual({
      kind: "refresh",
      apiBase: "http://local/",
    });
  });
});
