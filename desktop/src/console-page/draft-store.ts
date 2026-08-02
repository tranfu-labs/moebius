import type { ConversationDraftKey } from "./conversation-draft-model.js";

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
