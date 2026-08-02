import { useEffect, useMemo } from "react";

import { subSessionIdFromSourceKey } from "./console-process-model.js";
import type { ConversationViewSyncPort } from "./conversation-view-sync-contract.js";
import type { ProcessDataSyncPort } from "./process-data-sync-contract.js";
import type { ProjectFilePort } from "./project-file-contract.js";
import { planRightSidebarActiveSources } from "./right-sidebar-tabs-model.js";
import type { RightSidebarTabsStore } from "./right-sidebar-tabs-store.js";
import type {
  SidebarConversationDraft,
  SidebarConversationDraftStore,
} from "./sidebar-conversation-drafts.js";
import { useRightSidebarConversationViews } from "./use-right-sidebar-conversation-views.js";
import { useRightSidebarProcessData } from "./use-right-sidebar-process-data.js";
import { useRightSidebarTabs } from "./use-right-sidebar-tabs.js";
import { useProjectFileReader } from "./use-project-file-reader.js";
import type { ConsoleErrorController } from "./use-console-error-state.js";

interface SelectedSidebarSession {
  sessionId: string;
  projectId: string;
  workspaceMode: "direct" | "worktree";
}

export function useRightSidebarConsole(
  storage: Storage,
  tabsStore: RightSidebarTabsStore,
  apiBase: string | null,
  hostSessionId: string,
  selectedSessionId: string,
  selectedSession: SelectedSidebarSession | null,
  selectedProjectId: string,
  generalAssistantTeamKey: string | null,
  draftStore: SidebarConversationDraftStore,
  commitDrafts: (drafts: SidebarConversationDraft[]) => void,
  conversationPort: ConversationViewSyncPort,
  processPort: ProcessDataSyncPort,
  projectFilePort: ProjectFilePort,
  invocationKey: (sessionId: string, runId: string) => string,
  errors: ConsoleErrorController,
) {
  const tabs = useRightSidebarTabs(
    storage, tabsStore, hostSessionId, selectedSession, selectedProjectId, generalAssistantTeamKey,
    draftStore, commitDrafts,
  );
  const active = planRightSidebarActiveSources(tabs.state, subSessionIdFromSourceKey);
  const conversationViews = useRightSidebarConversationViews(
    apiBase,
    active.subSessionId,
    active.conversation?.kind === "session" ? active.conversation.sessionId : null,
    conversationPort,
  );
  const processData = useRightSidebarProcessData(
    apiBase, active.processSourceKey, selectedSessionId, hostSessionId,
    processPort, invocationKey, errors,
  );
  const files = useProjectFileReader(apiBase, projectFilePort);
  useEffect(() => {
    conversationViews.clearSubSessionViews();
  }, [conversationViews.clearSubSessionViews, hostSessionId]);
  return useMemo(() => ({
    tabs,
    active,
    conversationViews,
    processData,
    files,
  }), [active, conversationViews, files, processData, tabs]);
}
