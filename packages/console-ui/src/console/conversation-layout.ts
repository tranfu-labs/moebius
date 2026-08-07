import { CONVERSATION_RELAY_COLLAPSED_WIDTH } from "@/console/conversation-relay-rail-model";

export const MAIN_CONVERSATION_COLUMN_WIDTH_CLASS = "max-w-[840px]";
export const MAIN_CONVERSATION_COLUMN_GUTTER_CLASS = "px-8";
const MAIN_CONVERSATION_COLUMN_MAX_WIDTH_PX = 840;
const MAIN_CONVERSATION_COLUMN_GUTTER_PX = 32;
const CONVERSATION_RELAY_LEFT_PX = 12;

export function planConversationRelayClearance(paneWidth: number): number {
  const naturalColumnLeft = Math.max(
    MAIN_CONVERSATION_COLUMN_GUTTER_PX,
    Math.floor((paneWidth - MAIN_CONVERSATION_COLUMN_MAX_WIDTH_PX) / 2),
  );
  // 覆盖式展开：留白只让开收起态目录轨（12px 内缩 + 44px 收起视口），
  // 展开面板以悬浮覆盖层呈现、不参与留白计算（见 design.md 分支阈值推导）。
  const requiredColumnLeft = CONVERSATION_RELAY_LEFT_PX + CONVERSATION_RELAY_COLLAPSED_WIDTH;
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
