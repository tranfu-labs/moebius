import type { Translate } from "@/i18n";

export const CONVERSATION_RELAY_COLLAPSED_ROW_HEIGHT = 20;
export const CONVERSATION_RELAY_EXPANDED_ROW_HEIGHT = 32;
export const CONVERSATION_RELAY_ROW_HEIGHT = CONVERSATION_RELAY_COLLAPSED_ROW_HEIGHT;
export const CONVERSATION_RELAY_MIN_CAPACITY = 3;
export const CONVERSATION_RELAY_PREFERRED_MIN_CAPACITY = 7;
export const CONVERSATION_RELAY_COLLAPSED_WIDTH = 44;
export const CONVERSATION_RELAY_MAX_EXPANDED_WIDTH = 224;
export const CONVERSATION_RELAY_SPINE_X = 14;
export const CONVERSATION_RELAY_LANE_STEP = 18;
export const CONVERSATION_RELAY_RIGHT_PADDING = 14;

export interface ConversationRelayMessageInput {
  id: number;
  speaker: "user" | "agent" | "system";
  role: string | null;
  body: string;
  sourceKind?: string | null;
  updatedAt: string;
  attachments?: readonly { displayName: string }[];
}

export interface ConversationRelayEvent {
  id: string;
  messageId: number;
  kind: "user" | "agent";
  actorKey: string;
  actorName: string;
  body: string;
  updatedAt: string;
}

export interface ConversationRelayEventRow {
  type: "event";
  event: ConversationRelayEvent;
  eventIndex: number;
}

export interface ConversationRelayOmissionRow {
  type: "omission";
  fromIndex: number;
  toIndex: number;
  count: number;
}

export type ConversationRelayRow =
  | ConversationRelayEventRow
  | ConversationRelayOmissionRow;

export interface ConversationRelayLayout {
  agentKeys: readonly string[];
  expandedWidth: number;
  laneStep: number;
  lanes: ReadonlyMap<string, number>;
  spineX: number;
}

export interface ConversationRelayPath {
  actorKey: string | null;
  d: string;
  eventIds: readonly string[];
  key: string;
  kind: "spine" | "branch";
}

export function projectConversationRelayEvents(
  messages: readonly ConversationRelayMessageInput[],
  resolveAgentName: (role: string | null) => string,
  t: Translate,
): ConversationRelayEvent[] {
  return messages.flatMap((message) => {
    if (
      (message.speaker !== "user" && message.speaker !== "agent")
      || message.sourceKind === "local-child-session-card"
      || message.sourceKind === "local-worker-run"
    ) {
      return [];
    }
    const kind = message.speaker;
    const actorKey = kind === "user" ? "user" : (message.role?.trim() || "agent");
    const body = message.body.trim()
      || message.attachments
        ?.map((attachment) => attachment.displayName)
        .join(t("console.relay.attachmentSeparator"))
      || t("console.relay.attachmentMessage");
    return [{
      id: `message-${String(message.id)}`,
      messageId: message.id,
      kind,
      actorKey,
      actorName: kind === "user" ? t("console.common.you") : resolveAgentName(message.role),
      body,
      updatedAt: message.updatedAt,
    }];
  });
}

export function deriveConversationRelayCapacity(
  viewportHeight: number,
): number {
  const safeHeight = Number.isFinite(viewportHeight) ? Math.max(0, viewportHeight) : 0;
  const expandedCapacity = Math.floor(
    safeHeight / CONVERSATION_RELAY_EXPANDED_ROW_HEIGHT,
  );
  if (expandedCapacity >= CONVERSATION_RELAY_PREFERRED_MIN_CAPACITY) {
    return expandedCapacity;
  }
  const compactCapacity = Math.floor(
    safeHeight / CONVERSATION_RELAY_COLLAPSED_ROW_HEIGHT,
  );
  return compactCapacity >= CONVERSATION_RELAY_PREFERRED_MIN_CAPACITY
    ? CONVERSATION_RELAY_PREFERRED_MIN_CAPACITY
    : Math.max(CONVERSATION_RELAY_MIN_CAPACITY, compactCapacity);
}

export function deriveConversationRelayExpandedRowHeight(
  viewportHeight: number,
  rowCount: number,
): number {
  if (rowCount <= 0 || viewportHeight <= 0) {
    return CONVERSATION_RELAY_COLLAPSED_ROW_HEIGHT;
  }
  return clamp(
    viewportHeight / rowCount,
    CONVERSATION_RELAY_COLLAPSED_ROW_HEIGHT,
    CONVERSATION_RELAY_EXPANDED_ROW_HEIGHT,
  );
}

export function computeConversationRelayRows(
  events: readonly ConversationRelayEvent[],
  focusId: string | null,
  capacity: number,
): ConversationRelayRow[] {
  if (events.length === 0) return [];

  const safeCapacity = Math.max(CONVERSATION_RELAY_MIN_CAPACITY, capacity);
  if (events.length <= safeCapacity) {
    return events.map((event, eventIndex) => ({ type: "event", event, eventIndex }));
  }

  const foundFocusIndex = focusId === null
    ? -1
    : events.findIndex((event) => event.id === focusId);
  const focusIndex = foundFocusIndex < 0 ? events.length - 1 : foundFocusIndex;
  if (safeCapacity <= 4) {
    const compactIndexes = safeCapacity === 3
      ? [0, focusIndex, events.length - 1]
      : focusIndex <= 1
        ? [0, 1, 2, events.length - 1]
        : focusIndex >= events.length - 2
          ? [0, events.length - 3, events.length - 2, events.length - 1]
          : [0, focusIndex, focusIndex + 1, events.length - 1];
    return eventsFromIndexes(events, compactIndexes);
  }
  const edgeWindow = safeCapacity - 2;

  if (focusIndex < edgeWindow) {
    return rowsFromIndexes(events, [
      ...range(0, edgeWindow - 1),
      events.length - 1,
    ]);
  }
  if (focusIndex >= events.length - edgeWindow) {
    return rowsFromIndexes(events, [
      0,
      ...range(events.length - edgeWindow, events.length - 1),
    ]);
  }

  const middleWindow = safeCapacity - 4;
  const before = Math.floor((middleWindow - 1) / 2);
  const start = focusIndex - before;
  return rowsFromIndexes(events, [
    0,
    ...range(start, start + middleWindow - 1),
    events.length - 1,
  ]);
}

function eventsFromIndexes(
  events: readonly ConversationRelayEvent[],
  indexes: readonly number[],
): ConversationRelayEventRow[] {
  return [...new Set(indexes)]
    .filter((index) => index >= 0 && index < events.length)
    .sort((left, right) => left - right)
    .flatMap((eventIndex) => {
      const event = events[eventIndex];
      return event === undefined ? [] : [{ type: "event" as const, event, eventIndex }];
    });
}

export function deriveConversationRelayLayout(
  events: readonly ConversationRelayEvent[],
  availableWidth: number,
): ConversationRelayLayout {
  const agentKeys = [...new Set(
    events
      .filter((event) => event.kind === "agent")
      .map((event) => event.actorKey),
  )];
  const maxWidth = clamp(
    Math.floor(availableWidth),
    CONVERSATION_RELAY_COLLAPSED_WIDTH,
    CONVERSATION_RELAY_MAX_EXPANDED_WIDTH,
  );
  const laneStep = agentKeys.length === 0
    ? 0
    : Math.min(
      CONVERSATION_RELAY_LANE_STEP,
      (maxWidth - CONVERSATION_RELAY_SPINE_X - CONVERSATION_RELAY_RIGHT_PADDING)
        / agentKeys.length,
    );
  const expandedWidth = agentKeys.length === 0
    ? CONVERSATION_RELAY_COLLAPSED_WIDTH
    : Math.max(
      CONVERSATION_RELAY_COLLAPSED_WIDTH,
      Math.round(
        CONVERSATION_RELAY_SPINE_X
          + laneStep * agentKeys.length
          + CONVERSATION_RELAY_RIGHT_PADDING,
      ),
    );
  const lanes = new Map<string, number>();
  for (const event of events) {
    if (event.kind === "user") {
      lanes.set(event.actorKey, CONVERSATION_RELAY_SPINE_X);
    }
  }
  agentKeys.forEach((actorKey, index) => {
    lanes.set(
      actorKey,
      CONVERSATION_RELAY_SPINE_X + laneStep * (index + 1),
    );
  });
  return {
    agentKeys,
    expandedWidth,
    laneStep,
    lanes,
    spineX: CONVERSATION_RELAY_SPINE_X,
  };
}

export function createConversationRelayCurvePath(
  previousX: number,
  previousY: number,
  currentX: number,
  currentY: number,
): string {
  return [
    `M ${String(previousX)} ${String(previousY)}`,
    conversationRelayCurveCommand(previousX, previousY, currentX, currentY),
  ].join(" ");
}

export function deriveConversationRelayPaths(
  events: readonly ConversationRelayEvent[],
  rows: readonly ConversationRelayRow[],
  layout: ConversationRelayLayout,
  rowHeight: number,
): ConversationRelayPath[] {
  const visibleEvents = rows.flatMap((row, rowIndex) =>
    row.type === "event" ? [{ event: row.event, rowIndex }] : []);
  if (visibleEvents.length === 0) return [];

  const paths: ConversationRelayPath[] = [];
  const spineSegments = splitConversationRelayRowsAtOmissions(visibleEvents, rows);
  spineSegments.forEach((segment, segmentIndex) => {
    const first = segment[0];
    const last = segment.at(-1);
    if (first === undefined || last === undefined) return;
    const startsAfterOmission = rows[first.rowIndex - 1]?.type === "omission";
    const endsBeforeOmission = rows[last.rowIndex + 1]?.type === "omission";
    const startY = startsAfterOmission
      ? first.rowIndex * rowHeight
      : rowCenter(first.rowIndex, rowHeight);
    const endY = endsBeforeOmission
      ? (last.rowIndex + 1) * rowHeight
      : rowCenter(last.rowIndex, rowHeight);
    if (startY === endY) return;
    paths.push({
      actorKey: null,
      d: [
        `M ${String(layout.spineX)} ${String(startY)}`,
        `L ${String(layout.spineX)} ${String(endY)}`,
      ].join(" "),
      eventIds: segment
        .filter(({ event }) => event.kind === "user")
        .map(({ event }) => event.id),
      key: `user-spine-${String(segmentIndex)}`,
      kind: "spine",
    });
  });

  const eventIndexById = new Map(events.map((event, index) => [event.id, index]));
  const visibleById = new Map(
    visibleEvents.map(({ event, rowIndex }) => [event.id, { event, rowIndex }]),
  );

  for (const actorKey of layout.agentKeys) {
    const actorRows = visibleEvents.filter(
      ({ event }) => event.kind === "agent" && event.actorKey === actorKey,
    );
    const segments = splitConversationRelayRowsAtOmissions(actorRows, rows);
    segments.forEach((segment, segmentIndex) => {
      const first = segment[0];
      const last = segment.at(-1);
      if (first === undefined || last === undefined) return;
      const laneX = layout.lanes.get(actorKey) ?? layout.spineX;
      const firstY = rowCenter(first.rowIndex, rowHeight);
      const firstEventIndex = eventIndexById.get(first.event.id) ?? 0;
      const previousEvent = events[firstEventIndex - 1];
      const previousVisible = previousEvent === undefined
        ? undefined
        : visibleById.get(previousEvent.id);
      let d: string;

      if (
        previousVisible !== undefined
        && !hasConversationRelayOmissionBetween(
          rows,
          previousVisible.rowIndex,
          first.rowIndex,
        )
      ) {
        const previousX = layout.lanes.get(previousVisible.event.actorKey)
          ?? layout.spineX;
        d = createConversationRelayCurvePath(
          previousX,
          rowCenter(previousVisible.rowIndex, rowHeight),
          laneX,
          firstY,
        );
      } else if (previousEvent !== undefined) {
        d = [
          `M ${String(laneX)} ${String(first.rowIndex * rowHeight)}`,
          `L ${String(laneX)} ${String(firstY)}`,
        ].join(" ");
      } else {
        d = `M ${String(laneX)} ${String(firstY)}`;
      }

      for (const actorRow of segment.slice(1)) {
        d += ` L ${String(laneX)} ${String(rowCenter(actorRow.rowIndex, rowHeight))}`;
      }

      const lastEventIndex = eventIndexById.get(last.event.id) ?? events.length - 1;
      const nextEvent = events[lastEventIndex + 1];
      const nextVisible = nextEvent === undefined
        ? undefined
        : visibleById.get(nextEvent.id);
      const lastY = rowCenter(last.rowIndex, rowHeight);
      if (
        nextVisible !== undefined
        && !hasConversationRelayOmissionBetween(rows, last.rowIndex, nextVisible.rowIndex)
      ) {
        const nextX = layout.lanes.get(nextVisible.event.actorKey) ?? layout.spineX;
        d += ` ${conversationRelayCurveCommand(
          laneX,
          lastY,
          nextX,
          rowCenter(nextVisible.rowIndex, rowHeight),
        )}`;
      } else if (nextEvent !== undefined) {
        d += ` L ${String(laneX)} ${String((last.rowIndex + 1) * rowHeight)}`;
      }

      paths.push({
        actorKey,
        d,
        eventIds: segment.map(({ event }) => event.id),
        key: `branch-${actorKey}-${String(segmentIndex)}`,
        kind: "branch",
      });
    });
  }

  return paths;
}

export function adjacentConversationRelayEventId(
  events: readonly ConversationRelayEvent[],
  currentId: string,
  direction: -1 | 1,
): string {
  if (events.length === 0) return currentId;
  const currentIndex = Math.max(0, events.findIndex((event) => event.id === currentId));
  return events[clamp(currentIndex + direction, 0, events.length - 1)]?.id ?? currentId;
}

function rowsFromIndexes(
  events: readonly ConversationRelayEvent[],
  indexes: readonly number[],
): ConversationRelayRow[] {
  const uniqueIndexes = [...new Set(indexes)]
    .filter((index) => index >= 0 && index < events.length)
    .sort((left, right) => left - right);
  const rows: ConversationRelayRow[] = [];

  uniqueIndexes.forEach((eventIndex, position) => {
    const previousIndex = uniqueIndexes[position - 1];
    if (previousIndex !== undefined && eventIndex - previousIndex > 1) {
      const fromIndex = previousIndex + 1;
      const toIndex = eventIndex - 1;
      rows.push({
        type: "omission",
        fromIndex,
        toIndex,
        count: toIndex - fromIndex + 1,
      });
    }
    const event = events[eventIndex];
    if (event !== undefined) {
      rows.push({ type: "event", event, eventIndex });
    }
  });
  return rows;
}

function range(start: number, end: number): number[] {
  return Array.from(
    { length: Math.max(0, end - start + 1) },
    (_, index) => start + index,
  );
}

function splitConversationRelayRowsAtOmissions(
  actorRows: Array<{ event: ConversationRelayEvent; rowIndex: number }>,
  rows: readonly ConversationRelayRow[],
): Array<Array<{ event: ConversationRelayEvent; rowIndex: number }>> {
  const segments: Array<Array<{ event: ConversationRelayEvent; rowIndex: number }>> = [];
  for (const actorRow of actorRows) {
    const currentSegment = segments.at(-1);
    const previousActorRow = currentSegment?.at(-1);
    if (
      currentSegment === undefined
      || previousActorRow === undefined
      || hasConversationRelayOmissionBetween(
        rows,
        previousActorRow.rowIndex,
        actorRow.rowIndex,
      )
    ) {
      segments.push([actorRow]);
    } else {
      currentSegment.push(actorRow);
    }
  }
  return segments;
}

function hasConversationRelayOmissionBetween(
  rows: readonly ConversationRelayRow[],
  fromRowIndex: number,
  toRowIndex: number,
): boolean {
  return rows
    .slice(Math.min(fromRowIndex, toRowIndex) + 1, Math.max(fromRowIndex, toRowIndex))
    .some((row) => row.type === "omission");
}

function rowCenter(rowIndex: number, rowHeight: number): number {
  return rowIndex * rowHeight + rowHeight / 2;
}

function conversationRelayCurveCommand(
  previousX: number,
  previousY: number,
  currentX: number,
  currentY: number,
): string {
  const bend = Math.max(4, Math.abs(currentY - previousY) / 2);
  return [
    `C ${String(previousX)} ${String(previousY + bend)}`,
    `${String(currentX)} ${String(currentY - bend)}`,
    `${String(currentX)} ${String(currentY)}`,
  ].join(" ");
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value));
}
