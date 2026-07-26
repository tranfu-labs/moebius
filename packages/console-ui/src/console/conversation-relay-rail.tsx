import {
  type CSSProperties,
  type KeyboardEvent,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import {
  CONVERSATION_RELAY_COLLAPSED_WIDTH,
  CONVERSATION_RELAY_ROW_HEIGHT,
  adjacentConversationRelayEventId,
  computeConversationRelayRows,
  conversationRelayExpandedWidth,
  conversationRelayLanePositions,
  createConversationRelayCurvePath,
  deriveConversationRelayCapacity,
  type ConversationRelayEvent,
  type ConversationRelayRow,
} from "@/console/conversation-relay-rail-model";
import { identityToken } from "@/console/role-tag";
import { cn } from "@/lib/utils";
import {
  Popover,
  PopoverAnchor,
  PopoverContent,
} from "@/ui/popover";

export interface ConversationRelayRailProps {
  events: readonly ConversationRelayEvent[];
  currentEventId: string | null;
  containerWidth: number;
  onActivate: (event: ConversationRelayEvent) => void;
  onBrowse?: (event: ConversationRelayEvent) => void;
  className?: string;
}

export function ConversationRelayRail({
  events,
  currentEventId,
  containerWidth,
  onActivate,
  onBrowse,
  className,
}: ConversationRelayRailProps): JSX.Element | null {
  const [expanded, setExpanded] = useState(false);
  const [inspectedId, setInspectedId] = useState<string | null>(null);
  const [browseId, setBrowseId] = useState(currentEventId ?? events.at(-1)?.id ?? "");
  const [viewportHeight, setViewportHeight] = useState(0);
  const viewportRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<HTMLElement>(null);
  const closeTimerRef = useRef<number | null>(null);
  const pendingFocusIdRef = useRef<string | null>(null);

  useEffect(() => {
    if (!expanded) {
      setBrowseId(currentEventId ?? events.at(-1)?.id ?? "");
    }
  }, [currentEventId, events, expanded]);

  useEffect(() => {
    const viewport = viewportRef.current;
    if (viewport === null) return;
    const update = () => setViewportHeight(Math.round(viewport.getBoundingClientRect().height));
    update();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(update);
    observer.observe(viewport);
    return () => observer.disconnect();
  }, []);

  useEffect(() => () => {
    if (closeTimerRef.current !== null) {
      window.clearTimeout(closeTimerRef.current);
    }
  }, []);

  const capacity = deriveConversationRelayCapacity(viewportHeight);
  const focusId = browseId || currentEventId;
  const rows = useMemo(
    () => computeConversationRelayRows(events, focusId, capacity),
    [capacity, events, focusId],
  );
  const expandedWidth = conversationRelayExpandedWidth(containerWidth);
  const lanes = useMemo(
    () => conversationRelayLanePositions(events, expandedWidth),
    [events, expandedWidth],
  );
  const railHeight = rows.length * CONVERSATION_RELAY_ROW_HEIGHT;
  const stageTop = Math.max(0, (viewportHeight - railHeight) / 2);
  const paths = createConnectionPaths(rows, lanes);
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

  if (events.length === 0) return null;

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
    "--relay-expanded-width": `${String(expandedWidth)}px`,
    "--relay-height": `${String(railHeight)}px`,
  } as CSSProperties;
  const inspectedEvent = events.find((event) => event.id === inspectedId);
  const inspectedRowIndex = rows.findIndex(
    (row) => row.type === "event" && row.event.id === inspectedId,
  );
  const inspectedEventColor = inspectedEvent === undefined
    ? "var(--hint)"
    : `var(${identityToken(inspectedEvent.actorKey)})`;

  return (
    <Popover open={inspectedEvent !== undefined && inspectedRowIndex >= 0}>
    <div
      ref={viewportRef}
      className={cn(
        "pointer-events-none relative h-full w-11",
        className,
      )}
      data-capacity={capacity}
      data-container-width={containerWidth}
      data-expanded={expanded ? "true" : "false"}
      data-testid="conversation-relay-rail"
      onMouseEnter={() => {
        cancelClose();
        setExpanded(true);
      }}
      onMouseLeave={scheduleClose}
      style={style}
    >
      <nav
        ref={stageRef}
        aria-label="当前主会话消息目录"
        className={cn(
          "pointer-events-auto absolute left-0 overflow-visible",
          expanded && "rounded-md border border-line bg-sunken",
        )}
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
          width: expanded ? expandedWidth : CONVERSATION_RELAY_COLLAPSED_WIDTH,
        }}
      >
        <svg
          aria-hidden="true"
          className={cn(
            "pointer-events-none absolute left-0 top-0 overflow-visible text-line-strong",
            expanded ? "opacity-100" : "opacity-0",
          )}
          height={railHeight}
          viewBox={`0 0 ${String(expandedWidth)} ${String(railHeight)}`}
          width={expandedWidth}
        >
          {paths.map((path) => (
            <path
              key={path.key}
              d={path.d}
              data-relay-from={path.from}
              data-relay-to={path.to}
              data-testid="relay-connector"
              fill="none"
              stroke="currentColor"
              strokeLinecap="round"
              strokeWidth={1.5}
              vectorEffect="non-scaling-stroke"
            />
          ))}
        </svg>

        {rows.map((row, rowIndex) => {
          if (row.type === "omission") {
            return (
              <div
                key={`omission-${String(row.fromIndex)}-${String(row.toIndex)}`}
                aria-label={`暂时收起 ${String(row.count)} 条消息`}
                className={cn(
                  "absolute left-0 flex h-5 items-center text-[8px] tracking-[1px] text-hint",
                  expanded ? "justify-center" : "w-11 pl-2",
                )}
                data-testid="relay-omission"
                style={{
                  top: rowIndex * CONVERSATION_RELAY_ROW_HEIGHT,
                  width: expanded ? expandedWidth : CONVERSATION_RELAY_COLLAPSED_WIDTH,
                }}
              >
                <span aria-hidden="true">•••</span>
              </div>
            );
          }

          const event = row.event;
          const current = event.id === currentEventId;
          const inspected = event.id === inspectedId;
          const laneX = lanes.get(event.actorKey) ?? 18;
          const eventColor = `var(${identityToken(event.actorKey)})`;
          return (
            <button
              key={event.id}
              type="button"
              aria-current={current ? "location" : undefined}
              aria-label={`${event.actorName}，${event.body}`}
              className={cn(
                "absolute left-0 z-[2] flex h-5 border-0 bg-transparent p-0 outline-none",
                expanded
                  ? "w-[var(--relay-expanded-width)] items-center hover:bg-hover focus-visible:bg-hover"
                  : "w-11 items-center pl-2",
              )}
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
              onMouseLeave={scheduleClose}
              style={{ top: rowIndex * CONVERSATION_RELAY_ROW_HEIGHT }}
            >
              {expanded ? (
                <span
                  aria-hidden="true"
                  className={cn(
                    "absolute block border-2 border-sunken",
                    event.kind === "user" ? "rotate-45 rounded-[2px]" : "rounded-full",
                    current
                      ? "h-3 w-3 bg-sunken outline outline-2 outline-sunken"
                      : "h-[9px] w-[9px]",
                  )}
                  style={{
                    backgroundColor: current ? "var(--sunken)" : eventColor,
                    borderColor: current ? eventColor : "var(--sunken)",
                    left: laneX - (current ? 6 : 4.5),
                  }}
                />
              ) : (
                <span
                  aria-hidden="true"
                  className={cn(
                    "block rounded-full",
                    current ? "h-[3px] w-6 opacity-100" : "h-0.5 w-[13px] opacity-70",
                    inspected && !current && "w-[19px] opacity-100",
                  )}
                  style={{ backgroundColor: eventColor }}
                />
              )}
            </button>
          );
        })}
        {inspectedEvent !== undefined && inspectedRowIndex >= 0 ? (
          <PopoverAnchor asChild>
            <span
              aria-hidden="true"
              className="pointer-events-none absolute left-0 h-5"
              style={{
                top: inspectedRowIndex * CONVERSATION_RELAY_ROW_HEIGHT,
                width: expandedWidth,
              }}
            />
          </PopoverAnchor>
        ) : null}
      </nav>
    </div>
    {inspectedEvent !== undefined && inspectedRowIndex >= 0 ? (
      <PopoverContent
        align="center"
        className="w-[296px] max-w-[calc(100vw-24px)]"
        collisionPadding={12}
        onCloseAutoFocus={(event) => event.preventDefault()}
        onEscapeKeyDown={() => setInspectedId(null)}
        onMouseEnter={cancelClose}
        onMouseLeave={scheduleClose}
        onOpenAutoFocus={(event) => event.preventDefault()}
        side="right"
        sideOffset={12}
        data-testid="relay-event-preview"
      >
        <p className="flex items-center gap-1.5 text-[11px] text-hint">
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

function createConnectionPaths(
  rows: readonly ConversationRelayRow[],
  lanes: ReadonlyMap<string, number>,
): Array<{ d: string; from: string; key: string; to: string }> {
  const paths: Array<{ d: string; from: string; key: string; to: string }> = [];
  for (let rowIndex = 1; rowIndex < rows.length; rowIndex += 1) {
    const previous = rows[rowIndex - 1];
    const current = rows[rowIndex];
    if (previous?.type !== "event" || current?.type !== "event") continue;
    const previousX = lanes.get(previous.event.actorKey) ?? 18;
    const currentX = lanes.get(current.event.actorKey) ?? 18;
    const previousY = (rowIndex - 1) * CONVERSATION_RELAY_ROW_HEIGHT
      + CONVERSATION_RELAY_ROW_HEIGHT / 2;
    const currentY = rowIndex * CONVERSATION_RELAY_ROW_HEIGHT
      + CONVERSATION_RELAY_ROW_HEIGHT / 2;
    paths.push({
      key: `${previous.event.id}-${current.event.id}`,
      from: previous.event.id,
      to: current.event.id,
      d: createConversationRelayCurvePath(previousX, previousY, currentX, currentY),
    });
  }
  return paths;
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
