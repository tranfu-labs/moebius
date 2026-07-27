export const CONVERSATION_RELAY_ROW_HEIGHT = 20;
export const CONVERSATION_RELAY_MIN_CAPACITY = 7;
export const CONVERSATION_RELAY_COLLAPSED_WIDTH = 44;
export const CONVERSATION_RELAY_MIN_EXPANDED_WIDTH = 148;
export const CONVERSATION_RELAY_MAX_EXPANDED_WIDTH = 224;

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
  rowHeight = CONVERSATION_RELAY_ROW_HEIGHT,
): number {
  const measured = Math.floor(Math.max(0, viewportHeight - rowHeight) / rowHeight);
  return Math.max(CONVERSATION_RELAY_MIN_CAPACITY, measured);
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

export function conversationRelayExpandedWidth(containerWidth: number): number {
  return clamp(
    Math.round(156 + (containerWidth - 560) * 0.18),
    CONVERSATION_RELAY_MIN_EXPANDED_WIDTH,
    CONVERSATION_RELAY_MAX_EXPANDED_WIDTH,
  );
}

export function conversationRelayLanePositions(
  events: readonly ConversationRelayEvent[],
  expandedWidth: number,
): Map<string, number> {
  const actorKeys = [...new Set(events.map((event) => event.actorKey))];
  const laneStart = 18;
  const laneEnd = expandedWidth - 18;
  const step = actorKeys.length > 1
    ? (laneEnd - laneStart) / (actorKeys.length - 1)
    : 0;
  return new Map(actorKeys.map((actorKey, index) => [
    actorKey,
    laneStart + step * index,
  ]));
}

export function createConversationRelayCurvePath(
  previousX: number,
  previousY: number,
  currentX: number,
  currentY: number,
): string {
  const verticalDistance = currentY - previousY;
  return [
    `M ${String(previousX)} ${String(previousY)}`,
    `C ${String(previousX)} ${String(previousY + verticalDistance * (20 / 31))}`,
    `${String(currentX)} ${String(previousY + verticalDistance * (11 / 31))}`,
    `${String(currentX)} ${String(currentY)}`,
  ].join(" ");
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

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value));
}
import type { Translate } from "@/i18n";
