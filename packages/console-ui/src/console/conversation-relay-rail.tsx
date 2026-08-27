import {
  type CSSProperties,
  Fragment,
  type KeyboardEvent,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import {
  CONVERSATION_RELAY_COLLAPSED_ROW_HEIGHT,
  CONVERSATION_RELAY_COLLAPSED_WIDTH,
  adjacentConversationRelayEventId,
  computeConversationRelayRows,
  deriveConversationRelayCapacity,
  deriveConversationRelayExpandedRowHeight,
  deriveConversationRelayHeightBudget,
  deriveConversationRelayLayout,
  deriveConversationRelayPaths,
  type ConversationRelayEvent,
} from "@/console/conversation-relay-rail-model";
import { identityToken } from "@/console/role-tag";
import { cn } from "@/lib/utils";
import type { OperatorConsoleAppearance } from "@/console/operator-console-appearance";
import { operatorFloatingSurfaceClassName } from "@/console/operator-console-appearance";
import { useI18n } from "@/i18n";
import {
  Popover,
  PopoverAnchor,
  PopoverContent,
} from "@/ui/popover";

const RELAY_BAND_HORIZONTAL_INSET = 4;
const RELAY_BAND_VERTICAL_INSET = 2;
const RELAY_PANEL_BORDER_WIDTH = 1;

export interface ConversationRelayRailProps {
  events: readonly ConversationRelayEvent[];
  currentEventId: string | null;
  containerWidth: number;
  onActivate: (event: ConversationRelayEvent) => void;
  onBrowse?: (event: ConversationRelayEvent) => void;
  className?: string;
  appearance?: OperatorConsoleAppearance;
}

export function ConversationRelayRail({
  events,
  currentEventId,
  containerWidth,
  onActivate,
  onBrowse,
  className,
  appearance = "default",
}: ConversationRelayRailProps): JSX.Element | null {
  const { t } = useI18n();
  const hasEvents = events.length > 0;
  const [expanded, setExpanded] = useState(false);
  const [inspectedId, setInspectedId] = useState<string | null>(null);
  const [browseId, setBrowseId] = useState(currentEventId ?? events.at(-1)?.id ?? "");
  const [viewportHeight, setViewportHeight] = useState<number | null>(null);
  const viewportRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<HTMLElement>(null);
  const closeTimerRef = useRef<number | null>(null);
  const pendingFocusIdRef = useRef<string | null>(null);

  useEffect(() => {
    if (!expanded) {
      setBrowseId(currentEventId ?? events.at(-1)?.id ?? "");
    }
  }, [currentEventId, events, expanded]);

  useLayoutEffect(() => {
    if (!hasEvents) {
      setViewportHeight(null);
      return;
    }
    const viewport = viewportRef.current;
    if (viewport === null) return;
    const update = () => {
      const nextHeight = Math.round(viewport.getBoundingClientRect().height);
      if (nextHeight <= 0) return;
      setViewportHeight((currentHeight) =>
        currentHeight === nextHeight ? currentHeight : nextHeight);
    };
    update();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(update);
    observer.observe(viewport);
    return () => observer.disconnect();
  }, [hasEvents]);

  useEffect(() => () => {
    if (closeTimerRef.current !== null) {
      window.clearTimeout(closeTimerRef.current);
    }
  }, []);

  const measuredViewportHeight = viewportHeight ?? 0;
  const railHeightBudget = deriveConversationRelayHeightBudget(measuredViewportHeight);
  const capacity = deriveConversationRelayCapacity(railHeightBudget);
  const focusId = browseId || currentEventId;
  const rows = useMemo(
    () => computeConversationRelayRows(events, focusId, capacity),
    [capacity, events, focusId],
  );
  const layout = useMemo(
    () => deriveConversationRelayLayout(events, containerWidth),
    [containerWidth, events],
  );
  const expandedRowHeight = deriveConversationRelayExpandedRowHeight(
    railHeightBudget,
    rows.length,
  );
  const rowHeight = expanded
    ? expandedRowHeight
    : CONVERSATION_RELAY_COLLAPSED_ROW_HEIGHT;
  const railHeight = rows.length * rowHeight;
  const expandedRailHeight = rows.length * expandedRowHeight;
  const stageTop = Math.max(0, (measuredViewportHeight - railHeight) / 2);
  const expandedStageTop = Math.max(
    0,
    (measuredViewportHeight - expandedRailHeight) / 2,
  );
  const paths = useMemo(
    () => deriveConversationRelayPaths(events, rows, layout, expandedRowHeight),
    [events, expandedRowHeight, layout, rows],
  );
  const browse = useCallback((eventId: string, direction: -1 | 1) => {
    const nextId = adjacentConversationRelayEventId(events, eventId, direction);
    const nextEvent = events.find((event) => event.id === nextId);
    pendingFocusIdRef.current = nextId === eventId ? null : nextId;
    setBrowseId(nextId);
    if (nextEvent !== undefined) onBrowse?.(nextEvent);
  }, [events, onBrowse]);

  useLayoutEffect(() => {
    const pendingFocusId = pendingFocusIdRef.current;
    if (pendingFocusId === null) return;
    const target = stageRef.current
      ?.querySelector<HTMLElement>(`[data-relay-event="${pendingFocusId}"]`);
    if (target === undefined || target === null) return;
    pendingFocusIdRef.current = null;
    target.focus();
  }, [rows]);

  useEffect(() => {
    const viewport = viewportRef.current;
    if (viewport === null) return;
    const handleWheel = (event: globalThis.WheelEvent) => {
      if (Math.abs(event.deltaY) < 2) return;
      event.preventDefault();
      event.stopPropagation();
      browse(focusId ?? events.at(-1)?.id ?? "", event.deltaY > 0 ? 1 : -1);
    };
    viewport.addEventListener("wheel", handleWheel, { passive: false });
    return () => viewport.removeEventListener("wheel", handleWheel);
  }, [browse, events, focusId]);

  if (!hasEvents) return null;

  const cancelClose = () => {
    if (closeTimerRef.current !== null) {
      window.clearTimeout(closeTimerRef.current);
      closeTimerRef.current = null;
    }
  };
  const scheduleClose = () => {
    cancelClose();
    closeTimerRef.current = window.setTimeout(() => {
      setExpanded(false);
      setInspectedId(null);
    }, 120);
  };
  const style = {
    "--relay-expanded-width": `${String(layout.expandedWidth)}px`,
    "--relay-height": `${String(railHeight)}px`,
    "--relay-row-height": `${String(rowHeight)}px`,
  } as CSSProperties;
  const inspectedEvent = events.find((event) => event.id === inspectedId);
  const inspectedRowIndex = rows.findIndex(
    (row) => row.type === "event" && row.event.id === inspectedId,
  );
  const inspectedEventColor = inspectedEvent === undefined
    ? "var(--hint)"
    : conversationRelayEventColor(inspectedEvent);

  return (
    <Popover
      open={viewportHeight !== null && inspectedEvent !== undefined && inspectedRowIndex >= 0}
    >
      <div
        ref={viewportRef}
        className={cn(
          "pointer-events-none relative h-full w-11",
          className,
        )}
        data-capacity={capacity}
        data-container-width={containerWidth}
        data-expanded={expanded ? "true" : "false"}
        data-expanded-width={layout.expandedWidth}
        data-height-budget={railHeightBudget}
        data-row-height={rowHeight}
        data-testid="conversation-relay-rail"
        data-viewport-measured={viewportHeight === null ? "false" : "true"}
        onMouseEnter={() => {
          cancelClose();
          setExpanded(true);
        }}
        onMouseLeave={scheduleClose}
        style={style}
      >
        {viewportHeight !== null ? (
          <nav
            ref={stageRef}
            aria-label={t("console.relayRail.label")}
            className={cn(
              "pointer-events-auto absolute left-0 overflow-visible rounded-md border transition-[width,height,top,background-color,border-color] duration-200 ease-enter motion-reduce:transition-none",
              expanded
                ? appearance === "focused"
                  ? "border-line bg-[var(--focused-side-surface)]"
                  : "border-line bg-sunken"
                : "border-transparent bg-transparent",
            )}
            data-motion-origin="left"
            onBlur={(event) => {
              if (!event.currentTarget.contains(event.relatedTarget)) scheduleClose();
            }}
            onFocus={() => {
              cancelClose();
              setExpanded(true);
            }}
            style={{
              height: railHeight,
              top: stageTop,
              transformOrigin: "left center",
              width: expanded
                ? layout.expandedWidth
                : CONVERSATION_RELAY_COLLAPSED_WIDTH,
            }}
          >
          <svg
            aria-hidden="true"
            className={cn(
              "pointer-events-none absolute left-0 top-0 z-layer-local-mid overflow-visible text-sub transition-[height,opacity] duration-150 motion-reduce:transition-none",
              expanded ? "opacity-100" : "opacity-0",
            )}
            height={expandedRailHeight}
            viewBox={`0 0 ${String(layout.expandedWidth)} ${String(expandedRailHeight)}`}
            width={layout.expandedWidth}
          >
          {paths.map((path, pathIndex) => {
            const emphasized = inspectedId !== null
              && path.eventIds.includes(inspectedId);
            return (
              <path
                key={path.key}
                className="relay-motion-inline"
                d={path.d}
                data-relay-actor={path.actorKey ?? "user"}
                data-relay-emphasized={emphasized ? "true" : "false"}
                data-relay-event-ids={path.eventIds.join(" ")}
                data-relay-path-kind={path.kind}
                data-testid={path.kind === "spine" ? "relay-spine" : "relay-branch"}
                fill="none"
                pathLength={1}
                stroke={path.actorKey === null
                  ? "currentColor"
                  : `var(${identityToken(path.actorKey)})`}
                strokeDasharray={1}
                strokeLinecap="round"
                strokeWidth={emphasized ? 2 : 1.5}
                style={{
                  opacity: expanded ? (emphasized ? 1 : 0.85) : 0,
                  strokeDashoffset: expanded ? 0 : 1,
                  transition: appearance === "focused"
                    ? "opacity 100ms var(--ease), stroke-width 120ms var(--ease)"
                    : [
                        "stroke-dashoffset 260ms var(--ease-enter)",
                        "opacity 150ms var(--ease)",
                        "stroke-width 150ms var(--ease)",
                      ].join(", "),
                  transitionDelay: appearance === "focused"
                    ? "0ms"
                    : expanded
                    ? `${String(Math.min(pathIndex * 18, 126))}ms`
                    : "0ms",
                }}
                vectorEffect="non-scaling-stroke"
              />
            );
          })}
          </svg>

        {rows.map((row, rowIndex) => {
          if (row.type === "omission") {
            return (
              <div
                key={`omission-${String(row.fromIndex)}-${String(row.toIndex)}`}
                aria-label={t("console.relayRail.omitted", { count: row.count })}
                className={cn(
                  "absolute left-0 z-layer-local-low flex items-center text-meta tracking-[1px] text-hint transition-[width,height,top,opacity] duration-150 motion-reduce:transition-none",
                  expanded ? "justify-center" : "w-11 pl-2",
                )}
                data-testid="relay-omission"
                style={{
                  height: rowHeight,
                  top: rowIndex * rowHeight,
                  width: expanded
                    ? layout.expandedWidth
                    : CONVERSATION_RELAY_COLLAPSED_WIDTH,
                }}
              >
                <span aria-hidden="true">•••</span>
              </div>
            );
          }

          const event = row.event;
          const current = event.id === currentEventId;
          const inspected = event.id === inspectedId;
          const laneX = layout.lanes.get(event.actorKey) ?? layout.spineX;
          const eventColor = conversationRelayEventColor(event);
          return (
            <Fragment key={event.id}>
              <span
                aria-hidden="true"
                className={cn(
                  "pointer-events-none absolute z-layer-local-low rounded-md transition-[left,width,height,top,background-color] duration-150 motion-reduce:transition-none",
                  inspected ? "bg-hover" : "bg-transparent",
                )}
                data-testid={`relay-band-${event.id}`}
                style={{
                  height: rowHeight - RELAY_BAND_VERTICAL_INSET * 2,
                  left: RELAY_BAND_HORIZONTAL_INSET - RELAY_PANEL_BORDER_WIDTH,
                  top: rowIndex * rowHeight + RELAY_BAND_VERTICAL_INSET,
                  width: (expanded
                    ? layout.expandedWidth
                    : CONVERSATION_RELAY_COLLAPSED_WIDTH)
                    - RELAY_BAND_HORIZONTAL_INSET * 2,
                }}
              />
              <button
                type="button"
                aria-current={current ? "location" : undefined}
                aria-label={`${event.actorName}，${event.body}`}
                className="absolute left-0 z-layer-local-high flex items-center border-0 bg-transparent p-0 outline-none transition-[width,height,top] duration-200 ease-enter motion-reduce:transition-none"
                data-hit-target={expanded ? "row" : "collapsed-row"}
                data-relay-event={event.id}
                data-testid={`relay-event-${event.id}`}
                onClick={() => onActivate(event)}
                onFocus={() => {
                  cancelClose();
                  setExpanded(true);
                  setInspectedId(event.id);
                }}
                onKeyDown={(keyboardEvent) => handleEventKeyDown(
                  keyboardEvent,
                  event,
                  browse,
                  onActivate,
                )}
                onMouseEnter={() => {
                  cancelClose();
                  setInspectedId(event.id);
                }}
                onPointerEnter={() => {
                  cancelClose();
                  setInspectedId(event.id);
                }}
                onPointerMove={() => {
                  cancelClose();
                  setInspectedId(event.id);
                }}
                style={{
                  height: rowHeight,
                  top: rowIndex * rowHeight,
                  width: expanded
                    ? layout.expandedWidth
                    : CONVERSATION_RELAY_COLLAPSED_WIDTH,
                }}
              >
                <span
                  aria-hidden="true"
                  className="relay-motion-inline absolute left-2 block rounded-full motion-reduce:transition-none"
                  data-relay-collapsed-tick={event.id}
                  style={{
                    backgroundColor: eventColor,
                    height: current ? 3 : 2,
                    opacity: expanded ? 0 : current ? 1 : 0.7,
                    transform: `scaleX(${expanded ? "0.18" : "1"})`,
                    transformOrigin: "left center",
                    transition: [
                      "width 160ms var(--ease-enter)",
                      "opacity 100ms var(--ease)",
                      "transform 180ms var(--ease-enter)",
                    ].join(", "),
                    width: current ? 24 : 13,
                  }}
                />
                <span
                  aria-hidden="true"
                  className={cn(
                    "relay-motion-inline absolute block rounded-full border-2 border-sunken motion-reduce:transition-none",
                    current ? "h-3 w-3 bg-sunken" : "h-[9px] w-[9px]",
                  )}
                  data-relay-expanded-node={event.id}
                  style={{
                    backgroundColor: current ? "var(--sunken)" : eventColor,
                    borderColor: current ? eventColor : "var(--sunken)",
                    left: expanded
                      ? laneX - (current ? 6 : 4.5)
                      : 8,
                    opacity: expanded ? 1 : 0,
                    top: "50%",
                    marginTop: current ? -6 : -4.5,
                    transform: `scale(${expanded ? (inspected ? "1.16" : "1") : "0.45"})`,
                    transition: [
                      "left 240ms var(--ease-enter)",
                      "opacity 120ms var(--ease)",
                      "transform 180ms var(--ease-enter)",
                    ].join(", "),
                    transitionDelay: expanded
                      ? `${String(Math.min(rowIndex * 12, 96))}ms`
                      : "0ms",
                  }}
                />
              </button>
            </Fragment>
          );
        })}
          </nav>
        ) : null}
        {viewportHeight !== null ? (
          <div
            aria-hidden="true"
            className="pointer-events-none absolute left-0"
            data-testid="relay-preview-anchor-layer"
            style={{
              height: expandedRailHeight,
              top: expandedStageTop,
              width: layout.expandedWidth,
            }}
          >
            {inspectedEvent !== undefined && inspectedRowIndex >= 0 ? (
              <PopoverAnchor asChild>
                <span
                  className="pointer-events-none absolute left-0 transition-[top,height] duration-200 ease-enter motion-reduce:transition-none"
                  data-testid="relay-preview-anchor"
                  style={{
                    height: expandedRowHeight,
                    top: inspectedRowIndex * expandedRowHeight,
                    width: layout.expandedWidth,
                  }}
                />
              </PopoverAnchor>
            ) : null}
          </div>
        ) : null}
      </div>
      {viewportHeight !== null && inspectedEvent !== undefined && inspectedRowIndex >= 0 ? (
        <PopoverContent
          align="center"
          className={operatorFloatingSurfaceClassName(
            appearance,
            "w-[240px] max-w-[calc(100vw-24px)] rounded-md px-3 py-2.5",
          )}
          collisionPadding={12}
          data-relay-side-offset="12"
          data-testid="relay-event-preview"
          onCloseAutoFocus={(event) => event.preventDefault()}
          onEscapeKeyDown={() => setInspectedId(null)}
          onMouseEnter={cancelClose}
          onMouseLeave={scheduleClose}
          onOpenAutoFocus={(event) => event.preventDefault()}
          side="right"
          sideOffset={12}
        >
          <div
            key={inspectedEvent.id}
            className="motion-safe:animate-[relay-preview-content-in_160ms_var(--ease-enter)]"
            data-testid="relay-preview-content"
          >
            <p className="flex items-center gap-1.5 text-meta text-hint">
              <span
                aria-hidden="true"
                className="h-[7px] w-[7px] rounded-full"
                style={{ backgroundColor: inspectedEventColor }}
              />
              <span>{inspectedEvent.actorName}</span>
              <span aria-hidden="true">·</span>
              <time className="tnum">{formatRelayTime(inspectedEvent.updatedAt)}</time>
            </p>
            <p className="mt-1.5 line-clamp-3 text-xs leading-[1.55] text-ink">
              {inspectedEvent.body}
            </p>
          </div>
        </PopoverContent>
      ) : null}
    </Popover>
  );
}

function handleEventKeyDown(
  keyboardEvent: KeyboardEvent<HTMLButtonElement>,
  event: ConversationRelayEvent,
  browse: (eventId: string, direction: -1 | 1) => void,
  onActivate: (event: ConversationRelayEvent) => void,
): void {
  if (keyboardEvent.key === "ArrowDown" || keyboardEvent.key === "ArrowUp") {
    keyboardEvent.preventDefault();
    browse(event.id, keyboardEvent.key === "ArrowDown" ? 1 : -1);
    return;
  }
  if (keyboardEvent.key === "Enter" || keyboardEvent.key === " ") {
    keyboardEvent.preventDefault();
    onActivate(event);
  }
}

function formatRelayTime(value: string): string {
  const timestamp = Date.parse(value);
  if (Number.isNaN(timestamp)) return value;
  return new Intl.DateTimeFormat("zh-CN", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(timestamp);
}

function conversationRelayEventColor(event: ConversationRelayEvent): string {
  return event.kind === "user"
    ? "var(--ink)"
    : `var(${identityToken(event.actorKey)})`;
}
