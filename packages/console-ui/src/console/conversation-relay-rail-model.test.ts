import { describe, expect, it } from "vitest";
import { translate } from "@/i18n";

import {
  adjacentConversationRelayEventId,
  computeConversationRelayRows,
  conversationRelayExpandedWidth,
  createConversationRelayCurvePath,
  deriveConversationRelayCapacity,
  projectConversationRelayEvents,
  type ConversationRelayEvent,
} from "@/console/conversation-relay-rail-model";

const EVENTS: ConversationRelayEvent[] = Array.from({ length: 13 }, (_, index) => ({
  id: `message-${String(index + 1)}`,
  messageId: index + 1,
  kind: index % 3 === 0 ? "user" : "agent",
  actorKey: index % 3 === 0 ? "user" : index % 2 === 0 ? "qa" : "dev",
  actorName: index % 3 === 0 ? "你" : index % 2 === 0 ? "测试" : "开发",
  body: `message ${String(index + 1)}`,
  updatedAt: "2026-07-26T10:00:00.000Z",
}));
const zhT: Parameters<typeof projectConversationRelayEvents>[2] = (key, values) =>
  translate("zh-CN", key, values);
const enT: Parameters<typeof projectConversationRelayEvents>[2] = (key, values) =>
  translate("en", key, values);

describe("conversation relay rail model", () => {
  it("projects only user and visible final Agent messages", () => {
    const events = projectConversationRelayEvents([
      message(1, "user", null, "目标"),
      message(2, "agent", "dev", "完成"),
      message(3, "system", null, "系统事实"),
      { ...message(4, "agent", "qa", "子会话"), sourceKind: "local-child-session-card" },
      { ...message(5, "agent", "qa", "运行占位"), sourceKind: "local-worker-run" },
    ], (role) => role === "dev" ? "开发工程师" : "测试工程师", zhT);

    expect(events.map((event) => [event.messageId, event.actorName])).toEqual([
      [1, "你"],
      [2, "开发工程师"],
    ]);
  });

  it("projects English user and attachment fallback copy without Chinese separators", () => {
    const events = projectConversationRelayEvents([
      { ...message(1, "user", null, ""), attachments: [{ displayName: "brief.md" }, { displayName: "logo.png" }] },
      message(2, "user", null, ""),
    ], () => "Agent", enT);

    expect(events.map((event) => [event.actorName, event.body])).toEqual([
      ["You", "brief.md, logo.png"],
      ["You", "Attachment message"],
    ]);
    expect(JSON.stringify(events)).not.toMatch(/\p{Script=Han}/u);
  });

  it("derives a viewport capacity and responsive overlay width", () => {
    expect(deriveConversationRelayCapacity(160)).toBe(7);
    expect(deriveConversationRelayCapacity(500)).toBe(24);
    expect(conversationRelayExpandedWidth(480)).toBe(148);
    expect(conversationRelayExpandedWidth(1000)).toBe(224);
  });

  it("keeps boundaries and focus while folding a long conversation", () => {
    const rows = computeConversationRelayRows(EVENTS, "message-7", 7);
    const ids = rows.flatMap((row) => row.type === "event" ? [row.event.id] : []);
    expect(rows).toHaveLength(7);
    expect(rows.filter((row) => row.type === "omission")).toHaveLength(2);
    expect(ids).toContain("message-1");
    expect(ids).toContain("message-7");
    expect(ids).toContain("message-13");
  });

  it("matches the onboarding Git graph cubic geometry", () => {
    expect(createConversationRelayCurvePath(18, 10, 82, 30)).toBe(
      "M 18 10 C 18 22.903225806451612 82 17.096774193548388 82 30",
    );
  });

  it("moves a browse cursor without inventing events", () => {
    expect(adjacentConversationRelayEventId(EVENTS, "message-7", 1)).toBe("message-8");
    expect(adjacentConversationRelayEventId(EVENTS, "message-1", -1)).toBe("message-1");
  });
});

function message(
  id: number,
  speaker: "user" | "agent" | "system",
  role: string | null,
  body: string,
) {
  return {
    id,
    speaker,
    role,
    body,
    updatedAt: "2026-07-26T10:00:00.000Z",
  };
}
