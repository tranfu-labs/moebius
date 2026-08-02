import { useCallback, useMemo, useRef, useState } from "react";

import {
  activateConversationComposerDraft,
  clearConversationComposerDraft,
  editConversationComposerDraft,
  sessionDraftKey,
  type ConversationComposerDraftState,
} from "./conversation-draft-model.js";
import type { ConversationDraftStore } from "./draft-store.js";

export function useConversationComposer(
  initialSessionId: string,
  store: ConversationDraftStore,
) {
  const [draft, setDraft] = useState<ConversationComposerDraftState>(() => {
    const key = sessionDraftKey(initialSessionId);
    return { key, value: store.read(key) };
  });
  const draftRef = useRef(draft);
  const commit = useCallback((next: ConversationComposerDraftState) => {
    draftRef.current = next;
    setDraft(next);
  }, []);
  const activate = useCallback((sessionId: string) => {
    const key = sessionDraftKey(sessionId);
    commit(activateConversationComposerDraft(draftRef.current, key, store.read(key)));
  }, [commit, store]);
  const clear = useCallback((sessionId: string) => {
    const key = sessionDraftKey(sessionId);
    store.clear(key);
    commit(clearConversationComposerDraft(draftRef.current, key));
  }, [commit, store]);
  const change = useCallback((value: string) => {
    store.write(draftRef.current.key, value);
    commit(editConversationComposerDraft(draftRef.current, value));
  }, [commit, store]);
  return useMemo(() => ({ draft, draftRef, commit, activate, clear, change }), [
    activate, change, clear, commit, draft,
  ]);
}
