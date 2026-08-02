import { useMemo, type Dispatch } from "react";

import type { ConversationReadingPositionStore } from "./conversation-reading-position.js";
import type { ConversationDraftStore } from "./draft-store.js";
import type { NewConversationDraftEvent } from "./new-conversation.js";
import { useConsoleSelectionState } from "./use-console-selection-state.js";
import { useConversationComposer } from "./use-conversation-composer.js";

export function useConsoleLocalState(
  storage: Storage,
  draftStore: ConversationDraftStore,
  readingPositionStore: ConversationReadingPositionStore,
  dispatchNewConversation: Dispatch<NewConversationDraftEvent>,
) {
  const selection = useConsoleSelectionState(
    storage,
    draftStore,
    readingPositionStore,
    dispatchNewConversation,
  );
  const composer = useConversationComposer(selection.selection.sessionId, draftStore);
  return useMemo(() => ({ selection, composer }), [composer, selection]);
}
