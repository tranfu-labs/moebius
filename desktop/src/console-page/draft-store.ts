export const NEW_CONVERSATION_DRAFT_KEY = "draft:new";

export type ConversationDraftKey = typeof NEW_CONVERSATION_DRAFT_KEY | `draft:${string}`;

export interface ConversationComposerDraftState {
  key: ConversationDraftKey;
  value: string;
}

export type ConversationSubmissionBlockReason =
  | "transition-pending"
  | "owner-mismatch";

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
  if (input.transitionPending) {
    return "transition-pending";
  }
  return input.ownerKey === sessionDraftKey(input.selectedSessionId)
    ? null
    : "owner-mismatch";
}

export interface ConversationDraftStore {
  read(key: ConversationDraftKey): string;
  write(key: ConversationDraftKey, value: string): void;
  clear(key: ConversationDraftKey): void;
  readResumeRunId(key: ConversationDraftKey): string | null;
  writeResumeRunId(key: ConversationDraftKey, runId: string): void;
  clearResumeRunId(key: ConversationDraftKey): void;
}

export function createConversationDraftStore(storage: Storage): ConversationDraftStore {
  return {
    read(key) {
      try {
        return storage.getItem(key) ?? "";
      } catch {
        return "";
      }
    },
    write(key, value) {
      try {
        if (value === "") {
          storage.removeItem(key);
        } else {
          storage.setItem(key, value);
        }
      } catch {
        // Draft persistence is best-effort; typing must remain available.
      }
    },
    clear(key) {
      try {
        storage.removeItem(key);
      } catch {
        // A blocked storage backend must not break a successful send.
      }
    },
    readResumeRunId(key) {
      try {
        const value = storage.getItem(`${key}:resume-run`);
        return value === null || value.trim() === "" ? null : value;
      } catch {
        return null;
      }
    },
    writeResumeRunId(key, runId) {
      try {
        storage.setItem(`${key}:resume-run`, runId);
      } catch {
        // Recovery metadata is best-effort; full execution remains available.
      }
    },
    clearResumeRunId(key) {
      try {
        storage.removeItem(`${key}:resume-run`);
      } catch {
        // A blocked storage backend must not break a successful send.
      }
    },
  };
}
