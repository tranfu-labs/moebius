/**
 * Interaction skeleton adapted for this design prototype from:
 * https://beui.dev/components/motion/preview-rail
 * Upstream repository: https://github.com/starc007/ui-components
 * Upstream license: MIT
 *
 * Prototype adaptation:
 * - keeps fixed-height hit targets, controlled focus, keyboard navigation and preview;
 * - replaces hover scaling with a collapsed directory / expanded swimlane projection;
 * - derives capacity from the main timeline viewport instead of a fixed item count;
 * - removes spring, blur, shadow and shape-morph animation;
 * - uses only deterministic local fixture data.
 */
import {
  type CSSProperties,
  type KeyboardEvent,
  type WheelEvent
} from "react";

import {
  ACTORS,
  CONVERSATION,
  RAIL_ROW_HEIGHT,
  adjacentEventId,
  actorById,
  computeRailRows,
  createGitGraphCurvePath,
  type RailEvent,
  type RailRow
} from "./rail-model.js";

interface ConversationRailProps {
  capacity: number;
  containerWidth: number;
  expanded: boolean;
  focusId: string;
  inspectedId: string | null;
  overlayWidth: number;
  onActivate: (event: RailEvent) => void;
  onBrowse: (eventId: string) => void;
  onCancelCollapse: () => void;
  onClearInspect: () => void;
  onExpand: () => void;
  onInspect: (event: RailEvent, element: HTMLElement) => void;
  onScheduleCollapse: () => void;
}

export function ConversationRail({
  capacity,
  containerWidth,
  expanded,
  focusId,
  inspectedId,
  overlayWidth,
  onActivate,
  onBrowse,
  onCancelCollapse,
  onClearInspect,
  onExpand,
  onInspect,
  onScheduleCollapse
}: ConversationRailProps): JSX.Element {
  const rows = computeRailRows(CONVERSATION.events, focusId, capacity);
  const laneStart = 18;
  const laneEnd = overlayWidth - 18;
  const laneStep =
    ACTORS.length > 1 ? (laneEnd - laneStart) / (ACTORS.length - 1) : 0;
  const laneX = new Map(
    ACTORS.map((actor, index) => [actor.id, laneStart + index * laneStep])
  );
  const railHeight = rows.length * RAIL_ROW_HEIGHT;
  const paths = createConnectionPaths(rows, laneX);
  const style = {
    "--expanded-width": `${overlayWidth}px`,
    "--rail-height": `${railHeight}px`
  } as CSSProperties;

  const browseFrom = (eventId: string, direction: -1 | 1) => {
    const nextId = adjacentEventId(CONVERSATION.events, eventId, direction);
    onBrowse(nextId);
    window.requestAnimationFrame(() => {
      document
        .querySelector<HTMLElement>(`[data-rail-event="${nextId}"]`)
        ?.focus();
    });
  };

  const handleKeyDown = (
    keyboardEvent: KeyboardEvent<HTMLButtonElement>,
    event: RailEvent
  ) => {
    if (keyboardEvent.key === "ArrowDown" || keyboardEvent.key === "ArrowUp") {
      keyboardEvent.preventDefault();
      browseFrom(event.id, keyboardEvent.key === "ArrowDown" ? 1 : -1);
      return;
    }
    if (keyboardEvent.key === "Enter" || keyboardEvent.key === " ") {
      keyboardEvent.preventDefault();
      onActivate(event);
    }
  };

  const handleWheel = (wheelEvent: WheelEvent<HTMLDivElement>) => {
    if (Math.abs(wheelEvent.deltaY) < 2) return;
    wheelEvent.preventDefault();
    wheelEvent.stopPropagation();
    browseFrom(focusId, wheelEvent.deltaY > 0 ? 1 : -1);
  };

  return (
    <div
      className={`conversation-rail${expanded ? " is-expanded" : ""}`}
      data-capacity={capacity}
      data-container-width={containerWidth}
      data-testid="conversation-rail"
      onMouseEnter={() => {
        onCancelCollapse();
        onExpand();
      }}
      onMouseLeave={() => {
        onClearInspect();
        onScheduleCollapse();
      }}
      onWheel={handleWheel}
      style={style}
    >
      <nav
        aria-label="当前主会话消息目录"
        className="rail-stage"
        onFocus={onExpand}
        onBlur={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget)) {
            onScheduleCollapse();
          }
        }}
      >
        <svg
          aria-hidden="true"
          className="rail-connections"
          height={railHeight}
          viewBox={`0 0 ${overlayWidth} ${railHeight}`}
          width={overlayWidth}
        >
          {paths.map((path) => (
            <path d={path.d} key={path.key} />
          ))}
        </svg>

        {rows.map((row, rowIndex) => {
          if (row.type === "omission") {
            return (
              <OmissionMarker
                key={`omission-${row.fromIndex}-${row.toIndex}`}
                row={row}
                rowIndex={rowIndex}
              />
            );
          }

          const actor = actorById(row.event.actorId);
          const x = laneX.get(actor.id) ?? laneStart;
          const current = row.event.id === focusId;
          const inspected = row.event.id === inspectedId;
          const buttonStyle = {
            "--event-color": `var(--ident-${actor.tone})`,
            "--lane-x": `${x}px`,
            "--row-y": `${rowIndex * RAIL_ROW_HEIGHT}px`
          } as CSSProperties;

          return (
            <button
              aria-current={current ? "location" : undefined}
              aria-label={eventAccessibleLabel(row.event)}
              className={`rail-event rail-event-${row.event.kind}${
                current ? " is-current" : ""
              }${inspected ? " is-inspected" : ""}`}
              data-rail-event={row.event.id}
              data-testid={`rail-event-${row.event.id}`}
              key={row.event.id}
              onClick={() => onActivate(row.event)}
              onFocus={(focusEvent) => {
                onCancelCollapse();
                onExpand();
                onInspect(row.event, focusEvent.currentTarget);
              }}
              onKeyDown={(keyboardEvent) =>
                handleKeyDown(keyboardEvent, row.event)
              }
              onMouseEnter={(mouseEvent) =>
                onInspect(row.event, mouseEvent.currentTarget)
              }
              onMouseLeave={onClearInspect}
              style={buttonStyle}
              type="button"
            >
              <span aria-hidden="true" className="directory-tick" />
              <span aria-hidden="true" className="swimlane-marker" />
            </button>
          );
        })}
      </nav>

      <span className="rail-measurement" aria-hidden="true">
        视口容量 {capacity}
      </span>
    </div>
  );
}

function createConnectionPaths(
  rows: RailRow[],
  laneX: Map<string, number>
): Array<{ d: string; key: string }> {
  const paths: Array<{ d: string; key: string }> = [];

  for (let rowIndex = 1; rowIndex < rows.length; rowIndex += 1) {
    const previous = rows[rowIndex - 1];
    const current = rows[rowIndex];

    if (previous?.type === "event" && current?.type === "event") {
      const previousX = laneX.get(previous.event.actorId) ?? 18;
      const currentX = laneX.get(current.event.actorId) ?? 18;
      const previousY = (rowIndex - 1) * RAIL_ROW_HEIGHT + RAIL_ROW_HEIGHT / 2;
      const currentY = rowIndex * RAIL_ROW_HEIGHT + RAIL_ROW_HEIGHT / 2;
      paths.push({
        key: `${previous.event.id}-${current.event.id}`,
        d: createGitGraphCurvePath(
          previousX,
          previousY,
          currentX,
          currentY
        )
      });
      continue;
    }

  }

  return paths;
}

function OmissionMarker({
  row,
  rowIndex
}: {
  row: Extract<RailRow, { type: "omission" }>;
  rowIndex: number;
}): JSX.Element {
  return (
    <div
      aria-label={`暂时收起 ${row.count} 条消息`}
      className="rail-omission"
      data-testid="rail-omission"
      style={{ top: rowIndex * RAIL_ROW_HEIGHT }}
    >
      <span aria-hidden="true">•••</span>
    </div>
  );
}

function eventAccessibleLabel(event: RailEvent): string {
  const actor = actorById(event.actorId);
  return `${actor.name}，${event.body}`;
}
