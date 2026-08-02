import { useCallback, useMemo, type Dispatch, type SetStateAction } from "react";

import type { ManagedAttachmentClient } from "./managed-attachment-port.js";
import type { ConversationDraftKey } from "./conversation-draft-model.js";
import {
  decideSidebarAttachmentPresenceCommit,
  planConsoleAttachmentDraftKeys,
} from "./managed-attachment-model.js";
import type {
  SidebarConversationDraft,
  SidebarConversationDraftAttachmentPresence,
  SidebarConversationDraftStore,
} from "./sidebar-conversation-drafts.js";
import { useManagedAttachmentDrafts } from "./use-managed-attachments.js";

export function useConsoleAttachmentDrafts(
  client: ManagedAttachmentClient,
  apiBase: string | null,
  capability: string | null,
  newConversationOpen: boolean,
  composerDraftKey: ConversationDraftKey,
  activeSubSessionId: string | null,
  activeSidebarSessionId: string | null,
  activeSidebarAttachmentDraftKey: `draft:sidebar:${string}` | null,
  sidebarDraftStore: SidebarConversationDraftStore,
  commitSidebarDrafts: Dispatch<SetStateAction<SidebarConversationDraft[]>>,
  setError: (error: string | null) => void,
) {
  const keys = planConsoleAttachmentDraftKeys({
    newConversationOpen,
    composerDraftKey,
    activeSubSessionId,
    activeSidebarSessionId,
    activeSidebarAttachmentDraftKey,
  });
  const onError = useCallback((error: string) => setError(error), [setError]);
  const onSidebarPresence = useCallback((
    draftKey: string,
    presence: SidebarConversationDraftAttachmentPresence,
  ) => {
    const decision = decideSidebarAttachmentPresenceCommit(
      sidebarDraftStore.setManagedAttachmentPresence(draftKey, presence),
    );
    if (decision === "skip") return;
    commitSidebarDrafts(sidebarDraftStore.list());
  }, [commitSidebarDrafts, sidebarDraftStore]);
  const main = useManagedAttachmentDrafts({
    client,
    apiBase,
    capability,
    currentDraftKey: keys.main,
    onError,
  });
  const subSession = useManagedAttachmentDrafts({
    client,
    apiBase,
    capability,
    currentDraftKey: keys.subSession,
    onError,
  });
  const sidebar = useManagedAttachmentDrafts({
    client,
    apiBase,
    capability,
    currentDraftKey: keys.sidebar,
    onError,
    onDraftAttachmentPresenceChange: onSidebarPresence,
  });
  return useMemo(() => ({ main, subSession, sidebar }), [main, sidebar, subSession]);
}
