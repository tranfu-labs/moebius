import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
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

  it("keeps real node focus while the Popover opens, browses, and activates", async () => {
    const user = userEvent.setup();
    const onActivate = vi.fn();
    const onBrowse = vi.fn();
    renderRail(onActivate, onBrowse);
    const first = screen.getByTestId("relay-event-message-1");

    await user.tab();
    await waitFor(() => expect(screen.getByTestId("relay-event-preview")).toBeVisible());
    expect(document.activeElement).toBe(first);

    await user.keyboard("{ArrowDown}");
    const second = screen.getByTestId("relay-event-message-2");
    await waitFor(() => expect(document.activeElement).toBe(second));
    expect(onBrowse).toHaveBeenCalledWith(events[1]);
    expect(onActivate).not.toHaveBeenCalled();
    await new Promise((resolve) => window.setTimeout(resolve, 180));
    expect(screen.getByTestId("relay-event-preview")).toHaveTextContent("已经准备实现");
    expect(document.activeElement).toBe(second);

    await user.keyboard("{Enter}");
    expect(onActivate).toHaveBeenCalledWith(events[1]);
    expect(document.activeElement).toBe(second);
    onActivate.mockClear();

    await user.keyboard(" ");
    expect(onActivate).toHaveBeenCalledWith(events[1]);
    expect(document.activeElement).toBe(second);

    await user.keyboard("{Escape}");
    await waitFor(() =>
      expect(screen.queryByTestId("relay-event-preview")).not.toBeInTheDocument());
    expect(document.activeElement).toBe(second);
  });

  it("does not draw a connector across either omission window", () => {
    const longEvents = Array.from({ length: 13 }, (_, index): ConversationRelayEvent => ({
      ...events[index % events.length]!,
      id: `message-${String(index + 1)}`,
      messageId: index + 1,
      body: `消息 ${String(index + 1)}`,
    }));
    renderRail(vi.fn(), vi.fn(), longEvents, "message-7");
    fireEvent.mouseEnter(screen.getByTestId("conversation-relay-rail"));

    expect(screen.getAllByTestId("relay-omission")).toHaveLength(2);
    expect(screen.getAllByTestId("relay-connector").map((connector) => [
      connector.getAttribute("data-relay-from"),
      connector.getAttribute("data-relay-to"),
    ])).toEqual([
      ["message-6", "message-7"],
      ["message-7", "message-8"],
    ]);
  });

  it("isolates wheel browsing from its scrolling parent", () => {
    const onBrowse = vi.fn();
    const onParentWheel = vi.fn();
    render(
      <div onWheel={onParentWheel} style={{ height: 400 }}>
        <ConversationRelayRail
          containerWidth={760}
          currentEventId="message-1"
          events={events}
          onActivate={vi.fn()}
          onBrowse={onBrowse}
        />
      </div>,
    );

    const rail = screen.getByTestId("conversation-relay-rail");
    fireEvent.mouseEnter(rail);
    const wheel = new WheelEvent("wheel", {
      bubbles: true,
      cancelable: true,
      deltaY: 30,
    });
    fireEvent(rail, wheel);
    expect(wheel.defaultPrevented).toBe(true);
    expect(onBrowse).toHaveBeenCalledWith(events[1]);
    expect(onParentWheel).not.toHaveBeenCalled();
  });
});

function renderRail(
  onActivate = vi.fn(),
  onBrowse = vi.fn(),
  railEvents = events,
  currentEventId = "message-1",
): void {
  render(
    <div style={{ height: 400 }}>
      <ConversationRelayRail
        containerWidth={760}
        currentEventId={currentEventId}
        events={railEvents}
        onActivate={onActivate}
        onBrowse={onBrowse}
      />
    </div>,
  );
}
