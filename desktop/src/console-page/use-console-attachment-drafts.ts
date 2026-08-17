import type { Translate, TranslationKey } from "@moebius/console-ui";
import { useCallback, useMemo, type Dispatch, type SetStateAction } from "react";

import type { ManagedAttachmentClient } from "./managed-attachment-port.js";
import type { ManagedAttachmentFailureCode } from "./managed-attachment-contract.js";
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
import type { ConsoleErrorController } from "./use-console-error-state.js";

const failureKeys: Readonly<Record<ManagedAttachmentFailureCode, TranslationKey>> = {
  "attachment-upload": "desktop.error.attachmentUpload",
  "attachment-preview-not-ready": "desktop.error.attachmentPreviewNotReady",
  "attachment-preview-save": "desktop.error.attachmentPreviewSave",
  "attachment-draft-restore": "desktop.error.attachmentDraftRestore",
  "attachment-backfill": "desktop.error.attachmentBackfill",
  "attachment-remove": "desktop.error.attachmentRemove",
  "attachment-preview-read": "desktop.error.attachmentPreviewRead",
  "image-preview-budget": "desktop.error.imagePreviewBudget",
  "image-preview-decode": "desktop.error.imagePreviewDecode",
  "image-dimensions-invalid": "desktop.error.imageDimensionsInvalid",
  "image-preview-canvas": "desktop.error.imagePreviewCanvas",
  "image-preview-encode": "desktop.error.imagePreviewEncode",
  "attachment-service-unavailable": "desktop.error.attachmentServiceUnavailable",
  "attachment-draft-owner-mismatch": "desktop.error.attachmentDraftOwnerMismatch",
};

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
  errors: ConsoleErrorController,
  t: Translate,
) {
  const keys = planConsoleAttachmentDraftKeys({
    newConversationOpen,
    composerDraftKey,
    activeSubSessionId,
    activeSidebarSessionId,
    activeSidebarAttachmentDraftKey,
  });
  const mainError = useCallback((error: string) => {
    errors.report({ family: "attachment", scope: keys.main }, error);
  }, [errors, keys.main]);
  const subSessionError = useCallback((error: string) => {
    errors.report({ family: "attachment", scope: keys.subSession }, error);
  }, [errors, keys.subSession]);
  const sidebarError = useCallback((error: string) => {
    errors.report({ family: "attachment", scope: keys.sidebar }, error);
  }, [errors, keys.sidebar]);
  const translateFailure = useCallback(
    (code: ManagedAttachmentFailureCode) => t(failureKeys[code]),
    [t],
  );
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
    onError: mainError,
    translateFailure,
  });
  const subSession = useManagedAttachmentDrafts({
    client,
    apiBase,
    capability,
    currentDraftKey: keys.subSession,
    onError: subSessionError,
    translateFailure,
  });
  const sidebar = useManagedAttachmentDrafts({
    client,
    apiBase,
    capability,
    currentDraftKey: keys.sidebar,
    onError: sidebarError,
    translateFailure,
    onDraftAttachmentPresenceChange: onSidebarPresence,
  });
  return useMemo(() => ({ main, subSession, sidebar }), [main, sidebar, subSession]);
}
