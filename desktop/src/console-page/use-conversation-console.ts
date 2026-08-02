import { useMemo, type Dispatch, type MutableRefObject, type SetStateAction } from "react";
import {
  type OperatorAgentTeam,
  type OperatorProject,
  type RightSidebarSourceTab,
  type RightSidebarTabsState,
  type TranslationKey,
} from "@moebius/console-ui";

import type { LocalConsoleState } from "./console-state-contract.js";
import type { ConsoleStateActions } from "./console-state-actions.js";
import type { ConversationAnalysisReferencePort } from "./conversation-analysis-contract.js";
import type { SearchedSessionPort } from "./searched-session-contract.js";
import type { ConsoleSelection, ConsoleStateCoordinator } from "./console-state-coordinator.js";
import type { ConversationComposerDraftState } from "./conversation-draft-model.js";
import type { NewConversationDraftEvent } from "./new-conversation.js";
import type { ConsolePresentationRoute } from "./presentation-route.js";
import type {
  SidebarConversationDraft,
  SidebarConversationDraftStore,
} from "./sidebar-conversation-drafts.js";
import { useAnalysisPanelNavigation } from "./use-analysis-panel-navigation.js";
import type { AgentTeamCatalogBundle } from "./use-agent-team-catalog.js";
import { useConversationAnalysis } from "./use-conversation-analysis.js";
import type { useConversationSearch } from "./use-conversation-search.js";
import { useConversationNavigation } from "./use-conversation-navigation.js";
import { useConversationTransition } from "./use-conversation-transition.js";
import { useEditResend } from "./use-edit-resend.js";
import type { useManagedAttachmentDrafts } from "./use-managed-attachments.js";
import { useNewConversationSubmission } from "./use-new-conversation-submission.js";
import { useNewConversationLauncher } from "./use-new-conversation-launcher.js";
import { useSearchedSessionNavigation } from "./use-searched-session-navigation.js";
import { useSidebarSourceMigration } from "./use-sidebar-source-migration.js";
import { useSessionMutationIntents } from "./use-session-mutation-intents.js";
import type { RightSidebarTabsBundle } from "./use-right-sidebar-tabs.js";
import type { ConsoleErrorController } from "./use-console-error-state.js";

type FetchLike = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;
export function useConversationConsole(
  composerDraft: Pick<ConversationComposerDraftState, "key">,
  composerDraftRef: MutableRefObject<ConversationComposerDraftState>,
  commitComposerDraft: (draft: ConversationComposerDraftState) => void,
  selection: ConsoleSelection,
  projects: readonly OperatorProject[],
  actions: ConsoleStateActions,
  search: ReturnType<typeof useConversationSearch>,
  errors: ConsoleErrorController,
  t: (key: TranslationKey, values?: Record<string, string | number>) => string,
  coordinator: ConsoleStateCoordinator,
  selectionRef: MutableRefObject<ConsoleSelection>,
  selectionPersistenceEnabledRef: MutableRefObject<boolean>,
  dispatchNewConversation: Dispatch<NewConversationDraftEvent>,
  commitRoute: (route: ConsolePresentationRoute) => void,
  activateComposer: (sessionId: string) => void,
  tabs: RightSidebarTabsBundle,
  openTab: (state: RightSidebarTabsState, source: RightSidebarSourceTab) => RightSidebarTabsState,
  newConversation: Parameters<typeof useNewConversationSubmission>[0],
  agentTeams: AgentTeamCatalogBundle,
  pendingTeamKey: string | null,
  setPendingTeamKey: (teamKey: string | null) => void,
  resolveTeamKey: (
    teams: readonly OperatorAgentTeam[],
    lastUsedTeamKey: string | null,
    pendingTeamKey?: string | null,
  ) => string | null,
  managedAttachments: ReturnType<typeof useManagedAttachmentDrafts>,
  readyAttachmentIds: readonly string[],
  attachmentsBlocked: boolean,
  rememberSelection: (selection: ConsoleSelection) => void,
  conversationDraftStore: Parameters<typeof useNewConversationSubmission>[10],
  desktopApi: Parameters<typeof useNewConversationSubmission>[12],
  locale: string,
  writeReadingPosition: (sessionId: string, messageId: number) => void,
  apiBase: string | null,
  stateRef: MutableRefObject<LocalConsoleState | null>,
  presentationRouteRef: MutableRefObject<ConsolePresentationRoute | null>,
  presentationRoute: ConsolePresentationRoute | null,
  sidebarDraftStore: SidebarConversationDraftStore,
  commitSidebarDrafts: (drafts: SidebarConversationDraft[]) => void,
  commitState: (state: LocalConsoleState) => void,
  commitSelection: (selection: ConsoleSelection) => void,
  refresh: (selection: ConsoleSelection) => Promise<boolean>,
  referencePort: ConversationAnalysisReferencePort,
  searchedSessionPort: SearchedSessionPort,
  fetch: FetchLike,
  setNotice: (notice: string | null) => void,
  setUpdatingTitleIds: Dispatch<SetStateAction<Set<string>>>,
  copySessionLogPath: Parameters<typeof useSessionMutationIntents>[7],
) {
  const transition = useConversationTransition(
    composerDraft.key, selection.sessionId, actions, errors, t,
  );
  const editResend = useEditResend(
    stateRef, managedAttachments.replaceWithMessageAttachments, conversationDraftStore,
    composerDraftRef, commitComposerDraft, errors, t,
  );
  const navigation = useConversationNavigation(
    projects, coordinator, selectionRef, selectionPersistenceEnabledRef, dispatchNewConversation,
    commitRoute, activateComposer, actions, tabs.store, openTab, tabs.commitCurrent, tabs.setOpen,
    transition,
  );
  const submission = useNewConversationSubmission(
    newConversation, dispatchNewConversation, agentTeams, managedAttachments,
    readyAttachmentIds, attachmentsBlocked, actions,
    selectionPersistenceEnabledRef, rememberSelection, commitRoute, conversationDraftStore,
    activateComposer, desktopApi, errors, t,
  );
  const launcher = useNewConversationLauncher(
    projects, newConversation, dispatchNewConversation, agentTeams, pendingTeamKey,
    setPendingTeamKey, conversationDraftStore, resolveTeamKey,
    actions.addProject,
  );
  const sessions = useMemo(() => projects.flatMap((project) => project.sessions), [projects]);
  const analysisNavigation = useAnalysisPanelNavigation(
    sessions, locale, selectionRef, actions, commitRoute, tabs, openTab,
    writeReadingPosition, errors, t,
  );
  const analysis = useConversationAnalysis(
    apiBase, stateRef, presentationRouteRef, coordinator, agentTeams, sidebarDraftStore,
    commitSidebarDrafts, tabs, selectionRef, selectionPersistenceEnabledRef,
    dispatchNewConversation, commitState, commitSelection, rememberSelection, commitRoute,
    activateComposer, openTab, referencePort, fetch, errors, setNotice, t,
  );
  const searchedSession = useSearchedSessionNavigation(
    apiBase, stateRef, commitRoute, tabs.store, openTab, tabs.commitCurrent,
    tabs.setOpen, actions.selectSession, searchedSessionPort, errors,
  );
  const sessionMutations = useSessionMutationIntents(
    actions, search, tabs, presentationRouteRef, selectionRef, commitRoute,
    setUpdatingTitleIds, copySessionLogPath,
  );
  useSidebarSourceMigration(
    projects, presentationRoute, refresh, commitRoute, tabs.setOpen, tabs.showHost,
  );
  return useMemo(() => ({
    transition,
    editResend,
    navigation,
    submission,
    launcher,
    analysisNavigation,
    analysis,
    searchedSession,
    sessionMutations,
  }), [analysis, analysisNavigation, editResend, launcher, navigation, searchedSession, sessionMutations, submission, transition]);
}
