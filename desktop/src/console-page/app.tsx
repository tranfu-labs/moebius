import "@moebius/console-ui/globals.css";

import {
  useI18n,
  resolveNewConversationAgentTeamKey,
  hasBlockingComposerAttachment,
  readyComposerAttachmentIds,
  processInvocationKey,
  openRightSidebarSourceTab,
} from "@moebius/console-ui";
import { useCallback, useMemo, useReducer, useRef, useState } from "react";
import { loadExecutionProfileRegistry } from "./console-api-client.js";
import { browserConsoleCommandPort } from "./console-command-client.js";
import { planGeneralAssistantTeamKey } from "./agent-team-console-model.js";
import { fetchFromBrowser as fetch } from "./browser-fetch.js";
import { managedAttachmentClient } from "./attachment-client.js";
import { createConversationDraftStore } from "./draft-store.js";
import {
  readSidebarVisibilityPreference,
  planSidebarVisibilityPreference,
  writeSidebarVisibilityPreference,
  type SidebarVisibilityPreference,
} from "./sidebar-preference.js";
import { reduceNewConversationDraft } from "./new-conversation.js";
import { createRightSidebarTabsStore } from "./right-sidebar-tabs-store.js";
import {
  createSidebarConversationDraftStore,
  type SidebarConversationDraft,
} from "./sidebar-conversation-drafts.js";
import { createConversationReadingPositionStore } from "./conversation-reading-position.js";
import { useAgentTeamConsole } from "./use-agent-team-console.js";
import { useGithubTeamConsole } from "./use-github-team-console.js";
import { browserConversationSearchPort } from "./conversation-search-browser-client.js";
import { useConsoleStateSync } from "./use-console-state-sync.js";
import { browserConsoleStateSyncPort } from "./console-state-sync-browser-port.js";
import { useConsoleAttachmentDrafts } from "./use-console-attachment-drafts.js";
import { browserConversationViewSyncPort } from "./conversation-view-browser-port.js";
import { browserProcessDataSyncPort } from "./process-data-browser-port.js";
import { useRightSidebarConsole } from "./use-right-sidebar-console.js";
import { browserProjectFilePort } from "./project-file-browser-port.js";
import { browserConversationAnalysisReferencePort } from "./conversation-analysis-browser-port.js";
import { useConversationConsole } from "./use-conversation-console.js";
import { browserProjectMutationPort } from "./project-mutation-browser-port.js";
import { useProjectMutations } from "./use-project-mutations.js";
import { browserSessionRunPort } from "./session-run-browser-port.js";
import { browserSidebarMessagePort } from "./sidebar-message-browser-port.js";
import { useSessionConsole } from "./use-session-console.js";
import { browserSidebarDraftPort } from "./sidebar-draft-browser-port.js";
import { browserSearchedSessionPort } from "./searched-session-browser-port.js";
import { OperatorConsoleView } from "./operator-console-view.js";
import { mountConsoleApp } from "./mount-console-app.js";
import { useDesktopConsoleShell } from "./use-desktop-console-shell.js";
import { useConsoleLocalState } from "./use-console-local-state.js";
import { useConsoleStateActions } from "./use-console-state-actions.js";
import { useConsoleNavigationScene } from "./use-console-navigation-scene.js";
import { useConsolePresentation } from "./use-console-presentation.js";
import { useSidebarDraftClose } from "./use-sidebar-draft-close.js";
import { useManagedProcesses } from "./use-managed-processes.js";
import { useTeamTraceabilityComposition } from "./use-team-traceability-composition.js";
import { hasProviderSettingsPort } from "./provider-settings-port.js";
import { useProviderSettings } from "./use-provider-settings.js";
import { buildProviderSettingsMessages } from "./provider-settings-messages.js";
import { browserManagedProcessPort } from "./managed-process-client.js";
import { useTaskReminderController } from "./use-task-reminder.js";
import {
  DesktopApplicationRoot,
  useDesktopLanguage,
} from "./desktop-application-root.js";

export function App(): JSX.Element {
  return <DesktopApplicationRoot operatorConsole={OperatorConsoleApp} />;
}


export function OperatorConsoleApp({
  pendingAgentTeamKey: initialPendingAgentTeamKey = null,
  onReplayOnboarding,
}: {
  pendingAgentTeamKey?: string | null;
  onReplayOnboarding?: () => void;
}): JSX.Element {
  const language = useDesktopLanguage();
  const { t } = useI18n();
  const providerSettings = useProviderSettings(
    hasProviderSettingsPort(window.moebius) ? window.moebius : undefined, buildProviderSettingsMessages(t),
  );
  const desktopShellBundle = useDesktopConsoleShell(
    window.moebius, window.MOEBIUS_LOCAL_CONSOLE_URL, window.location.search,
    loadExecutionProfileRegistry, window.fetch, browserConversationSearchPort, t,
  );
  const runtimeBridgeBundle = desktopShellBundle.runtime;
  const apiBase = runtimeBridgeBundle.apiBase;
  const attachmentCapability = runtimeBridgeBundle.attachmentCapability;
  const clientError = runtimeBridgeBundle.clientError;
  const clientErrors = runtimeBridgeBundle.clientErrors;
  const [sessionAnalysisNotice, setSessionAnalysisNotice] = useState<string | null>(null);
  const conversationDraftStoreRef = useRef(createConversationDraftStore(window.localStorage));
  const conversationReadingPositionStoreRef = useRef(
    createConversationReadingPositionStore(window.localStorage),
  );
  const [newConversation, dispatchNewConversation] = useReducer(reduceNewConversationDraft, null);
  const localStateBundle = useConsoleLocalState(
    window.localStorage, conversationDraftStoreRef.current,
    conversationReadingPositionStoreRef.current, dispatchNewConversation,
  );
  const selectionStateBundle = localStateBundle.selection;
  const composerBundle = localStateBundle.composer;
  const selection = selectionStateBundle.selection;
  const selectionRef = selectionStateBundle.selectionRef;
  const selectionPersistenceEnabledRef = selectionStateBundle.selectionPersistenceEnabledRef;
  const state = selectionStateBundle.state;
  const stateRef = selectionStateBundle.stateRef;
  const presentationRoute = selectionStateBundle.presentationRoute;
  const presentationRouteRef = selectionStateBundle.presentationRouteRef;
  const coordinator = selectionStateBundle.coordinator;
  const commitSelection = selectionStateBundle.commitSelection;
  const commitPresentationRoute = selectionStateBundle.commitPresentationRoute;
  const forgetPersistedSelection = selectionStateBundle.forgetPersistedSelection;
  const rememberConfirmedSelection = selectionStateBundle.rememberConfirmedSelection;
  const commitConsoleState = selectionStateBundle.commitConsoleState;
  const rightSidebarTabsStore = useMemo(
    () => createRightSidebarTabsStore(window.localStorage),
    [],
  );
  const sidebarConversationDraftStoreRef = useRef(
    createSidebarConversationDraftStore(window.localStorage),
  );
  const [sidebarConversationDrafts, setSidebarConversationDrafts] = useState<SidebarConversationDraft[]>(() =>
    sidebarConversationDraftStoreRef.current.list(),
  );
  const [updatingConversationTitleSessionIds, setUpdatingConversationTitleSessionIds] =
    useState<Set<string>>(() => new Set());
  const composerDraft = composerBundle.draft;
  const composerDraftRef = composerBundle.draftRef;
  const commitComposerDraft = composerBundle.commit;
  const activateComposerDraft = composerBundle.activate;
  const clearComposerDraft = composerBundle.clear;
  const agentTeamControllersBundle = useAgentTeamConsole(window.moebius, window.localStorage, createAgentTeamBuilderDraftId, t, language.activeLocale);
  const agentTeamCatalogBundle = agentTeamControllersBundle.catalog;
  const githubTeamBundle = useGithubTeamConsole(window.moebius, language.activeLocale, { onOpenExternalLink: runtimeBridgeBundle.openExternalLink, onOpenTeam: agentTeamControllersBundle.navigation.open, refreshTeams: agentTeamCatalogBundle.refresh });
  const [pendingAgentTeamKey, setPendingAgentTeamKey] = useState<string | null>(initialPendingAgentTeamKey);
  const [sidebarVisibilityPreference, setSidebarVisibilityPreference] = useState<SidebarVisibilityPreference>(() =>
    readSidebarVisibilityPreference(window.localStorage),
  );
  const resultAcknowledgementsRef = useRef(new Set<string>());
  const rightSidebarBundle = useRightSidebarConsole(
    window.localStorage, rightSidebarTabsStore, apiBase,
    presentationRoute?.hostSessionId ?? selection.sessionId,
    selection.sessionId, state?.selectedSession ?? null, selection.projectId,
    planGeneralAssistantTeamKey(agentTeamCatalogBundle.state), sidebarConversationDraftStoreRef.current,
    setSidebarConversationDrafts, browserConversationViewSyncPort, browserProcessDataSyncPort,
    browserProjectFilePort, processInvocationKey, clientErrors,
  );
  const rightSidebarTabsBundle = rightSidebarBundle.tabs;
  const rightSidebarTabs = rightSidebarTabsBundle.state;
  const activeSubSessionId = rightSidebarBundle.active.subSessionId;
  const activeConversationLocator = rightSidebarBundle.active.conversation;
  const activeSidebarConversationSessionId = activeConversationLocator?.kind === "session"
    ? activeConversationLocator.sessionId
    : null;
  const activeSidebarConversationDraftId = activeConversationLocator?.kind === "draft"
    ? activeConversationLocator.draftId
    : null;
  const activeSidebarConversationDraft = activeSidebarConversationDraftId === null
    ? null
    : sidebarConversationDrafts.find((draft) => draft.draftId === activeSidebarConversationDraftId) ?? null;
  const navigationSceneBundle = useConsoleNavigationScene({
    selectionRef,
    presentationRouteRef,
    rightSidebarTabs,
    rightSidebarTabsBundle,
    rightSidebarTabsStore,
    composerDraftRef,
    readingPositionStoreRef: conversationReadingPositionStoreRef,
    commitSelection,
    commitPresentationRoute,
    commitComposerDraft,
  });
  const conversationViewsBundle = rightSidebarBundle.conversationViews;
  const subSessionViews = conversationViewsBundle.subSessionViews;
  const attachmentDraftsBundle = useConsoleAttachmentDrafts(
    managedAttachmentClient, apiBase, attachmentCapability, newConversation?.isOpen === true,
    composerDraft.key, activeSubSessionId, activeSidebarConversationSessionId,
    activeSidebarConversationDraft?.attachmentDraftKey ?? null,
    sidebarConversationDraftStoreRef.current, setSidebarConversationDrafts, clientErrors, t,
  );
  const managedAttachments = attachmentDraftsBundle.main;
  const managedSubSessionAttachments = attachmentDraftsBundle.subSession;
  const managedSidebarConversationAttachments = attachmentDraftsBundle.sidebar;
  const sidebarDraftCloseBundle = useSidebarDraftClose(
    sidebarConversationDraftStoreRef.current,
    setSidebarConversationDrafts,
    managedSidebarConversationAttachments,
    window.confirm,
    t,
  );

  const setRightSidebarOpen = rightSidebarTabsBundle.setOpen;
  const stateSyncBundle = useConsoleStateSync(
    apiBase, state, coordinator, selectionRef, commitConsoleState, commitSelection,
    clientErrors, newConversation?.isOpen === true, selection.sessionId, activateComposerDraft,
    resultAcknowledgementsRef, browserConsoleStateSyncPort,
    () => { void window.moebius?.refreshTaskReminderDock?.(); },
  );
  const refresh = stateSyncBundle.refresh;

  const presentationBundle = useConsolePresentation(
    state, clientError, activeSubSessionId, subSessionViews, rightSidebarTabs,
    updatingConversationTitleSessionIds, managedAttachmentClient, apiBase,
    attachmentCapability, t,
  );
  const teamTraceability = useTeamTraceabilityComposition({
    apiBase, sessionId: presentationBundle.selectedSession?.sessionId ?? null,
    sessionRevision: presentationBundle.selectedSession?.updatedAt ?? null,
  });
  const projects = presentationBundle.projects;
  const stateActionsBundle = useConsoleStateActions(
    apiBase, browserConsoleCommandPort, coordinator, t, selectionRef, commitSelection,
    presentationRouteRef, commitPresentationRoute, refresh, composerDraft.value,
    clearComposerDraft, managedAttachments,
    conversationDraftStoreRef.current, stateRef, selectionStateBundle.replaceState,
    clientErrors, window.moebius, navigationSceneBundle.captureNavigationScene,
    navigationSceneBundle.restoreNavigationScene,
  );
  const actions = stateActionsBundle.actions;

  const conversationControllersBundle = useConversationConsole(
    composerDraft, composerDraftRef, commitComposerDraft,
    selection, projects, actions, desktopShellBundle.conversationSearch, clientErrors, t, coordinator,
    selectionRef, selectionPersistenceEnabledRef, dispatchNewConversation, commitPresentationRoute,
    activateComposerDraft, rightSidebarTabsBundle, openRightSidebarSourceTab, newConversation,
    agentTeamCatalogBundle, pendingAgentTeamKey, setPendingAgentTeamKey,
    resolveNewConversationAgentTeamKey, managedAttachments,
    readyComposerAttachmentIds(managedAttachments.attachments),
    hasBlockingComposerAttachment(managedAttachments.attachments), rememberConfirmedSelection,
    conversationDraftStoreRef.current, window.moebius, language.activeLocale,
    (sessionId, messageId) => conversationReadingPositionStoreRef.current.write(sessionId, messageId),
    apiBase, stateRef, presentationRouteRef, presentationRoute, sidebarConversationDraftStoreRef.current,
    setSidebarConversationDrafts, commitConsoleState, commitSelection, refresh,
    browserConversationAnalysisReferencePort, browserSearchedSessionPort, fetch, setSessionAnalysisNotice,
    setUpdatingConversationTitleSessionIds, window.moebius?.copySessionLogPath,
  );
  const startNewConversation = conversationControllersBundle.launcher.startNewConversation;

  const projectMutationsBundle = useProjectMutations(
    apiBase, projects, presentationRoute, selectionRef, selectionPersistenceEnabledRef,
    forgetPersistedSelection, refresh, commitPresentationRoute, setRightSidebarOpen,
    rightSidebarTabsBundle.store, rightSidebarTabsBundle.showHost, startNewConversation,
    window.moebius, browserProjectMutationPort, clientErrors,
  );

  const sessionControllersBundle = useSessionConsole(
    apiBase, managedSubSessionAttachments, conversationDraftStoreRef.current,
    selectionRef, refresh, rightSidebarBundle, browserSessionRunPort,
    managedSidebarConversationAttachments, projects, agentTeamCatalogBundle,
    sidebarConversationDraftStoreRef.current, setSidebarConversationDrafts,
    presentationRouteRef, commitPresentationRoute, window.moebius,
    browserSidebarDraftPort, t, browserSidebarMessagePort, clientErrors,
  );
  const managedProcesses = useManagedProcesses({
    apiBase,
    sessionId: selection.sessionId,
    port: browserManagedProcessPort,
    openExternalLink: (url) => { void runtimeBridgeBundle.openExternalLink?.(url); },
  });

  const setSidebarOpen = useCallback((open: boolean) => {
    const preference = planSidebarVisibilityPreference(open);
    setSidebarVisibilityPreference(preference);
    writeSidebarVisibilityPreference(window.localStorage, preference);
  }, []);

  return (
    <OperatorConsoleView
      language={language}
      desktopShell={desktopShellBundle}
      localState={localStateBundle}
      stateSync={stateSyncBundle}
      stateActions={stateActionsBundle}
      presentation={presentationBundle}
      attachments={attachmentDraftsBundle}
      conversations={conversationControllersBundle}
      projectMutations={projectMutationsBundle}
      sessions={sessionControllersBundle}
      rightSidebar={rightSidebarBundle}
      sidebarDraftClose={sidebarDraftCloseBundle}
      agentTeams={agentTeamControllersBundle}
      githubTeams={githubTeamBundle}
      managedProcesses={managedProcesses}
      providerSettings={providerSettings}
      taskReminder={useTaskReminderController(window.moebius)}
      actions={actions}
      newConversation={newConversation}
      sessionAnalysisNotice={sessionAnalysisNotice}
      sessionTeamUpdate={teamTraceability.sessionTeamUpdate}
      loadRunAgentInfo={teamTraceability.loadHistoricalRunAgentInfo}
      loadRunAgentMarkdown={teamTraceability.loadHistoricalRunAgentMarkdown}
      sidebarConversationDrafts={sidebarConversationDrafts}
      sidebarOpen={sidebarVisibilityPreference === "open"}
      setSidebarOpen={setSidebarOpen}
      conversationDraftStore={conversationDraftStoreRef.current}
      readingPositionStore={conversationReadingPositionStoreRef.current}
      onReplayOnboarding={onReplayOnboarding}
      t={t}
    />
  );
}

function createAgentTeamBuilderDraftId(): string {
  const suffix = typeof globalThis.crypto?.randomUUID === "function" ? globalThis.crypto.randomUUID() : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  return `agent-teams-${suffix}`;
}

mountConsoleApp(<App />);
