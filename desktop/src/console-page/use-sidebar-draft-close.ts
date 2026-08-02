import { useCallback, useMemo } from "react";
import type { RightSidebarTab, Translate } from "@moebius/console-ui";

import {
  planSidebarConversationDraftId,
  planSidebarDraftCloseDecision,
  planSidebarAttachmentDraftKey,
} from "./sidebar-draft-model.js";
import type { SidebarConversationDraft, SidebarConversationDraftStore } from "./sidebar-conversation-drafts.js";
import type { useManagedAttachmentDrafts } from "./use-managed-attachments.js";

export function useSidebarDraftClose(
  store: SidebarConversationDraftStore,
  commitDrafts: (drafts: SidebarConversationDraft[]) => void,
  attachments: ReturnType<typeof useManagedAttachmentDrafts>,
  confirmDiscard: (message: string) => boolean,
  t: Translate,
) {
  const beforeClose = useCallback((tab: RightSidebarTab): boolean => {
    const draftId = planSidebarConversationDraftId(tab);
    if (draftId === null) return true;
    const draft = store.read(draftId);
    const attachmentDraftKey = planSidebarAttachmentDraftKey(draft);
    const decision = planSidebarDraftCloseDecision(
      draft,
      attachmentDraftKey === null ? false : attachments.hasDraftAttachments(attachmentDraftKey),
    );
    if (decision === "retain") return true;
    if (decision === "confirm" && !confirmDiscard(t("console.sessionAnalysis.discardDraft"))) {
      return false;
    }
    store.remove(draftId);
    commitDrafts(store.list());
    if (attachmentDraftKey !== null) attachments.clearDraft(attachmentDraftKey);
    return true;
  }, [attachments, commitDrafts, confirmDiscard, store, t]);
  return useMemo(() => ({ beforeClose }), [beforeClose]);
}
