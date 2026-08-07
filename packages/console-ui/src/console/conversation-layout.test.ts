import { describe, expect, it } from "vitest";

import {
  planConversationMessageReveal,
  planConversationReadingRestore,
  planConversationRelayClearance,
} from "./conversation-layout";

describe("conversation timeline layout decisions", () => {
  it("plans virtual scrolling when relay locates an unmounted message", () => {
    expect(planConversationMessageReveal([10, 20, 30], 30, [10])).toEqual({
      kind: "virtual",
      index: 2,
    });
    expect(planConversationMessageReveal([10, 20, 30], 10, [10])).toEqual({
      kind: "mounted",
      index: 0,
    });
  });

  it("restores a non-tail reading position across a session change", () => {
    const events = [
      { id: "message-1", messageId: 1 },
      { id: "message-2", messageId: 2 },
      { id: "message-3", messageId: 3 },
    ];
    expect(planConversationReadingRestore(events, 2)).toEqual({
      kind: "reveal",
      event: events[1],
    });
    expect(planConversationReadingRestore(events, 3)).toEqual({
      kind: "follow-latest",
      event: events[2],
    });
  });

  it("reserves only the collapsed relay rail footprint and overlays when expanded", () => {
    expect(planConversationRelayClearance(760)).toBe(56);
    expect(planConversationRelayClearance(903)).toBe(56);
    expect(planConversationRelayClearance(951)).toBe(56);
    expect(planConversationRelayClearance(952)).toBe(32);
    expect(planConversationRelayClearance(1_200)).toBe(32);
  });
});
