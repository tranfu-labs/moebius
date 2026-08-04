export const MAIN_CONVERSATION_COLUMN_WIDTH_CLASS = "max-w-[840px]";
export const MAIN_CONVERSATION_COLUMN_GUTTER_CLASS = "px-8";
const MAIN_CONVERSATION_COLUMN_MAX_WIDTH_PX = 840;
const MAIN_CONVERSATION_COLUMN_GUTTER_PX = 32;
const CONVERSATION_RELAY_LEFT_PX = 12;
const CONVERSATION_RELAY_GAP_PX = 12;

export function planConversationRelayClearance(
  paneWidth: number,
  relayExpandedWidth: number,
): number {
  const naturalColumnLeft = Math.max(
    MAIN_CONVERSATION_COLUMN_GUTTER_PX,
    Math.floor((paneWidth - MAIN_CONVERSATION_COLUMN_MAX_WIDTH_PX) / 2),
  );
  const requiredColumnLeft = CONVERSATION_RELAY_LEFT_PX
    + relayExpandedWidth
    + CONVERSATION_RELAY_GAP_PX;
  return naturalColumnLeft >= requiredColumnLeft
    ? MAIN_CONVERSATION_COLUMN_GUTTER_PX
    : requiredColumnLeft;
}

export function planConversationMessageReveal(
  messageIds: readonly number[],
  targetMessageId: number,
  mountedMessageIds: readonly number[],
):
  | { kind: "not-found" }
  | { kind: "mounted"; index: number }
  | { kind: "virtual"; index: number } {
  const index = messageIds.indexOf(targetMessageId);
  if (index < 0) return { kind: "not-found" };
  return mountedMessageIds.includes(targetMessageId)
    ? { kind: "mounted", index }
    : { kind: "virtual", index };
}

export function planConversationReadingRestore<TEvent extends { id: string; messageId: number }>(
  events: readonly TEvent[],
  savedMessageId: number | null,
):
  | { kind: "skip" }
  | { kind: "reveal"; event: TEvent }
  | { kind: "follow-latest"; event: TEvent } {
  const latest = events.at(-1);
  if (latest === undefined) return { kind: "skip" };
  const saved = savedMessageId === null
    ? undefined
    : events.find((event) => event.messageId === savedMessageId);
  if (saved !== undefined) {
    return saved.id === latest.id
      ? { kind: "follow-latest", event: saved }
      : { kind: "reveal", event: saved };
  }
  return { kind: "follow-latest", event: latest };
}
