import { useMemo } from "react";

import type { ManagedAttachmentClient } from "./managed-attachment-port.js";
import type { SidebarConversationDraftAttachmentPresence } from "./sidebar-conversation-drafts.js";
import { useManagedAttachmentDrafts } from "./use-managed-attachments.js";

export function useConsoleAttachmentDrafts(
  client: ManagedAttachmentClient,
  apiBase: string | null,
  capability: string | null,
  mainDraftKey: string,
  subSessionDraftKey: string,
  sidebarDraftKey: string,
  onError: (error: string) => void,
  onSidebarPresence: (
    draftKey: string,
    presence: SidebarConversationDraftAttachmentPresence,
  ) => void,
) {
  const main = useManagedAttachmentDrafts({
    client,
    apiBase,
    capability,
    currentDraftKey: mainDraftKey,
    onError,
  });
  const subSession = useManagedAttachmentDrafts({
    client,
    apiBase,
    capability,
    currentDraftKey: subSessionDraftKey,
    onError,
  });
  const sidebar = useManagedAttachmentDrafts({
    client,
    apiBase,
    capability,
    currentDraftKey: sidebarDraftKey,
    onError,
    onDraftAttachmentPresenceChange: onSidebarPresence,
  });
  return useMemo(() => ({ main, subSession, sidebar }), [main, sidebar, subSession]);
}
