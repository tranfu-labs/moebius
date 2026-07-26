import { describe, expect, it } from "vitest";
import {
  CONVERSATION,
  activateEvent,
  adjacentEventId,
  computeRailRows,
  createGitGraphCurvePath,
  deriveRailCapacity,
  overlayWidthForContainer,
  previewForEvent
} from "./rail-model.js";

describe("main conversation rail model", () => {
  it("derives capacity from the actual timeline viewport", () => {
    expect(deriveRailCapacity(160)).toBe(7);
    expect(deriveRailCapacity(500)).toBe(24);
    expect(deriveRailCapacity(900)).toBe(44);
  });

  it("keeps the focus and far boundary when focus is near the start", () => {
    const rows = computeRailRows(CONVERSATION.events, "event-02", 10);
    const eventIds = rows.flatMap((row) =>
      row.type === "event" ? [row.event.id] : []
    );
    expect(rows).toHaveLength(10);
    expect(eventIds).toContain("event-02");
    expect(eventIds.at(0)).toBe("event-01");
    expect(eventIds.at(-1)).toBe("event-34");
    expect(rows.at(-2)?.type).toBe("omission");
  });

  it("keeps the focus and first boundary when focus is near the end", () => {
    const rows = computeRailRows(CONVERSATION.events, "event-33", 10);
    const eventIds = rows.flatMap((row) =>
      row.type === "event" ? [row.event.id] : []
    );
    expect(rows).toHaveLength(10);
    expect(eventIds).toContain("event-33");
    expect(eventIds.at(0)).toBe("event-01");
    expect(eventIds.at(-1)).toBe("event-34");
    expect(rows[1]?.type).toBe("omission");
  });

  it("uses two omissions around a middle focus without duplicating events", () => {
    const rows = computeRailRows(CONVERSATION.events, "event-18", 11);
    const eventIds = rows.flatMap((row) =>
      row.type === "event" ? [row.event.id] : []
    );
    expect(rows).toHaveLength(11);
    expect(rows.filter((row) => row.type === "omission")).toHaveLength(2);
    expect(eventIds).toContain("event-18");
    expect(new Set(eventIds).size).toBe(eventIds.length);
  });

  it("preserves the true A to B to C to B to C ordering", () => {
    const actorSequence = CONVERSATION.events
      .slice(13, 18)
      .map((event) => event.actorId);
    expect(actorSequence).toEqual([
      "product-lead",
      "product-reviewer",
      "ui-prototyper",
      "product-reviewer",
      "ui-prototyper"
    ]);
  });

  it("keeps the user preview title but removes it from agent previews", () => {
    const userPreview = previewForEvent(CONVERSATION, CONVERSATION.events[0]);
    const agentPreview = previewForEvent(CONVERSATION, CONVERSATION.events[32]);
    expect(userPreview).toEqual({
      title: "你",
      actorName: "你",
      body: CONVERSATION.events[0]?.body
    });
    expect(agentPreview.title).toBeNull();
    expect(agentPreview.actorName).toBe("界面原型师");
    expect(agentPreview.body).toBe(CONVERSATION.events[32]?.body);
  });

  it("uses the onboarding Git graph cubic curve between adjacent rows", () => {
    expect(createGitGraphCurvePath(18, 10, 82, 30)).toBe(
      "M 18 10 C 18 22.903225806451612 82 17.096774193548388 82 30"
    );
  });

  it("moves rail focus without activating the timeline", () => {
    expect(adjacentEventId(CONVERSATION.events, "event-18", 1)).toBe("event-19");
    expect(adjacentEventId(CONVERSATION.events, "event-01", -1)).toBe("event-01");
  });

  it("keeps the previous reading position when precise location fails", () => {
    const result = activateEvent("event-18", "event-04", true);
    expect(result.activated).toBe(false);
    expect(result.focusedEventId).toBe("event-18");
    expect(result.feedback).toContain("保持当前阅读位置");
  });

  it("responds to the main conversation container width", () => {
    expect(overlayWidthForContainer(480)).toBe(148);
    expect(overlayWidthForContainer(720)).toBe(185);
    expect(overlayWidthForContainer(1000)).toBe(224);
  });
});
