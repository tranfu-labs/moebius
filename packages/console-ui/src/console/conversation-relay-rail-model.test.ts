import { describe, expect, it } from "vitest";
import { translate } from "@/i18n";

import {
  adjacentConversationRelayEventId,
  computeConversationRelayRows,
  createConversationRelayCurvePath,
  deriveConversationRelayCapacity,
  deriveConversationRelayExpandedRowHeight,
  deriveConversationRelayLayout,
  deriveConversationRelayPaths,
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

  it("derives capacity from the expanded row height and compacts only for short viewports", () => {
    expect(deriveConversationRelayCapacity(160)).toBe(7);
    expect(deriveConversationRelayCapacity(500)).toBe(15);
    expect(deriveConversationRelayCapacity(80)).toBe(4);
    expect(deriveConversationRelayCapacity(40)).toBe(3);
    expect(deriveConversationRelayExpandedRowHeight(500, 7)).toBe(32);
    expect(deriveConversationRelayExpandedRowHeight(160, 7)).toBeCloseTo(160 / 7);
    expect(deriveConversationRelayExpandedRowHeight(80, 4)).toBe(20);
    expect(
      computeConversationRelayRows(EVENTS, "message-7", 3)
        .map((row) => row.type === "event" ? row.event.id : "omission"),
    ).toEqual(["message-1", "message-7", "message-13"]);
  });

  it("assigns member lanes by first appearance and grows width from lane count", () => {
    const sequence = relaySequence();
    const layout = deriveConversationRelayLayout(sequence, 760);

    expect(layout.agentKeys).toEqual(["primary", "dev", "qa"]);
    expect([...layout.lanes]).toEqual([
      ["user", 14],
      ["primary", 32],
      ["dev", 50],
      ["qa", 68],
    ]);
    expect(layout.expandedWidth).toBe(82);
  });

  it.each([
    { memberCount: 0, availableWidth: 760, width: 44, laneStep: 0 },
    { memberCount: 1, availableWidth: 760, width: 46, laneStep: 18 },
    { memberCount: 3, availableWidth: 760, width: 82, laneStep: 18 },
    { memberCount: 20, availableWidth: 150, width: 150, laneStep: 6.1 },
    { memberCount: 20, availableWidth: 20, width: 44, laneStep: 0.8 },
  ])(
    "constrains $memberCount member lanes to $availableWidth px",
    ({ memberCount, availableWidth, width, laneStep }) => {
      const memberEvents = Array.from(
        { length: memberCount },
        (_, index): ConversationRelayEvent => relayEvent(
          index + 1,
          "agent",
          `member-${String(index + 1)}`,
        ),
      );
      const layout = deriveConversationRelayLayout(memberEvents, availableWidth);
      expect(layout.expandedWidth).toBe(width);
      expect(layout.laneStep).toBeCloseTo(laneStep);
    },
  );

  it("builds a user spine and colored member branches with split and merge curves", () => {
    const sequence = relaySequence();
    const rows = computeConversationRelayRows(sequence, "message-6", 7);
    const layout = deriveConversationRelayLayout(sequence, 760);
    const paths = deriveConversationRelayPaths(sequence, rows, layout, 32);

    expect(paths[0]).toMatchObject({
      actorKey: null,
      eventIds: ["message-1"],
      kind: "spine",
    });
    expect(paths[0]?.d).toBe("M 14 16 L 14 176");
    expect(paths.slice(1).map((path) => path.actorKey)).toEqual([
      "primary",
      "dev",
      "qa",
    ]);
    expect(paths.find((path) => path.actorKey === "primary")?.d).toContain(
      "M 14 16 C 14 32 32 32 32 48",
    );
    expect(paths.find((path) => path.actorKey === "primary")?.d).toContain(
      "L 32 112 C 32 128 68 128 68 144",
    );
    expect(paths.find((path) => path.actorKey === "dev")?.eventIds).toEqual([
      "message-3",
      "message-6",
    ]);
  });

  it("handles user-only, consecutive-member, and member-at-both-edges histories", () => {
    const userOnly = [relayEvent(1, "user", "user")];
    expect(deriveConversationRelayPaths(
      userOnly,
      computeConversationRelayRows(userOnly, "message-1", 7),
      deriveConversationRelayLayout(userOnly, 760),
      32,
    )).toEqual([]);

    const consecutive = [
      relayEvent(1, "user", "user"),
      relayEvent(2, "agent", "dev"),
      relayEvent(3, "agent", "dev"),
      relayEvent(4, "user", "user"),
    ];
    const consecutiveBranch = deriveConversationRelayPaths(
      consecutive,
      computeConversationRelayRows(consecutive, "message-4", 7),
      deriveConversationRelayLayout(consecutive, 760),
      32,
    ).find((path) => path.actorKey === "dev");
    expect(consecutiveBranch?.eventIds).toEqual(["message-2", "message-3"]);
    expect(consecutiveBranch?.d).toContain("L 32 80 C 32 96 14 96 14 112");

    const memberEdges = [
      relayEvent(1, "agent", "dev"),
      relayEvent(2, "user", "user"),
      relayEvent(3, "agent", "dev"),
    ];
    const edgeBranch = deriveConversationRelayPaths(
      memberEdges,
      computeConversationRelayRows(memberEdges, "message-3", 7),
      deriveConversationRelayLayout(memberEdges, 760),
      32,
    ).find((path) => path.actorKey === "dev");
    expect(edgeBranch?.d).toBe("M 32 16 L 32 80");
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

  it("uses a bounded cubic split curve without horizontal corners", () => {
    expect(createConversationRelayCurvePath(18, 10, 82, 30)).toBe(
      "M 18 10 C 18 20 82 20 82 30",
    );
  });

  it("splits member paths at both omission windows", () => {
    const repeatedMemberEvents = EVENTS.map((event) => ({
      ...event,
      kind: "agent" as const,
      actorKey: "dev",
    }));
    const rows = computeConversationRelayRows(repeatedMemberEvents, "message-7", 7);
    const layout = deriveConversationRelayLayout(repeatedMemberEvents, 760);
    const paths = deriveConversationRelayPaths(repeatedMemberEvents, rows, layout, 32);
    const visibleIds = new Set(rows.flatMap((row) =>
      row.type === "event" ? [row.event.id] : []));

    expect(rows.filter((row) => row.type === "omission")).toHaveLength(2);
    for (const path of paths.filter((candidate) => candidate.kind === "branch")) {
      expect(path.eventIds.every((eventId) => visibleIds.has(eventId))).toBe(true);
    }
    expect(paths.filter((path) => path.actorKey === "dev")).toHaveLength(3);
  });

  it.each([
    { focusId: "message-1", omissionCount: 1, spineCount: 2 },
    { focusId: "message-21", omissionCount: 2, spineCount: 3 },
    { focusId: "message-42", omissionCount: 1, spineCount: 2 },
  ])(
    "splits every path at omission rows around $focusId",
    ({ focusId, omissionCount, spineCount }) => {
      const longEvents = Array.from(
        { length: 42 },
        (_, index): ConversationRelayEvent => ({
          ...EVENTS[index % EVENTS.length]!,
          id: `message-${String(index + 1)}`,
          messageId: index + 1,
        }),
      );
      const rows = computeConversationRelayRows(longEvents, focusId, 17);
      const paths = deriveConversationRelayPaths(
        longEvents,
        rows,
        deriveConversationRelayLayout(longEvents, 760),
        32,
      );

      expect(rows.filter((row) => row.type === "omission")).toHaveLength(
        omissionCount,
      );
      expect(paths.filter((path) => path.kind === "spine")).toHaveLength(
        spineCount,
      );
      expectEveryPathToStopAtOmissions(rows, paths, 32);
    },
  );

  it("moves a browse cursor without inventing events", () => {
    expect(adjacentConversationRelayEventId(EVENTS, "message-7", 1)).toBe("message-8");
    expect(adjacentConversationRelayEventId(EVENTS, "message-1", -1)).toBe("message-1");
  });
});

function relaySequence(): ConversationRelayEvent[] {
  return [
    relayEvent(1, "user", "user"),
    relayEvent(2, "agent", "primary"),
    relayEvent(3, "agent", "dev"),
    relayEvent(4, "agent", "primary"),
    relayEvent(5, "agent", "qa"),
    relayEvent(6, "agent", "dev"),
  ];
}

function relayEvent(
  id: number,
  kind: "user" | "agent",
  actorKey: string,
): ConversationRelayEvent {
  return {
    id: `message-${String(id)}`,
    messageId: id,
    kind,
    actorKey,
    actorName: actorKey,
    body: `message ${String(id)}`,
    updatedAt: "2026-07-26T10:00:00.000Z",
  };
}

function expectEveryPathToStopAtOmissions(
  rows: readonly ReturnType<typeof computeConversationRelayRows>[number][],
  paths: readonly ReturnType<typeof deriveConversationRelayPaths>[number][],
  rowHeight: number,
): void {
  const omissionRowIndexes = rows.flatMap((row, rowIndex) =>
    row.type === "omission" ? [rowIndex] : []);
  for (const path of paths) {
    const coordinates = path.d
      .match(/-?\d+(?:\.\d+)?/g)
      ?.map(Number) ?? [];
    const yCoordinates = coordinates.filter((_, index) => index % 2 === 1);
    const minimumY = Math.min(...yCoordinates);
    const maximumY = Math.max(...yCoordinates);
    for (const rowIndex of omissionRowIndexes) {
      const omissionTop = rowIndex * rowHeight;
      const omissionBottom = omissionTop + rowHeight;
      expect(
        maximumY <= omissionTop || minimumY >= omissionBottom,
        `${path.key} crossed omission row ${String(rowIndex)}: ${path.d}`,
      ).toBe(true);
    }
  }
}

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
