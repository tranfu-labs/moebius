import { useMemo, type Dispatch, type MutableRefObject, type SetStateAction } from "react";

import type { ConversationDraftStore } from "./draft-store.js";
import type { ConsoleSelection } from "./console-state-coordinator.js";
import type { SessionRunPort } from "./session-run-contract.js";
import type { SidebarMessagePort } from "./sidebar-message-contract.js";
import { planReadyAttachmentIds } from "./managed-attachment-model.js";
import type { useManagedAttachmentDrafts } from "./use-managed-attachments.js";
import { useSessionRunActions } from "./use-session-run-actions.js";
import { useSidebarMessageActions } from "./use-sidebar-message-actions.js";

export function useSessionConsole(
  apiBase: string | null,
  subSessionComposerValues: Readonly<Record<string, string>>,
  setSubSessionComposerValues: Dispatch<SetStateAction<Record<string, string>>>,
  subSessionAttachments: ReturnType<typeof useManagedAttachmentDrafts>,
  draftStore: ConversationDraftStore,
  selectionRef: MutableRefObject<ConsoleSelection>,
  refresh: (selection: ConsoleSelection) => Promise<boolean>,
  refreshSubSession: (sessionId: string) => Promise<unknown>,
  runPort: SessionRunPort,
  sidebarSendingId: string | null,
  setSidebarSendingId: (sessionId: string | null) => void,
  sidebarComposerValues: Readonly<Record<string, string>>,
  setSidebarComposerValues: Dispatch<SetStateAction<Record<string, string>>>,
  sidebarAttachments: ReturnType<typeof useManagedAttachmentDrafts>,
  sidebarViews: Parameters<typeof useSidebarMessageActions>[8],
  setSidebarViews: Parameters<typeof useSidebarMessageActions>[9],
  sidebarPort: SidebarMessagePort,
  setError: (error: string | null) => void,
) {
  const runs = useSessionRunActions(
    apiBase, subSessionComposerValues, setSubSessionComposerValues,
    planReadyAttachmentIds(subSessionAttachments.attachments), subSessionAttachments.clearDraft, draftStore,
    selectionRef, refresh, refreshSubSession, runPort, setError,
  );
  const sidebarMessages = useSidebarMessageActions(
    apiBase, sidebarSendingId, setSidebarSendingId, sidebarComposerValues,
    setSidebarComposerValues, planReadyAttachmentIds(sidebarAttachments.attachments), sidebarAttachments.clearDraft,
    draftStore, sidebarViews, setSidebarViews, selectionRef, refresh, sidebarPort, setError,
  );
  return useMemo(() => ({ runs, sidebarMessages }), [runs, sidebarMessages]);
}
