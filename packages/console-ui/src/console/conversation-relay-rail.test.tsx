import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { ConversationRelayRail } from "@/console/conversation-relay-rail";
import type { ConversationRelayEvent } from "@/console/conversation-relay-rail-model";

const events: ConversationRelayEvent[] = [
  {
    id: "message-1",
    messageId: 1,
    kind: "user",
    actorKey: "user",
    actorName: "你",
    body: "请实现目录轨",
    updatedAt: "2026-07-26T10:00:00.000Z",
  },
  {
    id: "message-2",
    messageId: 2,
    kind: "agent",
    actorKey: "implementation-lead",
    actorName: "实施负责人",
    body: "已经准备实现",
    updatedAt: "2026-07-26T10:01:00.000Z",
  },
];

describe("ConversationRelayRail", () => {
  it("turns each expanded event row into the only node hit target", () => {
    renderRail();
    fireEvent.mouseEnter(screen.getByTestId("conversation-relay-rail"));

    expect(screen.getByTestId("relay-event-message-1")).toHaveAttribute(
      "data-hit-target",
      "row",
    );
    expect(screen.getByTestId("relay-event-message-2")).toHaveClass(
      "w-[var(--relay-expanded-width)]",
    );
  });

  it("draws cubic connectors between adjacent event rows", () => {
    renderRail();
    fireEvent.mouseEnter(screen.getByTestId("conversation-relay-rail"));
    const connector = screen.getByTestId("relay-connector");
    expect(connector.getAttribute("d")).toContain(" C ");
    expect(connector.getAttribute("d")).not.toContain(" H ");
  });

  it("shows only readable member metadata and original reply for Agent preview", () => {
    renderRail();
    fireEvent.mouseEnter(screen.getByTestId("conversation-relay-rail"));
    fireEvent.mouseEnter(screen.getByTestId("relay-event-message-2"));

    const preview = screen.getByTestId("relay-event-preview");
    expect(preview).toHaveTextContent("实施负责人");
    expect(preview).toHaveTextContent("已经准备实现");
    expect(preview).not.toHaveTextContent("请实现目录轨");
    expect(preview).not.toHaveTextContent("@implementation-lead");

    fireEvent.pointerMove(screen.getByTestId("relay-event-message-1"));
    expect(screen.getByTestId("relay-event-preview")).toHaveTextContent("请实现目录轨");
    expect(screen.getByTestId("relay-event-preview")).not.toHaveTextContent("已经准备实现");
  });

  it("browses without activation and activates on Enter", () => {
    const onActivate = vi.fn();
    const onBrowse = vi.fn();
    renderRail(onActivate, onBrowse);
    const first = screen.getByTestId("relay-event-message-1");
    fireEvent.focus(first);
    fireEvent.keyDown(first, { key: "ArrowDown" });
    expect(onBrowse).toHaveBeenCalledWith(events[1]);
    expect(onActivate).not.toHaveBeenCalled();
    fireEvent.keyDown(screen.getByTestId("relay-event-message-2"), { key: "Enter" });
    expect(onActivate).toHaveBeenCalledWith(events[1]);
  });
});

function renderRail(
  onActivate = vi.fn(),
  onBrowse = vi.fn(),
): void {
  render(
    <div style={{ height: 400 }}>
      <ConversationRelayRail
        containerWidth={760}
        currentEventId="message-1"
        events={events}
        onActivate={onActivate}
        onBrowse={onBrowse}
      />
    </div>,
  );
}
