import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ConversationRelayRail } from "@/console/conversation-relay-rail";
import type { ConversationRelayEvent } from "@/console/conversation-relay-rail-model";
import { identityToken } from "@/console/role-tag";

const events: ConversationRelayEvent[] = [
  relayEvent(1, "user", "user", "你", "请实现目录轨"),
  relayEvent(2, "agent", "primary", "主理人", "方案已经放行"),
  relayEvent(3, "agent", "dev", "开发", "已经准备实现"),
  relayEvent(4, "agent", "primary", "主理人", "继续完成验证"),
  relayEvent(5, "agent", "qa", "测试", "等待独立复核"),
  relayEvent(6, "agent", "dev", "开发", "交付自动证据"),
];
const originalMatchMedia = window.matchMedia;

describe("ConversationRelayRail", () => {
  beforeEach(() => {
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue(
      rect(760, 400),
    );
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      value: originalMatchMedia,
    });
  });

  it("renders compact left-aligned ticks with current and identity hierarchy", () => {
    renderRail();
    const rail = screen.getByTestId("conversation-relay-rail");
    const nav = screen.getByRole("navigation", { name: "当前主会话消息目录" });
    const userTick = tick("message-1");
    const agentTick = tick("message-2");

    expect(rail).toHaveAttribute("data-expanded", "false");
    expect(rail).toHaveAttribute("data-row-height", "20");
    expect(nav).toHaveAttribute("data-motion-origin", "left");
    expect(nav).toHaveStyle({ transformOrigin: "left center", width: "44px" });
    expect(userTick).toHaveClass("left-2");
    expect(userTick).toHaveStyle({
      backgroundColor: "var(--ink)",
      height: "3px",
      opacity: "1",
      width: "24px",
    });
    expect(agentTick).toHaveStyle({
      backgroundColor: `var(${identityToken("primary")})`,
      height: "2px",
      opacity: "0.7",
      width: "13px",
    });
  });

  it("expands from the shared left edge for pointer and keyboard focus", async () => {
    const user = userEvent.setup();
    renderRail();
    const rail = screen.getByTestId("conversation-relay-rail");
    const nav = screen.getByRole("navigation", { name: "当前主会话消息目录" });

    fireEvent.mouseEnter(rail);
    expect(rail).toHaveAttribute("data-expanded", "true");
    expect(rail).toHaveAttribute("data-row-height", "32");
    expect(nav).toHaveClass("border-line", "bg-sunken", "rounded-md");
    expect(nav).toHaveStyle({ height: "192px", width: "82px" });

    fireEvent.mouseLeave(rail);
    fireEvent.transitionEnd(nav);
    await user.tab();
    await waitFor(() => expect(screen.getByTestId("relay-event-preview")).toBeVisible());
    expect(rail).toHaveAttribute("data-expanded", "true");
    expect(document.activeElement).toBe(screen.getByTestId("relay-event-message-1"));
  });

  it("renders a fixed user spine and first-appearance member branches", () => {
    renderRail();
    fireEvent.mouseEnter(screen.getByTestId("conversation-relay-rail"));

    const spine = screen.getByTestId("relay-spine");
    const branches = screen.getAllByTestId("relay-branch");
    expect(spine.getAttribute("d")).toContain("M 14 16 L 14 176");
    expect(branches.map((branch) => branch.getAttribute("data-relay-actor"))).toEqual([
      "primary",
      "dev",
      "qa",
    ]);
    expect(branches[0]?.getAttribute("d")).toContain(" C ");
    expect(screen.queryByTestId("relay-connector")).not.toBeInTheDocument();
    expect(screen.getByTestId("relay-event-message-1").querySelector(
      '[data-relay-expanded-node="message-1"]',
    )).toHaveClass("h-3", "w-3", "rounded-full", "bg-sunken");
    expect(screen.getByTestId("relay-event-message-1").querySelector(
      '[data-relay-expanded-node="message-1"]',
    )).toHaveStyle({
      backgroundColor: "var(--sunken)",
      borderColor: "var(--ink)",
    });
    expect(screen.getByTestId("relay-event-message-1").querySelector(
      '[data-relay-expanded-node="message-1"]',
    )).toHaveStyle({ left: "8px" });
    expect(screen.getByTestId("relay-event-message-2").querySelector(
      '[data-relay-expanded-node="message-2"]',
    )).toHaveStyle({ left: "27.5px" });
  });

  it("keeps whole rows clickable above bands and paths and emphasizes inspected paths", () => {
    renderRail();
    fireEvent.mouseEnter(screen.getByTestId("conversation-relay-rail"));
    const farRightRow = screen.getByTestId("relay-event-message-6");

    expect(farRightRow).toHaveAttribute("data-hit-target", "row");
    expect(farRightRow).toHaveClass("z-[3]");
    expect(farRightRow).toHaveStyle({ width: "82px" });
    expect(screen.getByTestId("relay-band-message-6")).toHaveClass("z-[1]");
    expect(screen.getByTestId("relay-spine").closest("svg")).toHaveClass("z-[2]");

    fireEvent.mouseEnter(farRightRow);
    expect(screen.getByTestId("relay-band-message-6")).toHaveClass("bg-hover");
    expect(screen.getAllByTestId("relay-branch").find(
      (path) => path.getAttribute("data-relay-actor") === "dev",
    )).toHaveAttribute("data-relay-emphasized", "true");
    expect(screen.getAllByTestId("relay-branch").find(
      (path) => path.getAttribute("data-relay-actor") === "qa",
    )).toHaveAttribute("data-relay-emphasized", "false");
  });

  it("shows a fixed-density preview and preserves it across the pointer gap", () => {
    vi.useFakeTimers();
    renderRail();
    const rail = screen.getByTestId("conversation-relay-rail");
    fireEvent.mouseEnter(rail);
    fireEvent.mouseEnter(screen.getByTestId("relay-event-message-1"));

    const preview = screen.getByTestId("relay-event-preview");
    expect(preview).toHaveClass("w-[240px]", "px-3", "py-2.5");
    expect(preview).toHaveAttribute("data-relay-side-offset", "12");
    expect(preview).toHaveTextContent("请实现目录轨");
    expect(preview).not.toHaveTextContent("@user");
    expect(screen.getByText("请实现目录轨")).toHaveClass("line-clamp-3");
    expect(screen.getByTestId("relay-preview-anchor")).toHaveStyle({
      top: "0px",
      width: "82px",
    });

    fireEvent.pointerMove(screen.getByTestId("relay-event-message-6"));
    expect(screen.getByTestId("relay-event-preview")).toHaveTextContent("交付自动证据");
    expect(screen.getByTestId("relay-preview-anchor")).toHaveStyle({
      top: "160px",
      width: "82px",
    });

    fireEvent.mouseLeave(rail);
    act(() => vi.advanceTimersByTime(60));
    fireEvent.mouseEnter(preview);
    act(() => vi.advanceTimersByTime(120));
    expect(rail).toHaveAttribute("data-expanded", "true");

    fireEvent.mouseLeave(preview);
    act(() => vi.advanceTimersByTime(119));
    expect(rail).toHaveAttribute("data-expanded", "true");
    act(() => vi.advanceTimersByTime(1));
    expect(rail).toHaveAttribute("data-expanded", "false");
  });

  it("keeps real node focus while browsing and activates only on explicit input", async () => {
    const user = userEvent.setup();
    const onActivate = vi.fn();
    const onBrowse = vi.fn();
    renderRail(onActivate, onBrowse);

    await user.tab();
    await waitFor(() => expect(screen.getByTestId("relay-event-preview")).toBeVisible());
    expect(document.activeElement).toBe(screen.getByTestId("relay-event-message-1"));

    await user.keyboard("{ArrowDown}");
    await waitFor(() =>
      expect(document.activeElement).toBe(screen.getByTestId("relay-event-message-2")));
    expect(onBrowse).toHaveBeenCalledWith(events[1]);
    expect(onActivate).not.toHaveBeenCalled();

    await user.keyboard("{Enter}");
    expect(onActivate).toHaveBeenCalledWith(events[1]);
    onActivate.mockClear();
    await user.keyboard(" ");
    expect(onActivate).toHaveBeenCalledWith(events[1]);
  });

  it("splits branches at omission windows and keeps the expanded panel in the viewport", () => {
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue(
      rect(760, 160),
    );
    const longEvents = Array.from({ length: 13 }, (_, index): ConversationRelayEvent => ({
      ...events[index % events.length]!,
      id: `message-${String(index + 1)}`,
      messageId: index + 1,
      body: `消息 ${String(index + 1)}`,
    }));
    renderRail(vi.fn(), vi.fn(), longEvents, "message-7");
    const rail = screen.getByTestId("conversation-relay-rail");
    fireEvent.mouseEnter(rail);

    expect(rail).toHaveAttribute("data-capacity", "7");
    expect(screen.getAllByTestId("relay-omission")).toHaveLength(2);
    expect(screen.getAllByTestId("relay-spine")).toHaveLength(3);
    expect(screen.getByRole("navigation")).toHaveStyle({ height: "160px" });
    for (const path of screen.getAllByTestId("relay-branch")) {
      expect(path.getAttribute("data-relay-event-ids")).not.toContain("message-2");
      expect(path.getAttribute("data-relay-event-ids")).not.toContain("message-12");
    }
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

  it("retains reduced-motion targets for panel, paths, nodes, and preview", () => {
    const matchMedia = vi.fn().mockReturnValue({
      addEventListener: vi.fn(),
      matches: true,
      media: "(prefers-reduced-motion: reduce)",
      removeEventListener: vi.fn(),
    });
    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      value: matchMedia,
    });
    expect(window.matchMedia("(prefers-reduced-motion: reduce)").matches).toBe(true);
    renderRail();
    fireEvent.mouseEnter(screen.getByTestId("conversation-relay-rail"));
    fireEvent.mouseEnter(screen.getByTestId("relay-event-message-2"));

    expect(screen.getByRole("navigation")).toHaveClass("motion-reduce:transition-none");
    expect(screen.getByTestId("relay-spine")).toHaveClass("relay-motion-inline");
    expect(screen.getByTestId("relay-event-message-2").querySelector(
      '[data-relay-expanded-node="message-2"]',
    )).toHaveClass("motion-reduce:transition-none");
    expect(screen.getByTestId("relay-preview-content")).toHaveClass(
      "motion-safe:animate-[relay-preview-content-in_160ms_var(--ease-enter)]",
    );
    expect(screen.getByTestId("conversation-relay-rail")).toHaveAttribute(
      "data-expanded",
      "true",
    );
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

function relayEvent(
  id: number,
  kind: "user" | "agent",
  actorKey: string,
  actorName: string,
  body: string,
): ConversationRelayEvent {
  return {
    id: `message-${String(id)}`,
    messageId: id,
    kind,
    actorKey,
    actorName,
    body,
    updatedAt: `2026-07-26T10:0${String(id)}:00.000Z`,
  };
}

function tick(eventId: string): HTMLElement {
  const found = document.querySelector<HTMLElement>(
    `[data-relay-collapsed-tick="${eventId}"]`,
  );
  if (found === null) throw new Error(`Missing relay tick ${eventId}`);
  return found;
}

function rect(width: number, height: number): DOMRect {
  return {
    bottom: height,
    height,
    left: 0,
    right: width,
    top: 0,
    width,
    x: 0,
    y: 0,
    toJSON: () => ({}),
  };
}
