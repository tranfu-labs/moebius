export const NEW_CONVERSATION_DRAFT_KEY = "draft:new";

export type ConversationDraftKey = typeof NEW_CONVERSATION_DRAFT_KEY | `draft:${string}`;

export interface ConversationComposerDraftState {
  key: ConversationDraftKey;
  value: string;
}

export type ConversationSubmissionBlockReason = "transition-pending" | "owner-mismatch";

export function sessionDraftKey(sessionId: string): ConversationDraftKey {
  return `draft:${sessionId}`;
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
