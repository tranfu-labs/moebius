import "@moebius/console-ui/globals.css";

import {
  useI18n,
  OperatorConsole,
  resolveNewConversationAgentTeamKey,
  hasBlockingComposerAttachment,
  readyComposerAttachmentIds,
  processInvocationKey,
  openRightSidebarSourceTab,
  createRunOutputSourceKey,
} from "@moebius/console-ui";
import { useCallback, useMemo, useReducer, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  loadExecutionProfileRegistry,
} from "./console-api-client.js";
import { ConsoleStateActions } from "./console-state-actions.js";
import { browserConsoleCommandPort } from "./console-command-client.js";
import {
  planAgentTeamFileManagerTranslationKey,
  planGeneralAssistantTeamKey,
} from "./agent-team-console-model.js";
import { fetchFromBrowser as fetch } from "./browser-fetch.js";
import { managedAttachmentClient } from "./attachment-client.js";
import {
  activateConversationComposerDraft,
  clearConversationComposerDraft,
  editConversationComposerDraft,
  type ConversationComposerDraftState,
  NEW_CONVERSATION_DRAFT_KEY,
  sessionDraftKey,
} from "./conversation-draft-model.js";
import { createConversationDraftStore } from "./draft-store.js";
import {
  readSidebarVisibilityPreference,
  writeSidebarVisibilityPreference,
  type SidebarVisibilityPreference,
} from "./sidebar-preference.js";
import { reduceNewConversationDraft } from "./new-conversation.js";
import {
  createRightSidebarTabsStore,
  parseConversationTabSourceKey,
} from "./right-sidebar-tabs-store.js";
import {
  createSidebarConversationDraftStore,
  sidebarConversationDraftRequiresDiscardConfirmation,
  type SidebarConversationDraftAttachmentPresence,
  type SidebarConversationDraft,
} from "./sidebar-conversation-drafts.js";
import { sidebarPresentationRoute } from "./presentation-route.js";
import { createConversationReadingPositionStore } from "./conversation-reading-position.js";
import {
  discardAgentTeamMemberDraft,
  discardAllAgentTeamDrafts,
  updateAgentTeamMemberDraft,
} from "./team-state.js";
export type { DesktopApi } from "./desktop-api-contract.js";
import { useDesktopSettingsBundle } from "./use-desktop-settings.js";
import { useActiveCliInstallationsBundle } from "./use-active-cli-installations.js";
import { useAgentTeamConsole } from "./use-agent-team-console.js";
import { browserConversationSearchPort } from "./conversation-search-browser-client.js";
import { ConversationSearchOverlay } from "./conversation-search-overlay.js";
import { useConversationSearch } from "./use-conversation-search.js";
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
import { SidebarConversationView } from "./sidebar-conversation-view.js";
import { useDesktopRuntimeBridge } from "./use-desktop-runtime-bridge.js";
import { useConsoleSelectionState } from "./use-console-selection-state.js";
import { useConsoleStateActions } from "./use-console-state-actions.js";
import { useConsolePresentation } from "./use-console-presentation.js";
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
  const runtimeBridgeBundle = useDesktopRuntimeBridge(
    window.moebius, window.MOEBIUS_LOCAL_CONSOLE_URL, window.location.search,
    loadExecutionProfileRegistry, window.fetch,
  );
  const apiBase = runtimeBridgeBundle.apiBase;
  const conversationSearchBundle = useConversationSearch(
    { apiBase, port: browserConversationSearchPort },
  );
  const executionRegistryState = runtimeBridgeBundle.executionRegistryState;
  const attachmentCapability = runtimeBridgeBundle.attachmentCapability;
  const [sessionAnalysisNotice, setSessionAnalysisNotice] = useState<string | null>(null);
  const conversationDraftStoreRef = useRef(createConversationDraftStore(window.localStorage));
  const conversationReadingPositionStoreRef = useRef(
    createConversationReadingPositionStore(window.localStorage),
  );
  const [newConversation, dispatchNewConversation] = useReducer(reduceNewConversationDraft, null);
  const selectionStateBundle = useConsoleSelectionState(
    window.localStorage, conversationDraftStoreRef.current,
    conversationReadingPositionStoreRef.current, dispatchNewConversation,
  );
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
  const [composerDraft, setComposerDraft] = useState<ConversationComposerDraftState>(() => {
    const key = sessionDraftKey(selection.sessionId);
    return { key, value: conversationDraftStoreRef.current.read(key) };
  });
  const composerDraftRef = useRef(composerDraft);
  const commitComposerDraft = useCallback((next: ConversationComposerDraftState) => {
    composerDraftRef.current = next;
    setComposerDraft(next);
  }, []);
  const activateComposerDraft = useCallback((sessionId: string) => {
    const key = sessionDraftKey(sessionId);
    commitComposerDraft(activateConversationComposerDraft(
      composerDraftRef.current,
      key,
      conversationDraftStoreRef.current.read(key),
    ));
  }, [commitComposerDraft]);
  const clearComposerDraft = useCallback((sessionId: string) => {
    const key = sessionDraftKey(sessionId);
    conversationDraftStoreRef.current.clear(key);
    commitComposerDraft(clearConversationComposerDraft(composerDraftRef.current, key));
  }, [commitComposerDraft]);
  const [clientError, setClientError] = useState<string | null>(null);
  const settingsBundle = useDesktopSettingsBundle(window.moebius);
  const agentTeamControllersBundle = useAgentTeamConsole(
    window.moebius, window.localStorage, createAgentTeamBuilderDraftId, t,
  );
  const agentTeamCatalogBundle = agentTeamControllersBundle.catalog;
  const agentTeamMemberBundle = agentTeamControllersBundle.member;
  const agentTeamNavigationBundle = agentTeamControllersBundle.navigation;
  const agentTeamProfileBundle = agentTeamControllersBundle.profile;
  const agentTeamRegistrationBundle = agentTeamControllersBundle.registration;
  const agentTeamCopyBundle = agentTeamControllersBundle.copy;
  const agentTeamMemberMutationBundle = agentTeamControllersBundle.memberMutations;
  const agentTeamRecordMutationBundle = agentTeamControllersBundle.recordMutations;
  const agentTeamBuilderBundle = agentTeamControllersBundle.builder;
  const cliInstallationsBundle = useActiveCliInstallationsBundle(window.moebius);
  const [pendingAgentTeamKey, setPendingAgentTeamKey] = useState<string | null>(
    initialPendingAgentTeamKey,
  );
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
    browserProjectFilePort, processInvocationKey, setClientError,
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
  const conversationViewsBundle = rightSidebarBundle.conversationViews;
  const subSessionViews = conversationViewsBundle.subSessionViews;
  const processDataBundle = rightSidebarBundle.processData;
  const processOutputs = processDataBundle.outputs;
  const processInvocationStates = processDataBundle.invocations;
  const readProcessDebugInvocation = processDataBundle.readInvocation;
  const loadPreviousProcessOutput = processDataBundle.loadPrevious;
  const readWorkspaceDiff = rightSidebarBundle.files.readWorkspaceDiff;
  const readProjectFiles = rightSidebarBundle.files.readProjectFiles;
  const readProjectFile = rightSidebarBundle.files.readProjectFile;
  const readFileReference = rightSidebarBundle.files.readFileReference;
  const currentAttachmentDraftKey = newConversation?.isOpen !== true
    ? composerDraft.key
    : NEW_CONVERSATION_DRAFT_KEY;
  const activeSubSessionDraftKey = sessionDraftKey(activeSubSessionId ?? "__inactive-sub-session__");
  const activeSidebarConversationAttachmentDraftKey = activeSidebarConversationDraft?.attachmentDraftKey
    ?? (activeSidebarConversationSessionId === null
      ? "draft:sidebar:__inactive__"
      : sessionDraftKey(activeSidebarConversationSessionId));
  const reportAttachmentError = useCallback((error: string) => setClientError(error), []);
  const recordSidebarDraftAttachmentPresence = useCallback((
    draftKey: string,
    presence: SidebarConversationDraftAttachmentPresence,
  ) => {
    if (!sidebarConversationDraftStoreRef.current.setManagedAttachmentPresence(draftKey, presence)) {
      return;
    }
    setSidebarConversationDrafts(sidebarConversationDraftStoreRef.current.list());
  }, []);
  const attachmentDraftsBundle = useConsoleAttachmentDrafts(
    managedAttachmentClient, apiBase, attachmentCapability, currentAttachmentDraftKey,
    activeSubSessionDraftKey, activeSidebarConversationAttachmentDraftKey,
    reportAttachmentError, recordSidebarDraftAttachmentPresence,
  );
  const managedAttachments = attachmentDraftsBundle.main;
  const managedSubSessionAttachments = attachmentDraftsBundle.subSession;
  const managedSidebarConversationAttachments = attachmentDraftsBundle.sidebar;

  const setRightSidebarOpen = rightSidebarTabsBundle.setOpen;
  const stateSyncBundle = useConsoleStateSync(
    apiBase, state, coordinator, selectionRef, commitConsoleState, commitSelection,
    setClientError, newConversation?.isOpen === true, selection.sessionId, activateComposerDraft,
    resultAcknowledgementsRef, browserConsoleStateSyncPort,
  );
  const refresh = stateSyncBundle.refresh;

  const presentationBundle = useConsolePresentation(
    state, clientError, activeSubSessionId, subSessionViews, rightSidebarTabs,
    updatingConversationTitleSessionIds, managedAttachmentClient, apiBase,
    attachmentCapability, t,
  );
  const project = presentationBundle.project;
  const projects = presentationBundle.projects;
  const selectedSession = presentationBundle.selectedSession;
  const stateActionsBundle = useConsoleStateActions(
    apiBase, browserConsoleCommandPort, coordinator, t, selectionRef, commitSelection,
    refresh, composerDraft.value, clearComposerDraft, managedAttachments,
    conversationDraftStoreRef.current, stateRef, selectionStateBundle.replaceState,
    setClientError, window.moebius,
  );
  const actions = stateActionsBundle.actions;

  const conversationControllersBundle = useConversationConsole(
    composerDraft, composerDraftRef, commitComposerDraft,
    selection, projects, actions, conversationSearchBundle, setClientError, t, coordinator,
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
  const conversationTransitionBundle = conversationControllersBundle.transition;
  const conversationNavigationBundle = conversationControllersBundle.navigation;
  const newConversationSubmissionBundle = conversationControllersBundle.submission;
  const analysisNavigationBundle = conversationControllersBundle.analysisNavigation;
  const analyzeConversation = conversationControllersBundle.analysis.analyze;
  const openSearchedSession = conversationControllersBundle.searchedSession.openSearchedSession;
  const startNewConversation = conversationControllersBundle.launcher.startNewConversation;
  const editAndResend = conversationControllersBundle.editResend.editAndResend;
  const sessionMutationIntents = conversationControllersBundle.sessionMutations;
  const lastError = conversationTransitionBundle.transitionError
    ?? clientError
    ?? runtimeBridgeBundle.statusError
    ?? state?.lastError
    ?? null;
  const analysisEntriesFor = analysisNavigationBundle.entriesFor;
  const analysisPanelOpenBySession = analysisNavigationBundle.openBySession;
  const setAnalysisPanelOpen = analysisNavigationBundle.setPanelOpen;
  const openAnalysisPanelEntry = analysisNavigationBundle.openEntry;
  const openConversationReference = analysisNavigationBundle.openReference;
  const conversationMessageNavigation = analysisNavigationBundle.messageNavigation;

  const projectMutationsBundle = useProjectMutations(
    apiBase, projects, presentationRoute, selectionRef, selectionPersistenceEnabledRef,
    forgetPersistedSelection, refresh, commitPresentationRoute, setRightSidebarOpen,
    rightSidebarTabsBundle.store, rightSidebarTabsBundle.showHost, startNewConversation,
    window.moebius, browserProjectMutationPort, setClientError,
  );
  const isProjectMutationPending = projectMutationsBundle.isPending;
  const showProjectInFolder = projectMutationsBundle.showProjectInFolder;
  const renameProject = projectMutationsBundle.renameProject;
  const removeProject = projectMutationsBundle.removeProject;
  const selectFolderForRepair = projectMutationsBundle.selectFolderForRepair;
  const repairProjectFolder = projectMutationsBundle.repairProjectFolder;

  const sessionControllersBundle = useSessionConsole(
    apiBase, managedSubSessionAttachments, conversationDraftStoreRef.current,
    selectionRef, refresh, rightSidebarBundle, browserSessionRunPort,
    managedSidebarConversationAttachments, projects, agentTeamCatalogBundle,
    sidebarConversationDraftStoreRef.current, setSidebarConversationDrafts,
    presentationRouteRef, commitPresentationRoute, window.moebius,
    browserSidebarDraftPort, t, browserSidebarMessagePort, setClientError,
  );
  const sessionRunActionsBundle = sessionControllersBundle.runs;
  const activeSubSessionComposerValue = activeSubSessionId === null
    ? ""
    : sessionControllersBundle.subSessionComposerValues[activeSubSessionId]
      ?? conversationDraftStoreRef.current.read(sessionDraftKey(activeSubSessionId));
  const interrupt = sessionRunActionsBundle.interrupt;
  const sendSubSessionMessage = sessionRunActionsBundle.sendSubSessionMessage;
  const retryRun = sessionRunActionsBundle.retryRun;
  const interruptSubSession = sessionRunActionsBundle.interruptSubSession;
  const sidebarMessageActionsBundle = sessionControllersBundle.sidebarMessages;
  const retryPendingMessage = sidebarMessageActionsBundle.retryPendingMessage;
  const editPendingMessage = sidebarMessageActionsBundle.editPendingMessage;
  const removePendingMessage = sidebarMessageActionsBundle.removePendingMessage;

  const openDiagnostics = useMemo(() => {
    if (window.moebius?.openStatusPage === undefined) {
      return undefined;
    }
    return () => {
      void window.moebius?.openStatusPage?.();
    };
  }, []);

  const setSidebarOpen = useCallback((open: boolean) => {
    const preference = open ? "open" : "closed";
    setSidebarVisibilityPreference(preference);
    writeSidebarVisibilityPreference(window.localStorage, preference);
  }, []);

  const renderSidebarConversation = useCallback(() => {
    return (
      <SidebarConversationView
        activeDraft={activeSidebarConversationDraft}
        activeSessionId={activeSidebarConversationSessionId}
        project={project}
        projects={projects}
        rightSidebar={rightSidebarBundle}
        sessions={sessionControllersBundle}
        conversations={conversationControllersBundle}
        attachments={managedSidebarConversationAttachments}
        agentTeams={agentTeamCatalogBundle}
        actions={actions}
        executionRegistryState={executionRegistryState}
        reloadExecutionRegistry={runtimeBridgeBundle.reloadExecutionRegistry}
        readComposerValue={(sessionId) => sessionControllersBundle.sidebarComposerValues[sessionId]
          ?? conversationDraftStoreRef.current.read(sessionDraftKey(sessionId))}
        writeComposerValue={sessionControllersBundle.sidebarMessages.editComposer}
        readReadingMessageId={(sessionId) => conversationReadingPositionStoreRef.current.read(sessionId)}
        writeReadingMessageId={(sessionId, messageId) =>
          conversationReadingPositionStoreRef.current.write(sessionId, messageId)}
        openEvidence={(intent) => {
          rightSidebarTabsBundle.changeTabs(openRightSidebarSourceTab(rightSidebarTabs, intent.kind === "workspace-diff"
            ? {
                id: `sidebar-workspace-${intent.sessionId}`,
                type: "workspace-diff",
                title: "builtin:workspace-diff",
                sourceKey: `workspace-diff:${intent.sessionId}`,
              }
            : {
                id: `sidebar-run-${intent.runId}`,
                type: "run-output",
                title: intent.role ?? t("console.sessionAnalysis.fullOutput"),
                sourceKey: createRunOutputSourceKey(intent.sessionId, intent.runId, intent.stepId),
              }));
        }}
        t={t}
      />
    );
  }, [
    activeSidebarConversationDraft,
    activeSidebarConversationSessionId,
    agentTeamCatalogBundle.state,
    actions,
    rightSidebarTabsBundle,
    conversationControllersBundle,
    executionRegistryState,
    managedSidebarConversationAttachments,
    project,
    projects,
    rightSidebarBundle,
    rightSidebarTabs,
    sessionControllersBundle,
    t,
  ]);

  return (
    <OperatorConsole
      executionRegistryState={executionRegistryState}
      onReloadExecutionRegistry={runtimeBridgeBundle.reloadExecutionRegistry}
      activeLocale={language.activeLocale}
      pendingLocale={language.pendingLocale}
      languageSaveStatus={language.status}
      {...settingsBundle}
      onSelectLocale={language.selectLocale}
      onRetryLocaleSave={language.retry}
      renderSearchOverlay={(close) => (
        <ConversationSearchOverlay
          {...conversationSearchBundle}
          closeHost={close}
          onOpen={openSearchedSession}
        />
      )}
      onUpdateClaude={() => {
        const update = window.moebius?.startOnboardingClaudeUpdate;
        if (update === undefined) {
          setClientError(t("desktop.error.builderUnavailable"));
          return;
        }
        void update().catch((error) => {
          setClientError(formatError(error));
        });
      }}
      project={project}
      projects={projects}
      selectedProjectId={selection.projectId}
      selectedSessionId={selection.sessionId}
      navigationSessionId={presentationRoute?.selectedSessionId}
      selectedSession={selectedSession}
      analysisPanel={selectedSession === null
        ? undefined
        : {
            open: analysisPanelOpenBySession[selectedSession.sessionId] === true,
            state: {
              status: "ready",
              entries: analysisEntriesFor(selectedSession.sessionId),
            },
            onOpenChange: (open) => setAnalysisPanelOpen(selectedSession.sessionId, open),
            onOpenEntry: (entry) => openAnalysisPanelEntry(selectedSession.sessionId, entry),
          }}
      conversationNotice={conversationTransitionBundle.transitionError ?? sessionAnalysisNotice ?? (presentationRoute?.notice === "source-unavailable"
        ? t("console.sessionAnalysis.sourceUnavailable")
        : null)}
      messages={presentationBundle.messages}
      initialReadingMessageId={selectedSession === null
        ? null
        : conversationReadingPositionStoreRef.current.read(selectedSession.sessionId)}
      messageNavigationRequest={
        selectedSession !== null
        && conversationMessageNavigation?.sessionId === selectedSession.sessionId
          ? {
              messageId: conversationMessageNavigation.messageId,
              requestId: conversationMessageNavigation.requestId,
            }
          : null
      }
      onMessageNavigationHandled={(requestId) => {
        analysisNavigationBundle.handleMessageNavigation(requestId);
      }}
      onReadingMessageChange={(sessionId, messageId) => {
        conversationReadingPositionStoreRef.current.write(sessionId, messageId);
      }}
      pendingDispatchMessages={state?.pendingDispatchMessages ?? []}
      pendingPrimaryMessages={state?.pendingPrimaryMessages ?? []}
      childSessions={state?.childSessions ?? []}
      memberIdentities={state?.memberIdentities ?? []}
      subSessionViews={presentationBundle.subSessionViews}
      subSessionComposerValue={activeSubSessionComposerValue}
      subSessionComposerAttachments={managedSubSessionAttachments.attachments}
      activeRun={presentationBundle.activeRun}
      activeRuns={presentationBundle.activeRuns}
      workspaceDiff={state?.workspaceDiff ?? { available: false, fileCount: null, reason: "unavailable" }}
      composerValue={composerDraft.value}
      composerAttachments={managedAttachments.attachments}
      composerSubmissionBlockReason={conversationTransitionBundle.submissionBlockText}
      runnerStatus={runtimeBridgeBundle.runnerStatus}
      sqlitePath={presentationBundle.sqlitePath}
      lastError={lastError}
      projectListState={presentationBundle.projectListState}
      agentTeamsState={agentTeamCatalogBundle.state}
      lastUsedAgentTeamKey={agentTeamCatalogBundle.lastUsedTeamKey}
      conversationAgentTeamKey={selectedSession?.agentTeamOwnership != null && selectedSession.agentTeamId != null
        ? `${selectedSession.agentTeamOwnership}:${selectedSession.agentTeamId}`
        : null}
      selectedAgentTeamKey={agentTeamCatalogBundle.selection?.teamKey}
      selectedAgentTeamMemberSlug={agentTeamCatalogBundle.selection?.memberSlug}
      agentTeamDetailState={agentTeamControllersBundle.detailState}
      agentTeamBuilder={agentTeamBuilderBundle}
      newConversation={newConversation?.isOpen !== true ? null : {
        selectedProjectId: newConversation.projectId,
        selectedWorkspaceMode: newConversation.workspaceMode,
        selectedTeamKey: newConversation.teamKey,
        draft: newConversation.draft,
        isSubmitting: newConversation.isSubmitting,
        error: sessionAnalysisNotice ?? newConversation.error ?? clientError,
      }}
      {...cliInstallationsBundle}
      onComposerChange={(value) => {
        const current = composerDraftRef.current;
        conversationDraftStoreRef.current.write(current.key, value);
        commitComposerDraft(editConversationComposerDraft(current, value));
      }}
      onComposerFilesAdded={managedAttachments.addFiles}
      onComposerAttachmentRemove={managedAttachments.remove}
      onComposerAttachmentRetry={managedAttachments.retry}
      onSend={conversationTransitionBundle.sendMainComposer}
      onSubSessionComposerChange={sessionRunActionsBundle.editComposer}
      onSubSessionComposerFilesAdded={managedSubSessionAttachments.addFiles}
      onSubSessionComposerAttachmentRemove={managedSubSessionAttachments.remove}
      onSubSessionComposerAttachmentRetry={managedSubSessionAttachments.retry}
      onSubSessionSend={(sessionId) => {
        void sendSubSessionMessage(sessionId);
      }}
      onSubSessionRetry={(sessionId, runId, executionOverride) =>
        retryRun(sessionId, runId, executionOverride)}
      onSubSessionInterrupt={(sessionId, runId) => {
        void interruptSubSession(sessionId, runId);
      }}
      onStartNewConversation={startNewConversation}
      onNewConversationProjectChange={(projectId) => {
        setClientError(null);
        dispatchNewConversation({ type: "select-project", projectId });
        const selectedProject = projects.find((candidate) => candidate.projectId === projectId);
        dispatchNewConversation({
          type: "select-workspace",
          workspaceMode: selectedProject?.worktreeMode === true ? "worktree" : "direct",
        });
      }}
      onNewConversationWorkspaceChange={(workspaceMode) => {
        dispatchNewConversation({ type: "select-workspace", workspaceMode });
      }}
      onNewConversationTeamChange={(teamKey) => {
        dispatchNewConversation({ type: "select-team", teamKey });
      }}
      onNewConversationDraftChange={(value) => {
        conversationDraftStoreRef.current.write(NEW_CONVERSATION_DRAFT_KEY, value);
        dispatchNewConversation({ type: "edit-draft", draft: value });
      }}
      onSubmitNewConversation={() => void newConversationSubmissionBundle.createConversation()}
      onAddNewConversationProject={() => {
        void actions.addProject(projects.map((candidate) => candidate.projectId)).then((added) => {
          if (added !== null) {
            setClientError(null);
            dispatchNewConversation({ type: "select-project", projectId: added.projectId });
            dispatchNewConversation({ type: "select-workspace", workspaceMode: "direct" });
          }
        });
      }}
      onReorderProjects={actions.reorderProjects}
      onChangeSessionWorkspace={actions.changeSessionWorkspace}
      onChangeSessionTeam={(sessionId, team) => actions.changeSessionTeam(sessionId, {
        ownership: team.ownership,
        id: team.id,
      })}
      onSelectSession={conversationNavigationBundle.selectConversation}
      onChangeSessionProject={actions.rebindSessionProject}
      onShowProjectInFolder={showProjectInFolder}
      onRenameProject={renameProject}
      onRemoveProject={removeProject}
      onSelectFolderForRepair={selectFolderForRepair}
      onRepairProjectFolder={repairProjectFolder}
      onArchiveSession={sessionMutationIntents.archiveSession}
      onCopySessionLogPath={sessionMutationIntents.copyLogPath}
      onUpdateSessionReadState={async (session, _projectId, action) => {
        await actions.updateSessionReadState(session, action);
      }}
      onSetSessionPinned={async (session, _projectId, pinned) => {
        await actions.setSessionPinned(session, pinned);
      }}
      onRenameSession={(session, _projectId, title) =>
        sessionMutationIntents.renameSession(session, title)}
      onInterrupt={interrupt}
      onRetryRun={(sessionId, runId, executionOverride) =>
        retryRun(sessionId, runId, executionOverride)}
      onRetryPendingMessage={(sessionId, messageId) => void retryPendingMessage(sessionId, messageId)}
      onEditPendingMessage={(sessionId, messageId, body) => void editPendingMessage(sessionId, messageId, body)}
      onRemovePendingMessage={(sessionId, messageId) => void removePendingMessage(sessionId, messageId)}
      onAnalyzeSession={(input) => {
        void analyzeConversation({
          kind: "conversation",
          ...input,
        });
      }}
      onAnalyzeConversation={(input) => {
        void analyzeConversation({
          kind: "message",
          ...input,
        });
      }}
      onEditAndResend={editAndResend}
      onOpenDiagnostics={openDiagnostics}
      onReplayOnboarding={onReplayOnboarding}
      onOpenExternalLink={window.moebius?.openExternalLink === undefined
        ? undefined
        : (url) => {
          void window.moebius?.openExternalLink?.(url).catch((error: unknown) => {
            setClientError(error instanceof Error ? error.message : String(error));
          });
        }}
      onOpenConversationReference={openConversationReference}
      onRetryProjectList={() => {
        setClientError(null);
        void refresh(selectionRef.current);
      }}
      onRetryAgentTeams={agentTeamCatalogBundle.refresh}
      onCreateAgentTeam={agentTeamRecordMutationBundle.createTeam}
      onOpenAgentTeam={agentTeamNavigationBundle.open}
      onCloseAgentTeam={() => {
        agentTeamNavigationBundle.close();
        agentTeamProfileBundle.clearPrimaryAgentChange();
      }}
      onSelectAgentTeamMember={agentTeamNavigationBundle.selectMember}
      onChangeAgentTeamPrimaryAgent={agentTeamProfileBundle.changePrimaryAgent}
      onAddAgentTeamMember={agentTeamMemberMutationBundle.addMember}
      onUpdateAgentTeamInformation={agentTeamRecordMutationBundle.updateInformation}
      onChangeAgentTeamMember={(teamKey, memberSlug, agentMarkdown) => {
        agentTeamMemberBundle.commitDrafts(updateAgentTeamMemberDraft(
          agentTeamMemberBundle.draftsRef.current,
          teamKey,
          memberSlug,
          agentMarkdown,
        ));
      }}
      onSaveAgentTeamMember={agentTeamMemberBundle.saveMember}
      onCheckAgentTeamMemberExternalChange={agentTeamMemberBundle.checkExternalChange}
      onLoadAgentTeamMemberExternalVersion={agentTeamMemberBundle.loadExternalVersion}
      onOverwriteAgentTeamMemberExternalVersion={agentTeamMemberBundle.overwriteExternal}
      onRetryAgentTeamMember={(teamKey, memberSlug) => {
        void agentTeamMemberBundle.loadMember(teamKey, memberSlug);
      }}
      onDiscardAgentTeamMember={(teamKey, memberSlug) => {
        agentTeamMemberBundle.commitDrafts(discardAgentTeamMemberDraft(
          agentTeamMemberBundle.draftsRef.current,
          teamKey,
          memberSlug,
        ));
      }}
      onDiscardAllAgentTeamDrafts={(teamKey) => {
        agentTeamMemberBundle.commitDrafts(discardAllAgentTeamDrafts(agentTeamMemberBundle.draftsRef.current, teamKey));
        agentTeamMemberBundle.setSaveAllFailures([]);
      }}
      onSaveAllAgentTeamDrafts={agentTeamMemberBundle.saveAll}
      onSaveAgentExecutionProfile={agentTeamProfileBundle.saveExecutionProfile}
      onRestoreAgentRecommendedProfile={agentTeamProfileBundle.restoreRecommendedProfile}
      onApplyOfficialAgentTeamUpdate={agentTeamProfileBundle.applyOfficialUpdate}
      onDuplicateBuiltInAgentTeam={agentTeamCopyBundle.duplicateBuiltIn}
      onRecheckAgentTeam={agentTeamCatalogBundle.refresh}
      onRelocateAgentTeam={agentTeamRecordMutationBundle.relocateTeam}
      onRemoveAgentTeamRecord={agentTeamRecordMutationBundle.removeRecord}
      agentTeamFileManagerLabel={t(planAgentTeamFileManagerTranslationKey(
        window.moebius?.agentTeamFileManagerKind ?? "file-manager",
      ))}
      onOpenAgentTeamLocation={agentTeamRecordMutationBundle.openLocation}
      onDuplicateUserAgentTeam={agentTeamCopyBundle.duplicateUser}
      onDuplicateAgentTeamMember={agentTeamMemberMutationBundle.duplicateMember}
      onTrashAgentTeamMember={agentTeamMemberMutationBundle.trashMember}
      onTrashUserAgentTeam={agentTeamRecordMutationBundle.trashTeam}
      onViewAgentTeamRegistrationConflict={agentTeamRegistrationBundle.viewConflict}
      onShowAgentTeamRegistrationConflictLocation={agentTeamRegistrationBundle.showConflictLocation}
      onPreserveAgentTeamRegistrationConflicts={agentTeamRegistrationBundle.preserveConflicts}
      isSending={stateActionsBundle.isSending}
      isSubSessionSending={sessionRunActionsBundle.isSending}
      isSelectionMutationPending={stateActionsBundle.selectionMutationKind !== null}
      isSessionProjectUpdating={stateActionsBundle.selectionMutationKind === "rebind-session"}
      isProjectMutationPending={isProjectMutationPending}
      sidebarOpen={sidebarVisibilityPreference === "open"}
      onSidebarOpenChange={setSidebarOpen}
      rightSidebarOpen={rightSidebarTabsBundle.visibilityPreference === "open"}
      rightSidebarWidth={rightSidebarTabsBundle.width}
      rightSidebarTabs={presentationBundle.rightSidebarTabs}
      rightSidebarTabDiscriminators={presentationBundle.rightSidebarTabDiscriminators}
      rightSidebarUpdatingTabIds={presentationBundle.rightSidebarUpdatingTabIds}
      onRetryRightSidebarTitles={() => {
        setClientError(null);
        void refresh(selectionRef.current);
      }}
      rightSidebarFocusTabId={
        selectedSession !== null
        && rightSidebarTabsBundle.focusRequest?.hostSessionId === selectedSession.sessionId
          ? rightSidebarTabsBundle.focusRequest.tabId
          : null
      }
      onRightSidebarFocusHandled={(tabId) => {
        rightSidebarTabsBundle.handleFocus(tabId);
      }}
      rightSidebarContentSlots={{
        conversation: renderSidebarConversation,
      }}
      processOutputs={processOutputs}
      processInvocationStates={processInvocationStates}
      onLoadProcessInvocation={readProcessDebugInvocation}
      onRightSidebarOpenChange={setRightSidebarOpen}
      onRightSidebarWidthChange={rightSidebarTabsBundle.changeWidth}
      onRightSidebarTabsChange={rightSidebarTabsBundle.changeTabs}
      onBeforeCloseRightSidebarTab={(tab) => {
        const locator = tab.type === "conversation"
          ? parseConversationTabSourceKey(tab.sourceKey)
          : null;
        if (locator?.kind !== "draft") return true;
        const draft = sidebarConversationDraftStoreRef.current.read(locator.draftId);
        if (draft === null) return true;
        const hasAttachments = managedSidebarConversationAttachments
          .hasDraftAttachments(draft.attachmentDraftKey);
        if (
          sidebarConversationDraftRequiresDiscardConfirmation(draft, hasAttachments)
            && !window.confirm(t("console.sessionAnalysis.discardDraft"))
        ) {
          return false;
        }
        sidebarConversationDraftStoreRef.current.remove(draft.draftId);
        setSidebarConversationDrafts(sidebarConversationDraftStoreRef.current.list());
        managedSidebarConversationAttachments.clearDraft(draft.attachmentDraftKey);
        return true;
      }}
      onLoadWorkspaceDiff={readWorkspaceDiff}
      onLoadProjectFiles={readProjectFiles}
      onLoadProjectFile={readProjectFile}
      onLoadFileReference={readFileReference}
      onLoadProcessOutputPrevious={loadPreviousProcessOutput}
    />
  );
}

function createAgentTeamBuilderDraftId(): string {
  const suffix = typeof globalThis.crypto?.randomUUID === "function"
    ? globalThis.crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  return `agent-teams-${suffix}`;
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

const rootElement = document.getElementById("root");
if (rootElement !== null) {
  createRoot(rootElement).render(<App />);
}
