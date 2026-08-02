import {
  createRunOutputSourceKey,
  openRightSidebarSourceTab,
  OperatorConsole,
  type Translate,
} from "@moebius/console-ui";

import type { ConsoleStateActions } from "./console-state-actions.js";
import type { ConversationDraftStore } from "./draft-store.js";
import type { NewConversationDraftState } from "./new-conversation.js";
import type { ConversationReadingPositionStore } from "./conversation-reading-position.js";
import type { SidebarConversationDraft } from "./sidebar-conversation-drafts.js";
import { sessionDraftKey } from "./conversation-draft-model.js";
import { ConversationSearchOverlay } from "./conversation-search-overlay.js";
import { SidebarConversationView } from "./sidebar-conversation-view.js";
import type { useAgentTeamConsole } from "./use-agent-team-console.js";
import type { useConsoleAttachmentDrafts } from "./use-console-attachment-drafts.js";
import type { useConsolePresentation } from "./use-console-presentation.js";
import type { useConsoleLocalState } from "./use-console-local-state.js";
import type { useConsoleStateActions } from "./use-console-state-actions.js";
import type { useConsoleStateSync } from "./use-console-state-sync.js";
import type { useConversationConsole } from "./use-conversation-console.js";
import type { useDesktopLanguage } from "./desktop-application-root.js";
import type { useDesktopConsoleShell } from "./use-desktop-console-shell.js";
import type { useProjectMutations } from "./use-project-mutations.js";
import type { useRightSidebarConsole } from "./use-right-sidebar-console.js";
import type { useSessionConsole } from "./use-session-console.js";
import type { useSidebarDraftClose } from "./use-sidebar-draft-close.js";

export interface OperatorConsoleViewProps {
  language: ReturnType<typeof useDesktopLanguage>;
  desktopShell: ReturnType<typeof useDesktopConsoleShell>;
  localState: ReturnType<typeof useConsoleLocalState>;
  stateSync: ReturnType<typeof useConsoleStateSync>;
  stateActions: ReturnType<typeof useConsoleStateActions>;
  presentation: ReturnType<typeof useConsolePresentation>;
  attachments: ReturnType<typeof useConsoleAttachmentDrafts>;
  conversations: ReturnType<typeof useConversationConsole>;
  projectMutations: ReturnType<typeof useProjectMutations>;
  sessions: ReturnType<typeof useSessionConsole>;
  rightSidebar: ReturnType<typeof useRightSidebarConsole>;
  sidebarDraftClose: ReturnType<typeof useSidebarDraftClose>;
  agentTeams: ReturnType<typeof useAgentTeamConsole>;
  actions: ConsoleStateActions;
  newConversation: NewConversationDraftState | null;
  sessionAnalysisNotice: string | null;
  sidebarConversationDrafts: SidebarConversationDraft[];
  sidebarOpen: boolean;
  setSidebarOpen(open: boolean): void;
  conversationDraftStore: ConversationDraftStore;
  readingPositionStore: ConversationReadingPositionStore;
  onReplayOnboarding?: () => void;
  t: Translate;
}

export function OperatorConsoleView(props: OperatorConsoleViewProps): JSX.Element {
  const runtime = props.desktopShell.runtime;
  const selectionState = props.localState.selection;
  const composer = props.localState.composer;
  const selection = selectionState.selection;
  const state = selectionState.state;
  const presentationRoute = selectionState.presentationRoute;
  const project = props.presentation.project;
  const projects = props.presentation.projects;
  const selectedSession = props.presentation.selectedSession;
  const conversationTransition = props.conversations.transition;
  const analysisNavigation = props.conversations.analysisNavigation;
  const rightSidebarTabs = props.rightSidebar.tabs;
  const activeSubSessionId = props.rightSidebar.active.subSessionId;
  const activeConversation = props.rightSidebar.active.conversation;
  const activeSidebarSessionId = activeConversation?.kind === "session"
    ? activeConversation.sessionId
    : null;
  const activeSidebarDraftId = activeConversation?.kind === "draft" ? activeConversation.draftId : null;
  const activeSidebarDraft = activeSidebarDraftId === null
    ? null
    : props.sidebarConversationDrafts.find((draft) => draft.draftId === activeSidebarDraftId) ?? null;
  const activeSubSessionComposerValue = activeSubSessionId === null
    ? ""
    : props.sessions.subSessionComposerValues[activeSubSessionId]
      ?? props.conversationDraftStore.read(sessionDraftKey(activeSubSessionId));
  const lastError = conversationTransition.transitionError
    ?? runtime.clientError
    ?? runtime.statusError
    ?? state?.lastError
    ?? null;
  const renderSidebarConversation = () => (
    <SidebarConversationView
      activeDraft={activeSidebarDraft}
      activeSessionId={activeSidebarSessionId}
      project={project}
      projects={projects}
      rightSidebar={props.rightSidebar}
      sessions={props.sessions}
      conversations={props.conversations}
      attachments={props.attachments.sidebar}
      agentTeams={props.agentTeams.catalog}
      actions={props.actions}
      executionRegistryState={runtime.executionRegistryState}
      reloadExecutionRegistry={runtime.reloadExecutionRegistry}
      readComposerValue={(sessionId) => props.sessions.sidebarComposerValues[sessionId]
        ?? props.conversationDraftStore.read(sessionDraftKey(sessionId))}
      writeComposerValue={props.sessions.sidebarMessages.editComposer}
      readReadingMessageId={props.readingPositionStore.read}
      writeReadingMessageId={props.readingPositionStore.write}
      openEvidence={(intent) => {
        rightSidebarTabs.changeTabs(openRightSidebarSourceTab(rightSidebarTabs.state, intent.kind === "workspace-diff"
          ? {
              id: `sidebar-workspace-${intent.sessionId}`,
              type: "workspace-diff",
              title: "builtin:workspace-diff",
              sourceKey: `workspace-diff:${intent.sessionId}`,
            }
          : {
              id: `sidebar-run-${intent.runId}`,
              type: "run-output",
              title: intent.role ?? props.t("console.sessionAnalysis.fullOutput"),
              sourceKey: createRunOutputSourceKey(intent.sessionId, intent.runId, intent.stepId),
            }));
      }}
      t={props.t}
    />
  );
  return (
    <OperatorConsole
      executionRegistryState={runtime.executionRegistryState}
      onReloadExecutionRegistry={runtime.reloadExecutionRegistry}
      activeLocale={props.language.activeLocale}
      pendingLocale={props.language.pendingLocale}
      languageSaveStatus={props.language.status}
      {...props.desktopShell.settings}
      onSelectLocale={props.language.selectLocale}
      onRetryLocaleSave={props.language.retry}
      renderSearchOverlay={(close) => (
        <ConversationSearchOverlay
          {...props.desktopShell.conversationSearch}
          closeHost={close}
          onOpen={props.conversations.searchedSession.openSearchedSession}
        />
      )}
      onUpdateClaude={runtime.updateClaude}
      project={project}
      projects={projects}
      selectedProjectId={selection.projectId}
      selectedSessionId={selection.sessionId}
      navigationSessionId={presentationRoute?.selectedSessionId}
      selectedSession={selectedSession}
      analysisPanel={selectedSession === null
        ? undefined
        : {
            open: analysisNavigation.openBySession[selectedSession.sessionId] === true,
            state: { status: "ready", entries: analysisNavigation.entriesFor(selectedSession.sessionId) },
            onOpenChange: (open) => analysisNavigation.setPanelOpen(selectedSession.sessionId, open),
            onOpenEntry: (entry) => analysisNavigation.openEntry(selectedSession.sessionId, entry),
          }}
      conversationNotice={conversationTransition.transitionError
        ?? props.sessionAnalysisNotice
        ?? (presentationRoute?.notice === "source-unavailable"
          ? props.t("console.sessionAnalysis.sourceUnavailable")
          : null)}
      messages={props.presentation.messages}
      initialReadingMessageId={selectedSession === null
        ? null
        : props.readingPositionStore.read(selectedSession.sessionId)}
      messageNavigationRequest={selectedSession !== null
        && analysisNavigation.messageNavigation?.sessionId === selectedSession.sessionId
        ? {
            messageId: analysisNavigation.messageNavigation.messageId,
            requestId: analysisNavigation.messageNavigation.requestId,
          }
        : null}
      onMessageNavigationHandled={analysisNavigation.handleMessageNavigation}
      onReadingMessageChange={props.readingPositionStore.write}
      pendingDispatchMessages={state?.pendingDispatchMessages ?? []}
      pendingPrimaryMessages={state?.pendingPrimaryMessages ?? []}
      childSessions={state?.childSessions ?? []}
      memberIdentities={state?.memberIdentities ?? []}
      subSessionViews={props.presentation.subSessionViews}
      subSessionComposerValue={activeSubSessionComposerValue}
      subSessionComposerAttachments={props.attachments.subSession.attachments}
      activeRun={props.presentation.activeRun}
      activeRuns={props.presentation.activeRuns}
      workspaceDiff={state?.workspaceDiff ?? { available: false, fileCount: null, reason: "unavailable" }}
      composerValue={composer.draft.value}
      composerAttachments={props.attachments.main.attachments}
      composerSubmissionBlockReason={conversationTransition.submissionBlockText}
      sqlitePath={props.presentation.sqlitePath}
      lastError={lastError}
      projectListState={props.presentation.projectListState}
      agentTeamsState={props.agentTeams.catalog.state}
      lastUsedAgentTeamKey={props.agentTeams.catalog.lastUsedTeamKey}
      conversationAgentTeamKey={selectedSession?.agentTeamOwnership != null && selectedSession.agentTeamId != null
        ? `${selectedSession.agentTeamOwnership}:${selectedSession.agentTeamId}`
        : null}
      selectedAgentTeamKey={props.agentTeams.catalog.selection?.teamKey}
      selectedAgentTeamMemberSlug={props.agentTeams.catalog.selection?.memberSlug}
      agentTeamDetailState={props.agentTeams.detailState}
      agentTeamBuilder={props.agentTeams.builder}
      newConversation={props.newConversation?.isOpen !== true ? null : {
        selectedProjectId: props.newConversation.projectId,
        selectedWorkspaceMode: props.newConversation.workspaceMode,
        selectedTeamKey: props.newConversation.teamKey,
        draft: props.newConversation.draft,
        isSubmitting: props.newConversation.isSubmitting,
        error: props.sessionAnalysisNotice ?? props.newConversation.error ?? runtime.clientError,
      }}
      {...props.desktopShell.cliInstallations}
      onComposerChange={composer.change}
      onComposerFilesAdded={props.attachments.main.addFiles}
      onComposerAttachmentRemove={props.attachments.main.remove}
      onComposerAttachmentRetry={props.attachments.main.retry}
      onSend={conversationTransition.sendMainComposer}
      onSubSessionComposerChange={props.sessions.runs.editComposer}
      onSubSessionComposerFilesAdded={props.attachments.subSession.addFiles}
      onSubSessionComposerAttachmentRemove={props.attachments.subSession.remove}
      onSubSessionComposerAttachmentRetry={props.attachments.subSession.retry}
      onSubSessionSend={(sessionId) => void props.sessions.runs.sendSubSessionMessage(sessionId)}
      onSubSessionRetry={props.sessions.runs.retryRun}
      onSubSessionInterrupt={(sessionId, runId) => void props.sessions.runs.interruptSubSession(sessionId, runId)}
      onStartNewConversation={props.conversations.launcher.startNewConversation}
      onNewConversationProjectChange={props.conversations.launcher.selectProject}
      onNewConversationWorkspaceChange={props.conversations.launcher.selectWorkspace}
      onNewConversationTeamChange={props.conversations.launcher.selectTeam}
      onNewConversationDraftChange={props.conversations.launcher.changeDraft}
      onSubmitNewConversation={() => void props.conversations.submission.createConversation()}
      onAddNewConversationProject={() => void props.conversations.launcher.addProject()}
      onReorderProjects={props.actions.reorderProjects}
      onChangeSessionWorkspace={props.actions.changeSessionWorkspace}
      onChangeSessionTeam={(sessionId, team) => props.actions.changeSessionTeam(sessionId, {
        ownership: team.ownership,
        id: team.id,
      })}
      onSelectSession={props.conversations.navigation.selectConversation}
      onChangeSessionProject={props.actions.rebindSessionProject}
      onShowProjectInFolder={props.projectMutations.showProjectInFolder}
      onRenameProject={props.projectMutations.renameProject}
      onRemoveProject={props.projectMutations.removeProject}
      onSelectFolderForRepair={props.projectMutations.selectFolderForRepair}
      onRepairProjectFolder={props.projectMutations.repairProjectFolder}
      onArchiveSession={props.conversations.sessionMutations.archiveSession}
      onCopySessionLogPath={props.conversations.sessionMutations.copyLogPath}
      onUpdateSessionReadState={async (session, _projectId, action) => {
        await props.actions.updateSessionReadState(session, action);
      }}
      onSetSessionPinned={async (session, _projectId, pinned) => {
        await props.actions.setSessionPinned(session, pinned);
      }}
      onRenameSession={(session, _projectId, title) =>
        props.conversations.sessionMutations.renameSession(session, title)}
      onInterrupt={props.sessions.runs.interrupt}
      onRetryRun={props.sessions.runs.retryRun}
      onRetryPendingMessage={(sessionId, messageId) =>
        void props.sessions.sidebarMessages.retryPendingMessage(sessionId, messageId)}
      onEditPendingMessage={(sessionId, messageId, body) =>
        void props.sessions.sidebarMessages.editPendingMessage(sessionId, messageId, body)}
      onRemovePendingMessage={(sessionId, messageId) =>
        void props.sessions.sidebarMessages.removePendingMessage(sessionId, messageId)}
      onAnalyzeSession={(input) => void props.conversations.analysis.analyze({ kind: "conversation", ...input })}
      onAnalyzeConversation={(input) => void props.conversations.analysis.analyze({ kind: "message", ...input })}
      onEditAndResend={props.conversations.editResend.editAndResend}
      onOpenDiagnostics={runtime.openDiagnostics}
      onReplayOnboarding={props.onReplayOnboarding}
      onOpenExternalLink={runtime.openExternalLink}
      onOpenConversationReference={analysisNavigation.openReference}
      onRetryProjectList={() => {
        runtime.setClientError(null);
        void props.stateSync.refresh(selectionState.selectionRef.current);
      }}
      onRetryAgentTeams={props.agentTeams.catalog.refresh}
      onCreateAgentTeam={props.agentTeams.recordMutations.createTeam}
      onOpenAgentTeam={props.agentTeams.navigation.open}
      onCloseAgentTeam={props.agentTeams.intents.close}
      onSelectAgentTeamMember={props.agentTeams.navigation.selectMember}
      onChangeAgentTeamPrimaryAgent={props.agentTeams.profile.changePrimaryAgent}
      onAddAgentTeamMember={props.agentTeams.memberMutations.addMember}
      onUpdateAgentTeamInformation={props.agentTeams.recordMutations.updateInformation}
      onChangeAgentTeamMember={props.agentTeams.intents.changeMember}
      onSaveAgentTeamMember={props.agentTeams.member.saveMember}
      onCheckAgentTeamMemberExternalChange={props.agentTeams.member.checkExternalChange}
      onLoadAgentTeamMemberExternalVersion={props.agentTeams.member.loadExternalVersion}
      onOverwriteAgentTeamMemberExternalVersion={props.agentTeams.member.overwriteExternal}
      onRetryAgentTeamMember={(teamKey, memberSlug) => void props.agentTeams.member.loadMember(teamKey, memberSlug)}
      onDiscardAgentTeamMember={props.agentTeams.intents.discardMember}
      onDiscardAllAgentTeamDrafts={props.agentTeams.intents.discardAll}
      onSaveAllAgentTeamDrafts={props.agentTeams.member.saveAll}
      onSaveAgentExecutionProfile={props.agentTeams.profile.saveExecutionProfile}
      onRestoreAgentRecommendedProfile={props.agentTeams.profile.restoreRecommendedProfile}
      onApplyOfficialAgentTeamUpdate={props.agentTeams.profile.applyOfficialUpdate}
      onDuplicateBuiltInAgentTeam={props.agentTeams.copy.duplicateBuiltIn}
      onRecheckAgentTeam={props.agentTeams.catalog.refresh}
      onRelocateAgentTeam={props.agentTeams.recordMutations.relocateTeam}
      onRemoveAgentTeamRecord={props.agentTeams.recordMutations.removeRecord}
      agentTeamFileManagerLabel={props.agentTeams.intents.fileManagerLabel}
      onOpenAgentTeamLocation={props.agentTeams.recordMutations.openLocation}
      onDuplicateUserAgentTeam={props.agentTeams.copy.duplicateUser}
      onDuplicateAgentTeamMember={props.agentTeams.memberMutations.duplicateMember}
      onTrashAgentTeamMember={props.agentTeams.memberMutations.trashMember}
      onTrashUserAgentTeam={props.agentTeams.recordMutations.trashTeam}
      onViewAgentTeamRegistrationConflict={props.agentTeams.registration.viewConflict}
      onShowAgentTeamRegistrationConflictLocation={props.agentTeams.registration.showConflictLocation}
      onPreserveAgentTeamRegistrationConflicts={props.agentTeams.registration.preserveConflicts}
      isSending={props.stateActions.isSending}
      isSubSessionSending={props.sessions.runs.isSending}
      isSelectionMutationPending={props.stateActions.selectionMutationKind !== null}
      isSessionProjectUpdating={props.stateActions.selectionMutationKind === "rebind-session"}
      isProjectMutationPending={props.projectMutations.isPending}
      sidebarOpen={props.sidebarOpen}
      onSidebarOpenChange={props.setSidebarOpen}
      rightSidebarOpen={rightSidebarTabs.visibilityPreference === "open"}
      rightSidebarWidth={rightSidebarTabs.width}
      rightSidebarTabs={props.presentation.rightSidebarTabs}
      rightSidebarTabDiscriminators={props.presentation.rightSidebarTabDiscriminators}
      rightSidebarUpdatingTabIds={props.presentation.rightSidebarUpdatingTabIds}
      onRetryRightSidebarTitles={() => {
        runtime.setClientError(null);
        void props.stateSync.refresh(selectionState.selectionRef.current);
      }}
      rightSidebarFocusTabId={selectedSession !== null
        && rightSidebarTabs.focusRequest?.hostSessionId === selectedSession.sessionId
        ? rightSidebarTabs.focusRequest.tabId
        : null}
      onRightSidebarFocusHandled={rightSidebarTabs.handleFocus}
      rightSidebarContentSlots={{ conversation: renderSidebarConversation }}
      processOutputs={props.rightSidebar.processData.outputs}
      processInvocationStates={props.rightSidebar.processData.invocations}
      onLoadProcessInvocation={props.rightSidebar.processData.readInvocation}
      onRightSidebarOpenChange={rightSidebarTabs.setOpen}
      onRightSidebarWidthChange={rightSidebarTabs.changeWidth}
      onRightSidebarTabsChange={rightSidebarTabs.changeTabs}
      onBeforeCloseRightSidebarTab={props.sidebarDraftClose.beforeClose}
      onLoadWorkspaceDiff={props.rightSidebar.files.readWorkspaceDiff}
      onLoadProjectFiles={props.rightSidebar.files.readProjectFiles}
      onLoadProjectFile={props.rightSidebar.files.readProjectFile}
      onLoadFileReference={props.rightSidebar.files.readFileReference}
      onLoadProcessOutputPrevious={props.rightSidebar.processData.loadPrevious}
    />
  );
}
