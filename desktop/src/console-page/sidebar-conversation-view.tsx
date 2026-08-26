import {
  OperatorConsole,
  type ExecutionRegistryState,
  type OperatorEvidenceOpenIntent,
  type OperatorProject,
  type OperatorSubSessionView,
  type TranslationKey,
} from "@moebius/console-ui";

import type { ConsoleStateActions } from "./console-state-actions.js";
import type { useConversationConsole } from "./use-conversation-console.js";
import type { useManagedAttachmentDrafts } from "./use-managed-attachments.js";
import type { useRightSidebarConsole } from "./use-right-sidebar-console.js";
import type { useSessionConsole } from "./use-session-console.js";
import type { AgentTeamCatalogBundle } from "./use-agent-team-catalog.js";
import type { SidebarConversationDraft } from "./sidebar-conversation-drafts.js";
import {
  planSidebarDraftBodyChange,
  planSidebarDraftFragmentRemoval,
  planSidebarDraftProjectChange,
  planSidebarDraftSuggestionSelection,
  planSidebarDraftTeamChange,
  planSidebarDraftWorkspaceChange,
} from "./sidebar-conversation-view-model.js";

type RightSidebarBundle = ReturnType<typeof useRightSidebarConsole>;
type SessionBundle = ReturnType<typeof useSessionConsole>;
type ConversationBundle = ReturnType<typeof useConversationConsole>;
type SidebarAttachments = ReturnType<typeof useManagedAttachmentDrafts>;

export interface SidebarConversationViewProps {
  activeDraft: SidebarConversationDraft | null;
  activeSessionId: string | null;
  project: OperatorProject;
  projects: OperatorProject[];
  rightSidebar: RightSidebarBundle;
  sessions: SessionBundle;
  conversations: ConversationBundle;
  attachments: SidebarAttachments;
  agentTeams: AgentTeamCatalogBundle;
  actions: ConsoleStateActions;
  updateProjectWorkspacePreference(
    projectId: string,
    workspaceMode: "direct" | "worktree",
  ): Promise<void>;
  executionRegistryState: ExecutionRegistryState;
  reloadExecutionRegistry(): void;
  readComposerValue(sessionId: string): string;
  writeComposerValue(sessionId: string, value: string): void;
  readReadingMessageId(sessionId: string): number | null;
  writeReadingMessageId(sessionId: string, messageId: number): void;
  openEvidence(intent: OperatorEvidenceOpenIntent): void;
  t(key: TranslationKey): string;
}

export function SidebarConversationView(props: SidebarConversationViewProps): JSX.Element | null {
  if (props.activeDraft !== null) return <SidebarDraftConversation {...props} draft={props.activeDraft} />;
  if (props.activeSessionId === null) return null;
  const viewState = props.rightSidebar.conversationViews.sidebarConversationViews[props.activeSessionId];
  if (viewState?.status !== "ready") {
    return (
      <div className="grid min-h-full place-items-center p-6 text-sm text-sub" role="status">
        {viewState?.status === "error"
          ? viewState.message
          : props.t("console.sessionAnalysis.loadingConversation")}
      </div>
    );
  }
  return <SidebarSessionConversation {...props} view={viewState.view} />;
}

function SidebarDraftConversation(
  props: SidebarConversationViewProps & { draft: SidebarConversationDraft },
): JSX.Element {
  const { draft } = props;
  const draftProject = props.projects.find((candidate) =>
    candidate.projectId === draft.context.projectId) ?? props.project;
  const promptSuggestions = draft.entryTemplate === "session-analysis"
    ? [
        {
          id: "unexpected-agent-run",
          label: props.t("console.sessionAnalysis.unexpectedLabel"),
          prompt: props.t("console.sessionAnalysis.unexpectedPrompt"),
        },
        {
          id: "long-agent-run",
          label: props.t("console.sessionAnalysis.slowLabel"),
          prompt: props.t("console.sessionAnalysis.slowPrompt"),
        },
      ]
    : [];
  const update = props.sessions.sidebarDrafts.updateDraft;
  const now = () => new Date().toISOString();
  return (
    <OperatorConsole
      presentation="conversation"
      project={draftProject}
      projects={props.projects}
      selectedProjectId={draft.context.projectId ?? draftProject.projectId}
      selectedSessionId={draft.hostSessionId}
      selectedSession={null}
      messages={[]}
      activeRun={null}
      composerValue=""
      composerAttachments={props.attachments.attachments}
      agentTeamsState={props.agentTeams.state}
      executionRegistryState={props.executionRegistryState}
      onReloadExecutionRegistry={props.reloadExecutionRegistry}
      newConversation={{
        selectedProjectId: draft.context.projectId,
        selectedWorkspaceMode: draft.context.workspaceMode,
        selectedTeamKey: draft.context.teamKey,
        draft: draft.body,
        isSubmitting: props.sessions.sidebarDrafts.sendingId === draft.draftId,
        error: null,
        textFragments: draft.textFragments,
        promptSuggestions,
      }}
      onComposerChange={() => undefined}
      onComposerFilesAdded={props.attachments.addFiles}
      onComposerAttachmentRemove={props.attachments.remove}
      onComposerAttachmentRetry={props.attachments.retry}
      onSend={() => undefined}
      onSelectSession={() => undefined}
      onInterrupt={() => undefined}
      onNewConversationProjectChange={(projectId) => update(draft.draftId, (current) =>
        planSidebarDraftProjectChange(current, projectId, props.projects, now()))}
      onNewConversationWorkspaceChange={(workspaceMode) => {
        update(draft.draftId, (current) => planSidebarDraftWorkspaceChange(current, workspaceMode, now()));
        if (draft.context.projectId !== null) {
          void props.updateProjectWorkspacePreference(draft.context.projectId, workspaceMode).catch(() => undefined);
        }
      }}
      onNewConversationTeamChange={(teamKey) => update(draft.draftId, (current) =>
        planSidebarDraftTeamChange(current, teamKey, now()))}
      onNewConversationDraftChange={(body) => update(draft.draftId, (current) =>
        planSidebarDraftBodyChange(current, body, now()))}
      onNewConversationTextFragmentRemove={(fragmentId) => update(draft.draftId, (current) =>
        planSidebarDraftFragmentRemoval(current, fragmentId, now()))}
      onNewConversationPromptSuggestionSelect={(suggestion) => update(draft.draftId, (current) =>
        planSidebarDraftSuggestionSelection(current, suggestion, now()))}
      onSubmitNewConversation={() => void props.sessions.sidebarDrafts.submitDraft(draft.draftId)}
      onAddNewConversationProject={() => void props.actions.addProject(
        props.projects.map((candidate) => candidate.projectId),
      )}
    />
  );
}

function SidebarSessionConversation(
  props: SidebarConversationViewProps & { view: OperatorSubSessionView },
): JSX.Element {
  const { view } = props;
  const conversationProject = props.projects.find((candidate) =>
    candidate.projectId === view.session.projectId) ?? props.project;
  const analysis = props.conversations.analysisNavigation;
  const messages = props.sessions.sidebarMessages;
  const runs = props.sessions.runs;
  return (
    <OperatorConsole
      presentation="conversation"
      project={conversationProject}
      projects={props.projects}
      selectedProjectId={view.session.projectId}
      selectedSessionId={view.session.sessionId}
      selectedSession={view.session}
      analysisPanel={{
        open: analysis.openBySession[view.session.sessionId] === true,
        state: { status: "ready", entries: analysis.entriesFor(view.session.sessionId) },
        onOpenChange: (open) => analysis.setPanelOpen(view.session.sessionId, open),
        onOpenEntry: (entry) => analysis.openEntry(view.session.sessionId, entry),
      }}
      messages={view.messages}
      pendingDispatchMessages={view.pendingDispatchMessages ?? []}
      initialReadingMessageId={props.readReadingMessageId(view.session.sessionId)}
      messageNavigationRequest={analysis.messageNavigation?.sessionId === view.session.sessionId
        ? {
            messageId: analysis.messageNavigation.messageId,
            requestId: analysis.messageNavigation.requestId,
          }
        : null}
      onMessageNavigationHandled={analysis.handleMessageNavigation}
      onReadingMessageChange={props.writeReadingMessageId}
      pendingPrimaryMessages={view.pendingPrimaryMessages ?? []}
      memberIdentities={view.memberIdentities ?? []}
      activeRun={view.activeRun}
      activeRuns={view.activeRuns ?? (view.activeRun === null ? [] : [view.activeRun])}
      workspaceDiff={view.workspaceDiff ?? { available: false, fileCount: null, reason: "unavailable" }}
      composerValue={props.readComposerValue(view.session.sessionId)}
      executionRegistryState={props.executionRegistryState}
      onReloadExecutionRegistry={props.reloadExecutionRegistry}
      composerAttachments={props.attachments.attachments}
      agentTeamsState={props.agentTeams.state}
      conversationAgentTeamKey={view.session.agentTeamOwnership != null && view.session.agentTeamId != null
        ? `${view.session.agentTeamOwnership}:${view.session.agentTeamId}`
        : null}
      isSending={props.sessions.sidebarDrafts.sendingId === view.session.sessionId}
      onComposerChange={(value) => props.writeComposerValue(view.session.sessionId, value)}
      onComposerFilesAdded={props.attachments.addFiles}
      onComposerAttachmentRemove={props.attachments.remove}
      onComposerAttachmentRetry={props.attachments.retry}
      onSend={() => void messages.sendMessage(view.session.sessionId)}
      onSelectSession={() => undefined}
      onInterrupt={(sessionId, runId) => void runs.interruptSubSession(sessionId, runId)}
      onRetryRun={runs.retryRun}
      onRetryPendingMessage={(sessionId, messageId) => void messages.retryPendingMessage(sessionId, messageId)}
      onEditPendingMessage={(sessionId, messageId, body) => void messages.editPendingMessage(sessionId, messageId, body)}
      onRemovePendingMessage={(sessionId, messageId) => void messages.removePendingMessage(sessionId, messageId)}
      onAnalyzeConversation={(input) => void props.conversations.analysis.analyze({ kind: "message", ...input })}
      onOpenConversationReference={analysis.openReference}
      onChangeSessionWorkspace={props.actions.changeSessionWorkspace}
      onChangeSessionTeam={(sessionId, team) => props.actions.changeSessionTeam(sessionId, {
        ownership: team.ownership,
        id: team.id,
      })}
      onOpenEvidence={props.openEvidence}
      onLoadWorkspaceDiff={props.rightSidebar.files.readWorkspaceDiff}
      onLoadProjectFiles={props.rightSidebar.files.readProjectFiles}
      onLoadProjectFile={props.rightSidebar.files.readProjectFile}
      onLoadWorkspaceDiffFile={props.rightSidebar.files.readWorkspaceDiffFile}
      onLoadFileReference={props.rightSidebar.files.readFileReference}
    />
  );
}
