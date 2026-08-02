import { useMemo, useState, type MutableRefObject } from "react";
import type { OperatorProject, TranslationKey } from "@moebius/console-ui";

import type { ConversationDraftStore } from "./draft-store.js";
import type { ConsoleSelection } from "./console-state-coordinator.js";
import type { ConsolePresentationRoute } from "./presentation-route.js";
import type { SessionRunPort } from "./session-run-contract.js";
import type { SidebarDraftPort, SidebarDraftPreferenceTransport } from "./sidebar-draft-contract.js";
import type { SidebarConversationDraft, SidebarConversationDraftStore } from "./sidebar-conversation-drafts.js";
import type { SidebarMessagePort } from "./sidebar-message-contract.js";
import { planHasBlockingAttachments, planReadyAttachmentIds } from "./managed-attachment-model.js";
import type { AgentTeamCatalogBundle } from "./use-agent-team-catalog.js";
import type { useManagedAttachmentDrafts } from "./use-managed-attachments.js";
import type { useRightSidebarTabs } from "./use-right-sidebar-tabs.js";
import { useSessionRunActions } from "./use-session-run-actions.js";
import { useSidebarDraftActions } from "./use-sidebar-draft-actions.js";
import { useSidebarMessageActions } from "./use-sidebar-message-actions.js";

export function useSessionConsole(
  apiBase: string | null,
  subSessionAttachments: ReturnType<typeof useManagedAttachmentDrafts>,
  draftStore: ConversationDraftStore,
  selectionRef: MutableRefObject<ConsoleSelection>,
  refresh: (selection: ConsoleSelection) => Promise<boolean>,
  refreshSubSession: (sessionId: string) => Promise<unknown>,
  runPort: SessionRunPort,
  sidebarAttachments: ReturnType<typeof useManagedAttachmentDrafts>,
  projects: readonly OperatorProject[],
  catalog: AgentTeamCatalogBundle,
  sidebarDraftStore: SidebarConversationDraftStore,
  commitSidebarDrafts: (drafts: SidebarConversationDraft[]) => void,
  tabs: ReturnType<typeof useRightSidebarTabs>,
  presentationRouteRef: MutableRefObject<ConsolePresentationRoute | null>,
  commitRoute: (route: ConsolePresentationRoute) => void,
  draftTransport: SidebarDraftPreferenceTransport | undefined,
  draftPort: SidebarDraftPort,
  t: (key: TranslationKey) => string,
  sidebarViews: Parameters<typeof useSidebarMessageActions>[8],
  setSidebarViews: Parameters<typeof useSidebarMessageActions>[9],
  sidebarPort: SidebarMessagePort,
  setError: (error: string | null) => void,
) {
  const [subSessionComposerValues, setSubSessionComposerValues] = useState<Record<string, string>>({});
  const [sidebarSendingId, setSidebarSendingId] = useState<string | null>(null);
  const [sidebarComposerValues, setSidebarComposerValues] = useState<Record<string, string>>({});
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
  const sidebarDrafts = useSidebarDraftActions(
    apiBase, sidebarSendingId, setSidebarSendingId, projects, catalog,
    planReadyAttachmentIds(sidebarAttachments.attachments),
    planHasBlockingAttachments(sidebarAttachments.attachments), sidebarAttachments.clearDraft,
    sidebarDraftStore, commitSidebarDrafts, setSidebarComposerValues, tabs.store,
    tabs.commitCurrent, presentationRouteRef, selectionRef, commitRoute, refresh,
    draftTransport, draftPort, setError, t,
  );
  return useMemo(
    () => ({
      runs,
      sidebarMessages,
      sidebarDrafts,
      subSessionComposerValues,
      sidebarComposerValues,
    }),
    [runs, sidebarComposerValues, sidebarDrafts, sidebarMessages, subSessionComposerValues],
  );
}
