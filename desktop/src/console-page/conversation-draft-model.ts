import type { Translate } from "@moebius/console-ui";

export const NEW_CONVERSATION_DRAFT_KEY = "draft:new";

export type ConversationDraftKey =
  | typeof NEW_CONVERSATION_DRAFT_KEY
  | `draft:${string}`
  | `agent-form:${string}`
  | `agent-form-submitted:${string}`;

export interface ConversationComposerDraftState {
  key: ConversationDraftKey;
  value: string;
}

export type ConversationSubmissionBlockReason = "transition-pending" | "owner-mismatch";

export function sessionDraftKey(sessionId: string): ConversationDraftKey {
  return `draft:${sessionId}`;
}

export function agentFormDraftKey(sessionId: string, sourceMessageId: number): ConversationDraftKey {
  return `agent-form:${sessionId}:${String(sourceMessageId)}`;
}

export function agentFormSubmittedKey(sessionId: string, sourceMessageId: number): ConversationDraftKey {
  return `agent-form-submitted:${sessionId}:${String(sourceMessageId)}`;
}

export function activateConversationComposerDraft(
  current: ConversationComposerDraftState,
  key: ConversationDraftKey,
  persistedValue: string,
): ConversationComposerDraftState {
  return current.key === key ? current : { key, value: persistedValue };
}

export function editConversationComposerDraft(
  current: ConversationComposerDraftState,
  value: string,
): ConversationComposerDraftState {
  return current.value === value ? current : { ...current, value };
}

export function clearConversationComposerDraft(
  current: ConversationComposerDraftState,
  key: ConversationDraftKey,
): ConversationComposerDraftState {
  return current.key === key && current.value !== ""
    ? { ...current, value: "" }
    : current;
}

export function conversationSubmissionBlockReason(input: {
  ownerKey: ConversationDraftKey;
  selectedSessionId: string;
  transitionPending: boolean;
}): ConversationSubmissionBlockReason | null {
  if (input.transitionPending) return "transition-pending";
  return input.ownerKey === sessionDraftKey(input.selectedSessionId)
    ? null
    : "owner-mismatch";
}

export function planConversationSubmissionAction(input: {
  ownerKey: ConversationDraftKey;
  selectedSessionId: string;
  transitionPending: boolean;
}): "send" | ConversationSubmissionBlockReason {
  return conversationSubmissionBlockReason(input) ?? "send";
}

export function planConversationSubmissionBlockText(
  action: "send" | ConversationSubmissionBlockReason,
  t: Translate,
): string | null {
  if (action === "transition-pending") return t("desktop.composer.transitionPending");
  if (action === "owner-mismatch") return t("desktop.composer.ownerMismatch");
  return null;
}

export function planSessionTransitionSettlement(latest: boolean): "commit" | "stale" {
  return latest ? "commit" : "stale";
}
