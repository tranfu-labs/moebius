import {
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  Ellipsis,
  FileText,
  LoaderCircle,
  MessagesSquare,
  PanelLeft,
  PanelLeftClose,
  PanelRight,
  PanelRightClose,
  Plus,
  CircleCheck,
  CircleHelp,
  Copy,
  RefreshCw,
  Search,
  Settings,
  Trash2,
  UsersRound,
} from "lucide-react";
import { useVirtualizer } from "@tanstack/react-virtual";
import type { LucideIcon } from "lucide-react";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  Profiler,
  type PointerEvent as ReactPointerEvent,
  type ProfilerOnRenderCallback,
  type ReactNode,
  type Ref,
  type SyntheticEvent,
} from "react";

import {
  ANALYSIS_PANEL_SPLIT_MIN_WIDTH_PX,
  AnalysisPanel,
  type AnalysisPanelEntry,
  type AnalysisPanelState,
} from "@/console/analysis-panel";
import {
  type AgentExecutionProfile,
  type AgentExecutionProfileDocument,
  type AgentExecutionProviderProfile,
  type AgentTeamDetailState,
  type AgentTeamSaveAllFailureView,
} from "@/console/agent-team-detail";
import type { ExecutionRegistryState, RegistryProviderProfile } from "@/console/execution-profile-registry";
import { MoebiusLogo } from "@/brand/moebius-logo";
import { I18nProvider, translate, useI18n, type Locale, type Translate } from "@/i18n";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/ui/dropdown-menu";
import {
  AgentTeamsPage,
  type AgentTeamBuilderController,
  type AgentTeamInformationInput,
  type GithubTeamUpstreamCheckView,
  type GithubTeamUpstreamSyncOutcome,
  type OperatorAgentTeam,
  type OperatorAgentTeamsState,
} from "@/console/agent-teams-page";
import { GithubTeamDiscoveryPage, GithubTeamPreviewPage, type GithubTeamConsoleController } from "@/console/github-team-pages";
import { type PortraitId } from "@/console/agent-portrait";
import { ConversationEmptyState } from "@/console/conversation-empty-state";
import { ConversationRelayRail } from "@/console/conversation-relay-rail";
import {
  projectConversationRelayEvents,
  type ConversationRelayEvent,
} from "@/console/conversation-relay-rail-model";
import {
  MAIN_CONVERSATION_COLUMN_GUTTER_CLASS,
  MAIN_CONVERSATION_COLUMN_WIDTH_CLASS,
  planConversationMessageReveal,
  planConversationReadingRestore,
  planConversationRelayClearance,
} from "@/console/conversation-layout";
import { buildConversationImageGallery } from "@/console/conversation-image-gallery";
import type { ConversationImageDialogItem } from "@/console/conversation-image-dialog";
import { ComposerContext } from "@/console/composer-context";
import { ChangeTab, type WorkspaceDiffData } from "@/console/change-tab";
import { ManagedProcessPanel, type ManagedProcessPanelController } from "@/console/managed-process-panel";
import type { WorkspaceFileContent } from "@/console/file-diff-view";
import {
  FileReferenceTab,
  type FileReferenceContent,
} from "@/console/file-reference-tab";
import { decideInitialFileViewMode } from "@/console/file-view-state";
import type {
  MarkdownConversationReference,
  MarkdownFileReference,
} from "@/console/markdown-internal-reference";
import { NewConversationPage } from "@/console/new-conversation-page";
import { ProjectFilesTab, type ProjectFilesData } from "@/console/project-files-tab";
import {
  ProcessTab,
  nextProcessTabTitle,
  type OperatorProcessOutputState,
} from "@/console/process-tab";
import type { OperatorProcessInvocationState } from "@/console/process-event";
import {
  resolveOperatorMemberEngine,
  resolveOperatorMemberPortrait,
  resolveOperatorMemberName,
  type OperatorMemberIdentity,
} from "@/console/member-name";
import {
  ConversationSidebar,
  type ConversationSidebarProject,
  type ConversationSidebarProps,
  type CopySessionLogPathResult,
} from "@/console/conversation-sidebar";
import { RoleComposer, type RoleCompletion } from "@/console/role-composer";
import { RoleTag } from "@/console/role-tag";
import {
  SessionTeamUpdateDetailDialog,
  type SessionTeamUpdateDetailView,
} from "@/console/session-team-update-detail-dialog";
import {
  SessionTeamUpdateNotice,
  type SessionTeamUpdateCategoryKind,
  type SessionTeamUpdateViewState,
} from "@/console/session-team-update-notice";
import { AgentRunInfoPopover, type AgentRunInfoView } from "@/console/agent-run-info-popover";
import {
  operatorConsoleAppearanceClassName,
  operatorFloatingSurfaceClassName,
  type OperatorConsoleAppearance,
} from "@/console/operator-console-appearance";
import {
  SettingsDialog,
  type DefaultAgentSettingsState,
  type LanguageSaveStatus,
  type SettingsAboutState,
  type SettingsSection,
  type TaskReminderSettingsController,
} from "@/console/settings-dialog";
import type { ProviderSettingsController } from "@/console/provider-settings-panel";
import { NotificationPermissionDialog } from "@/console/notification-permission-dialog";
import {
  StructuredAttachmentList,
  hasBlockingComposerAttachment,
  readyComposerAttachmentIds,
  type ComposerAttachment,
  type StructuredAttachment,
} from "@/console/structured-attachments";
import { ResultCard, shouldShowResultCard } from "@/console/result-card";
import { RunBlock } from "@/console/run-block";
import {
  type OperatorClaudeTerminalTraceState,
  type OperatorClaudeTerminalTraces,
} from "@/console/claude-terminal-surface";
import { RotateCcw } from "lucide-react";
import { MessageAction, MessageToolbar } from "@/console/message-toolbar";
import { IncidentNotice } from "@/console/incident-card";
import { ProcessTrail, type ProcessStep } from "@/console/process-trail";
import { stripLegacyOutcomeBoilerplate } from "@/console/legacy-run-outcome-copy";
import { MarkdownMessage } from "@/console/markdown-message";
import {
  RunOutcome,
  outcomeSeverity,
  resolveOutcomeDescriptionKey,
  resolveOutcomeLabelKey,
  type ProviderUnavailableKind,
  type RunOutcomeStatus,
} from "@/console/run-outcome";
import { RunCompletedAt, RunTime, RunTriggeredAt } from "@/console/run-time";
import { SubSessionCard, type SubSessionCardItem } from "@/console/sub-session-card";
import { SubtaskTab, type OperatorSubSessionViewState } from "@/console/subtask-tab";
import { getAgentTeamSelectionLabel } from "@/console/team-selection-label";
import {
  RightSidebar,
  type RightSidebarContentSlots,
} from "@/console/right-sidebar";
import { projectRightSidebarLayout } from "@/console/right-sidebar-layout";
import {
  createFileReferenceSourceKey,
  createRunOutputSourceKey,
  dedupeRunOutputTabsByStableStep,
  EMPTY_RIGHT_SIDEBAR_TABS,
  RIGHT_SIDEBAR_BUILTIN_TAB_TITLES,
  openRightSidebarSourceTab,
  parseFileReferenceSourceKey,
  updateRightSidebarFileMode,
  updateRightSidebarProjectFileMode,
  updateRightSidebarProcessScroll,
  parseRunOutputSourceKey,
  type RightSidebarTabsState,
} from "@/console/right-sidebar-tabs";
import {
  TextFragmentList,
  type ComposerTextFragment,
} from "@/console/text-fragment-list";
import { cn } from "@/lib/utils";
import { Button } from "@/ui/button";
import { Input } from "@/ui/input";
import { TooltipProvider } from "@/ui/tooltip";

export type { OperatorConsoleAppearance } from "@/console/operator-console-appearance";

export type OperatorMessageSpeaker = "user" | "agent" | "system";
export type OperatorMessageStatus =
  | "pending"
  | "running"
  | "completed"
  | "failed"
  | "interrupted"
  | "stuck"
  | "displayed";
export type OperatorSessionStatus =
  | "idle"
  | "running"
  | "waiting"
  | "stuck"
  | "failed"
  | "interrupted";
export type OperatorApplicationView = "conversation" | "agent-teams";
export type TeamSyncStatusView =
  | { kind: "syncing"; teamNames: readonly string[] }
  | { kind: "updated" };
export type OperatorProjectListState = "ready" | "loading" | "error";
export type OperatorApplicationOverlay = { kind: "search" };

export const DEFAULT_SIDEBAR_WIDTH_PX = 252;
export const MIN_SIDEBAR_WIDTH_PX = 220;
export const MAX_SIDEBAR_WIDTH_PX = 360;
export const NARROW_WINDOW_WIDTH_PX = 760;
export const STACKED_TEAM_ROW_WINDOW_WIDTH_PX = 1024;
export const CONVERSATION_DOCK_GAP_PX = 12;
const INITIAL_CONVERSATION_DOCK_HEIGHT_PX = 176;
const TIMELINE_FOLLOW_THRESHOLD_PX = 48;
interface SidebarResizeGesture {
  pointerId: number;
  startX: number;
  startWidth: number;
}

type ConversationRouteAction = () => boolean | void | Promise<boolean | void>;

function isPromiseLike(value: unknown): value is PromiseLike<boolean | void> {
  return typeof value === "object"
    && value !== null
    && "then" in value
    && typeof value.then === "function";
}

export interface OperatorSession {
  sessionId: string;
  projectId: string;
  parentSessionId?: string | null;
  analysisParentSessionId?: string | null;
  originSessionId?: string | null;
  entryTemplate?: "session-analysis" | null;
  writePolicy?: "normal" | "confirm-current-plan-before-write";
  agentTeamOwnership?: "system" | "user" | null;
  agentTeamId?: string | null;
  agentTeamHealth?: "usable" | "deleted" | "needs-repair" | null;
  agentTeamHealthReason?: string | null;
  agentTeamPendingOwnership?: "system" | "user" | null;
  agentTeamPendingId?: string | null;
  agentTeamSnapshot?: OperatorAgentTeamSnapshotSummary | null;
  agentTeamPendingSnapshot?: OperatorAgentTeamSnapshotSummary | null;
  analysisRecordAvailable?: boolean;
  workspaceMode: "direct" | "worktree";
  workspacePendingMode: "direct" | "worktree" | null;
  workspaceUnavailableReason?: string | null;
  branchName?: string | null;
  title: string;
  titleRevision?: number;
  pinnedAt?: string | null;
  manualUnreadAt?: string | null;
  manualUnreadRequiresLeave?: boolean;
  readStateRevision?: number;
  attentionRevision?: number;
  attentionAcknowledgedRevision?: number;
  hasUnacknowledgedAttention?: boolean;
  statusDot?: "red" | "blue" | "blink" | "none";
  status: OperatorSessionStatus;
  awaitsHumanReason: "answer" | "confirmation" | "acceptance" | "exception" | null;
  unreadSince: string | null;
  unresolvedSystemEventKind?: "run-not-started" | "run-stuck" | "user-stopped" | "resume-unavailable" | "retry-exhausted" | "other" | null;
  hasPendingControlWork?: boolean;
  lastMessageMentionsAgent?: boolean;
  continuation?: {
    canContinue: boolean;
    kind: "available" | "project-unavailable" | "team-deleted" | "team-needs-repair";
    reason: string | null;
    recoveryAction: "repair-project" | "select-team" | "repair-or-select-team" | null;
  };
  runningCount: number;
  managedRunningCount?: number;
  waitingCount: number;
  stuckCount: number;
  errorCount: number;
  interruptedCount: number;
  /** Round state projection (derived by local-console; single source for sidebar dot and Dock). */
  roundState?: {
    kind: "not-started" | "in-progress" | "terminal";
    roundId: number;
    fact: {
      roundId: number;
      outcome: "completed" | "awaiting-user" | "no-new-content" | "silent-closeout";
      terminalMessageId: number | null;
      occurredAt: string;
    } | null;
    silentSince: string | null;
  } | null;
  childCount?: number;
  createdAt: string;
  updatedAt: string;
}

export interface OperatorAgentTeamSnapshotSummary {
  team: {
    ownership: "system" | "user";
    id: string;
    name: string | null;
    description: string | null;
    primaryAgentSlug: string | null;
    officialSourceName?: string | null;
    createdAt?: string | null;
  };
  members: Array<{ name: string; displayName: string | null; description: string | null }>;
  loadedAt: string | null;
}

export interface OperatorProject {
  projectId: string;
  sourceType: "local-folder";
  title: string;
  folderPath: string;
  worktreeMode: boolean;
  workspaceCwd: string | null;
  workspaceMode: "direct" | "worktree" | null;
  worktreePath: string | null;
  worktreeUnavailableReason: string | null;
  workspaceUpdatedAt: string | null;
  branchName?: string | null;
  isGitRepository?: boolean;
  directoryAvailable?: boolean;
  directoryUnavailableReason?: string | null;
  newConversationDisabledReason?: string | null;
  sessions: OperatorSession[];
  runningCount: number;
  managedRunningCount?: number;
  waitingCount: number;
  stuckCount: number;
  errorCount: number;
}

export type OperatorExecutionEngine = "codex" | "claude" | "kimi" | "pi";

export type OperatorExecutionProfile = {
  cli: "codex" | "claude" | "kimi";
  model: string;
  effort: string;
} | {
  cli: "pi";
  providerId: "deepseek";
  providerProfileId: string;
  model: string;
  effort: string;
};

function projectOperatorExecutionProfileEngine(
  profile: OperatorExecutionProfile | null | undefined,
): OperatorMemberIdentity["engine"] {
  if (profile === null || profile === undefined) return undefined;
  return profile.cli === "pi"
    ? { cli: profile.cli, providerId: profile.providerId }
    : { cli: profile.cli };
}

export interface OperatorMessage {
  id: number;
  /** Thinking and tool calls that produced this message; folded once it lands. */
  processSteps?: readonly ProcessStep[];
  sessionId: string;
  speaker: OperatorMessageSpeaker;
  role: string | null;
  body: string;
  status: OperatorMessageStatus;
  runId: string | null;
  runDir: string | null;
  error: string | null;
  systemEventKind?: "run-not-started" | "run-stuck" | "user-stopped" | "resume-unavailable" | "retry-exhausted" | "other";
  terminal?: {
    kind: "interrupted" | "timeout" | "quota-exhausted" | "rate-limited" | "auth" | "crashed";
    subkind: string | null;
    safeCode: string | null;
    retryable: boolean | null;
    partialMarkdown: string;
    contentIncomplete: true;
    actualProfile: OperatorExecutionProfile | null;
  } | null;
  sourceKind?: string | null;
  sourceId?: string | null;
  runTiming?: {
    stepId: string;
    attempt: number;
    createdAt: string;
    startedAt: string | null;
    elapsedMs: number | null;
    completedAt: string | null;
    status: "created" | "running" | "completed" | "failed" | "interrupted" | "stuck" | "paused";
    engine: OperatorExecutionEngine;
    processOutputAvailable: boolean;
  } | null;
  createdAt: string;
  updatedAt: string;
  attachments?: StructuredAttachment[];
  textFragments?: ComposerTextFragment[];
}

export type OperatorChildSessionSummary = SubSessionCardItem;

export interface OperatorPendingDispatch {
  message: OperatorMessage;
  targetLane: "primary" | "worker" | "awaiting-team";
  targetRole: string | null;
  waitingForTeam: boolean;
  targetUnavailable?: boolean;
}

export interface OperatorSubSessionView {
  session: OperatorSession;
  messages: OperatorMessage[];
  pendingDispatchMessages?: OperatorPendingDispatch[];
  pendingPrimaryMessages?: OperatorMessage[];
  memberIdentities?: OperatorMemberIdentity[];
  activeRun: OperatorRunSnapshot | null;
  activeRuns?: OperatorRunSnapshot[];
  workspaceDiff?: OperatorWorkspaceDiffSummary;
}

export type OperatorEvidenceOpenIntent =
  | { kind: "workspace-diff"; sessionId: string; fileCount: number }
  | {
      kind: "run-output";
      sessionId: string;
      runId: string;
      stepId: string | null;
      role: string | null;
      fallbackOutput: string | null;
    };

export interface OperatorEvidenceView {
  kind: OperatorEvidenceOpenIntent["kind"];
  title: string;
  content: string;
}

export type OperatorWorkspaceDiffSummary =
  | { available: true; fileCount: number; reason: null }
  | { available: false; fileCount: null; reason: string };

export interface OperatorRunSnapshot {
  sessionId: string;
  runId: string;
  role: string | null;
  status: "running";
  createdAt?: string;
  startedAt: string | null;
  elapsedMs: number | null;
  stepId?: string;
  attempt?: number;
  engine?: OperatorExecutionEngine;
  /** Exact profile for this live run; optional for older state projections. */
  profile?: OperatorExecutionProfile | null;
  processOutputAvailable?: boolean;
  activity?: {
    cursor: number;
    kind: "command" | "tool" | "search" | "read" | "edit" | "progress";
    phase: "running" | "completed";
    action: string;
    object: string | null;
    /** Safe object for the always-visible activity line; falls back to `object`. */
    lineObject?: string | null;
    occurredAt: string;
  } | null;
  runDir: string | null;
  cwd: string | null;
  workspaceMode: "direct" | "worktree" | null;
  worktreeUnavailableReason: string | null;
  stdoutTail: string | null;
  stderrTail: string | null;
  liveMarkdown: string | null;
  /** Activity the runtime accumulated for this run; mapped by activityStepsToProcessSteps. */
  activitySteps?: readonly {
    kind: "command" | "tool" | "search" | "read" | "edit" | "thinking" | "progress";
    phase: "running" | "completed";
    action: string;
    object: string | null;
    occurredAt: string;
    lineObject?: string | null;
    callId?: string | null;
    input?: string | null;
    output?: string | null;
    outputRemainingLines?: number;
    error?: string | null;
  }[];
  processSteps?: readonly ProcessStep[];
  lastOutputSummary: string;
  tailDiagnostic: string | null;
  interruptible: boolean;
}

export interface OperatorNewConversationState {
  selectedProjectId: string | null;
  selectedWorkspaceMode: "direct" | "worktree";
  selectedTeamKey: string | null;
  draft: string;
  isSubmitting: boolean;
  error: string | null;
  textFragments?: ComposerTextFragment[];
  promptSuggestions?: Array<{ id: string; label: string; prompt: string }>;
}

export interface OperatorEditAndResendTarget {
  stoppedMessageId: number;
  sessionId: string;
  runId: string | null;
}

export interface OperatorAnalysisPanelController {
  open: boolean;
  state: AnalysisPanelState;
  onOpenChange(open: boolean): void;
  onOpenEntry(entry: AnalysisPanelEntry): void;
  onRetry?: () => void;
}

export interface OperatorMessageNavigationRequest {
  messageId: number;
  requestId: number;
}

function planPermissionModalOpenStatus(
  phase: import("@/console/settings-dialog").TaskReminderSettingsController["modal"]["phase"],
): import("@/console/notification-permission-dialog").PermissionModalOpenSettingsStatus {
  switch (phase) {
    case "requesting":
      return "requesting";
    case "request-done":
      return "request-done";
    case "opening-settings":
      return "opening";
    case "opened":
      return "opened";
    case "failed":
      return "failed";
    default:
      return "idle";
  }
}

function planPermissionModalCloseSave(
  phase: import("@/console/settings-dialog").TaskReminderSettingsController["modal"]["phase"],
): import("@/console/notification-permission-dialog").PermissionModalCloseSaveStatus {
  return phase === "closing-save" ? "saving" : phase === "closing-save-failed" ? "failed" : "idle";
}

export interface OperatorConsoleProps {
  presentation?: "application" | "conversation";
  appearance?: OperatorConsoleAppearance;
  project: OperatorProject;
  projects?: OperatorProject[];
  selectedProjectId?: string;
  selectedSessionId: string;
  navigationSessionId?: string;
  selectedSession: OperatorSession | null;
  conversationNotice?: ReactNode;
  analysisPanel?: OperatorAnalysisPanelController;
  managedProcesses?: ManagedProcessPanelController;
  messages: OperatorMessage[];
  initialReadingMessageId?: number | null;
  messageNavigationRequest?: OperatorMessageNavigationRequest | null;
  onMessageNavigationHandled?: (requestId: number) => void;
  onReadingMessageChange?: (sessionId: string, messageId: number) => void;
  pendingDispatchMessages?: OperatorPendingDispatch[];
  pendingPrimaryMessages?: OperatorMessage[];
  childSessions?: OperatorChildSessionSummary[];
  memberIdentities?: readonly OperatorMemberIdentity[];
  openedSubSession?: OperatorSubSessionView | null;
  subSessionViews?: Readonly<Record<string, OperatorSubSessionViewState>>;
  subSessionComposerValue?: string;
  subSessionComposerAttachments?: readonly ComposerAttachment[];
  openedEvidence?: OperatorEvidenceView | null;
  activeRun: OperatorRunSnapshot | null;
  activeRuns?: OperatorRunSnapshot[];
  claudeTerminalTraces?: OperatorClaudeTerminalTraces;
  workspaceDiff?: OperatorWorkspaceDiffSummary;
  composerValue: string;
  composerAttachments?: readonly ComposerAttachment[];
  composerSubmissionBlockReason?: string | null;
  sqlitePath?: string;
  projectListState?: OperatorProjectListState;
  agentTeamsState?: OperatorAgentTeamsState;
  lastUsedAgentTeamKey?: string | null;
  conversationAgentTeamKey?: string | null;
  sessionTeamUpdate?: SessionTeamUpdateViewState;
  sessionTeamUpdateDetailView?: SessionTeamUpdateDetailView | null;
  onApplySessionTeamUpdate?: () => void;
  onRetrySessionTeamUpdate?: () => void;
  onCancelSessionTeamUpdate?: () => void;
  onViewSessionTeamUpdate?: (kind: SessionTeamUpdateCategoryKind) => void;
  onDismissSessionTeamUpdateCategory?: (kind: SessionTeamUpdateCategoryKind) => void;
  selectedAgentTeamKey?: string | null;
  openAgentTeamKey?: string | null;
  selectedAgentTeamMemberSlug?: string | null;
  agentTeamDetailState?: AgentTeamDetailState | null;
  agentTeamBuilder?: AgentTeamBuilderController;
  githubTeams?: GithubTeamConsoleController;
  onOpenUpstreamRepository?: (teamKey: string, repository: string) => void;
  onDetachUpstream?: (teamKey: string) => void;
  onRetryUpstream?: (teamKey: string) => Promise<GithubTeamUpstreamCheckView>;
  onSyncUpstream?: (teamKey: string) => Promise<GithubTeamUpstreamSyncOutcome>;
  onRevertUpstream?: (teamKey: string) => Promise<"reverted" | "none">;
  newConversation?: OperatorNewConversationState | null;
  activeCliInstallations?: Array<"codex" | "claude" | "kimi">;
  executionRegistryState?: ExecutionRegistryState;
  onReloadExecutionRegistry?: () => void;
  activeLocale?: Locale;
  pendingLocale?: Locale | null;
  languageSaveStatus?: LanguageSaveStatus;
  settingsAbout?: SettingsAboutState;
  providerSettings?: ProviderSettingsController;
  defaultAgent?: DefaultAgentSettingsState;
  defaultAgentProviderProfiles?: readonly AgentExecutionProviderProfile[];
  taskReminder?: TaskReminderSettingsController;
  settingsExternalLinks?: {
    releaseNotes: string;
    feedback: string;
    repository: string;
  };
  onSelectLocale?: (locale: Locale) => void;
  onRetryLocaleSave?: () => void;
  onSaveDefaultAgent?: (profile: AgentExecutionProfile) => void | Promise<void>;
  onCheckSettingsUpdates?: () => void;
  onInstallUpdate?: () => void;
  teamSyncStatus?: TeamSyncStatusView | null;
  onDismissTeamSyncStatus?: () => void;
  onCopySettingsVersion?: () => void;
  onOpenSettingsExternalLink?: (url: string) => Promise<void>;
  renderSearchOverlay?: (onClose: () => void) => ReactNode;
  onComposerChange(value: string): void;
  onComposerFilesAdded?: (files: File[]) => void;
  onComposerAttachmentRemove?: (clientId: string) => void;
  onComposerAttachmentRetry?: (clientId: string) => void;
  onSend(): void;
  onStartNewConversation?: (projectId?: string) => void;
  onNewConversationProjectChange?: (projectId: string) => void;
  onNewConversationWorkspaceChange?: (workspaceMode: "direct" | "worktree") => void;
  onNewConversationTeamChange?: (teamKey: string) => void;
  onNewConversationDraftChange?: (value: string) => void;
  onNewConversationTextFragmentRemove?: (fragmentId: string) => void;
  onNewConversationPromptSuggestionSelect?: (suggestion: {
    id: string;
    label: string;
    prompt: string;
  }) => void;
  onSubmitNewConversation?: () => void;
  onAddNewConversationProject?: () => void;
  onReorderProjects?: (projectIds: string[]) => boolean | void | Promise<boolean | void>;
  onChangeSessionWorkspace?: (sessionId: string, workspaceMode: "direct" | "worktree") => void;
  onChangeSessionTeam?: (sessionId: string, team: OperatorAgentTeam) => void;
  onSelectSession(selection: { sessionId: string; projectId: string }): void;
  onOpenSubSession?: (sessionId: string) => void;
  onCloseSubSession?: () => void;
  onSubSessionComposerChange?: (sessionId: string, value: string) => void;
  onSubSessionComposerFilesAdded?: (files: File[]) => void;
  onSubSessionComposerAttachmentRemove?: (clientId: string) => void;
  onSubSessionComposerAttachmentRetry?: (clientId: string) => void;
  onSubSessionSend?: (sessionId: string) => void;
  onSubSessionRetry?: (
    sessionId: string,
    runId: string,
    executionOverride?: OperatorExecutionProfile,
  ) => void | Promise<void>;
  onSubSessionInterrupt?: (sessionId: string, runId: string) => void;
  onOpenEvidence?: (intent: OperatorEvidenceOpenIntent) => void;
  onCloseEvidence?: () => void;
  onLoadWorkspaceDiff?: (sessionId: string) => Promise<WorkspaceDiffData>;
  onLoadProjectFiles?: (sessionId: string) => Promise<ProjectFilesData>;
  onLoadProjectFile?: (sessionId: string, filePath: string) => Promise<WorkspaceFileContent>;
  onLoadWorkspaceDiffFile?: (sessionId: string, filePath: string) => Promise<WorkspaceFileContent>;
  onLoadFileReference?: (
    sessionId: string,
    filePath: string,
    line: number,
    column: number | null,
    hasExplicitLine: boolean,
  ) => Promise<FileReferenceContent>;
  onChangeSessionProject?: (sessionId: string, projectId: string) => void;
  onShowProjectInFolder?: (folderPath: string) => void | Promise<void>;
  onRenameProject?: (projectId: string, title: string) => void | Promise<void>;
  onRemoveProject?: (projectId: string, force: boolean) => void | Promise<void>;
  onSelectFolderForRepair?: (projectId: string) => Promise<string | null>;
  onRepairProjectFolder?: (projectId: string, folderPath: string) => void | Promise<void>;
  onArchiveSession?: (sessionId: string, projectId: string) => void | Promise<void>;
  onCopySessionLogPath?: (sessionId: string, projectId: string) => Promise<CopySessionLogPathResult>;
  onUpdateSessionReadState?: ConversationSidebarProps["onUpdateReadState"];
  onSetSessionPinned?: ConversationSidebarProps["onSetSessionPinned"];
  onRenameSession?: ConversationSidebarProps["onRenameSession"];
  onInterrupt(sessionId: string, runId: string): void;
  onRetryRun?: (
    sessionId: string,
    runId: string,
    executionOverride?: OperatorExecutionProfile,
  ) => void | Promise<void>;
  onUpdateSessionMemberExecution?: (
    sessionId: string,
    memberName: string,
    action: "migrate" | "end",
    profile?: OperatorExecutionProfile,
  ) => void | Promise<void>;
  onRetryPendingMessage?: (sessionId: string, messageId: number) => void;
  onEditPendingMessage?: (sessionId: string, messageId: number, body: string) => void;
  onRemovePendingMessage?: (sessionId: string, messageId: number) => void;
  onAnalyzeSession?: (input: { sessionId: string; projectId: string }) => void;
  onAnalyzeConversation?: (input: {
    sessionId: string;
    runId: string | null;
    messageId: number | null;
  }) => void;
  onUpdateClaude?: () => void;
  onEditAndResend?: (target: OperatorEditAndResendTarget) => void;
  onReplayOnboarding?: () => void;
  onOpenExternalLink?: (url: string) => void;
  onOpenConversationReference?: (reference: MarkdownConversationReference) => void;
  onRetryProjectList?: () => void;
  onRetryAgentTeams?: () => void;
  onCreateAgentTeam?: (information: AgentTeamInformationInput) => Promise<OperatorAgentTeam>;
  onOpenAgentTeam?: (teamKey: string) => void;
  onOpenAgentTeamMember?: (teamKey: string, memberSlug: string) => void;
  onCloseAgentTeam?: () => void;
  onSelectAgentTeamMember?: (teamKey: string, memberSlug: string) => void;
  onChangeAgentTeamPrimaryAgent?: (teamKey: string, memberSlug: string) => void | Promise<void>;
  onReorderAgentTeamMembers?: (teamKey: string, memberSlugs: string[]) => void | Promise<void>;
  onChangeAgentTeamMemberPortrait?: (
    teamKey: string,
    memberSlug: string,
    portraitId: PortraitId | null,
  ) => void | Promise<void>;
  onChangeAgentTeamMemberIdentity?: (
    teamKey: string,
    memberSlug: string,
    identity: { displayName?: string; description?: string },
  ) => void;
  onAddAgentTeamMember?: (teamKey: string) => void | Promise<void>;
  onUpdateAgentTeamInformation?: (teamKey: string, information: AgentTeamInformationInput) => void | Promise<void>;
  onChangeAgentTeamMember?: (teamKey: string, memberSlug: string, agentMarkdown: string) => void;
  onSaveAgentTeamMember?: (teamKey: string, memberSlug: string) => void | Promise<void>;
  onCheckAgentTeamMemberExternalChange?: (teamKey: string, memberSlug: string) => void | Promise<void>;
  onLoadAgentTeamMemberExternalVersion?: (teamKey: string, memberSlug: string) => void;
  onOverwriteAgentTeamMemberExternalVersion?: (teamKey: string, memberSlug: string) => void | Promise<void>;
  onRetryAgentTeamMember?: (teamKey: string, memberSlug: string) => void;
  onDiscardAgentTeamMember?: (teamKey: string, memberSlug: string) => void;
  onDiscardAllAgentTeamDrafts?: (teamKey: string) => void;
  onSaveAllAgentTeamDrafts?: (teamKey: string) => Promise<{ failures: AgentTeamSaveAllFailureView[]; successCount?: number }>;
  onSaveAgentExecutionProfile?: (
    teamKey: string,
    memberSlug: string,
    profile: AgentExecutionProfile,
  ) => Promise<AgentExecutionProfileDocument>;
  onRestoreAgentRecommendedProfile?: (
    teamKey: string,
    memberSlug: string,
  ) => Promise<AgentExecutionProfileDocument>;
  onRestoreAgentTeamRevision?: (
    teamKey: string,
    memberSlug: string,
    revisionId: string,
  ) => Promise<{ agentMarkdown: string } | null> | void;
  onRevertAgentTeamOfficialSync?: (teamKey: string) => void | Promise<void>;
  onRetryAgentTeamOfficialSync?: (teamKey: string) => void | Promise<void>;
  onDismissAgentTeamOfficialSyncBanner?: (teamKey: string) => void;
  onDuplicateBuiltInAgentTeam?: (teamKey: string) => Promise<string>;
  onRecheckAgentTeam?: (teamKey: string) => void | Promise<void>;
  onRelocateAgentTeam?: (teamKey: string) => void | Promise<void>;
  onRemoveAgentTeamRecord?: (teamKey: string) => void | Promise<void>;
  agentTeamFileManagerLabel?: string;
  onOpenAgentTeamLocation?: (teamKey: string, memberSlug?: string) => void | Promise<void>;
  onDuplicateUserAgentTeam?: (teamKey: string) => Promise<string>;
  onDuplicateAgentTeamMember?: (teamKey: string, memberSlug: string) => void | Promise<void>;
  onTrashAgentTeamMember?: (teamKey: string, memberSlug: string) => void | Promise<void>;
  onTrashUserAgentTeam?: (teamKey: string) => void | Promise<void>;
  onViewAgentTeamRegistrationConflict?: () => void;
  onShowAgentTeamRegistrationConflictLocation?: () => void | Promise<void>;
  onPreserveAgentTeamRegistrationConflicts?: () => void | Promise<void>;
  isSending?: boolean;
  isSubSessionSending?: boolean;
  isSelectionMutationPending?: boolean;
  isSessionProjectUpdating?: boolean;
  isProjectMutationPending?: boolean;
  sidebarOpen?: boolean;
  onSidebarOpenChange?: (open: boolean) => void;
  rightSidebarOpen?: boolean;
  rightSidebarWidth?: number | null;
  rightSidebarTabs?: RightSidebarTabsState;
  rightSidebarFocusTabId?: string | null;
  onRightSidebarFocusHandled?: (tabId: string) => void;
  rightSidebarTabDiscriminators?: Readonly<Record<string, string>>;
  rightSidebarUpdatingTabIds?: readonly string[];
  onRetryRightSidebarTitles?: () => void;
  rightSidebarContentSlots?: RightSidebarContentSlots;
  processOutputs?: Readonly<Record<string, OperatorProcessOutputState>>;
  processInvocationStates?: Readonly<Record<string, OperatorProcessInvocationState>>;
  onLoadProcessInvocation?: (sessionId: string, runId: string) => void;
  onLoadRunAgentInfo?: (input: { sessionId: string; runId: string; signal: AbortSignal }) => Promise<AgentRunInfoView>;
  onRightSidebarOpenChange?: (open: boolean) => void;
  onRightSidebarWidthChange?: (width: number) => void;
  onRightSidebarTabsChange?: (state: RightSidebarTabsState) => void;
  onBeforeCloseRightSidebarTab?: (tab: import("@/console/right-sidebar-tabs").RightSidebarTab) => boolean;
  onLoadProcessOutputPrevious?: (sourceKey: string, cursor: string) => void;
  className?: string;
}

const FOCUSED_THREE_PANE_MIN_WIDTH_PX = 1200;

/**
 * Desktop shell wrapper that keeps the focused workspace on the main conversation
 * when a window first crosses into compact mode. The right workspace remains
 * available from its toggle instead of replacing the main conversation by default.
 */
export function ResponsiveOperatorConsole(props: OperatorConsoleProps): ReactNode {
  const [compact, setCompact] = useState(() => typeof window !== "undefined"
    && window.innerWidth < FOCUSED_THREE_PANE_MIN_WIDTH_PX);
  const [wideRightSidebarOpen, setWideRightSidebarOpen] = useState(props.rightSidebarOpen ?? false);
  const [compactRightSidebarOpen, setCompactRightSidebarOpen] = useState(false);

  useLayoutEffect(() => {
    const media = typeof window.matchMedia === "function"
      ? window.matchMedia(`(max-width: ${String(FOCUSED_THREE_PANE_MIN_WIDTH_PX - 1)}px)`)
      : null;
    const update = (): void => {
      const nextCompact = media?.matches
        ?? window.innerWidth < FOCUSED_THREE_PANE_MIN_WIDTH_PX;
      setCompact(nextCompact);
      if (nextCompact) setCompactRightSidebarOpen(false);
    };
    update();
    media?.addEventListener("change", update);
    return () => media?.removeEventListener("change", update);
  }, []);

  useLayoutEffect(() => {
    setWideRightSidebarOpen(props.rightSidebarOpen ?? false);
  }, [props.rightSidebarOpen]);

  const effectiveRightSidebarOpen = compact
    ? compactRightSidebarOpen
    : wideRightSidebarOpen;

  return (
    <OperatorConsole
      {...props}
      rightSidebarOpen={effectiveRightSidebarOpen}
      onRightSidebarOpenChange={(open) => {
        if (compact) setCompactRightSidebarOpen(open);
        else setWideRightSidebarOpen(open);
        props.onRightSidebarOpenChange?.(open);
      }}
    />
  );
}

export function OperatorConsole({
  presentation = "application",
  appearance = "default",
  project,
  projects,
  selectedProjectId,
  selectedSessionId,
  navigationSessionId,
  selectedSession,
  conversationNotice,
  analysisPanel,
  managedProcesses,
  messages,
  initialReadingMessageId = null,
  messageNavigationRequest = null,
  onMessageNavigationHandled,
  onReadingMessageChange,
  pendingDispatchMessages,
  pendingPrimaryMessages = [],
  childSessions = [],
  memberIdentities = [],
  subSessionViews = {},
  subSessionComposerValue = "",
  subSessionComposerAttachments = [],
  activeRun,
  activeRuns,
  claudeTerminalTraces = [],
  workspaceDiff = { available: false, fileCount: null, reason: "unavailable" },
  composerValue,
  composerAttachments = [],
  composerSubmissionBlockReason = null,
  projectListState = "ready",
  agentTeamsState = { status: "loading" },
  lastUsedAgentTeamKey = null,
  conversationAgentTeamKey = null,
  sessionTeamUpdate = { status: "idle", categories: [] },
  sessionTeamUpdateDetailView = null,
  onApplySessionTeamUpdate,
  onRetrySessionTeamUpdate,
  onCancelSessionTeamUpdate,
  onViewSessionTeamUpdate,
  onDismissSessionTeamUpdateCategory,
  selectedAgentTeamKey,
  openAgentTeamKey,
  selectedAgentTeamMemberSlug,
  agentTeamDetailState,
  agentTeamBuilder,
  githubTeams,
  onOpenUpstreamRepository,
  onDetachUpstream,
  onRetryUpstream,
  onSyncUpstream,
  onRevertUpstream,
  newConversation = null,
  activeCliInstallations = [],
  executionRegistryState,
  onReloadExecutionRegistry,
  activeLocale = "zh-CN",
  pendingLocale = null,
  languageSaveStatus = "idle",
  settingsAbout,
  providerSettings,
  defaultAgent,
  defaultAgentProviderProfiles,
  taskReminder,
  settingsExternalLinks,
  onSelectLocale,
  onRetryLocaleSave,
  onSaveDefaultAgent,
  onCheckSettingsUpdates,
  onInstallUpdate,
  teamSyncStatus,
  onDismissTeamSyncStatus,
  onCopySettingsVersion,
  onOpenSettingsExternalLink,
  renderSearchOverlay,
  onComposerChange,
  onComposerFilesAdded,
  onComposerAttachmentRemove,
  onComposerAttachmentRetry,
  onSend,
  onStartNewConversation,
  onNewConversationProjectChange,
  onNewConversationWorkspaceChange,
  onNewConversationTeamChange,
  onNewConversationDraftChange,
  onNewConversationTextFragmentRemove,
  onNewConversationPromptSuggestionSelect,
  onSubmitNewConversation,
  onAddNewConversationProject,
  onReorderProjects,
  onChangeSessionWorkspace,
  onChangeSessionTeam,
  onSelectSession,
  onOpenSubSession,
  onCloseSubSession,
  onSubSessionComposerChange,
  onSubSessionComposerFilesAdded,
  onSubSessionComposerAttachmentRemove,
  onSubSessionComposerAttachmentRetry,
  onSubSessionSend,
  onSubSessionRetry,
  onSubSessionInterrupt,
  onOpenEvidence,
  onCloseEvidence,
  onLoadWorkspaceDiff = unavailableWorkspaceDiff,
  onLoadProjectFiles = unavailableProjectFiles,
  onLoadProjectFile = unavailableProjectFile,
  onLoadWorkspaceDiffFile = unavailableProjectFile,
  onLoadFileReference = unavailableFileReference,
  onChangeSessionProject,
  onShowProjectInFolder,
  onRenameProject,
  onRemoveProject,
  onSelectFolderForRepair,
  onRepairProjectFolder,
  onArchiveSession,
  onCopySessionLogPath,
  onUpdateSessionReadState,
  onSetSessionPinned,
  onRenameSession,
  onInterrupt,
  onRetryRun,
  onUpdateSessionMemberExecution,
  onRetryPendingMessage,
  onEditPendingMessage,
  onRemovePendingMessage,
  onAnalyzeSession,
  onAnalyzeConversation,
  onUpdateClaude,
  onEditAndResend,
  onReplayOnboarding,
  onOpenExternalLink,
  onOpenConversationReference,
  onRetryProjectList,
  onRetryAgentTeams,
  onCreateAgentTeam,
  onOpenAgentTeam,
  onOpenAgentTeamMember,
  onCloseAgentTeam,
  onSelectAgentTeamMember,
  onChangeAgentTeamPrimaryAgent,
  onReorderAgentTeamMembers,
  onChangeAgentTeamMemberPortrait,
  onChangeAgentTeamMemberIdentity,
  onAddAgentTeamMember,
  onUpdateAgentTeamInformation,
  onChangeAgentTeamMember,
  onSaveAgentTeamMember,
  onCheckAgentTeamMemberExternalChange,
  onLoadAgentTeamMemberExternalVersion,
  onOverwriteAgentTeamMemberExternalVersion,
  onRetryAgentTeamMember,
  onDiscardAgentTeamMember,
  onDiscardAllAgentTeamDrafts,
  onSaveAllAgentTeamDrafts,
  onSaveAgentExecutionProfile,
  onRestoreAgentRecommendedProfile,
  onRestoreAgentTeamRevision,
  onRevertAgentTeamOfficialSync,
  onRetryAgentTeamOfficialSync,
  onDismissAgentTeamOfficialSyncBanner,
  onDuplicateBuiltInAgentTeam,
  onRecheckAgentTeam,
  onRelocateAgentTeam,
  onRemoveAgentTeamRecord,
  agentTeamFileManagerLabel,
  onOpenAgentTeamLocation,
  onDuplicateUserAgentTeam,
  onDuplicateAgentTeamMember,
  onTrashAgentTeamMember,
  onTrashUserAgentTeam,
  onViewAgentTeamRegistrationConflict,
  onShowAgentTeamRegistrationConflictLocation,
  onPreserveAgentTeamRegistrationConflicts,
  isSending = false,
  isSubSessionSending = false,
  isSelectionMutationPending = false,
  isSessionProjectUpdating = false,
  isProjectMutationPending = false,
  sidebarOpen,
  onSidebarOpenChange,
  rightSidebarOpen,
  rightSidebarWidth,
  rightSidebarTabs,
  rightSidebarFocusTabId = null,
  onRightSidebarFocusHandled,
  rightSidebarTabDiscriminators,
  rightSidebarUpdatingTabIds,
  onRetryRightSidebarTitles,
  rightSidebarContentSlots,
  processOutputs = {},
  processInvocationStates = {},
  onLoadProcessInvocation,
  onLoadRunAgentInfo,
  onRightSidebarOpenChange,
  onRightSidebarWidthChange,
  onRightSidebarTabsChange,
  onBeforeCloseRightSidebarTab,
  onLoadProcessOutputPrevious,
  className,
}: OperatorConsoleProps): JSX.Element {
  const embeddedConversation = presentation === "conversation";
  const timelinePerfEnabled = typeof window !== "undefined"
    && new URLSearchParams(window.location.search).get("moebius-timeline-perf") === "1";
  const t: Translate = (key, values) => translate(activeLocale, key, values);
  const resolvedAgentTeamFileManagerLabel = agentTeamFileManagerLabel ?? t("console.operator.fileManager");
  const displayedActiveRuns = activeRuns ?? (activeRun === null ? [] : [activeRun]);
  const visiblePendingDispatches = pendingDispatchMessages
    ?? pendingPrimaryMessages.map((message) => ({
      message,
      targetLane: "primary" as const,
      targetRole: null,
      waitingForTeam: false,
      targetUnavailable: false,
    }));
  const [uncontrolledSidebarOpen, setUncontrolledSidebarOpen] = useState(true);
  const [sidebarWidth, setSidebarWidth] = useState(DEFAULT_SIDEBAR_WIDTH_PX);
  const [uncontrolledRightSidebarOpen, setUncontrolledRightSidebarOpen] = useState(false);
  const [uncontrolledRightSidebarWidth, setUncontrolledRightSidebarWidth] = useState<number | null>(null);
  const [uncontrolledRightSidebarTabs, setUncontrolledRightSidebarTabs] = useState<RightSidebarTabsState>(
    EMPTY_RIGHT_SIDEBAR_TABS,
  );
  const [editingPendingMessage, setEditingPendingMessage] = useState<{
    id: number;
    body: string;
  } | null>(null);
  const [focusedPendingExpanded, setFocusedPendingExpanded] = useState(false);
  const [isNarrowWindow, setIsNarrowWindow] = useState(() => viewportIsNarrow());
  const [narrowSidebarOpen, setNarrowSidebarOpen] = useState(false);
  const [layoutAnnouncement, setLayoutAnnouncement] = useState("");
  const [availableContentWidth, setAvailableContentWidth] = useState(() => typeof window === "undefined"
    ? 960
    : window.innerWidth);
  const [useStackedTeamRows, setUseStackedTeamRows] = useState(() => viewportUsesStackedTeamRows());
  const sidebarResizeGestureRef = useRef<SidebarResizeGesture | null>(null);
  const sidebarOpenButtonRef = useRef<HTMLButtonElement | null>(null);
  const sidebarCloseButtonRef = useRef<HTMLButtonElement | null>(null);
  const narrowSidebarWasOpenRef = useRef(false);
  const rightSidebarToggleRef = useRef<HTMLButtonElement | null>(null);
  const operatorMainRef = useRef<HTMLElement | null>(null);
  const nextRightSidebarTabIdRef = useRef(1);
  const timelineScrollRef = useRef<HTMLElement | null>(null);
  const followTimelineRef = useRef(true);
  const parentScrollTopRef = useRef(0);
  const parentConversationPaneRef = useRef<HTMLDivElement | null>(null);
  const conversationDockObserverRef = useRef<ResizeObserver | null>(null);
  const operatorContentShellRef = useRef<HTMLDivElement | null>(null);
  const timelineListRef = useRef<HTMLDivElement | null>(null);
  const conversationMessageRefs = useRef(new Map<number, HTMLElement>());
  const timelineReadingAnchorRef = useRef<{ messageId: number; offset: number } | null>(null);
  const timelineResizeAnchorLockedRef = useRef(false);
  const timelineResizeAdjustedScrollTopRef = useRef<number | null>(null);
  const timelineResizeFrameRef = useRef<number | null>(null);
  const timelineResizeInProgressRef = useRef(false);
  const restoredReadingSessionRef = useRef<string | null>(null);
  const readingRestoreLayoutRef = useRef<string | null>(null);
  const readingSessionIdentityRef = useRef(selectedSessionId);
  const suppressReadingScrollRef = useRef(false);
  const conversationFocusFrameRef = useRef<number | null>(null);
  const conversationHighlightTimerRef = useRef<number | null>(null);
  const handledMessageNavigationRequestRef = useRef<number | null>(null);
  const settingsTriggerRef = useRef<HTMLButtonElement | null>(null);
  const settingsOpenRef = useRef(false);
  const projectActionTriggerRef = useRef<HTMLButtonElement | null>(null);
  const previousLanguageSaveStatusRef = useRef(languageSaveStatus);
  const nextSettingsNotificationIdRef = useRef(1);
  const [conversationPaneWidth, setConversationPaneWidth] = useState(760);
  const [currentRelayEventId, setCurrentRelayEventId] = useState<string | null>(null);
  const [highlightedMessageId, setHighlightedMessageId] = useState<number | null>(null);
  const [relayFeedback, setRelayFeedback] = useState("");
  const [showJumpToBottom, setShowJumpToBottom] = useState(false);
  const [conversationDockHeight, setConversationDockHeight] = useState(
    INITIAL_CONVERSATION_DOCK_HEIGHT_PX,
  );
  const attachConversationDock = useCallback((dock: HTMLDivElement | null) => {
    conversationDockObserverRef.current?.disconnect();
    conversationDockObserverRef.current = null;
    if (dock === null) return;
    const update = () => {
      const nextHeight = Math.ceil(dock.getBoundingClientRect().height);
      if (nextHeight > 0) {
        setConversationDockHeight((current) => current === nextHeight ? current : nextHeight);
      }
    };
    update();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(update);
    observer.observe(dock);
    conversationDockObserverRef.current = observer;
  }, []);
  const conversationPaneWidthRef = useRef(conversationPaneWidth);
  const messageIndexById = useMemo(
    () => new Map(messages.map((message, index) => [message.id, index] as const)),
    [messages],
  );
  const timelineVirtualizer = useVirtualizer({
    count: messages.length,
    getScrollElement: () => timelineScrollRef.current,
    getItemKey: (index) => messages[index]?.id ?? index,
    estimateSize: () => 180,
    measureElement: (element) => element.getBoundingClientRect().height,
    overscan: 8,
    initialRect: { width: 760, height: 640 },
    scrollMargin: timelineListRef.current?.offsetTop ?? 0,
    anchorTo: "end",
    scrollEndThreshold: TIMELINE_FOLLOW_THRESHOLD_PX,
  });
  const virtualTimelineItems = timelineVirtualizer.getVirtualItems();
  const [applicationView, setApplicationView] = useState<OperatorApplicationView>("conversation");
  const [applicationOverlay, setApplicationOverlay] = useState<OperatorApplicationOverlay | null>(null);
  const [fileReferenceContents, setFileReferenceContents] = useState<Record<string, FileReferenceContent>>({});
  const selectedSessionIdRef = useRef(selectedSessionId);
  selectedSessionIdRef.current = selectedSessionId;
  const [pendingConversationRoute, setPendingConversationRoute] = useState<{
    run: ConversationRouteAction;
    cancel?: () => void;
  } | null>(null);
  const [conversationRouteConflictOpen, setConversationRouteConflictOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [sessionTeamUpdateDetailOpen, setSessionTeamUpdateDetailOpen] = useState(false);
  const [settingsSection, setSettingsSection] = useState<SettingsSection>("general");
  const [providerRecoveryTeamMenuOpen, setProviderRecoveryTeamMenuOpen] = useState(false);
  const [settingsExternalLinkStatus, setSettingsExternalLinkStatus] = useState<"idle" | "failed">("idle");
  const [settingsNotifications, setSettingsNotifications] = useState<Array<{
    id: number;
    section: SettingsSection;
    message: string;
  }>>([]);
  const [savingConversationRouteDrafts, setSavingConversationRouteDrafts] = useState(false);
  const [renameTarget, setRenameTarget] = useState<OperatorProject | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [runningRemovalTarget, setRunningRemovalTarget] = useState<OperatorProject | null>(null);
  const [removalRequest, setRemovalRequest] = useState<{ project: OperatorProject; force: boolean } | null>(null);
  const [repairRequest, setRepairRequest] = useState<{ project: OperatorProject; folderPath: string } | null>(null);
  const [repairPickerProjectId, setRepairPickerProjectId] = useState<string | null>(null);
  const [projectActionError, setProjectActionError] = useState<string | null>(null);
  const openProviderSettings = useCallback(() => {
    setSettingsSection("providers");
    setSettingsOpen(true);
  }, []);
  const visibleProjects = projects ?? [project];
  const activeProjectId = selectedProjectId ?? project.projectId;
  const activeProject = visibleProjects.find((item) => item.projectId === activeProjectId) ?? project;
  const activeProjectUnavailable = activeProject.directoryAvailable === false;
  const projectListUnavailable = projectListState !== "ready";
  const projectConfigurationPending = isProjectMutationPending;

  useEffect(() => {
    const previousStatus = previousLanguageSaveStatusRef.current;
    previousLanguageSaveStatusRef.current = languageSaveStatus;
    if (previousStatus !== "saving" || languageSaveStatus === "saving" || settingsOpenRef.current) {
      return;
    }
    const message = languageSaveStatus === "failed"
      ? t("settings.notification.languageFailed")
      : t("settings.notification.languageSaved");
    setSettingsNotifications((current) => [...current, {
      id: nextSettingsNotificationIdRef.current++,
      section: "general",
      message,
    }]);
  }, [activeLocale, languageSaveStatus]);

  const openSettingsExternalLink = (url: string | undefined): void => {
    if (url === undefined || onOpenSettingsExternalLink === undefined) {
      setSettingsExternalLinkStatus("failed");
      return;
    }
    setSettingsExternalLinkStatus("idle");
    void onOpenSettingsExternalLink(url).catch(() => {
      setSettingsExternalLinkStatus("failed");
    });
  };
  const sidebarProjects = visibleProjects.map((item) => toSidebarProject(item, t));
  const hasAgentTeamNeedingRepair = agentTeamsState.status === "ready"
    && agentTeamsState.teams.some((team) => team.status === "needs-repair");
  const catalogConversationAgentTeam = agentTeamsState.status === "ready"
    ? agentTeamsState.teams.find((team) => team.teamKey === conversationAgentTeamKey)
    : undefined;
  const conversationAgentTeam = selectedSession?.agentTeamSnapshot
    ? snapshotSummaryToOperatorTeam(selectedSession.agentTeamSnapshot)
    : catalogConversationAgentTeam;
  const pendingConversationAgentTeam = selectedSession?.agentTeamPendingSnapshot
    ? snapshotSummaryToOperatorTeam(selectedSession.agentTeamPendingSnapshot)
    : agentTeamsState.status === "ready"
    && selectedSession?.agentTeamPendingOwnership != null
    && selectedSession.agentTeamPendingId != null
    ? agentTeamsState.teams.find(
        (team) => team.teamKey === `${selectedSession.agentTeamPendingOwnership}:${selectedSession.agentTeamPendingId}`,
      )
    : undefined;
  const runtimeConversationAgentTeam: OperatorAgentTeam | undefined = conversationAgentTeam === undefined || selectedSession?.agentTeamHealth == null
    ? conversationAgentTeam
    : {
        ...conversationAgentTeam,
        status: selectedSession.agentTeamHealth === "usable" ? "usable" : "needs-repair",
        canCreateConversation: selectedSession.agentTeamHealth === "usable",
      };
  const displayedConversationAgentTeam = pendingConversationAgentTeam ?? runtimeConversationAgentTeam;
  const selectedAgentTeamUnavailable = selectedSession?.agentTeamHealth == null
    ? conversationAgentTeam?.status === "needs-repair"
    : selectedSession.agentTeamHealth === "needs-repair" || selectedSession.agentTeamHealth === "deleted";
  const continuationBlocked = selectedSession?.continuation?.canContinue === false;
  const canSend = (composerValue.trim() !== "" || readyComposerAttachmentIds(composerAttachments).length > 0)
    && !hasBlockingComposerAttachment(composerAttachments)
    && !isSending
    && composerSubmissionBlockReason === null
    && !isSelectionMutationPending
    && !isSessionProjectUpdating
    && !activeProjectUnavailable
    && !selectedAgentTeamUnavailable
    && !continuationBlocked;
  const emptyConversation = messages.length === 0 && displayedActiveRuns.length === 0;
  const analysisPanelLayout = conversationPaneWidth >= ANALYSIS_PANEL_SPLIT_MIN_WIDTH_PX
    ? "split"
    : "overlay";
  const analysisPanelReservesSpace = analysisPanel?.open === true && analysisPanelLayout === "split";
  const hasManagedProcesses = (managedProcesses?.state.items.length ?? 0) > 0;
  const analysisPanelId = selectedSession === null
    ? "conversation-analysis-panel"
    : `conversation-analysis-panel-${encodeURIComponent(selectedSession.sessionId)}`;
  const conversationRelayEvents = useMemo(
    () => projectConversationRelayEvents(
      messages,
      (role) => resolveOperatorMemberName(role, memberIdentities, t),
      t,
    ),
    [memberIdentities, messages, t],
  );
  const conversationImageGallery = useMemo(
    () => buildConversationImageGallery(messages, memberIdentities, t),
    [memberIdentities, messages, t],
  );
  const conversationRelayClearance = conversationRelayEvents.length === 0
    ? null
    : planConversationRelayClearance(conversationPaneWidth);
  const resultCardVisible = shouldShowResultCard({
    diffAvailable: workspaceDiff.available,
    isRunning: displayedActiveRuns.length > 0 || selectedSession?.status === "running" || (selectedSession?.runningCount ?? 0) > 0,
    lastMessageMentionsAgent: selectedSession?.lastMessageMentionsAgent === true,
    hasCompletedStep: messages.some((message) => message.speaker === "agent" || terminalOutcome(message) !== null),
    hasPendingWork: messages.some((message) => message.status === "pending" || message.status === "running"),
  });
  const requestedSidebarOpen = sidebarOpen ?? uncontrolledSidebarOpen;
  const sidebarAutoCollapsed = requestedSidebarOpen && isNarrowWindow && !narrowSidebarOpen;
  const effectiveSidebarOpen = !embeddedConversation
    && (isNarrowWindow ? narrowSidebarOpen : requestedSidebarOpen);
  const requestedRightSidebarOpen = rightSidebarOpen ?? uncontrolledRightSidebarOpen;
  const effectiveRightSidebarOpen = !embeddedConversation
    && applicationView === "conversation"
    && requestedRightSidebarOpen;
  const rightSidebarLayout = projectRightSidebarLayout(
    availableContentWidth,
    rightSidebarWidth === undefined ? uncontrolledRightSidebarWidth : rightSidebarWidth,
  );
  const rightSidebarIsOverlay = rightSidebarLayout.layout === "overlay";
  const effectiveRightSidebarWidth = rightSidebarLayout.width;
  const effectiveRightSidebarTabs = rightSidebarTabs ?? uncontrolledRightSidebarTabs;
  const latestRightSidebarTabsRef = useRef(effectiveRightSidebarTabs);
  latestRightSidebarTabsRef.current = effectiveRightSidebarTabs;
  const pendingFileReferenceOpensRef = useRef(0);
  const latestFileReferenceOpenGenerationRef = useRef(0);
  const fileReferenceSourceGenerationRef = useRef<Record<string, number>>({});
  const activeRightSidebarTab = effectiveRightSidebarTabs.tabs.find(
    (tab) => tab.id === effectiveRightSidebarTabs.activeTabId,
  ) ?? null;
  const openedSubSessionId = activeRightSidebarTab?.type === "sub-session"
    ? activeRightSidebarTab.sourceKey?.replace(/^sub-session:/u, "") ?? null
    : null;

  useEffect(() => {
    const updateResponsiveLayout = () => {
      const pane = parentConversationPaneRef.current;
      const paneWidth = pane === null
        ? conversationPaneWidthRef.current
        : Math.round(pane.getBoundingClientRect().width);
      if (paneWidth !== conversationPaneWidthRef.current) {
        conversationPaneWidthRef.current = paneWidth;
        timelineResizeInProgressRef.current = true;
        timelineResizeAnchorLockedRef.current = timelineReadingAnchorRef.current !== null
          && !followTimelineRef.current;
        timelineVirtualizer.shouldAdjustScrollPositionOnItemSizeChange = () => false;
        timelineScrollRef.current?.setAttribute("data-resize-anchoring", "true");
        setConversationPaneWidth(paneWidth);
      }
      setIsNarrowWindow(viewportIsNarrow());
      const shellWidth = operatorContentShellRef.current === null
        ? 0
        : Math.round(operatorContentShellRef.current.getBoundingClientRect().width);
      setAvailableContentWidth(shellWidth > 0
        ? shellWidth
        : Math.max(0, window.innerWidth - (effectiveSidebarOpen ? sidebarWidth : 0)));
      setUseStackedTeamRows(viewportUsesStackedTeamRows());
    };
    window.addEventListener("resize", updateResponsiveLayout);
    return () => window.removeEventListener("resize", updateResponsiveLayout);
  }, [effectiveSidebarOpen, sidebarWidth, timelineVirtualizer]);

  useLayoutEffect(() => {
    const shell = operatorContentShellRef.current;
    if (shell === null) return;
    const update = () => {
      const nextWidth = Math.round(shell.getBoundingClientRect().width);
      if (nextWidth > 0) {
        setAvailableContentWidth((current) => current === nextWidth ? current : nextWidth);
      }
    };
    update();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(update);
    observer.observe(shell);
    return () => observer.disconnect();
  }, [effectiveSidebarOpen]);

  useEffect(() => {
    setNarrowSidebarOpen(false);
  }, [isNarrowWindow]);

  useLayoutEffect(() => {
    if (narrowSidebarOpen) {
      narrowSidebarWasOpenRef.current = true;
      sidebarCloseButtonRef.current?.focus();
      return;
    }
    if (narrowSidebarWasOpenRef.current) {
      narrowSidebarWasOpenRef.current = false;
      sidebarOpenButtonRef.current?.focus();
    }
  }, [narrowSidebarOpen]);

  useLayoutEffect(() => {
    const pane = parentConversationPaneRef.current;
    if (pane === null) return;
    const update = () => {
      const nextWidth = Math.round(pane.getBoundingClientRect().width);
      if (nextWidth === conversationPaneWidthRef.current) return;
      conversationPaneWidthRef.current = nextWidth;
      timelineResizeInProgressRef.current = true;
      timelineResizeAnchorLockedRef.current = timelineReadingAnchorRef.current !== null
        && !followTimelineRef.current;
      timelineVirtualizer.shouldAdjustScrollPositionOnItemSizeChange = () => false;
      timelineScrollRef.current?.setAttribute("data-resize-anchoring", "true");
      setConversationPaneWidth(nextWidth);
    };
    update();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(update);
    observer.observe(pane);
    return () => observer.disconnect();
  }, [applicationView, newConversation, timelineVirtualizer]);

  useLayoutEffect(() => {
    if (!timelineResizeInProgressRef.current) return;
    if (followTimelineRef.current || timelineReadingAnchorRef.current === null) {
      timelineResizeInProgressRef.current = false;
      timelineResizeAnchorLockedRef.current = false;
      timelineResizeAdjustedScrollTopRef.current = null;
      timelineVirtualizer.shouldAdjustScrollPositionOnItemSizeChange = undefined;
      timelineScrollRef.current?.setAttribute("data-resize-anchoring", "false");
      return;
    }
    let cancelled = false;
    let stableFrames = 0;
    let frameCount = 0;
    const reconcileReadingAnchor = () => {
      if (cancelled) return;
      frameCount += 1;
      const timeline = timelineScrollRef.current;
      const anchor = timelineReadingAnchorRef.current;
      const element = anchor === null ? undefined : conversationMessageRefs.current.get(anchor.messageId);
      if (timeline !== null && anchor !== null && element?.isConnected) {
        const offset = element.getBoundingClientRect().top - timeline.getBoundingClientRect().top;
        const delta = offset - anchor.offset;
        if (Math.abs(delta) > 0.5) {
          const nextScrollTop = timeline.scrollTop + delta;
          timelineResizeAdjustedScrollTopRef.current = nextScrollTop;
          timeline.scrollTop = nextScrollTop;
          stableFrames = 0;
        } else {
          stableFrames += 1;
        }
      } else {
        stableFrames = 0;
      }
      if (stableFrames >= 8 || frameCount >= 60) {
        timelineResizeInProgressRef.current = false;
        timelineResizeAnchorLockedRef.current = false;
        timelineVirtualizer.shouldAdjustScrollPositionOnItemSizeChange = undefined;
        timeline?.setAttribute("data-resize-anchoring", "false");
        timelineResizeFrameRef.current = null;
        return;
      }
      timelineResizeFrameRef.current = window.requestAnimationFrame(reconcileReadingAnchor);
    };
    timelineResizeFrameRef.current = window.requestAnimationFrame(reconcileReadingAnchor);
    return () => {
      cancelled = true;
      if (timelineResizeFrameRef.current !== null) {
        window.cancelAnimationFrame(timelineResizeFrameRef.current);
        timelineResizeFrameRef.current = null;
      }
    };
  }, [conversationPaneWidth, timelineVirtualizer]);

  useEffect(() => () => {
    conversationDockObserverRef.current?.disconnect();
    conversationDockObserverRef.current = null;
    if (conversationFocusFrameRef.current !== null) {
      window.cancelAnimationFrame(conversationFocusFrameRef.current);
    }
    if (conversationHighlightTimerRef.current !== null) {
      window.clearTimeout(conversationHighlightTimerRef.current);
    }
    timelineResizeAnchorLockedRef.current = false;
    timelineResizeAdjustedScrollTopRef.current = null;
    if (timelineResizeFrameRef.current !== null) {
      window.cancelAnimationFrame(timelineResizeFrameRef.current);
    }
  }, []);

  const revealConversationMessage = useCallback((messageId: number): boolean => {
    const mountedTarget = conversationMessageRefs.current.get(messageId);
    if (mountedTarget !== undefined && !mountedTarget.isConnected) {
      if (mountedTarget.parentElement !== null) return false;
      conversationMessageRefs.current.delete(messageId);
    }
    const revealPlan = planConversationMessageReveal(
      [...messageIndexById.keys()],
      messageId,
      [...conversationMessageRefs.current.keys()],
    );
    if (revealPlan.kind === "not-found") return false;
    const reveal = () => {
      const target = conversationMessageRefs.current.get(messageId);
      if (target === undefined || !target.isConnected) return;
      target.scrollIntoView({ block: "center", behavior: "auto" });
      target.focus({ preventScroll: true });
    };
    if (revealPlan.kind === "mounted") {
      reveal();
      return true;
    }
    timelineVirtualizer.scrollToIndex(revealPlan.index, { align: "center" });
    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(reveal);
    });
    return true;
  }, [messageIndexById, timelineVirtualizer]);

  useLayoutEffect(() => {
    if (readingSessionIdentityRef.current === selectedSessionId) return;
    readingSessionIdentityRef.current = selectedSessionId;
    timelineReadingAnchorRef.current = null;
    timelineResizeAnchorLockedRef.current = false;
    timelineResizeAdjustedScrollTopRef.current = null;
    timelineResizeInProgressRef.current = false;
    timelineVirtualizer.shouldAdjustScrollPositionOnItemSizeChange = undefined;
    timelineScrollRef.current?.setAttribute("data-resize-anchoring", "false");
    timelineScrollRef.current?.removeAttribute("data-reading-anchor-message-id");
    restoredReadingSessionRef.current = null;
    readingRestoreLayoutRef.current = null;
    suppressReadingScrollRef.current = true;
  }, [selectedSessionId, timelineVirtualizer]);

  useLayoutEffect(() => {
    if (restoredReadingSessionRef.current === selectedSessionId) return;
    if (selectedSession?.sessionId !== selectedSessionId) return;
    if (conversationRelayEvents.length === 0) {
      setCurrentRelayEventId(null);
      return;
    }
    if (!messages.some((message) => message.sessionId === selectedSessionId)) return;
    const restorePlan = planConversationReadingRestore(
      conversationRelayEvents,
      initialReadingMessageId,
    );
    if (restorePlan.kind === "skip") return;
    const targetEvent = restorePlan.event;
    restoredReadingSessionRef.current = selectedSessionId;
    readingRestoreLayoutRef.current = selectedSessionId;
    suppressReadingScrollRef.current = false;
    setCurrentRelayEventId(targetEvent.id);
    onReadingMessageChange?.(selectedSessionId, targetEvent.messageId);

    const timeline = timelineScrollRef.current;
    const followsLatest = restorePlan.kind === "follow-latest";
    followTimelineRef.current = followsLatest;
    setShowJumpToBottom(!followsLatest);
    if (timeline === null) return;
    if (followsLatest) {
      if (messages.length > 0) {
        timelineVirtualizer.scrollToIndex(messages.length - 1, { align: "end" });
      }
      window.requestAnimationFrame(() => {
        const currentTimeline = timelineScrollRef.current;
        if (currentTimeline !== null) {
          currentTimeline.scrollTop = currentTimeline.scrollHeight;
        }
      });
      return;
    }
    revealConversationMessage(targetEvent.messageId);
  }, [
    conversationRelayEvents,
    initialReadingMessageId,
    messages.length,
    onReadingMessageChange,
    revealConversationMessage,
    selectedSession?.sessionId,
    selectedSessionId,
    timelineVirtualizer,
  ]);

  useLayoutEffect(() => {
    const timeline = timelineScrollRef.current;
    if (readingRestoreLayoutRef.current === selectedSessionId) {
      readingRestoreLayoutRef.current = null;
      return;
    }
    if (selectedSession?.sessionId !== selectedSessionId) return;
    if (timeline !== null && followTimelineRef.current) {
      if (messages.length > 0) {
        timelineVirtualizer.scrollToIndex(messages.length - 1, { align: "end" });
      }
      timeline.scrollTop = timeline.scrollHeight;
      const latestEvent = conversationRelayEvents.at(-1);
      if (latestEvent !== undefined) {
        setCurrentRelayEventId(latestEvent.id);
        onReadingMessageChange?.(selectedSessionId, latestEvent.messageId);
      }
    }
  }, [
    conversationDockHeight,
    conversationRelayEvents,
    messages.length,
    displayedActiveRuns.map((run) => `${run.runId}:${run.lastOutputSummary}:${run.liveMarkdown ?? ""}`).join("|"),
    onReadingMessageChange,
    selectedSession?.sessionId,
    selectedSessionId,
    timelineVirtualizer,
  ]);

  const locateConversationRelayEvent = useCallback((event: ConversationRelayEvent) => {
    const timeline = timelineScrollRef.current;
    if (timeline === null || !revealConversationMessage(event.messageId)) {
      followTimelineRef.current = false;
      setRelayFeedback(t("console.operator.relayNotFound"));
      return;
    }
    const latestEvent = conversationRelayEvents.at(-1);
    followTimelineRef.current = latestEvent?.id === event.id;
    setShowJumpToBottom(!followTimelineRef.current);
    setCurrentRelayEventId(event.id);
    onReadingMessageChange?.(selectedSessionId, event.messageId);
    setHighlightedMessageId(event.messageId);
    setRelayFeedback(t("console.operator.relayLocated"));
    if (conversationHighlightTimerRef.current !== null) {
      window.clearTimeout(conversationHighlightTimerRef.current);
    }
    conversationHighlightTimerRef.current = window.setTimeout(() => {
      setHighlightedMessageId(null);
    }, prefersReducedMotion() ? 700 : 1500);
  }, [conversationRelayEvents, onReadingMessageChange, revealConversationMessage, selectedSessionId, t]);

  useLayoutEffect(() => {
    if (messageNavigationRequest === null) return;
    if (handledMessageNavigationRequestRef.current === messageNavigationRequest.requestId) return;
    const targetEvent = conversationRelayEvents.find(
      (event) => event.messageId === messageNavigationRequest.messageId,
    );
    if (targetEvent === undefined) return;
    handledMessageNavigationRequestRef.current = messageNavigationRequest.requestId;
    locateConversationRelayEvent(targetEvent);
    onMessageNavigationHandled?.(messageNavigationRequest.requestId);
  }, [
    conversationRelayEvents,
    locateConversationRelayEvent,
    messageNavigationRequest,
    onMessageNavigationHandled,
  ]);

  const openSubSession = (sessionId: string) => {
    parentScrollTopRef.current = timelineScrollRef.current?.scrollTop ?? 0;
    const childSession = childSessions.find((session) => session.sessionId === sessionId);
    setRightSidebarOpen(true);
    updateRightSidebarTabs(openRightSidebarSourceTab(effectiveRightSidebarTabs, {
      id: createRightSidebarTabId(nextRightSidebarTabIdRef),
      type: "sub-session",
      title: childSession?.title ?? t("console.subtask.title"),
      sourceKey: `sub-session:${sessionId}`,
    }));
    onOpenSubSession?.(sessionId);
  };

  const openFileReference = (sessionId: string, reference: MarkdownFileReference) => {
    parentScrollTopRef.current = timelineScrollRef.current?.scrollTop ?? 0;
    const openingHostSessionId = selectedSessionId;
    const openGeneration = latestFileReferenceOpenGenerationRef.current + 1;
    latestFileReferenceOpenGenerationRef.current = openGeneration;
    pendingFileReferenceOpensRef.current += 1;
    setRightSidebarOpen(true);
    void onLoadFileReference(
      sessionId,
      reference.path,
      reference.line,
      reference.column,
      reference.hasExplicitLine,
    )
      .catch(() => unavailableFileReference(
        sessionId,
        reference.path,
        reference.line,
        reference.column,
        reference.hasExplicitLine,
      ))
      .then((content) => {
        if (selectedSessionIdRef.current !== openingHostSessionId) {
          return;
        }
        const canonicalReference = { ...reference, path: content.path };
        const sourceKey = createFileReferenceSourceKey(sessionId, canonicalReference);
        const sourceGeneration = fileReferenceSourceGenerationRef.current[sourceKey] ?? 0;
        if (openGeneration >= sourceGeneration) {
          fileReferenceSourceGenerationRef.current[sourceKey] = openGeneration;
          setFileReferenceContents((current) => ({ ...current, [sourceKey]: content }));
        }
        updateRightSidebarTabs((current) => {
          const opened = openRightSidebarSourceTab(current, {
            id: createRightSidebarTabId(nextRightSidebarTabIdRef),
            type: "file-reference",
            title: fileReferenceTabTitle(
              canonicalReference,
              content.scope === "external-preview",
              t,
            ),
            sourceKey,
            fileMode: decideInitialFileViewMode({
              path: canonicalReference.path,
              scope: content.scope ?? "external-preview",
              hasExplicitLine: canonicalReference.hasExplicitLine,
            }),
          });
          return openGeneration === latestFileReferenceOpenGenerationRef.current
            ? opened
            : { ...opened, activeTabId: current.activeTabId };
        });
      })
      .finally(() => {
        pendingFileReferenceOpensRef.current = Math.max(
          0,
          pendingFileReferenceOpensRef.current - 1,
        );
      });
  };

  const openAgentTeamMember = onOpenAgentTeamMember === undefined
    ? undefined
    : (teamKey: string, memberSlug: string) => {
        setApplicationView("agent-teams");
        onOpenAgentTeamMember(teamKey, memberSlug);
      };

  const openMentionedTeamMember = (slug: string) => {
    if (conversationAgentTeamKey === null) {
      return;
    }
    if (openAgentTeamMember !== undefined) {
      openAgentTeamMember(conversationAgentTeamKey, slug);
      return;
    }
    // Keep the old team-only intent as a compatibility fallback for hosts that have not
    // adopted the member-targeted navigation callback yet.
    onOpenAgentTeam?.(conversationAgentTeamKey);
  };

  const openEvidence = (
    intent: OperatorEvidenceOpenIntent,
    identities: readonly OperatorMemberIdentity[] = memberIdentities,
  ) => {
    parentScrollTopRef.current = timelineScrollRef.current?.scrollTop ?? 0;
    setRightSidebarOpen(true);
    updateRightSidebarTabs(openRightSidebarSourceTab(effectiveRightSidebarTabs, intent.kind === "workspace-diff"
      ? {
          id: createRightSidebarTabId(nextRightSidebarTabIdRef),
          type: "workspace-diff",
          title: RIGHT_SIDEBAR_BUILTIN_TAB_TITLES.workspaceDiff,
          sourceKey: `workspace-diff:${intent.sessionId}`,
        }
      : {
          id: createRightSidebarTabId(nextRightSidebarTabIdRef),
          type: "run-output",
          title: nextProcessTabTitle(effectiveRightSidebarTabs, intent.role, identities, t),
          sourceKey: createRunOutputSourceKey(intent.sessionId, intent.runId, intent.stepId),
        }));
    onOpenEvidence?.(intent);
  };

  useEffect(() => {
    let nextState = effectiveRightSidebarTabs;
    for (const tab of effectiveRightSidebarTabs.tabs) {
      if (tab.type !== "run-output") continue;
      const locator = parseRunOutputSourceKey(tab.sourceKey);
      if (locator === null) continue;
      const subSessionState = subSessionViews[locator.sessionId];
      const sessionMessages = locator.sessionId === selectedSessionId
        ? messages
        : subSessionState?.status === "ready"
          ? subSessionState.view.messages
          : [];
      const matchingMessage = sessionMessages.find((message) => message.runId === locator.runId);
      const stepId = locator.stepId ?? matchingMessage?.runTiming?.stepId ?? null;
      const ready = tab.sourceKey === null ? undefined : processOutputs[tab.sourceKey];
      const responseRole = ready?.status === "ready" ? ready.output.role : null;
      const role = resolveMessageProcessRole(matchingMessage ?? null, sessionMessages) ?? responseRole;
      const identities = subSessionState?.status === "ready"
        ? subSessionState.view.memberIdentities ?? []
        : memberIdentities;
      const sourceKey = stepId === null
        ? tab.sourceKey
        : createRunOutputSourceKey(locator.sessionId, locator.runId, stepId);
      const shouldCorrectTitle = isUnknownProcessTabTitle(tab.title) && role !== null;
      if (sourceKey === tab.sourceKey && !shouldCorrectTitle) continue;
      const title = shouldCorrectTitle
        ? nextProcessTabTitle({
            tabs: nextState.tabs.filter((candidate) => candidate.id !== tab.id),
          }, role, identities, t)
        : tab.title;
      nextState = {
        ...nextState,
        tabs: nextState.tabs.map((candidate) => candidate.id === tab.id
          ? { ...candidate, sourceKey, title }
          : candidate),
      };
    }
    nextState = dedupeRunOutputTabsByStableStep(nextState);
    if (nextState !== effectiveRightSidebarTabs) {
      updateRightSidebarTabs(nextState);
    }
  }, [
    effectiveRightSidebarTabs,
    memberIdentities,
    messages,
    processOutputs,
    selectedSessionId,
    subSessionViews,
  ]);

  const setSidebarOpen = (open: boolean) => {
    if (isNarrowWindow) {
      setNarrowSidebarOpen(open);
      setLayoutAnnouncement(t(open
        ? "console.operator.sidebarOpened"
        : "console.operator.sidebarClosed"));
      if (open) {
        if (effectiveRightSidebarOpen) setRightSidebarOpen(false);
      }
      return;
    }
    if (sidebarOpen === undefined) {
      setUncontrolledSidebarOpen(open);
    }
    onSidebarOpenChange?.(open);
  };

  function updateRightSidebarTabs(
    update: RightSidebarTabsState | ((current: RightSidebarTabsState) => RightSidebarTabsState),
  ): void {
    const nextState = typeof update === "function"
      ? update(latestRightSidebarTabsRef.current)
      : update;
    latestRightSidebarTabsRef.current = nextState;
    if (rightSidebarTabs === undefined) {
      setUncontrolledRightSidebarTabs(nextState);
    }
    onRightSidebarTabsChange?.(nextState);
  }

  function setRightSidebarOpen(open: boolean): void {
    if (open && rightSidebarIsOverlay && narrowSidebarOpen) {
      setNarrowSidebarOpen(false);
    }
    if (open) {
      parentScrollTopRef.current = timelineScrollRef.current?.scrollTop ?? 0;
    }
    if (rightSidebarOpen === undefined) {
      setUncontrolledRightSidebarOpen(open);
    }
    onRightSidebarOpenChange?.(open);
    if (rightSidebarIsOverlay) {
      setLayoutAnnouncement(t(open
        ? "console.operator.rightSidebarOpened"
        : "console.operator.rightSidebarClosed"));
      if (!open) {
        window.requestAnimationFrame(() => rightSidebarToggleRef.current?.focus());
      }
    }
  }

  function setRightSidebarWidth(width: number): void {
    if (rightSidebarWidth === undefined) {
      setUncontrolledRightSidebarWidth(width);
    }
    onRightSidebarWidthChange?.(width);
  }

  function finishRightSidebarExit(): void {
    restoreTimelineScroll(timelineScrollRef, parentScrollTopRef.current);
    onCloseEvidence?.();
    onCloseSubSession?.();
  }

  const submitComposer = () => {
    if (canSend) {
      onSend();
    }
  };

  const openNewConversation = (projectId?: string) => {
    routeToConversation(() => onStartNewConversation?.(projectId));
  };

  const finishConversationRoute = () => {
    setPendingConversationRoute(null);
    setConversationRouteConflictOpen(false);
    setApplicationOverlay(null);
    setApplicationView("conversation");
  };

  const completeConversationRoute = (
    action: ConversationRouteAction = () => undefined,
  ): boolean | void | Promise<boolean | void> => {
    const result = action();
    if (isPromiseLike(result)) {
      return Promise.resolve(result).then((outcome) => {
        if (outcome !== false) {
          finishConversationRoute();
        }
        return outcome;
      });
    }
    if (result !== false) {
      finishConversationRoute();
    }
    return result;
  };

  const routeToConversation = (action?: ConversationRouteAction, onCancel?: () => void) => {
    if (applicationView !== "agent-teams") {
      return completeConversationRoute(action);
    }
    const editors = Object.values(agentTeamDetailState?.memberEditors ?? {});
    if (editors.some((editor) => editor?.externalChangeStatus === "conflict")) {
      setPendingConversationRoute({ run: action ?? (() => undefined), cancel: onCancel });
      setConversationRouteConflictOpen(true);
      return;
    }
    if (editors.some((editor) => editor?.isDirty === true)) {
      setPendingConversationRoute({ run: action ?? (() => undefined), cancel: onCancel });
      return;
    }
    return completeConversationRoute(action);
  };

  const resizeSidebar = (event: ReactPointerEvent<HTMLDivElement>) => {
    const gesture = sidebarResizeGestureRef.current;
    if (gesture === null || gesture.pointerId !== event.pointerId) {
      return;
    }
    setSidebarWidth(clampSidebarWidth(gesture.startWidth + event.clientX - gesture.startX));
  };

  const finishSidebarResize = (event: ReactPointerEvent<HTMLDivElement>) => {
    const gesture = sidebarResizeGestureRef.current;
    if (gesture === null || gesture.pointerId !== event.pointerId) {
      return;
    }
    sidebarResizeGestureRef.current = null;
    event.currentTarget.releasePointerCapture?.(event.pointerId);
  };

  const renderTimelineMessage = (
    message: OperatorMessage,
    index: number,
    virtualStart?: number,
  ) => {
    const isVirtualized = virtualStart !== undefined;
    return (
      <div
        key={message.id}
        ref={isVirtualized ? timelineVirtualizer.measureElement : undefined}
        data-index={index}
        className={isVirtualized ? "absolute left-0 top-0 w-full" : undefined}
        style={isVirtualized
          ? { transform: `translateY(${String(virtualStart - timelineVirtualizer.options.scrollMargin)}px)` }
          : undefined}
      >
        <div
          ref={(element) => {
            if (element === null) conversationMessageRefs.current.delete(message.id);
            else conversationMessageRefs.current.set(message.id, element);
          }}
          className={cn(
            "rounded-lg outline-none transition-colors",
            highlightedMessageId === message.id && "bg-sel ring-2 ring-inset ring-accent",
          )}
          data-message-id={message.id}
          data-testid={`timeline-message-${String(message.id)}`}
          tabIndex={-1}
        >
          <TimelineEntry
            appearance={appearance}
            message={message}
            processRole={resolveMessageProcessRole(message, messages)}
            memberIdentities={memberIdentities}
            imageGallery={conversationImageGallery}
            childSessions={childSessions}
            openedSubSessionId={openedSubSessionId}
            onOpenSubSession={openSubSession}
            onRetryRun={onRetryRun}
            onUpdateSessionMemberExecution={onUpdateSessionMemberExecution}
            onOpenProviderSettings={openProviderSettings}
            onOpenTeamMenu={() => setProviderRecoveryTeamMenuOpen(true)}
            executionRegistryState={executionRegistryState}
            providerProfiles={providerSettings?.state.status === "ready" ? providerSettings.state.profiles : []}
            onReloadExecutionRegistry={onReloadExecutionRegistry}
            onAnalyzeConversation={onAnalyzeConversation}
            onUpdateClaude={onUpdateClaude}
            onEditAndResend={onEditAndResend}
            onOpenExternalLink={onOpenExternalLink}
            onOpenConversationReference={onOpenConversationReference}
            onOpenFileReference={(reference) => openFileReference(message.sessionId, reference)}
            onOpenTeamMember={openMentionedTeamMember}
            onOpenEvidence={openEvidence}
            onLoadRunAgentInfo={onLoadRunAgentInfo}
            onOpenAgentTeamMember={openAgentTeamMember}
          />
        </div>
      </div>
    );
  };
  const timelineBounds = timelineScrollRef.current?.getBoundingClientRect();
  const renderFullTimeline = timelineScrollRef.current === null
    || timelineScrollRef.current.clientHeight === 0
    || timelineBounds?.height === 0;
  const onTimelineProfilerRender: ProfilerOnRenderCallback = useCallback((
    id,
    phase,
    actualDuration,
    baseDuration,
    startTime,
    commitTime,
  ) => {
    if (!timelinePerfEnabled) return;
    const probe = (window as Window & {
      __MOEBIUS_TIMELINE_PERF__?: {
        onCommit?: (entry: {
          id: string;
          phase: "mount" | "update" | "nested-update";
          actualDuration: number;
          baseDuration: number;
          startTime: number;
          commitTime: number;
        }) => void;
      };
    }).__MOEBIUS_TIMELINE_PERF__;
    probe?.onCommit?.({ id, phase, actualDuration, baseDuration, startTime, commitTime });
  }, [timelinePerfEnabled]);
  return (
    <div className={cn(
      "relative flex overflow-hidden bg-canvas text-ink",
      embeddedConversation ? "h-full min-h-0" : "h-screen min-h-0",
      operatorConsoleAppearanceClassName(appearance),
      className,
    )} data-appearance={appearance}>
      {!embeddedConversation ? (
        <a
          href="#operator-main-content"
          className="window-no-drag absolute left-3 top-2 z-[90] -translate-y-16 rounded-lg bg-ink px-3 py-2 text-sm font-normal text-canvas focus:translate-y-0 focus:outline-none focus:ring-2 focus:ring-accent motion-reduce:transition-none"
          onClick={(event) => {
            event.preventDefault();
            operatorMainRef.current?.focus();
          }}
        >
          {t("console.operator.skipToContent")}
        </a>
      ) : null}
      {layoutAnnouncement ? (
        <p className="sr-only" role="status" aria-live="polite" aria-atomic="true">
          {layoutAnnouncement}
        </p>
      ) : null}
      {!embeddedConversation && activeCliInstallations.length > 0 ? (
        <div
          className="window-no-drag absolute left-1/2 top-2 z-[80] flex -translate-x-1/2 items-center gap-2 rounded-full border border-line bg-card px-3 py-1.5 text-xs text-sub shadow-sm"
          role="status"
          data-testid="operator-cli-install-aggregate"
        >
          <RefreshCw className="h-3 w-3 motion-safe:animate-spin" strokeWidth={1.5} aria-hidden="true" />
          {activeCliInstallations.length === 1
            ? t("console.operator.installingCli", {
                cli: activeCliInstallations[0] === "codex"
                  ? "Codex"
                  : activeCliInstallations[0] === "claude"
                    ? "Claude Code"
                    : "Kimi",
              })
            : t("console.operator.installingClis", { count: activeCliInstallations.length })}
        </div>
      ) : null}
      {!embeddedConversation && narrowSidebarOpen ? (
        <button
          type="button"
          className="window-no-drag absolute inset-0 z-40 bg-ink/20"
          aria-label={t("console.operator.closeSidebarOverlay")}
          data-testid="operator-drawer-scrim"
          onClick={() => setSidebarOpen(false)}
        />
      ) : null}
      {!embeddedConversation ? <aside
        className={cn(
          "relative shrink-0 flex-col overflow-visible border-r border-line bg-canvas",
          appearance === "focused" && "z-[2] !w-[228px] rounded-none border-transparent bg-rail shadow-none [&>.bg-canvas]:bg-transparent",
          isNarrowWindow && "absolute inset-y-0 left-0 z-50 w-[min(320px,88vw)] max-w-full",
          effectiveSidebarOpen ? "flex" : "hidden",
        )}
        data-testid="operator-sidebar"
        hidden={!effectiveSidebarOpen}
        style={isNarrowWindow ? undefined : { width: `${sidebarWidth}px` }}
      >
        <header
          className="window-drag-region flex h-[var(--window-header-height)] shrink-0 items-center justify-end pl-[78px] pr-2.5"
          data-testid="sidebar-window-controls"
        >
          <button
            type="button"
            ref={sidebarCloseButtonRef}
            className="window-no-drag flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-sub hover:bg-hover hover:text-ink disabled:pointer-events-none disabled:opacity-40"
            aria-label={translate(activeLocale, "sidebar.close")}
            title={translate(activeLocale, "sidebar.close")}
            onClick={() => setSidebarOpen(false)}
          >
            <PanelLeftClose className="h-4 w-4" strokeWidth={1.5} aria-hidden="true" />
          </button>
        </header>

        <div
          className="window-drag-region flex h-[34px] shrink-0 items-center gap-2 px-4"
          data-testid="sidebar-brand-region"
        >
          <MoebiusLogo decorative />
          <span className="truncate font-sans text-base font-semibold tracking-[-0.01em]">Moebius</span>
        </div>

        <nav
          className="shrink-0 space-y-0.5 px-2.5 pb-1 pt-1.5"
          aria-label={translate(activeLocale, "sidebar.navigation")}
          data-testid="sidebar-app-actions"
        >
          <SidebarAction
            icon={Plus}
            label={translate(activeLocale, "sidebar.newConversation")}
            selected={newConversation !== null && applicationView === "conversation"}
            disabled={projectListUnavailable || isSelectionMutationPending || projectConfigurationPending}
            disabledReason={(projectListUnavailable
              ? translate(activeLocale, "sidebar.projectUnavailable")
              : undefined)
              ?? (isSelectionMutationPending || projectConfigurationPending
                ? translate(activeLocale, "sidebar.projectChanging")
                : undefined)}
            onClick={() => openNewConversation()}
          />
          <SidebarAction
            icon={Search}
            label={translate(activeLocale, "sidebar.search")}
            disabled={projectListUnavailable}
            disabledReason={projectListUnavailable
              ? translate(activeLocale, "sidebar.projectUnavailable")
              : undefined}
            onClick={() => setApplicationOverlay({ kind: "search" })}
          />
          <SidebarAction
            icon={UsersRound}
            label={translate(activeLocale, "sidebar.agentTeams")}
            selected={applicationView === "agent-teams"}
            statusIndicatorLabel={hasAgentTeamNeedingRepair ? t("console.operator.teamNeedsRepair") : undefined}
            disabled={activeProjectUnavailable}
            disabledReason={activeProject.directoryUnavailableReason ?? undefined}
            testId="sidebar-nav-agent-teams"
            onClick={() => setApplicationView("agent-teams")}
          />
        </nav>

        <ConversationSidebar
          projects={sidebarProjects}
          dataState={projectListState}
          selectedSessionId={newConversation === null
            ? navigationSessionId ?? selectedSessionId
            : undefined}
          showProjectPath={false}
          onSelectSession={(sessionId, projectId) => {
            if (!isSelectionMutationPending) {
              routeToConversation(() => onSelectSession({ sessionId, projectId }));
            }
          }}
          onNewConversation={(projectId) => {
            if (!isSelectionMutationPending) {
              openNewConversation(projectId);
            }
          }}
          onShowProjectInFolder={onShowProjectInFolder === undefined ? undefined : (sidebarProject) => {
            const target = visibleProjects.find((candidate) => candidate.projectId === sidebarProject.id);
            if (target) {
              void onShowProjectInFolder(target.folderPath);
            }
          }}
          onRenameProject={onRenameProject === undefined ? undefined : (sidebarProject) => {
            const target = visibleProjects.find((candidate) => candidate.projectId === sidebarProject.id);
            if (target) {
              projectActionTriggerRef.current = findProjectMenuTrigger(sidebarProject.id);
              setProjectActionError(null);
              setRenameTarget(target);
              setRenameValue(target.title);
            }
          }}
          onRemoveProject={onRemoveProject === undefined ? undefined : (sidebarProject) => {
            const target = visibleProjects.find((candidate) => candidate.projectId === sidebarProject.id);
            if (!target) {
              return;
            }
            projectActionTriggerRef.current = findProjectMenuTrigger(sidebarProject.id);
            setProjectActionError(null);
            if (target.runningCount > 0 || (target.managedRunningCount ?? 0) > 0) {
              setRunningRemovalTarget(target);
            } else {
              setRemovalRequest({ project: target, force: false });
            }
          }}
          onAnalyzeConversation={onAnalyzeSession === undefined ? undefined : (sessionId, projectId) => {
            onAnalyzeSession({ sessionId, projectId });
          }}
          onArchiveSession={onArchiveSession === undefined ? undefined : (sessionId, projectId) => {
            const archive = () => void onArchiveSession(sessionId, projectId);
            if (sessionId === selectedSessionId) {
              routeToConversation(archive);
            } else {
              archive();
            }
          }}
          onCopySessionLogPath={onCopySessionLogPath}
          onUpdateReadState={onUpdateSessionReadState}
          onSetSessionPinned={onSetSessionPinned}
          onRenameSession={onRenameSession}
          onReorderProjects={isSelectionMutationPending || isProjectMutationPending ? undefined : onReorderProjects}
          onRepairProject={onSelectFolderForRepair === undefined ? undefined : (sidebarProject) => {
            const target = visibleProjects.find((candidate) => candidate.projectId === sidebarProject.id);
            if (!target || repairPickerProjectId !== null) {
              return;
            }
            setProjectActionError(null);
            setRepairPickerProjectId(target.projectId);
            void onSelectFolderForRepair(target.projectId)
              .then((folderPath) => {
                if (folderPath !== null) {
                  setRepairRequest({ project: target, folderPath });
                }
              })
              .catch((error: unknown) => setProjectActionError(error instanceof Error ? error.message : String(error)))
              .finally(() => setRepairPickerProjectId(null));
          }}
          onRetry={onRetryProjectList}
          disabled={isSelectionMutationPending}
          disabledReason={translate(activeLocale, "sidebar.projectChanging")}
          projectActionsDisabled={projectConfigurationPending}
          projectActionsDisabledReason={translate(activeLocale, "sidebar.projectConfigUpdating")}
          className="min-h-0 w-full flex-1 overflow-visible border-0"
          appearance={appearance}
        />

        <footer className="shrink-0 border-t border-line px-2.5 pb-3 pt-2" data-testid="sidebar-footer">
          <SidebarAction
            icon={CircleHelp}
            label={translate(activeLocale, "sidebar.help")}
            onClick={onReplayOnboarding}
          />
          <div className="flex items-center gap-1">
            <div className="min-w-0 flex-1">
              <SidebarAction
                icon={Settings}
                label={translate(activeLocale, "sidebar.settings")}
                buttonRef={settingsTriggerRef}
                onClick={() => {
                  settingsOpenRef.current = true;
                  setSettingsSection(
                    settingsAbout?.updateStatus === "checking" ? "about" : "general",
                  );
                  setSettingsExternalLinkStatus("idle");
                  setSettingsOpen(true);
                }}
              />
            </div>
            {teamSyncStatus?.kind === "syncing" ? (
              <SidebarAction
                icon={LoaderCircle}
                iconSpinning
                label={t("console.operator.teamSyncing")}
                tooltip={t("console.operator.teamSyncingTeams", {
                  teams: teamSyncStatus.teamNames.map((name) => `「${name}」`).join(""),
                })}
                className="w-auto shrink-0 px-2"
                testId="sidebar-team-sync-status"
                onClick={() => setApplicationView("agent-teams")}
              />
            ) : teamSyncStatus?.kind === "updated" ? (
              <SidebarAction
                icon={CircleCheck}
                label={t("console.operator.teamSyncUpdated")}
                className="w-auto shrink-0 px-2"
                testId="sidebar-team-sync-status"
                onClick={() => {
                  setApplicationView("agent-teams");
                  onDismissTeamSyncStatus?.();
                }}
              />
            ) : settingsAbout?.updateStatus === "ready"
              || (settingsAbout?.updateStatus === "failed" && settingsAbout.latestVersion !== undefined) ? (
              <SidebarAction
                icon={RefreshCw}
                label={translate(activeLocale, "sidebar.installUpdate")}
                className="w-auto shrink-0 px-2"
                onClick={() => onInstallUpdate?.()}
                testId="sidebar-install-update"
              />
            ) : null}
          </div>
        </footer>

        {!isNarrowWindow ? <div
          className="window-no-drag group absolute inset-y-0 right-0 z-30 w-1 cursor-col-resize touch-none"
          role="separator"
          aria-label={translate(activeLocale, "sidebar.resize")}
          aria-orientation="vertical"
          aria-valuemin={MIN_SIDEBAR_WIDTH_PX}
          aria-valuemax={MAX_SIDEBAR_WIDTH_PX}
          aria-valuenow={sidebarWidth}
          aria-valuetext={translate(activeLocale, "sidebar.widthPixels", { width: sidebarWidth })}
          data-testid="sidebar-resize-handle"
          onPointerDown={(event) => {
            if (event.button !== 0) {
              return;
            }
            event.preventDefault();
            sidebarResizeGestureRef.current = {
              pointerId: event.pointerId,
              startX: event.clientX,
              startWidth: sidebarWidth,
            };
            event.currentTarget.setPointerCapture?.(event.pointerId);
          }}
          onPointerMove={resizeSidebar}
          onPointerUp={finishSidebarResize}
          onPointerCancel={finishSidebarResize}
        >
          <span
            className={cn(
              "absolute inset-y-0 right-0 w-px transition-colors",
              appearance === "focused"
                ? "bg-transparent group-hover:bg-line-strong group-active:bg-line-strong"
                : "bg-line group-hover:bg-accent group-active:bg-accent",
            )}
          />
        </div> : null}
      </aside> : null}

      <div
        ref={operatorContentShellRef}
        className="relative flex min-w-0 flex-1 overflow-hidden"
        data-testid="operator-content-shell"
      >
      <main
        ref={operatorMainRef}
        id="operator-main-content"
        tabIndex={-1}
        className={cn(
          "relative flex min-w-0 flex-1 flex-col bg-canvas",
          appearance === "focused" && "m-[4px_2px_4px_4px] overflow-hidden rounded-xl border border-line bg-card shadow-panel [container-type:inline-size]",
        )}
        data-appearance={appearance}
        data-testid="operator-main"
        data-sidebar-open={effectiveSidebarOpen ? "true" : "false"}
        data-sidebar-auto-collapsed={sidebarAutoCollapsed ? "true" : "false"}
      >
        {!embeddedConversation ? <div
          className="window-drag-region absolute inset-x-0 top-0 z-30 flex h-[var(--window-header-height)] items-center border-b border-line"
          data-testid="main-window-drag-region"
        >
          {!effectiveSidebarOpen ? (
            <button
              type="button"
              ref={sidebarOpenButtonRef}
              className="window-no-drag z-20 ml-[96px] flex h-7 w-7 items-center justify-center rounded-lg text-sub hover:bg-hover hover:text-ink"
              aria-label={t("console.operator.openSidebar")}
              title={t("console.operator.openSidebar")}
              onClick={() => setSidebarOpen(true)}
            >
              <PanelLeft className="h-4 w-4" strokeWidth={1.5} aria-hidden="true" />
            </button>
          ) : null}
          {hasManagedProcesses && managedProcesses ? <ManagedProcessPanel controller={managedProcesses} t={t} /> : null}
          {analysisPanel && selectedSession ? (
            <button
              type="button"
              className={cn("window-no-drag z-20 flex h-7 w-7 items-center justify-center rounded-lg text-sub hover:bg-hover hover:text-ink focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent", hasManagedProcesses ? "ml-1" : "ml-auto")}
              aria-label={t(analysisPanel.open ? "console.analysisPanel.hide" : "console.analysisPanel.show")}
              title={t(analysisPanel.open ? "console.analysisPanel.hide" : "console.analysisPanel.show")}
              aria-expanded={analysisPanel.open}
              aria-controls={analysisPanelId}
              onClick={() => analysisPanel.onOpenChange(!analysisPanel.open)}
            >
              <MessagesSquare className="h-4 w-4" strokeWidth={1.5} aria-hidden="true" />
            </button>
          ) : null}
          <button
            type="button"
            ref={rightSidebarToggleRef}
            className={cn(
              "window-no-drag z-20 mr-3 flex h-7 w-7 items-center justify-center rounded-lg text-sub hover:bg-hover hover:text-ink",
              (analysisPanel && selectedSession) || hasManagedProcesses ? "ml-1" : "ml-auto",
            )}
            aria-label={t(requestedRightSidebarOpen ? "console.operator.hideRightSidebar" : "console.operator.showRightSidebar")}
            title={t(requestedRightSidebarOpen ? "console.operator.hideRightSidebar" : "console.operator.showRightSidebar")}
            aria-pressed={requestedRightSidebarOpen}
            onClick={() => setRightSidebarOpen(!requestedRightSidebarOpen)}
          >
            {requestedRightSidebarOpen ? (
              <PanelRightClose className="h-4 w-4" strokeWidth={1.5} aria-hidden="true" />
            ) : (
              <PanelRight className="h-4 w-4" strokeWidth={1.5} aria-hidden="true" />
            )}
          </button>
        </div> : null}

        {projectListState === "loading" && !embeddedConversation ? (
          <DashboardLoadingState t={t} />
        ) : githubTeams?.page === "discovery" ? (
          <GithubTeamDiscoveryPage {...githubTeams.discovery} />
        ) : githubTeams?.page === "preview" ? (
          <GithubTeamPreviewPage {...githubTeams.preview} />
        ) : applicationView === "agent-teams" ? (
          <AgentTeamsPage
            state={agentTeamsState}
            providerProfiles={providerSettings?.state.status === "ready" ? providerSettings.state.profiles : []}
            onOpenProviderSettings={() => {
              setSettingsSection("providers");
              setSettingsOpen(true);
            }}
            selectedTeamKey={selectedAgentTeamKey}
            openTeamKey={openAgentTeamKey}
            selectedMemberSlug={selectedAgentTeamMemberSlug}
            detailState={agentTeamDetailState}
            useStackedRows={useStackedTeamRows}
            aiTeamBuilder={agentTeamBuilder}
            onDiscoverTeams={githubTeams?.openDiscovery}
            onOpenUpstreamRepository={onOpenUpstreamRepository}
            onDetachUpstream={onDetachUpstream}
            onRetryUpstream={onRetryUpstream}
            onSyncUpstream={onSyncUpstream}
            onRevertUpstream={onRevertUpstream}
            onRetry={onRetryAgentTeams}
            onCreateTeam={onCreateAgentTeam}
            onOpenTeam={onOpenAgentTeam}
            onCloseTeam={onCloseAgentTeam}
            onSelectMember={onSelectAgentTeamMember}
            onChangePrimaryAgent={onChangeAgentTeamPrimaryAgent}
            onReorderMembers={onReorderAgentTeamMembers}
            onChangeMemberPortrait={onChangeAgentTeamMemberPortrait}
            onChangeMemberIdentity={onChangeAgentTeamMemberIdentity}
            onAddMember={onAddAgentTeamMember}
            onUpdateTeamInformation={onUpdateAgentTeamInformation}
            onChangeMember={onChangeAgentTeamMember}
            onSaveMember={onSaveAgentTeamMember}
            onCheckMemberExternalChange={onCheckAgentTeamMemberExternalChange}
            onLoadMemberExternalVersion={onLoadAgentTeamMemberExternalVersion}
            onOverwriteMemberExternalVersion={onOverwriteAgentTeamMemberExternalVersion}
            onRetryMember={onRetryAgentTeamMember}
            onDiscardMember={onDiscardAgentTeamMember}
            onDiscardAll={onDiscardAllAgentTeamDrafts}
            onSaveAll={onSaveAllAgentTeamDrafts}
            onSaveExecutionProfile={onSaveAgentExecutionProfile}
            onRestoreRecommendedProfile={onRestoreAgentRecommendedProfile}
            onRestoreRevision={onRestoreAgentTeamRevision === undefined
              ? undefined
              : (teamKey, memberSlug, revisionId) =>
                  void onRestoreAgentTeamRevision(teamKey, memberSlug, revisionId)}
            onRevertSync={onRevertAgentTeamOfficialSync}
            onRetryOfficialSync={onRetryAgentTeamOfficialSync}
            onDismissSyncBanner={onDismissAgentTeamOfficialSyncBanner}
            onDuplicateBuiltInTeam={onDuplicateBuiltInAgentTeam}
            onRecheckTeam={onRecheckAgentTeam}
            onRelocateTeam={onRelocateAgentTeam}
            onRemoveTeamRecord={onRemoveAgentTeamRecord}
            fileManagerActionLabel={resolvedAgentTeamFileManagerLabel}
            onOpenLocation={onOpenAgentTeamLocation}
            onDuplicateUserTeam={onDuplicateUserAgentTeam}
            onDuplicateMember={onDuplicateAgentTeamMember}
            onTrashMember={onTrashAgentTeamMember}
            onTrashUserTeam={onTrashUserAgentTeam}
            onViewRegistrationConflictTeam={onViewAgentTeamRegistrationConflict}
            onShowRegistrationConflictLocation={onShowAgentTeamRegistrationConflictLocation}
            onPreserveRegistrationConflicts={onPreserveAgentTeamRegistrationConflicts}
            onBack={() => routeToConversation()}
          />
        ) : newConversation !== null ? (
          <NewConversationPage
            projects={visibleProjects.map((candidate) => ({
              projectId: candidate.projectId,
              title: candidate.title,
              available: candidate.directoryAvailable !== false && candidate.newConversationDisabledReason == null,
              independentWorkspaceAvailable: candidate.isGitRepository === true,
              branchLabel: candidate.branchName ?? "—",
            }))}
            teams={agentTeamsState.status === "ready"
              ? agentTeamsState.teams
                .map((team) => ({
                  teamKey: team.teamKey,
                  label: getAgentTeamSelectionLabel({
                    team,
                    teams: agentTeamsState.teams,
                    locale: activeLocale,
                    untitledLabel: t("console.common.untitledTeam"),
                    officialLabel: t("console.agentTeamDetail.official"),
                    userLabel: t("console.agentTeamDetail.userTeam"),
                  }),
                  available: team.canCreateConversation,
                  ownership: team.ownership,
                  description: team.description,
                  primaryAgentSlug: team.primaryAgentSlug,
                  members: team.members,
                }))
              : []}
            selectedProjectId={newConversation.selectedProjectId}
            selectedWorkspaceMode={newConversation.selectedWorkspaceMode}
            selectedTeamKey={newConversation.selectedTeamKey}
            draft={newConversation.draft}
            attachments={composerAttachments}
            textFragments={newConversation.textFragments}
            promptSuggestions={newConversation.promptSuggestions}
            isSubmitting={newConversation.isSubmitting}
            isProjectMutationPending={isSelectionMutationPending}
            error={newConversation.error}
            onSelectProject={(projectId) => onNewConversationProjectChange?.(projectId)}
            onSelectWorkspace={(workspaceMode) => onNewConversationWorkspaceChange?.(workspaceMode)}
            onAddProject={() => onAddNewConversationProject?.()}
            onSelectTeam={(teamKey) => onNewConversationTeamChange?.(teamKey)}
            onDraftChange={(value) => onNewConversationDraftChange?.(value)}
            onFilesAdded={(files) => onComposerFilesAdded?.(files)}
            onAttachmentRemove={(clientId) => onComposerAttachmentRemove?.(clientId)}
            onAttachmentRetry={(clientId) => onComposerAttachmentRetry?.(clientId)}
            onTextFragmentRemove={(fragmentId) => onNewConversationTextFragmentRemove?.(fragmentId)}
            onPromptSuggestionSelect={(suggestion) => onNewConversationPromptSuggestionSelect?.(suggestion)}
            onSubmit={() => onSubmitNewConversation?.()}
          />
        ) : (
          <>
            <div
              ref={parentConversationPaneRef}
              className="relative flex min-h-0 flex-1 flex-col"
              data-testid="parent-conversation-pane"
            >
            {selectedSession !== null && conversationRelayEvents.length > 0 ? (
              <div
                className="pointer-events-none absolute left-3 top-[var(--window-header-height)] z-20 w-11"
                data-testid="main-conversation-relay-slot"
                style={{ bottom: `${conversationDockHeight}px` }}
              >
                <ConversationRelayRail
                  appearance={appearance}
                  containerWidth={conversationPaneWidth}
                  currentEventId={currentRelayEventId}
                  events={conversationRelayEvents}
                  onActivate={locateConversationRelayEvent}
                  onBrowse={() => {
                    setRelayFeedback(t("console.operator.relayFocusMoved"));
                  }}
                />
              </div>
            ) : null}
            <TimelinePerformanceBoundary
              enabled={timelinePerfEnabled}
              onRender={onTimelineProfilerRender}
            >
            <section
                className={cn(
                  "scroll-thin min-h-0 flex-1 overflow-y-auto overflow-x-hidden",
                  analysisPanelReservesSpace && "pr-[312px]",
                )}
                aria-label={t("console.operator.timeline")}
                data-resize-anchoring={timelineResizeInProgressRef.current ? "true" : "false"}
                ref={timelineScrollRef}
                style={{ paddingBottom: `${conversationDockHeight + CONVERSATION_DOCK_GAP_PX}px` }}
                onScroll={(event) => {
                  const timeline = event.currentTarget;
                  const adjustedScrollTop = timelineResizeAdjustedScrollTopRef.current;
                  if (adjustedScrollTop !== null && Math.abs(timeline.scrollTop - adjustedScrollTop) <= 1) {
                    return;
                  }
                  if (timelineResizeInProgressRef.current) return;
                  if (timelineResizeAnchorLockedRef.current) return;
                  timelineResizeAdjustedScrollTopRef.current = null;
                  const atBottom = timeline.scrollHeight - timeline.scrollTop - timeline.clientHeight
                    <= TIMELINE_FOLLOW_THRESHOLD_PX;
                  followTimelineRef.current = atBottom;
                  setShowJumpToBottom(!atBottom);
                  if (!atBottom) {
                    const bounds = timeline.getBoundingClientRect();
                    const readingCenter = bounds.top + bounds.height / 2;
                    let nearestMessageId: number | null = null;
                    let nearestOffset = 0;
                    let nearestDistance = Number.POSITIVE_INFINITY;
                    for (const [messageId, element] of conversationMessageRefs.current) {
                      if (!element.isConnected) continue;
                      const rect = element.getBoundingClientRect();
                      const distance = Math.abs(rect.top + rect.height / 2 - readingCenter);
                      if (distance < nearestDistance) {
                        nearestMessageId = messageId;
                        nearestOffset = rect.top - bounds.top;
                        nearestDistance = distance;
                      }
                    }
                    if (nearestMessageId !== null) {
                      timelineReadingAnchorRef.current = {
                        messageId: nearestMessageId,
                        offset: nearestOffset,
                      };
                      timeline.dataset.readingAnchorMessageId = String(nearestMessageId);
                    }
                  }
                  if (selectedSession?.sessionId !== selectedSessionId) return;
                  if (atBottom) {
                    timelineReadingAnchorRef.current = null;
                    timeline.removeAttribute("data-reading-anchor-message-id");
                    const latestEvent = conversationRelayEvents.at(-1);
                    if (latestEvent !== undefined && latestEvent.id !== currentRelayEventId) {
                      setCurrentRelayEventId(latestEvent.id);
                      onReadingMessageChange?.(selectedSessionId, latestEvent.messageId);
                    }
                    return;
                  }
                  if (suppressReadingScrollRef.current) return;
                  if (conversationFocusFrameRef.current !== null) return;
                  conversationFocusFrameRef.current = window.requestAnimationFrame(() => {
                    conversationFocusFrameRef.current = null;
                    const bounds = timeline.getBoundingClientRect();
                    const readingCenter = bounds.top + bounds.height / 2;
                    let nearest: ConversationRelayEvent | null = null;
                    let nearestDistance = Number.POSITIVE_INFINITY;
                    for (const relayEvent of conversationRelayEvents) {
                      const element = conversationMessageRefs.current.get(relayEvent.messageId);
                      if (element === undefined) continue;
                      const rect = element.getBoundingClientRect();
                      const distance = Math.abs(rect.top + rect.height / 2 - readingCenter);
                      if (distance < nearestDistance) {
                        nearest = relayEvent;
                        nearestDistance = distance;
                      }
                    }
                    if (nearest !== null && nearest.id !== currentRelayEventId) {
                      setCurrentRelayEventId(nearest.id);
                      onReadingMessageChange?.(selectedSessionId, nearest.messageId);
                    }
                  });
                }}
                onWheel={() => {
                  timelineResizeAnchorLockedRef.current = false;
                  timelineResizeAdjustedScrollTopRef.current = null;
                }}
                onPointerDown={() => {
                  timelineResizeAnchorLockedRef.current = false;
                  timelineResizeAdjustedScrollTopRef.current = null;
                }}
                onKeyDown={() => {
                  timelineResizeAnchorLockedRef.current = false;
                  timelineResizeAdjustedScrollTopRef.current = null;
                }}
              >
              {selectedSession ? (
                <header
                  className={cn(
                    "sticky top-0 z-10 flex h-[var(--window-header-height)] items-center bg-canvas",
                    MAIN_CONVERSATION_COLUMN_GUTTER_CLASS,
                  )}
                  data-testid="conversation-title-header"
                >
                  <div className={cn(
                    "mx-auto flex w-full min-w-0 items-center gap-2",
                    MAIN_CONVERSATION_COLUMN_WIDTH_CLASS,
                  )}>
                    <h1
                      className="min-w-0 w-full max-w-[840px] flex-1 truncate text-left font-sans text-base font-semibold tracking-[-0.01em] text-ink"
                      title={selectedSession.title}
                    >
                      {selectedSession.title}
                    </h1>
                    {embeddedConversation && hasManagedProcesses && managedProcesses ? <ManagedProcessPanel controller={managedProcesses} t={t} /> : null}
                    {embeddedConversation && analysisPanel ? (
                      <button
                        type="button"
                        className="window-no-drag flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-sub hover:bg-hover hover:text-ink focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent"
                        aria-label={t(analysisPanel.open ? "console.analysisPanel.hide" : "console.analysisPanel.show")}
                        title={t(analysisPanel.open ? "console.analysisPanel.hide" : "console.analysisPanel.show")}
                        aria-expanded={analysisPanel.open}
                        aria-controls={analysisPanelId}
                        onClick={() => analysisPanel.onOpenChange(!analysisPanel.open)}
                      >
                        <MessagesSquare className="h-4 w-4" strokeWidth={1.5} aria-hidden="true" />
                      </button>
                    ) : null}
                  </div>
                </header>
              ) : null}
              {conversationNotice ? (
                <div className={MAIN_CONVERSATION_COLUMN_GUTTER_CLASS}>
                  <div
                    className={cn(
                      "mx-auto mt-3 rounded-xl border border-line bg-sunken px-3 py-2 text-xs leading-5 text-sub",
                      MAIN_CONVERSATION_COLUMN_WIDTH_CLASS,
                    )}
                    role="status"
                  >
                    {conversationNotice}
                  </div>
                </div>
              ) : null}
              {emptyConversation ? (
                <ConversationEmptyState
                  className={cn(
                    selectedSession && "min-h-[calc(100%_-_var(--window-header-height))]",
                    MAIN_CONVERSATION_COLUMN_GUTTER_CLASS,
                  )}
                  projectName={activeProject.title}
                />
              ) : (
                <div
                  className={conversationRelayClearance === null
                    ? MAIN_CONVERSATION_COLUMN_GUTTER_CLASS
                    : "pr-8"}
                  data-testid="conversation-timeline-gutter"
                  style={conversationRelayClearance === null
                    ? undefined
                    : { paddingLeft: conversationRelayClearance }}
                >
                  <div className={cn("mx-auto", MAIN_CONVERSATION_COLUMN_WIDTH_CLASS)}>
                    <div
                      ref={timelineListRef}
                      className="relative"
                      data-testid="virtual-timeline-list"
                      style={renderFullTimeline
                        ? undefined
                        : { height: `${String(timelineVirtualizer.getTotalSize())}px` }}
                    >
                      {renderFullTimeline
                        ? messages.map((message, index) => renderTimelineMessage(message, index))
                        : virtualTimelineItems.map((virtualItem) => {
                            const message = messages[virtualItem.index];
                            return message === undefined
                              ? null
                              : renderTimelineMessage(message, virtualItem.index, virtualItem.start);
                          })}
                    </div>

                    {displayedActiveRuns.map((run) => {
                      const isPrimaryRun = activeRun?.runId === run.runId;
                      const roleLabel = resolveOperatorMemberName(run.role, memberIdentities, t);
                      const runEngine = projectOperatorExecutionProfileEngine(run.profile)
                        ?? (run.engine === undefined ? undefined : { cli: run.engine })
                        ?? resolveOperatorMemberEngine(run.role, memberIdentities);
                      return (
                        <div data-testid="active-run-block" data-run-id={run.runId} key={run.runId}>
                          <RunBlock
                          appearance={appearance}
                          variant="main"
                          role={run.role ?? "dev"}
                          memberIdentities={memberIdentities}
                          sessionId={run.sessionId}
                          runId={run.runId}
                          engine={runEngine}
                          onLoadRunAgentInfo={onLoadRunAgentInfo}
                          onOpenAgentTeamMember={openAgentTeamMember}
                          elapsedMs={run.elapsedMs}
                            activity={run.activity}
                            processSteps={run.processSteps ?? activityStepsToProcessSteps(run.activitySteps)}
                            processOutputAvailable
                            outputUnavailableMessage={t("console.common.providerOutputUnavailable")}
                            summary={safeRunSummary(run.lastOutputSummary, t)}
                            liveMarkdown={run.liveMarkdown}
                            claudeTerminal={terminalTraceForRun(run, claudeTerminalTraces)}
                            rawOutput={runRawOutput(run)}
                            onOpenExternalLink={onOpenExternalLink}
                            onOpenFileReference={(reference) => openFileReference(run.sessionId, reference)}
                            onOpenTeamMember={openMentionedTeamMember}
                            onOpenOutput={(fallbackOutput) => openEvidence({
                                  kind: "run-output",
                                  sessionId: run.sessionId,
                                  runId: run.runId,
                                  stepId: run.stepId ?? null,
                                  role: run.role,
                                  fallbackOutput,
                                })}
                            onInterrupt={run.interruptible
                              ? () => onInterrupt(run.sessionId, run.runId)
                              : undefined}
                            onAnalyzeConversation={onAnalyzeConversation === undefined
                              ? undefined
                              : () => onAnalyzeConversation({
                                  sessionId: run.sessionId,
                                  runId: run.runId,
                                  messageId: null,
                                })}
                            interruptLabel={isPrimaryRun
                              ? t("console.runBlock.stopPrimaryActivity")
                              : t("console.runBlock.stopMember", { member: roleLabel })}
                            className="mt-3 max-w-none"
                          />
                        </div>
                      );
                    })}

                    {resultCardVisible && workspaceDiff.available && selectedSession ? (
                      <ResultCard
                        fileCount={workspaceDiff.fileCount}
                        onOpen={() => openEvidence({
                          kind: "workspace-diff",
                          sessionId: selectedSession.sessionId,
                          fileCount: workspaceDiff.fileCount,
                        })}
                      />
                    ) : null}
                  </div>
                </div>
              )}
              </section>
            </TimelinePerformanceBoundary>
            <p className="sr-only" aria-live="polite" data-testid="conversation-relay-feedback">
              {relayFeedback}
            </p>

            {showJumpToBottom ? (
              <button
                type="button"
                className="absolute left-1/2 z-20 flex -translate-x-1/2 items-center gap-1.5 rounded-full border border-line bg-card px-3 py-1.5 text-xs text-sub hover:text-ink"
                data-testid="jump-to-bottom"
                style={{ bottom: `${conversationDockHeight + CONVERSATION_DOCK_GAP_PX}px` }}
                onClick={() => {
                  const timeline = timelineScrollRef.current;
                  if (timeline !== null) {
                    timeline.scrollTop = timeline.scrollHeight;
                    followTimelineRef.current = true;
                    setShowJumpToBottom(false);
                  }
                }}
              >
                <ArrowDown className="h-3.5 w-3.5" strokeWidth={1.5} aria-hidden="true" />
                {t("console.operator.jumpBottom")}
              </button>
            ) : null}

            <div
              ref={attachConversationDock}
              className={cn(
                "pointer-events-none absolute inset-x-0 bottom-0 bg-canvas pb-4 pt-3",
                conversationRelayClearance === null
                  ? MAIN_CONVERSATION_COLUMN_GUTTER_CLASS
                  : "pr-8",
                analysisPanelReservesSpace && "pr-[312px]",
              )}
              data-testid="conversation-bottom-dock"
              style={conversationRelayClearance === null
                ? undefined
                : { paddingLeft: conversationRelayClearance }}
            >
                <div className={cn("pointer-events-auto mx-auto w-full", MAIN_CONVERSATION_COLUMN_WIDTH_CLASS)}>
                  <SessionTeamUpdateNotice
                    state={sessionTeamUpdate}
                    onApply={onApplySessionTeamUpdate}
                    onRetry={onRetrySessionTeamUpdate}
                    onCancel={onCancelSessionTeamUpdate}
                    onView={onViewSessionTeamUpdate === undefined ? undefined : (kind) => {
                      onViewSessionTeamUpdate(kind);
                      setSessionTeamUpdateDetailOpen(true);
                    }}
                    onDismissCategory={onDismissSessionTeamUpdateCategory}
                  />
                </div>
                {visiblePendingDispatches.length > 0 ? (
                  <section
                    className={cn(
                      appearance === "focused"
                        ? "pointer-events-auto relative z-[1] mx-auto mb-0 w-fit max-w-[min(76%,540px)] overflow-hidden rounded-t-[12px] border border-line border-b-0 bg-input p-0 shadow-pending [&>ol]:hidden [&>p]:hidden"
                        : "pointer-events-auto mx-auto mb-2 w-full rounded-xl border border-accent/35 bg-accent/10 px-3.5 py-2.5",
                      appearance === "default" && MAIN_CONVERSATION_COLUMN_WIDTH_CLASS,
                    )}
                    aria-label={t("console.operator.pendingDispatch")}
                    data-testid="primary-pending-zone"
                  >
                    {appearance === "focused" ? (
                      <div className="scroll-thin max-h-[148px] overflow-y-auto overscroll-contain">
                        {(focusedPendingExpanded ? visiblePendingDispatches : visiblePendingDispatches.slice(0, 1)).map((dispatch) => {
                          const message = dispatch.message;
                          const body = message.body.trim()
                            || message.attachments?.map((attachment) => attachment.displayName).join(", ")
                            || t("console.operator.attachmentMessage");
                          return (
                            <div
                              key={message.id}
                              className="flex min-h-10 min-w-0 items-center gap-1.5 border-t border-line px-1.5 py-1.5 first:border-t-0 focus-within:bg-hover"
                            >
                              <button
                                type="button"
                                className="min-w-0 flex-1 overflow-hidden text-ellipsis whitespace-nowrap bg-transparent px-1.5 text-left text-sm leading-5 text-ink focus-visible:outline-none"
                                aria-expanded={focusedPendingExpanded}
                                title={body}
                                onClick={() => setFocusedPendingExpanded((expanded) => !expanded)}
                              >
                                {body}
                              </button>
                              <div className="flex shrink-0 items-center gap-0.5">
                                <button
                                  type="button"
                                  className="grid h-7 w-7 place-items-center rounded-md text-hint transition-colors hover:bg-hover hover:text-ink focus-visible:bg-hover focus-visible:text-ink focus-visible:outline-none"
                                  aria-label={t("console.operator.pendingSendNow", { body })}
                                  title={t("console.operator.pendingSendNowTitle")}
                                  onClick={() => onRetryPendingMessage?.(selectedSessionId, message.id)}
                                >
                                  <ArrowUp className="h-3.5 w-3.5" strokeWidth={1.7} aria-hidden="true" />
                                </button>
                                <button
                                  type="button"
                                  className="grid h-7 w-7 place-items-center rounded-md text-hint transition-colors hover:bg-[var(--status-danger-bg)] hover:text-danger focus-visible:bg-[var(--status-danger-bg)] focus-visible:text-danger focus-visible:outline-none"
                                  aria-label={t("console.operator.pendingDelete", { body })}
                                  title={t("console.operator.pendingDeleteTitle")}
                                  onClick={() => onRemovePendingMessage?.(selectedSessionId, message.id)}
                                >
                                  <Trash2 className="h-3.5 w-3.5" strokeWidth={1.7} aria-hidden="true" />
                                </button>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    ) : (
                    <>
                    <p className="text-xs font-normal text-accent">{t("console.operator.pendingDispatch")}</p>
                    <ol className="scroll-thin mt-1.5 max-h-24 space-y-1 overflow-y-auto pr-1 text-sm text-ink">
                      {visiblePendingDispatches.map((dispatch, index) => {
                        const message = dispatch.message;
                        const editing = editingPendingMessage?.id === message.id;
                        return (
                          <li key={message.id} className="min-w-0">
                            <div className="flex min-w-0 gap-2">
                              <span className="shrink-0 text-sub">{index + 1}</span>
                              <span className="shrink-0 text-accent">
                                {dispatch.targetUnavailable
                                  ? t("console.operator.pendingTargetUnavailable")
                                  : dispatch.waitingForTeam
                                  ? t("console.operator.pendingNewTeam")
                                  : t("console.operator.pendingTarget", {
                                      target: resolveOperatorMemberName(
                                        dispatch.targetRole
                                          ?? (dispatch.targetLane === "primary"
                                            ? memberIdentities[0]?.slug ?? null
                                            : null),
                                        memberIdentities,
                                        t,
                                        t("console.common.collaborator"),
                                      ),
                                    })}
                              </span>
                              {editing ? (
                                <input
                                  className="min-w-0 flex-1 rounded-lg border border-line bg-card px-2 py-1 text-sm text-ink"
                                  aria-label={t("console.operator.pendingEditLabel")}
                                  value={editingPendingMessage.body}
                                  onChange={(event) => setEditingPendingMessage({
                                    id: message.id,
                                    body: event.currentTarget.value,
                                  })}
                                />
                              ) : (
                                <span className="truncate">
                                  {message.body.trim()
                                    || message.attachments?.map((attachment) => attachment.displayName).join(", ")
                                    || t("console.operator.attachmentMessage")}
                                </span>
                              )}
                            </div>
                            {message.error || dispatch.waitingForTeam || dispatch.targetUnavailable ? (
                              <div
                                className={cn(
                                  "ml-5 mt-1 rounded-lg border px-2 py-1.5 text-xs",
                                  message.error
                                    ? "border-danger/30 bg-danger/5 text-danger"
                                    : "border-line bg-card text-sub",
                                )}
                                role={message.error ? "alert" : undefined}
                                tabIndex={-1}
                              >
                                {message.error || dispatch.targetUnavailable ? (
                                  <>
                                    <p>{dispatch.targetUnavailable
                                      ? t("console.operator.pendingTargetUnavailableDetail")
                                      : message.error}</p>
                                    <p className="mt-0.5">{t("console.operator.pendingNotSent")}</p>
                                  </>
                                ) : null}
                                <div className="mt-1.5 flex flex-wrap gap-1.5">
                                  {editing ? (
                                    <>
                                      <button
                                        type="button"
                                        className="rounded border border-line bg-card px-2 py-1 text-ink"
                                        onClick={() => {
                                          onEditPendingMessage?.(
                                            selectedSessionId,
                                            message.id,
                                            editingPendingMessage.body,
                                          );
                                          setEditingPendingMessage(null);
                                        }}
                                      >
                                        {t(message.error
                                          ? "console.operator.pendingSave"
                                          : "console.operator.pendingSaveEdit")}
                                      </button>
                                      <button
                                        type="button"
                                        className="rounded border border-line bg-card px-2 py-1 text-ink"
                                        onClick={() => setEditingPendingMessage(null)}
                                      >
                                        {t("console.operator.pendingCancel")}
                                      </button>
                                    </>
                                  ) : (
                                    <>
                                      {message.error || dispatch.targetUnavailable ? (
                                        <button
                                          type="button"
                                          className="rounded border border-line bg-card px-2 py-1 text-ink"
                                          onClick={() => onRetryPendingMessage?.(selectedSessionId, message.id)}
                                        >
                                          {t(dispatch.targetUnavailable
                                            ? "console.operator.pendingResubmit"
                                            : "console.operator.pendingRetry")}
                                        </button>
                                      ) : null}
                                      <button
                                        type="button"
                                        className="rounded border border-line bg-card px-2 py-1 text-ink"
                                        onClick={() => setEditingPendingMessage({ id: message.id, body: message.body })}
                                      >
                                        {t("console.operator.pendingEdit")}
                                      </button>
                                      <button
                                        type="button"
                                        className="rounded border border-line bg-card px-2 py-1 text-danger"
                                        onClick={() => onRemovePendingMessage?.(selectedSessionId, message.id)}
                                      >
                                        {t("console.operator.pendingRemove")}
                                      </button>
                                    </>
                                  )}
                                </div>
                              </div>
                            ) : null}
                          </li>
                        );
                      })}
                    </ol>
                    </>
                    )}
                  </section>
                ) : null}
                <RoleComposer
                  variant="main"
                  value={composerValue}
                  attachments={composerAttachments}
                  onValueChange={onComposerChange}
                  onFilesAdded={onComposerFilesAdded}
                  onAttachmentRemove={onComposerAttachmentRemove}
                  onAttachmentRetry={onComposerAttachmentRetry}
                  onSubmit={submitComposer}
                  runActive={activeRun !== null}
                  onInterrupt={activeRun?.interruptible === true
                    ? () => onInterrupt(activeRun.sessionId, activeRun.runId)
                    : undefined}
                  roles={roleCompletionsForTeam(displayedConversationAgentTeam)}
                  disabled={isSending || isSelectionMutationPending || isSessionProjectUpdating || activeProjectUnavailable || selectedAgentTeamUnavailable || continuationBlocked}
                  submitDisabled={composerSubmissionBlockReason !== null}
                  placeholder={activeProjectUnavailable
                    ? t("console.operator.projectUnavailable")
                    : selectedSession?.agentTeamHealth === "deleted"
                      ? t("console.operator.teamDeleted")
                      : selectedAgentTeamUnavailable
                        ? t("console.operator.teamNeedsRepairShort")
                        : continuationBlocked
                          ? selectedSession?.continuation?.reason ?? t("console.operator.cannotContinue")
                      : activeRun
                        ? t("console.operator.continuePlaceholder")
                        : t("console.operator.placeholder")}
                  statusText={activeProjectUnavailable
                    ? t("console.operator.readOnlyRepair")
                    : selectedSession?.agentTeamHealth === "deleted"
                      ? t("console.operator.readOnlySelectTeam")
                      : selectedAgentTeamUnavailable
                        ? t("console.operator.readOnlyRepairOrTeam")
                        : continuationBlocked
                          ? selectedSession?.continuation?.reason ?? t("console.operator.readOnly")
                          : composerSubmissionBlockReason ?? undefined}
                  context={
                    <ComposerContext
                      project={activeProject}
                      projects={visibleProjects}
                      selectedSession={selectedSession}
                      agentTeam={runtimeConversationAgentTeam}
                      pendingAgentTeam={pendingConversationAgentTeam}
                      missingAgentTeamId={selectedSession?.agentTeamHealth === "deleted" ? selectedSession.agentTeamId : null}
                      agentTeamHealth={selectedSession?.agentTeamHealth ?? null}
                      teams={agentTeamsState.status === "ready" ? agentTeamsState.teams : []}
                      canChangeProject={
                        selectedSession !== null &&
                        messages.length === 0 &&
                        displayedActiveRuns.length === 0 &&
                        !selectedSession.parentSessionId &&
                        (selectedSession.childCount ?? 0) === 0
                      }
                      disabled={isSelectionMutationPending || activeProjectUnavailable}
                      onChangeSessionProject={onChangeSessionProject}
                      onChangeSessionWorkspace={messages.length === 0 ? onChangeSessionWorkspace : undefined}
                      onChangeSessionTeam={onChangeSessionTeam}
                      teamMenuOpen={providerRecoveryTeamMenuOpen}
                      onTeamMenuOpenChange={setProviderRecoveryTeamMenuOpen}
                      appearance={appearance}
                    />
                  }
                  className={cn(
                    "pointer-events-auto mx-auto",
                    MAIN_CONVERSATION_COLUMN_WIDTH_CLASS,
                  )}
                  appearance={appearance}
                />
            </div>
            {analysisPanel?.open ? (
              <AnalysisPanel
                id={analysisPanelId}
                layout={analysisPanelLayout}
                state={analysisPanel.state}
                onOpenEntry={analysisPanel.onOpenEntry}
                onRetry={analysisPanel.onRetry}
              />
            ) : null}
            </div>
          </>
        )}
      </main>
      <RightSidebar
        open={effectiveRightSidebarOpen}
        availableWidth={availableContentWidth}
        width={effectiveRightSidebarWidth}
        minWidth={rightSidebarLayout.minWidth}
        maxWidth={rightSidebarLayout.maxWidth}
        layout={rightSidebarLayout.layout}
        isGitRepository={activeProject.isGitRepository === true}
        state={effectiveRightSidebarTabs}
        tabDiscriminators={rightSidebarTabDiscriminators}
        updatingTabIds={rightSidebarUpdatingTabIds}
        onRetryTitles={onRetryRightSidebarTitles}
        onStateChange={updateRightSidebarTabs}
        onOpenChange={setRightSidebarOpen}
        onWidthChange={setRightSidebarWidth}
        toggleButtonRef={rightSidebarToggleRef}
        onExitComplete={finishRightSidebarExit}
        onBeforeCloseTab={onBeforeCloseRightSidebarTab}
        focusTabId={rightSidebarFocusTabId}
        onFocusTabHandled={onRightSidebarFocusHandled}
        createTabId={() => createRightSidebarTabId(nextRightSidebarTabIdRef)}
        contentSlots={{
          "sub-session": (tab) => {
            const sessionId = tab.sourceKey?.replace(/^sub-session:/u, "") ?? "";
            const summary = childSessions.find((candidate) => candidate.sessionId === sessionId) ?? null;
            return (
              <SubtaskTab
                sessionId={sessionId}
                summary={summary}
                state={subSessionViews[sessionId] ?? { status: "idle" }}
                claudeTerminalTraces={claudeTerminalTraces}
                composerValue={subSessionComposerValue}
                composerAttachments={subSessionComposerAttachments}
                roles={roleCompletionsForTeam(displayedConversationAgentTeam)}
                sending={isSubSessionSending}
                onComposerChange={(value) => onSubSessionComposerChange?.(sessionId, value)}
                onComposerFilesAdded={onSubSessionComposerFilesAdded}
                onComposerAttachmentRemove={onSubSessionComposerAttachmentRemove}
                onComposerAttachmentRetry={onSubSessionComposerAttachmentRetry}
                onSend={() => onSubSessionSend?.(sessionId)}
                onRetry={(runId, executionOverride) =>
                  onSubSessionRetry?.(sessionId, runId, executionOverride)}
                onUpdateMemberExecution={onUpdateSessionMemberExecution}
                executionRegistryState={executionRegistryState}
                providerProfiles={providerSettings?.state.status === "ready" ? providerSettings.state.profiles : []}
                onReloadExecutionRegistry={onReloadExecutionRegistry}
                onInterrupt={onSubSessionInterrupt ?? onInterrupt}
                onOpenOutput={(input) => openEvidence({
                  kind: "run-output",
                  ...input,
                }, subSessionViews[sessionId]?.status === "ready"
                  ? subSessionViews[sessionId].view.memberIdentities ?? []
                  : [])}
                onOpenExternalLink={onOpenExternalLink}
                onOpenFileReference={(reference) => openFileReference(sessionId, reference)}
                onOpenTeamMember={openMentionedTeamMember}
              />
            );
          },
          "run-output": (tab) => {
            return (
              <ProcessTab
                title={tab.title}
                state={tab.sourceKey === null
                  ? { status: "idle" }
                  : processOutputs[tab.sourceKey] ?? { status: "idle" }}
                invocationStates={processInvocationStates}
                onLoadInvocation={onLoadProcessInvocation}
                scrollSnapshot={tab.processScroll}
                onScrollSnapshotChange={(snapshot) => {
                  updateRightSidebarTabs(updateRightSidebarProcessScroll(
                    effectiveRightSidebarTabs,
                    tab.id,
                    snapshot,
                  ));
                }}
                onLoadPrevious={tab.sourceKey === null || onLoadProcessOutputPrevious === undefined
                  ? undefined
                  : (cursor) => onLoadProcessOutputPrevious(tab.sourceKey!, cursor)}
              />
            );
          },
          "file-reference": (tab) => {
            const locator = parseFileReferenceSourceKey(tab.sourceKey);
            return locator === null ? null : (
              <FileReferenceTab
                sessionId={locator.sessionId}
                filePath={locator.path}
                line={locator.line}
                column={locator.column}
                hasExplicitLine={locator.hasExplicitLine}
                rememberedMode={tab.fileMode}
                initialContent={tab.sourceKey === null ? undefined : fileReferenceContents[tab.sourceKey]}
                loadReference={onLoadFileReference}
                onModeChange={(mode) => {
                  updateRightSidebarTabs(updateRightSidebarFileMode(
                    effectiveRightSidebarTabs,
                    tab.id,
                    mode,
                  ));
                }}
                onOpenFileReference={(reference) => openFileReference(locator.sessionId, reference)}
                onOpenExternalLink={onOpenExternalLink}
              />
            );
          },
          "workspace-diff": () => selectedSession === null ? null : (
            <ChangeTab
              appearance={appearance}
              sessionId={selectedSession.sessionId}
              workspaceMode={selectedSession.workspaceMode}
              conversationStarted={messages.length > 0}
              isWorking={
                activeRun !== null
                || selectedSession.status === "running"
                || selectedSession.runningCount > 0
              }
              loadDiff={onLoadWorkspaceDiff}
              loadFile={onLoadWorkspaceDiffFile}
            />
          ),
          "project-files": (tab) => selectedSession === null ? null : (
            <ProjectFilesTab
              sessionId={selectedSession.sessionId}
              workspaceMode={selectedSession.workspaceMode}
              loadFiles={onLoadProjectFiles}
              loadFile={onLoadProjectFile}
              rememberedModes={tab.projectFileModes}
              onModeChange={(filePath, mode) => {
                updateRightSidebarTabs(updateRightSidebarProjectFileMode(
                  effectiveRightSidebarTabs,
                  tab.id,
                  filePath,
                  mode,
                ));
              }}
            />
          ),
          ...rightSidebarContentSlots,
        }}
        appearance={appearance}
      />
      </div>

      {applicationOverlay ? (
        applicationOverlay.kind === "search" && renderSearchOverlay !== undefined
          ? renderSearchOverlay(() => setApplicationOverlay(null))
          : <ApplicationPlaceholder overlay={applicationOverlay} onClose={() => setApplicationOverlay(null)} />
      ) : null}

      <I18nProvider locale={activeLocale}>
        <SettingsDialog
          open={settingsOpen}
          activeLocale={activeLocale}
          pendingLocale={pendingLocale}
          saveStatus={languageSaveStatus}
          activeSection={settingsSection}
          about={settingsAbout}
          providers={providerSettings}
          taskReminder={taskReminder}
          externalLinkStatus={settingsExternalLinkStatus}
          defaultAgent={defaultAgent}
          defaultAgentProviderProfiles={defaultAgentProviderProfiles}
          onSaveDefaultAgent={onSaveDefaultAgent}
          onOpenChange={(open) => {
            settingsOpenRef.current = open;
            setSettingsOpen(open);
            if (!open) {
              window.requestAnimationFrame(() => settingsTriggerRef.current?.focus());
            }
          }}
          onSectionChange={setSettingsSection}
          onSelectLocale={(locale) => onSelectLocale?.(locale)}
          onRetry={() => onRetryLocaleSave?.()}
          onCheckForUpdates={() => onCheckSettingsUpdates?.()}
          onInstallUpdate={onInstallUpdate}
          onCopyVersion={() => onCopySettingsVersion?.()}
          onOpenReleaseNotes={() => openSettingsExternalLink(settingsExternalLinks?.releaseNotes)}
          onOpenFeedback={() => openSettingsExternalLink(settingsExternalLinks?.feedback)}
          onOpenRepository={() => openSettingsExternalLink(settingsExternalLinks?.repository)}
        />

        <SessionTeamUpdateDetailDialog
          open={sessionTeamUpdateDetailOpen}
          view={sessionTeamUpdateDetailView}
          onOpenChange={setSessionTeamUpdateDetailOpen}
          onCancel={() => setSessionTeamUpdateDetailOpen(false)}
          onApply={onApplySessionTeamUpdate === undefined ? undefined : () => {
            onApplySessionTeamUpdate();
            setSessionTeamUpdateDetailOpen(false);
          }}
        />

        {taskReminder !== undefined && taskReminder.modal.open ? (
          <NotificationPermissionDialog
            open={taskReminder.modal.open}
            entries={taskReminder.modal.entries.map((entry) => ({
              id: entry.sessionId,
              conversationTitle: entry.title,
              outcome: entry.outcome === "awaiting-user" ? "awaiting-user" : "completed",
            }))}
            openingSettings={planPermissionModalOpenStatus(taskReminder.modal.phase)}
            closingSave={planPermissionModalCloseSave(taskReminder.modal.phase)}
            onOpenChange={() => undefined}
            onEnablePermission={() => taskReminder.onModalAction({ kind: "request" })}
            onRecheck={() => taskReminder.onModalAction({ kind: "recheck" })}
            onCloseNotifications={() => taskReminder.onModalAction({ kind: "close-notifications" })}
            onRetryOpenSettings={() => taskReminder.onModalAction({ kind: "open-settings" })}
            onRetryCloseSave={() => taskReminder.onModalAction({ kind: "close-notifications" })}
          />
        ) : null}

        {settingsNotifications.length > 0 ? (
          <div
            className="fixed bottom-4 right-4 z-[90] grid w-[min(360px,calc(100vw-32px))] gap-2"
            aria-label={t("settings.title")}
            data-testid="settings-notifications"
          >
            {settingsNotifications.map((notification) => (
              <div
                key={notification.id}
                className="rounded-md border border-line bg-card p-3 text-sm text-ink shadow-lg"
                role="status"
              >
                <p>{notification.message}</p>
                <div className="mt-2 flex items-center gap-2">
                  <Button
                    type="button"
                    size="sm"
                    onClick={() => {
                      setSettingsNotifications((current) =>
                        current.filter((candidate) => candidate.id !== notification.id));
                      setSettingsSection(notification.section);
                      setSettingsExternalLinkStatus("idle");
                      settingsOpenRef.current = true;
                      setSettingsOpen(true);
                    }}
                  >
                    {t("settings.notification.open")}
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => setSettingsNotifications((current) =>
                      current.filter((candidate) => candidate.id !== notification.id))}
                  >
                    {t("settings.notification.dismiss")}
                  </Button>
                </div>
              </div>
            ))}
          </div>
        ) : null}
      </I18nProvider>

      {renameTarget ? (
        <ProjectActionDialog
          title={t("console.operator.renameTitle")}
          description={t("console.operator.renameDescription")}
          error={projectActionError}
          returnFocusElement={projectActionTriggerRef.current}
          onCancel={() => {
            if (!isProjectMutationPending) {
              setRenameTarget(null);
            }
          }}
        >
          <label className="grid gap-1.5 text-sm font-normal text-ink">
            {t("console.operator.displayName")}
            <Input
              value={renameValue}
              disabled={isProjectMutationPending}
              onChange={(event) => setRenameValue(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  void submitProjectRename(renameTarget, renameValue, onRenameProject, setProjectActionError, setRenameTarget);
                }
              }}
            />
          </label>
          <DialogButtons
            pending={isProjectMutationPending}
            confirmLabel={t("console.operator.save")}
            onCancel={() => setRenameTarget(null)}
            onConfirm={() => {
              void submitProjectRename(renameTarget, renameValue, onRenameProject, setProjectActionError, setRenameTarget);
            }}
          />
        </ProjectActionDialog>
      ) : null}

      {repairRequest ? (
        <ProjectActionDialog
          title={t("console.operator.repairTitle")}
          description={t("console.operator.repairDescription")}
          error={projectActionError}
          onCancel={() => {
            if (!isProjectMutationPending) {
              setRepairRequest(null);
            }
          }}
        >
          <dl className="grid gap-3 rounded-xl border border-line bg-rail p-3 text-xs">
            <div className="grid gap-1">
              <dt className="font-normal text-sub">{t("console.operator.oldLocation")}</dt>
              <dd className="break-all text-ink" data-testid="repair-original-folder">{repairRequest.project.folderPath}</dd>
            </div>
            <div className="grid gap-1 border-t border-line pt-3">
              <dt className="font-normal text-sub">{t("console.operator.newLocation")}</dt>
              <dd className="break-all text-ink" data-testid="repair-new-folder">{repairRequest.folderPath}</dd>
            </div>
          </dl>
          <DialogButtons
            pending={isProjectMutationPending}
            confirmLabel={t("console.operator.confirmLocation")}
            onCancel={() => setRepairRequest(null)}
            onConfirm={() => {
              void submitProjectFolderRepair(repairRequest, onRepairProjectFolder, setProjectActionError, setRepairRequest);
            }}
          />
        </ProjectActionDialog>
      ) : null}

      {runningRemovalTarget ? (
        <ProjectActionDialog
          title={t("console.operator.runningTitle")}
          description={t("console.operator.runningDescription", { project: runningRemovalTarget.title })}
          icon={<AlertTriangle className="h-5 w-5 text-danger" strokeWidth={1.5} aria-hidden="true" />}
          returnFocusElement={projectActionTriggerRef.current}
          onCancel={() => setRunningRemovalTarget(null)}
        >
          <DialogButtons
            pending={false}
            confirmLabel={t("console.operator.forceContinue")}
            danger
            onCancel={() => setRunningRemovalTarget(null)}
            onConfirm={() => {
              setRemovalRequest({ project: runningRemovalTarget, force: true });
              setRunningRemovalTarget(null);
            }}
          />
        </ProjectActionDialog>
      ) : null}

      {removalRequest ? (
        <ProjectActionDialog
          title={t("console.operator.removeTitle")}
          description={t("console.operator.removeDescription", { project: removalRequest.project.title })}
          error={projectActionError}
          returnFocusElement={projectActionTriggerRef.current}
          onCancel={() => {
            if (!isProjectMutationPending) {
              setRemovalRequest(null);
            }
          }}
        >
          <p className="rounded-lg border border-line bg-rail px-3 py-2 text-xs text-sub">
            {t("console.operator.folderPreserved", { path: removalRequest.project.folderPath })}
          </p>
          <DialogButtons
            pending={isProjectMutationPending}
            confirmLabel={t(removalRequest.force ? "console.operator.interruptRemove" : "console.operator.removeProject")}
            danger
            onCancel={() => setRemovalRequest(null)}
            onConfirm={() => {
              const remove = () => void submitProjectRemoval(
                removalRequest,
                onRemoveProject,
                setProjectActionError,
                setRemovalRequest,
                setRunningRemovalTarget,
              );
              if (removalRequest.project.projectId === activeProjectId) {
                routeToConversation(remove);
              } else {
                remove();
              }
            }}
          />
        </ProjectActionDialog>
      ) : null}

      {pendingConversationRoute ? (
        <ProjectActionDialog
          title={t("console.operator.unsavedTitle")}
          description={t("console.operator.unsavedDescription")}
          onCancel={() => {
            pendingConversationRoute.cancel?.();
            setPendingConversationRoute(null);
          }}
        >
          <DialogButtons
            pending={savingConversationRouteDrafts}
            confirmLabel={t("console.operator.saveAllLeave")}
            onCancel={() => {
              pendingConversationRoute.cancel?.();
              setPendingConversationRoute(null);
            }}
            onConfirm={() => {
              const teamKey = agentTeamDetailState?.teamKey;
              if (teamKey === undefined || onSaveAllAgentTeamDrafts === undefined) {
                return;
              }
              setSavingConversationRouteDrafts(true);
              void onSaveAllAgentTeamDrafts(teamKey).then((result) => {
                if (result.failures.length === 0) {
                  return completeConversationRoute(pendingConversationRoute.run);
                }
                return undefined;
              }).finally(() => setSavingConversationRouteDrafts(false));
            }}
          />
          <Button
            type="button"
            variant="outline"
            disabled={savingConversationRouteDrafts}
            onClick={() => {
              const teamKey = agentTeamDetailState?.teamKey;
              if (teamKey !== undefined) {
                onDiscardAllAgentTeamDrafts?.(teamKey);
              }
              void completeConversationRoute(pendingConversationRoute.run);
            }}
          >
            {t("console.operator.discardAll")}
          </Button>
        </ProjectActionDialog>
      ) : null}

      {conversationRouteConflictOpen ? (
        <ProjectActionDialog
          title={t("console.operator.cannotNavigate")}
          description={t("console.operator.externalConflict")}
          onCancel={() => {
            pendingConversationRoute?.cancel?.();
            setPendingConversationRoute(null);
            setConversationRouteConflictOpen(false);
          }}
        >
          <div className="flex justify-end">
            <Button type="button" onClick={() => {
              pendingConversationRoute?.cancel?.();
              setPendingConversationRoute(null);
              setConversationRouteConflictOpen(false);
            }}>{t("console.operator.gotIt")}</Button>
          </div>
        </ProjectActionDialog>
      ) : null}
    </div>
  );
}

function snapshotSummaryToOperatorTeam(snapshot: OperatorAgentTeamSnapshotSummary): OperatorAgentTeam {
  return {
    teamKey: `${snapshot.team.ownership}:${snapshot.team.id}`,
    id: snapshot.team.id,
    ownership: snapshot.team.ownership,
    createdAt: snapshot.team.createdAt ?? undefined,
    officialSourceName: snapshot.team.officialSourceName ?? undefined,
    name: snapshot.team.name,
    description: snapshot.team.description,
    primaryAgentSlug: snapshot.team.primaryAgentSlug,
    memberOrder: snapshot.members.map((member) => member.name),
    members: snapshot.members.map((member) => ({
      slug: member.name,
      displayName: member.displayName ?? `@${member.name}`,
      description: member.description ?? "",
    })),
    status: "usable",
    canCreateConversation: true,
  };
}

function viewportIsNarrow(): boolean {
  return typeof window !== "undefined" && window.innerWidth < NARROW_WINDOW_WIDTH_PX;
}

function viewportUsesStackedTeamRows(): boolean {
  return typeof window !== "undefined" && window.innerWidth < STACKED_TEAM_ROW_WINDOW_WIDTH_PX;
}

function clampSidebarWidth(width: number): number {
  return Math.min(MAX_SIDEBAR_WIDTH_PX, Math.max(MIN_SIDEBAR_WIDTH_PX, width));
}

function createRightSidebarTabId(counter: { current: number }): string {
  const id = `right-sidebar-tab-${String(counter.current)}`;
  counter.current += 1;
  return id;
}

function findProjectMenuTrigger(projectId: string): HTMLButtonElement | null {
  if (typeof document === "undefined") {
    return null;
  }
  return Array.from(document.querySelectorAll<HTMLButtonElement>("[data-project-row-action='project-menu']"))
    .find((element) => element.dataset.projectMenuProjectId === projectId) ?? null;
}

const DIALOG_FOCUSABLE_SELECTOR = [
  "button:not([disabled])",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  "a[href]",
  "[tabindex]:not([tabindex='-1'])",
].join(",");

function dialogFocusableElements(dialog: HTMLElement): HTMLElement[] {
  return Array.from(dialog.querySelectorAll<HTMLElement>(DIALOG_FOCUSABLE_SELECTOR))
    .filter((element) => !element.hidden && element.getAttribute("aria-hidden") !== "true");
}

function ProjectActionDialog({
  title,
  description,
  icon,
  error,
  onCancel,
  returnFocusElement,
  children,
}: {
  title: string;
  description: string;
  icon?: JSX.Element;
  error?: string | null;
  onCancel(): void;
  returnFocusElement?: HTMLElement | null;
  children: ReactNode;
}): JSX.Element {
  const overlayRef = useRef<HTMLDivElement | null>(null);
  const dialogRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const overlay = overlayRef.current;
    const dialog = dialogRef.current;
    if (overlay === null || dialog === null) {
      return;
    }

    const backgroundElements = overlay.parentElement === null
      ? []
      : Array.from(overlay.parentElement.children).filter(
        (element): element is HTMLElement => element instanceof HTMLElement && element !== overlay,
      );
    const previousInert = backgroundElements.map((element) => ({ element, inert: element.inert }));
    backgroundElements.forEach((element) => {
      element.inert = true;
    });

    const focusInitialElement = (): void => {
      const firstFocusable = dialogFocusableElements(dialog)[0];
      (firstFocusable ?? dialog).focus();
    };
    const focusFrame = window.requestAnimationFrame(focusInitialElement);
    const handleFocusIn = (event: FocusEvent): void => {
      if (event.target instanceof Node && dialog.contains(event.target)) {
        return;
      }
      focusInitialElement();
    };
    document.addEventListener("focusin", handleFocusIn);

    return () => {
      document.removeEventListener("focusin", handleFocusIn);
      window.cancelAnimationFrame(focusFrame);
      previousInert.forEach(({ element, inert }) => {
        element.inert = inert;
      });
      if (returnFocusElement?.isConnected) {
        returnFocusElement.focus();
      }
    };
  }, [returnFocusElement]);

  return (
    <div
      ref={overlayRef}
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 p-6"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) {
          onCancel();
        }
      }}
    >
      <div
        ref={dialogRef}
        className="w-full max-w-md rounded-xl border border-line bg-sunken p-5 text-ink"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.preventDefault();
            event.stopPropagation();
            onCancel();
            return;
          }
          if (event.key !== "Tab") {
            return;
          }
          const focusable = dialogFocusableElements(event.currentTarget);
          if (focusable.length === 0) {
            event.preventDefault();
            event.currentTarget.focus();
            return;
          }
          const activeElement = document.activeElement;
          const activeIndex = activeElement instanceof HTMLElement ? focusable.indexOf(activeElement) : -1;
          const shouldWrapBackward = event.shiftKey && (activeIndex <= 0);
          const shouldWrapForward = !event.shiftKey && (activeIndex === -1 || activeIndex === focusable.length - 1);
          if (shouldWrapBackward || shouldWrapForward) {
            event.preventDefault();
            const nextIndex = event.shiftKey ? focusable.length - 1 : 0;
            focusable[nextIndex]?.focus();
          }
        }}
      >
        <div className="flex items-start gap-3">
          {icon}
          <div className="min-w-0">
            <h2 className="font-sans text-base font-semibold tracking-[-0.01em]">{title}</h2>
            <p className="mt-1 text-sm leading-5 text-sub">{description}</p>
          </div>
        </div>
        <div className="mt-4 grid gap-4">
          {children}
          {error ? <p className="text-sm text-danger" role="alert">{error}</p> : null}
        </div>
      </div>
    </div>
  );
}

function DialogButtons({
  pending,
  confirmLabel,
  danger = false,
  onCancel,
  onConfirm,
}: {
  pending: boolean;
  confirmLabel: string;
  danger?: boolean;
  onCancel(): void;
  onConfirm(): void;
}): JSX.Element {
  const { t } = useI18n();
  return (
    <div className="flex justify-end gap-2">
      <Button type="button" variant="ghost" disabled={pending} onClick={onCancel}>{t("console.common.cancel")}</Button>
      <Button type="button" variant={danger ? "danger" : "default"} disabled={pending} onClick={onConfirm}>
        {pending ? t("console.operator.processing") : confirmLabel}
      </Button>
    </div>
  );
}

async function submitProjectRename(
  project: OperatorProject,
  title: string,
  onRenameProject: OperatorConsoleProps["onRenameProject"],
  setError: (error: string | null) => void,
  close: (value: OperatorProject | null) => void,
): Promise<void> {
  if (!onRenameProject) {
    return;
  }
  setError(null);
  try {
    await onRenameProject(project.projectId, title);
    close(null);
  } catch (error) {
    setError(error instanceof Error ? error.message : String(error));
  }
}

async function submitProjectRemoval(
  request: { project: OperatorProject; force: boolean },
  onRemoveProject: OperatorConsoleProps["onRemoveProject"],
  setError: (error: string | null) => void,
  close: (value: { project: OperatorProject; force: boolean } | null) => void,
  showRunningWarning: (project: OperatorProject | null) => void,
): Promise<void> {
  if (!onRemoveProject) {
    return;
  }
  setError(null);
  try {
    await onRemoveProject(request.project.projectId, request.force);
    close(null);
  } catch (error) {
    if (!request.force && isManagedProcessRunningConflict(error)) {
      setError(null);
      close(null);
      showRunningWarning(request.project);
      return;
    }
    setError(error instanceof Error ? error.message : String(error));
  }
}

function isManagedProcessRunningConflict(error: unknown): boolean {
  return typeof error === "object"
    && error !== null
    && "code" in error
    && (error as { code?: unknown }).code === "managed-process-running";
}

async function submitProjectFolderRepair(
  request: { project: OperatorProject; folderPath: string },
  onRepairProjectFolder: OperatorConsoleProps["onRepairProjectFolder"],
  setError: (error: string | null) => void,
  close: (value: { project: OperatorProject; folderPath: string } | null) => void,
): Promise<void> {
  if (!onRepairProjectFolder) {
    return;
  }
  setError(null);
  try {
    await onRepairProjectFolder(request.project.projectId, request.folderPath);
    close(null);
  } catch (error) {
    setError(error instanceof Error ? error.message : String(error));
  }
}

function DashboardLoadingState({ t }: { t: Translate }): JSX.Element {
  return (
    <div className="grid min-h-0 flex-1 place-items-center px-6 pt-[var(--window-header-height)] text-center" data-testid="dashboard-loading-state">
      <div className="max-w-sm">
        <RefreshCw className="mx-auto h-5 w-5 text-sub motion-safe:animate-spin" strokeWidth={1.5} aria-hidden="true" />
        <h1 className="mt-4 font-sans text-lg font-semibold tracking-[-0.02em] text-ink">
          {t("console.operator.loadingTitle")}
        </h1>
        <p className="mt-2 text-sm leading-6 text-sub">
          {t("console.operator.loadingDescription")}
        </p>
      </div>
    </div>
  );
}

function SidebarAction({
  icon: Icon,
  iconSpinning = false,
  label,
  tooltip,
  selected = false,
  statusIndicatorLabel,
  onClick,
  disabled = false,
  disabledReason,
  buttonRef,
  className,
  testId,
}: {
  icon: LucideIcon;
  /** Continuous spin, e.g. a syncing indicator; automatically cancelled under prefers-reduced-motion. */
  iconSpinning?: boolean;
  label: string;
  /** Overrides the hover/title text without changing the accessible label. */
  tooltip?: string;
  selected?: boolean;
  statusIndicatorLabel?: string;
  onClick?: () => void;
  disabled?: boolean;
  disabledReason?: string;
  buttonRef?: Ref<HTMLButtonElement>;
  className?: string;
  testId?: string;
}): JSX.Element {
  return (
    <button
      ref={buttonRef}
      type="button"
      className={cn(
        "flex h-7 w-full items-center gap-2.5 rounded-md px-3 text-left text-sm font-normal text-ink hover:bg-hover",
        selected ? "bg-sel" : "bg-transparent",
        className,
      )}
      data-testid={testId}
      aria-label={label}
      aria-current={selected ? "page" : undefined}
      aria-description={disabled ? disabledReason : undefined}
      title={disabled ? disabledReason ?? label : tooltip ?? label}
      disabled={disabled}
      onClick={onClick}
    >
      <Icon
        className={cn(
          "h-4 w-4 shrink-0",
          selected ? "text-ink" : "text-sub",
          iconSpinning && "animate-spin motion-reduce:animate-none",
        )}
        strokeWidth={1.5}
        aria-hidden="true"
      />
      <span>{label}</span>
      {statusIndicatorLabel ? (
        <span
          className="ml-auto h-2 w-2 shrink-0 rounded-full bg-danger"
          role="img"
          aria-label={statusIndicatorLabel}
          title={statusIndicatorLabel}
        />
      ) : null}
    </button>
  );
}

function ApplicationPlaceholder({
  overlay,
  onClose,
}: {
  overlay: OperatorApplicationOverlay;
  onClose: () => void;
}): JSX.Element {
  const { t } = useI18n();
  return (
    <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/50 p-6" data-testid="application-overlay">
      <section
        className="w-full max-w-md rounded-xl border border-line bg-sunken p-5"
        role="dialog"
        aria-modal="true"
        aria-labelledby="application-placeholder-title"
      >
        <h1 id="application-placeholder-title" className="text-lg font-semibold tracking-[-0.01em] text-ink">
          {t("console.operator.searchTitle")}
        </h1>
        <p className="mt-2 text-sm leading-6 text-sub">
          {t("console.operator.searchDescription")}
        </p>
        <div className="mt-5 flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={onClose}>
            {t("common.close")}
          </Button>
        </div>
      </section>
    </div>
  );
}

export function resolveNewConversationAgentTeamKey(
  teams: readonly OperatorAgentTeam[],
  lastUsedAgentTeamKey: string | null,
  pendingAgentTeamKey: string | null = null,
): string | null {
  const pendingTeam = pendingAgentTeamKey === null
    ? undefined
    : teams.find((team) => team.teamKey === pendingAgentTeamKey && team.canCreateConversation);
  if (pendingTeam !== undefined) {
    return pendingTeam.teamKey;
  }
  const recordedTeam = lastUsedAgentTeamKey === null
    ? undefined
    : teams.find((team) => team.teamKey === lastUsedAgentTeamKey && team.canCreateConversation);
  if (recordedTeam !== undefined) {
    return recordedTeam.teamKey;
  }
  return teams.find((team) => team.ownership === "system" && team.canCreateConversation)?.teamKey ?? null;
}

function roleCompletionsForTeam(team: OperatorAgentTeam | undefined): RoleCompletion[] {
  return team?.members
    .filter((member) => member.available !== false)
    .map((member) => ({
      handle: member.slug,
      label: member.displayName || `@${member.slug}`,
      description: member.description,
    })) ?? [];
}

/**
 * Terminal records are stored with `role = NULL` (see openspec change
 * `terminal-record-member-attribution`), so the member has to be recovered from
 * a sibling message sharing the same step. This is a compatibility path for rows
 * written before that change, not redundancy — do not delete it until no stored
 * row has `speaker='system' AND run_id IS NOT NULL AND role IS NULL`.
 */
const activityStepKinds: Record<string, ProcessStep["kind"]> = {
  thinking: "thinking",
  tool: "tool",
  command: "command",
  search: "search",
  read: "file",
  edit: "file",
};

/** Runtime activity records to timeline steps; `progress` is the streamed answer, not a step. */
export function activityStepsToProcessSteps(
  steps: OperatorRunSnapshot["activitySteps"],
): readonly ProcessStep[] | undefined {
  if (steps === undefined) return undefined;
  const mapped = steps.flatMap((step, index) => {
    const kind = activityStepKinds[step.kind];
    return kind === undefined
      ? []
      : [{
          id: `${step.occurredAt}-${String(index)}`,
          kind,
          // Step rows strip the running/completed verb prefix (PRD acceptance 47).
          title: stripActivityStepPrefix(step.action),
          detail: step.object,
          status: step.error === undefined || step.error === null
            ? step.phase === "completed" ? ("done" as const) : ("running" as const)
            : ("failed" as const),
          ...(step.input === undefined ? {} : { input: step.input }),
          ...(step.output === undefined ? {} : { output: step.output }),
          ...(step.outputRemainingLines === undefined ? {} : { outputRemainingLines: step.outputRemainingLines }),
          ...(step.error === undefined ? {} : { error: step.error }),
        }];
  });
  return mapped.length === 0 ? undefined : mapped;
}

/**
 * Step rows must not repeat the running/completed verb prefix (PRD acceptance
 * 47); the always-visible activity line keeps the prefixed action. The prefix
 * comes from the domain-side activity verbs; it is matched with escapes here
 * to keep the component library free of CJK literals (production-copy-guard).
 */
function stripActivityStepPrefix(action: string): string {
  return action.replace(/^(?:\u6b63\u5728|\u5df2\u5b8c\u6210)/u, "");
}

function resolveMessageProcessRole(
  message: OperatorMessage | null,
  messages: readonly OperatorMessage[],
): string | null {
  if (message?.role !== null && message?.role !== undefined) {
    return message.role;
  }
  const stepId = message?.runTiming?.stepId;
  if (stepId === undefined) {
    return null;
  }
  return messages.find((candidate) =>
    candidate.role !== null && candidate.runTiming?.stepId === stepId)?.role ?? null;
}

function isUnknownProcessTabTitle(title: string): boolean {
  return /^(?:成员未知|Unknown member)(?: [2-9]\d*)?$/u.test(title); // i18n-exempt: recognizes persisted locale-specific tab titles
}

function TimelineEntry({
  appearance,
  message,
  processRole,
  memberIdentities,
  imageGallery,
  childSessions = [],
  openedSubSessionId = null,
  onOpenSubSession,
  onRetryRun,
  onUpdateSessionMemberExecution,
  onOpenProviderSettings,
  onOpenTeamMenu,
  executionRegistryState,
  providerProfiles,
  onReloadExecutionRegistry,
  onAnalyzeConversation,
  onUpdateClaude,
  onEditAndResend,
  onOpenExternalLink,
  onOpenConversationReference,
  onOpenFileReference,
  onOpenTeamMember,
  onOpenAgentTeamMember,
  onOpenEvidence,
  onLoadRunAgentInfo,
}: {
  appearance: OperatorConsoleAppearance;
  message: OperatorMessage;
  processRole: string | null;
  memberIdentities: readonly OperatorMemberIdentity[];
  imageGallery: readonly ConversationImageDialogItem[];
  childSessions?: readonly OperatorChildSessionSummary[];
  openedSubSessionId?: string | null;
  onOpenSubSession?: (sessionId: string) => void;
  onRetryRun?: (
    sessionId: string,
    runId: string,
    executionOverride?: OperatorExecutionProfile,
  ) => void | Promise<void>;
  onUpdateSessionMemberExecution?: (
    sessionId: string,
    memberName: string,
    action: "migrate" | "end",
    profile?: OperatorExecutionProfile,
  ) => void | Promise<void>;
  onOpenProviderSettings?: () => void;
  onOpenTeamMenu?: () => void;
  executionRegistryState?: ExecutionRegistryState;
  providerProfiles: readonly RegistryProviderProfile[];
  onReloadExecutionRegistry?: () => void;
  onAnalyzeConversation?: (input: {
    sessionId: string;
    runId: string | null;
    messageId: number | null;
  }) => void;
  onUpdateClaude?: () => void;
  onEditAndResend?: (target: OperatorEditAndResendTarget) => void;
  onOpenExternalLink?: (url: string) => void;
  onOpenConversationReference?: (reference: MarkdownConversationReference) => void;
  onOpenFileReference?: (reference: MarkdownFileReference) => void;
  onOpenTeamMember?: (slug: string) => void;
  onOpenAgentTeamMember?: (teamKey: string, memberSlug: string) => void;
  onOpenEvidence?: (intent: OperatorEvidenceOpenIntent) => void;
  onLoadRunAgentInfo?: (input: { sessionId: string; runId: string; signal: AbortSignal }) => Promise<AgentRunInfoView>;
}): JSX.Element {
  const { locale, t } = useI18n();
  const [analysisMenuOpen, setAnalysisMenuOpen] = useState(false);
  const analysisMenuReturnFocusRef = useRef<HTMLElement | null>(null);
  const openAnalysisMenu = (event: SyntheticEvent<HTMLElement>): void => {
    if (onAnalyzeConversation) {
      event.preventDefault();
      analysisMenuReturnFocusRef.current = event.currentTarget;
      setAnalysisMenuOpen(true);
    }
  };
  if (message.sourceKind === "local-child-session-card") {
    const sessionIds = parseChildSessionCardIds(message.body);
    const items = sessionIds === null
      ? childSessions
      : sessionIds.map((sessionId) => childSessions.find((item) => item.sessionId === sessionId)).filter(isDefined);
    return (
      <div className="py-4 pl-7">
        <SubSessionCard items={items} openedSessionId={openedSubSessionId} onOpen={onOpenSubSession} />
      </div>
    );
  }
  const outcome = terminalOutcome(message);
  // The final `"agent"` step makes an unattributable run resolve to the generic
  // collaborator label and a default portrait — an invented member for a machine
  // failure. It exists only because terminal records drop the role at write time;
  // openspec change `terminal-record-member-attribution` removes the need for it.
  const auditRole = message.role ?? processRole ?? "agent";
  if (outcome) {
    const providerUnavailable = resolveProviderUnavailableKind(message.terminal?.safeCode);
    // A terminal record never swallows the body: whatever the agent produced
    // renders as an ordinary message, and the status is one extra bubble under
    // it. Identity and timing belong to the header, not repeated in the bubble.
    const partialMarkdown = message.terminal?.partialMarkdown?.trim() ?? "";
    const identityRole = message.role ?? processRole;
    // A role-less failure (died before startup) still needs the audit entry: it
    // records which member and profile the run was planned with.
    const canAudit = message.runId !== null
      && onLoadRunAgentInfo !== undefined;
    const terminalEngine = projectOperatorExecutionProfileEngine(message.terminal?.actualProfile)
      ?? resolveOperatorMemberEngine(auditRole, memberIdentities);
    // A terminal record always has an owner: the member header when we know who
    // ran, otherwise the existing avatar-less system-notice header. A record must
    // never float in the timeline with neither an identity nor the body indent.
    // The system-notice fallback is a symptom of the same dropped role — see
    // openspec change `terminal-record-member-attribution`.
    const showMemberIdentity = identityRole !== null || canAudit;
    const strippedDetail = stripLegacyOutcomeBoilerplate(terminalOutcomeDescription(message));
    const descriptionKey = resolveOutcomeDescriptionKey(outcome, providerUnavailable);
    const incidentDetail = strippedDetail !== ""
      ? strippedDetail
      : descriptionKey === null ? null : t(descriptionKey);
    const recoveryActions = (
      <RunOutcome
        status={outcome}
        rawReason={message.error ?? message.body}
        initialProfile={message.terminal?.actualProfile}
        executionRegistryState={executionRegistryState}
        providerProfiles={providerProfiles}
        onReloadExecutionRegistry={onReloadExecutionRegistry}
        providerUnavailable={providerUnavailable}
        onRetry={providerUnavailable === null && outcome !== "retry-exhausted" && message.runId !== null
          ? () => onRetryRun?.(message.sessionId, message.runId!)
          : undefined}
        onOverrideAndRetry={
          message.runId !== null
          && message.terminal !== null
          && message.terminal !== undefined
          && (
            message.terminal.kind === "interrupted"
            || message.terminal.kind === "timeout"
            || message.terminal.kind === "quota-exhausted"
            || message.terminal.kind === "rate-limited"
            || message.terminal.kind === "auth"
            || message.terminal.kind === "crashed"
          )
            ? (profile) => onRetryRun?.(message.sessionId, message.runId!, profile)
            : undefined
        }
        onMigrateAndContinue={providerUnavailable === null
          && message.terminal?.actualProfile?.cli === "pi"
          && processRole !== null
          && onUpdateSessionMemberExecution !== undefined
          ? (profile) => onUpdateSessionMemberExecution(message.sessionId, processRole, "migrate", profile)
          : undefined}
        onEndContinuation={providerUnavailable === null
          && message.terminal?.actualProfile?.cli === "pi"
          && processRole !== null
          && onUpdateSessionMemberExecution !== undefined
          ? () => onUpdateSessionMemberExecution(message.sessionId, processRole, "end")
          : undefined}
        onSelectTeam={providerUnavailable !== null && onOpenTeamMenu !== undefined
          ? onOpenTeamMenu
          : undefined}
        maintenanceAction={providerUnavailable === "disabled" && onOpenProviderSettings !== undefined
          ? {
              label: t("console.runOutcome.reenableProvider"),
              onClick: onOpenProviderSettings,
            }
          : providerUnavailable === "needs-attention" && onOpenProviderSettings !== undefined
            ? {
                label: t("console.runOutcome.repairProvider"),
                onClick: onOpenProviderSettings,
              }
            : providerUnavailable === "missing" && onOpenProviderSettings !== undefined
              ? {
                  label: t("console.runOutcome.openProviderSettings"),
                  onClick: onOpenProviderSettings,
                }
              : message.error === "claude-cli-unsupported-version"
          && onUpdateClaude !== undefined
          ? {
              label: t("onboarding.updateClaude"),
              onClick: onUpdateClaude,
            }
          : undefined}
        onEditAndResend={outcome === "user-stopped" && onEditAndResend !== undefined
          ? () => onEditAndResend({
              stoppedMessageId: message.id,
              sessionId: message.sessionId,
              runId: message.runId,
            })
          : undefined}
      />
    );
    return (
      <div
        className="group relative py-3 text-sm"
        tabIndex={onAnalyzeConversation ? 0 : undefined}
        onContextMenu={onAnalyzeConversation ? openAnalysisMenu : undefined}
        onKeyDown={onAnalyzeConversation
          ? (event) => {
              if (event.key === "ContextMenu" || (event.shiftKey && event.key === "F10")) {
                openAnalysisMenu(event);
              }
            }
          : undefined}
      >
        <div className="mb-1.5 flex items-center gap-2 text-sm text-sub">
          {showMemberIdentity ? (
            canAudit ? (
              <AgentRunInfoPopover
                sessionId={message.sessionId}
                runId={message.runId!}
                role={auditRole}
                displayName={resolveOperatorMemberName(auditRole, memberIdentities, t)}
                portraitId={resolveOperatorMemberPortrait(auditRole, memberIdentities)}
                engine={terminalEngine}
                loadInfo={onLoadRunAgentInfo}
                onOpenAgentTeamMember={onOpenAgentTeamMember}
                appearance={appearance}
              />
            ) : (
              <RoleTag
                label={resolveOperatorMemberName(auditRole, memberIdentities, t)}
                toneKey={auditRole}
                portraitId={resolveOperatorMemberPortrait(auditRole, memberIdentities)}
                engine={terminalEngine}
                className="h-6 w-6 text-xs"
              />
            )
          ) : null}
          <span className="text-ink">
            {showMemberIdentity
              ? resolveOperatorMemberName(auditRole, memberIdentities, t)
              : t("console.common.systemNotice")}
          </span>
          {message.runTiming?.elapsedMs !== null && message.runTiming?.elapsedMs !== undefined ? (
            <RunTime mode="completed" elapsedMs={message.runTiming.elapsedMs} />
          ) : null}
        </div>
        <div className="pl-8">
        {message.processSteps?.length ? (
          <ProcessTrail steps={message.processSteps} collapsed className="mb-2" />
        ) : null}
        {partialMarkdown === "" ? null : (
          <MarkdownMessage
            content={partialMarkdown}
            mode="static"
            onOpenExternalLink={onOpenExternalLink}
            onOpenConversationReference={onOpenConversationReference}
            onOpenFileReference={onOpenFileReference}
            memberIdentities={memberIdentities}
            onOpenTeamMember={onOpenTeamMember}
          />
        )}
        {outcome === "user-stopped" ? null : (
          <IncidentNotice
            className={partialMarkdown === "" ? undefined : "mt-2"}
            incident={{
              label: t(resolveOutcomeLabelKey(outcome, providerUnavailable)),
              detail: incidentDetail,
              contentIncomplete: partialMarkdown !== "" && message.terminal?.contentIncomplete === true,
              severity: outcomeSeverity(outcome),
            }}
          />
        )}
        <MessageToolbar
          trailing={message.runTiming?.completedAt
            ? <RunCompletedAt completedAt={message.runTiming.completedAt} />
            : <RunTriggeredAt triggeredAt={message.updatedAt} />}
        >
          {appearance === "focused" && message.body.trim() !== "" ? (
            <MessageAction
              icon={Copy}
              label={t("console.common.copyMessage")}
              onClick={() => void navigator.clipboard?.writeText(message.body).catch(() => undefined)}
            />
          ) : null}
          {message.runId !== null && onOpenEvidence ? (
            <MessageAction
              icon={FileText}
              label={t("console.common.fullOutput")}
              onClick={() => onOpenEvidence({
                kind: "run-output",
                sessionId: message.sessionId,
                runId: message.runId!,
                stepId: message.runTiming?.stepId ?? null,
                role: processRole,
                fallbackOutput: providerUnavailable === null
                  ? message.error ?? message.body
                  : message.body,
              })}
            />
          ) : null}
          {recoveryActions}
          {onAnalyzeConversation ? (
            <ConversationAnalysisMenu
              appearance={appearance}
              open={analysisMenuOpen}
              onOpenChange={setAnalysisMenuOpen}
              returnFocusTarget={analysisMenuReturnFocusRef.current}
              onSelect={() => onAnalyzeConversation({
                sessionId: message.sessionId,
                runId: message.runId,
                messageId: message.id,
              })}
            />
          ) : null}
        </MessageToolbar>
        </div>
      </div>
    );
  }
  if (message.speaker === "user") {
    return (
      <div className="group py-3 text-sm">
        <div className="mb-1.5 flex items-center justify-end gap-2 text-sm text-sub">
          <span className="tnum text-hint opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100">{formatTime(message.updatedAt, locale)}</span>
          <span className="text-ink">{t("console.common.you")}</span>
        </div>
        <div className="flex justify-end">
          <div className={cn(
            "max-w-[75%] rounded-lg border border-line bg-card px-3 py-2",
            appearance === "focused" && "border-transparent bg-sunken",
          )}>
            {message.body.trim() === "" ? null : (
              <MarkdownMessage
                content={message.body}
                mode="static"
                onOpenExternalLink={onOpenExternalLink}
                onOpenConversationReference={onOpenConversationReference}
                onOpenFileReference={onOpenFileReference}
                memberIdentities={memberIdentities}
                onOpenTeamMember={onOpenTeamMember}
              />
            )}
            <StructuredAttachmentList
              attachments={message.attachments ?? []}
              mode="message"
              sourceLabel={t("console.imagePreview.sourceYou")}
              imageGallery={imageGallery}
              className={message.body.trim() === "" ? "" : "mt-2"}
            />
            <TextFragmentList
              fragments={message.textFragments ?? []}
              mode="message"
              className={message.body.trim() === "" && (message.attachments?.length ?? 0) === 0 ? "" : "mt-2"}
            />
          </div>
        </div>
        {appearance === "focused" && message.body.trim() !== "" ? (
          <TooltipProvider delayDuration={200} skipDelayDuration={100}>
            <div className="mt-1 flex h-6 items-center justify-end text-hint transition-colors group-hover:text-sub group-focus-within:text-sub">
              <MessageAction
                icon={Copy}
                label={t("console.common.copyMessage")}
                onClick={() => void navigator.clipboard?.writeText(message.body).catch(() => undefined)}
              />
            </div>
          </TooltipProvider>
        ) : null}
      </div>
    );
  }

  return (
    <div
      className="group py-3 text-sm"
      tabIndex={message.speaker === "agent" && onAnalyzeConversation ? 0 : undefined}
      onContextMenu={message.speaker === "agent" ? openAnalysisMenu : undefined}
      onKeyDown={message.speaker === "agent" && onAnalyzeConversation
        ? (event) => {
            if (event.key === "ContextMenu" || (event.shiftKey && event.key === "F10")) {
              openAnalysisMenu(event);
            }
          }
        : undefined}
    >
      <div className="mb-1.5 flex items-center gap-2 text-sm text-sub">
        {message.speaker === "agent" ? (
          message.runId !== null && message.role !== null && onLoadRunAgentInfo ? (
            <AgentRunInfoPopover
              sessionId={message.sessionId}
              runId={message.runId}
              role={message.role}
              displayName={resolveOperatorMemberName(message.role, memberIdentities, t)}
              portraitId={resolveOperatorMemberPortrait(message.role, memberIdentities)}
              engine={resolveOperatorMemberEngine(message.role, memberIdentities)}
              loadInfo={onLoadRunAgentInfo}
              onOpenAgentTeamMember={onOpenAgentTeamMember}
              appearance={appearance}
            />
          ) : (
            <RoleTag
              label={resolveOperatorMemberName(message.role, memberIdentities, t)}
              toneKey={message.role ?? "agent"}
              portraitId={resolveOperatorMemberPortrait(message.role, memberIdentities)}
              engine={resolveOperatorMemberEngine(message.role, memberIdentities)}
              className="h-6 w-6 text-xs"
            />
          )
        ) : null}
        <span className="text-ink">
          {message.speaker === "agent"
            ? resolveOperatorMemberName(message.role, memberIdentities, t)
            : t("console.common.systemNotice")}
        </span>
        {message.speaker === "agent"
        && message.runTiming?.elapsedMs !== null
        && message.runTiming?.elapsedMs !== undefined ? (
          <RunTime mode="completed" elapsedMs={message.runTiming.elapsedMs} />
        ) : (
          <span className="tnum text-hint opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100">{formatTime(message.updatedAt, locale)}</span>
        )}
      </div>
      <div className="relative pl-8">
      {message.speaker === "agent" && message.processSteps?.length ? (
        <ProcessTrail steps={message.processSteps} collapsed className="mb-2" />
      ) : null}
      {message.speaker === "system" ? (
        <div className="whitespace-pre-wrap break-words leading-6 text-ink">{systemSummary(message, t)}</div>
      ) : (
        <>
          {message.body.trim() === "" ? null : (
            <MarkdownMessage
              content={message.body}
              mode="static"
              onOpenExternalLink={onOpenExternalLink}
              onOpenConversationReference={onOpenConversationReference}
              onOpenFileReference={onOpenFileReference}
              memberIdentities={memberIdentities}
              onOpenTeamMember={onOpenTeamMember}
            />
          )}
          <StructuredAttachmentList
            attachments={message.attachments ?? []}
            mode="message"
            sourceLabel={t("console.imagePreview.sourceMember", {
              name: resolveOperatorMemberName(message.role, memberIdentities, t),
            })}
            imageGallery={imageGallery}
            onImageOpenFile={onOpenFileReference === undefined
              ? undefined
              : (id) => onOpenFileReference({
                  path: id,
                  line: 1,
                  column: null,
                  hasExplicitLine: false,
                })}
            className={message.body.trim() === "" ? "" : "mt-2"}
          />
        </>
      )}
      {message.speaker === "agent" && message.runId !== null ? (
        <MessageToolbar
          trailing={message.runTiming?.completedAt
            ? <RunCompletedAt completedAt={message.runTiming.completedAt} />
            : null}
        >
          {appearance === "focused" && message.body.trim() !== "" ? (
            <MessageAction
              icon={Copy}
              label={t("console.common.copyMessage")}
              onClick={() => void navigator.clipboard?.writeText(message.body).catch(() => undefined)}
            />
          ) : null}
          {onOpenEvidence ? (
            <MessageAction
              icon={FileText}
              label={t("console.common.fullOutput")}
              onClick={() => onOpenEvidence({
                kind: "run-output",
                sessionId: message.sessionId,
                runId: message.runId!,
                stepId: message.runTiming?.stepId ?? null,
                role: message.role,
                fallbackOutput: message.body,
              })}
            />
          ) : null}
          {onRetryRun ? (
            <MessageAction
              icon={RotateCcw}
              label={t("common.retry")}
              onClick={() => onRetryRun(message.sessionId, message.runId!)}
            />
          ) : null}
          {onAnalyzeConversation ? (
            <ConversationAnalysisMenu
              appearance={appearance}
              open={analysisMenuOpen}
              onOpenChange={setAnalysisMenuOpen}
              returnFocusTarget={analysisMenuReturnFocusRef.current}
              onSelect={() => onAnalyzeConversation({
                sessionId: message.sessionId,
                runId: message.runId,
                messageId: message.id,
              })}
            />
          ) : null}
        </MessageToolbar>
      ) : null}
      </div>
    </div>
  );
}

function TimelinePerformanceBoundary({
  enabled,
  onRender,
  children,
}: {
  enabled: boolean;
  onRender: ProfilerOnRenderCallback;
  children: ReactNode;
}): JSX.Element {
  return enabled
    ? <Profiler id="main-timeline" onRender={onRender}>{children}</Profiler>
    : <>{children}</>;
}

function ConversationAnalysisMenu({
  appearance,
  open,
  onOpenChange,
  returnFocusTarget,
  onSelect,
}: {
  appearance: OperatorConsoleAppearance;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  returnFocusTarget?: HTMLElement | null;
  onSelect(): void;
}): JSX.Element {
  const { t } = useI18n();
  return (
    <div>
      <DropdownMenu open={open} onOpenChange={onOpenChange}>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            className="flex h-6 w-6 items-center justify-center rounded-lg hover:bg-hover hover:text-ink"
            aria-label={t("console.sessionAnalysis.moreActions")}
            title={t("console.sessionAnalysis.moreActions")}
          >
            <Ellipsis className="h-3.5 w-3.5" strokeWidth={1.5} aria-hidden="true" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          align="end"
          className={operatorFloatingSurfaceClassName(appearance)}
          onCloseAutoFocus={(event) => {
            if (returnFocusTarget !== null && returnFocusTarget !== undefined) {
              event.preventDefault();
              returnFocusTarget.focus();
            }
          }}
        >
          <DropdownMenuItem onSelect={onSelect}>
            {t("console.sessionAnalysis.analyzeMessage")}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

function toSidebarProject(project: OperatorProject, t: Translate): ConversationSidebarProject {
  return {
    id: project.projectId,
    path: project.folderPath,
    label: project.title,
    newConversationDisabledReason: project.newConversationDisabledReason,
    directoryAvailable: project.directoryAvailable,
    directoryUnavailableReason: project.directoryUnavailableReason,
    isGitRepository: project.isGitRepository,
    sessions: project.sessions.filter((session) =>
      session.parentSessionId == null && session.analysisParentSessionId == null).map((session) => ({
      id: session.sessionId,
      title: session.title,
      titleRevision: session.titleRevision,
      pinnedAt: session.pinnedAt,
      manualUnreadAt: session.manualUnreadAt,
      readStateRevision: session.readStateRevision,
      attentionRevision: session.attentionRevision,
      hasUnacknowledgedAttention: session.hasUnacknowledgedAttention,
      statusDot: session.statusDot ?? "none",
      branchName: session.branchName ?? project.branchName ?? null,
      branchUnavailable: session.workspaceUnavailableReason != null,
      unreadSince: session.unreadSince,
      isRunning: session.status === "running" || session.runningCount > 0 || session.hasPendingControlWork === true,
      hasManagedProcesses: (session.managedRunningCount ?? 0) > 0,
      hasPendingControlWork: session.hasPendingControlWork ?? false,
      unresolvedSystemEventKind: session.unresolvedSystemEventKind === "run-not-started"
        || session.unresolvedSystemEventKind === "run-stuck"
        || session.unresolvedSystemEventKind === "retry-exhausted"
        ? session.unresolvedSystemEventKind
        : null,
      isNonContinuable: project.directoryAvailable === false || session.continuation?.canContinue === false,
      roundState: session.roundState ?? null,
      analysisDisabledReason: session.analysisRecordAvailable === false
        ? t("console.sessionAnalysis.recordUnavailable")
        : null,
      createdAt: session.createdAt,
      summary: sessionSummary(session, t),
    })),
  };
}

export function parseChildSessionCardIds(body: string): string[] | null {
  try {
    const value = JSON.parse(body) as unknown;
    if (typeof value !== "object" || value === null || !("childSessionIds" in value)) return null;
    const childSessionIds = (value as { childSessionIds?: unknown }).childSessionIds;
    return Array.isArray(childSessionIds) && childSessionIds.every((entry) => typeof entry === "string")
      ? childSessionIds
      : null;
  } catch {
    return null;
  }
}

function isDefined<T>(value: T | undefined): value is T {
  return value !== undefined;
}

function restoreTimelineScroll(
  timelineRef: { current: HTMLElement | null },
  scrollTop: number,
): void {
  const restore = () => {
    if (timelineRef.current !== null) timelineRef.current.scrollTop = scrollTop;
  };
  restore();
  window.requestAnimationFrame(() => {
    restore();
    window.requestAnimationFrame(restore);
  });
}

function sessionSummary(session: OperatorSession, t: Translate): string | undefined {
  if (session.errorCount > 0) {
    return t("console.operator.errors", { count: session.errorCount });
  }
  if (session.stuckCount > 0) {
    return t("console.operator.stuck", { count: session.stuckCount });
  }
  if (session.interruptedCount > 0) {
    return t("console.operator.interrupted", { count: session.interruptedCount });
  }
  return undefined;
}

function terminalOutcome(message: OperatorMessage): RunOutcomeStatus | null {
  if (message.speaker === "system" && message.terminal !== null && message.terminal !== undefined) {
    switch (message.terminal.kind) {
      case "interrupted":
        return message.terminal.subkind === "system" ? "system-stopped" : "user-stopped";
      case "timeout": return "run-stuck";
      case "quota-exhausted": return "quota-exhausted";
      case "rate-limited": return "rate-limited";
      case "auth": return "auth-failed";
      case "crashed": return "run-crashed";
    }
  }
  return message.speaker === "system" && message.systemEventKind !== undefined && message.systemEventKind !== "other"
    ? message.systemEventKind
    : null;
}

function resolveProviderUnavailableKind(
  safeCode: string | null | undefined,
): ProviderUnavailableKind | null {
  switch (safeCode) {
    case "pi-provider-disabled": return "disabled";
    case "pi-provider-needs-attention": return "needs-attention";
    case "pi-provider-missing": return "missing";
    default: return null;
  }
}

function terminalOutcomeDescription(message: OperatorMessage): string | null {
  return message.terminal !== null && message.terminal !== undefined
    ? nonBlank(message.body)
    : isSafeTerminalFailureCode(message.error)
    ? nonBlank(message.body)
    : null;
}

function isSafeTerminalFailureCode(error: string | null | undefined): boolean {
  return error === "codex-cli-upgrade-required"
    || error === "kimi-cli-not-found"
    || error === "kimi-cli-not-executable"
    || error === "kimi-cli-spawn-failed"
    || error === "kimi-cli-exited"
    || error === "kimi-acp-timeout"
    || error === "kimi-acp-interrupted"
    || error === "kimi-quota-exhausted"
    || error === "kimi-rate-limited"
    || error === "kimi-no-complete-result"
    || error === "kimi-empty-response"
    || error === "claude-cli-not-found"
    || error === "claude-cli-not-executable"
    || error === "claude-cli-unsupported-version"
    || error === "claude-cli-spawn-failed"
    || error === "claude-auth-required"
    || error === "claude-profile-invalid"
    || error === "claude-permission-denied"
    || error === "claude-rate-limited"
    || error === "claude-billing-unavailable"
    || error === "claude-service-unavailable"
    || error === "claude-resume-unavailable"
    || error === "claude-protocol-invalid"
    || error === "claude-timeout"
    || error === "claude-cancelled"
    || error === "pi-provider-disabled"
    || error === "pi-provider-needs-attention"
    || error === "pi-provider-missing";
}

function systemSummary(message: OperatorMessage, t: Translate): string {
  return nonBlank(message.body) ?? t("console.operator.systemUpdated");
}

function safeRunSummary(summary: string | null | undefined, t: Translate): string {
  return nonBlank(summary) ?? t("console.runBlock.progress");
}

function terminalTraceForRun(
  run: OperatorRunSnapshot,
  traces: OperatorClaudeTerminalTraces,
): OperatorClaudeTerminalTraceState | null {
  if (run.engine !== "claude") return null;
  return traces.find((trace) => trace.sessionId === run.sessionId && trace.runId === run.runId)?.state
    ?? { status: "connecting", chunks: [], nextCursor: 0 };
}

function runRawOutput(activeRun: OperatorRunSnapshot): string {
  return [activeRun.stdoutTail, activeRun.stderrTail, activeRun.tailDiagnostic].filter(nonBlank).join("\n");
}

function formatTime(value: string, locale: Locale): string {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return value;
  }
  return new Intl.DateTimeFormat(locale, {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(parsed);
}

function prefersReducedMotion(): boolean {
  return typeof window !== "undefined"
    && typeof window.matchMedia === "function"
    && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function nonBlank(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

async function unavailableWorkspaceDiff(): Promise<WorkspaceDiffData> {
  return {
    available: false,
    fileCount: null,
    files: [],
    reason: "workspace-unavailable",
    workspaceMode: "direct",
  };
}

async function unavailableProjectFiles(): Promise<ProjectFilesData> {
  return {
    available: false,
    files: [],
    reason: "workspace-unavailable",
    workspaceMode: "direct",
  };
}

async function unavailableProjectFile(_sessionId: string, filePath: string): Promise<WorkspaceFileContent> {
  return {
    available: false,
    path: filePath,
    lines: [],
    reason: "workspace-unavailable",
  };
}

async function unavailableFileReference(
  _sessionId: string,
  filePath: string,
  line: number,
  column: number | null,
  _hasExplicitLine: boolean,
): Promise<FileReferenceContent> {
  return {
    available: false,
    scope: null,
    isComplete: null,
    path: filePath,
    lines: [],
    reason: "unavailable",
    targetLine: line,
    targetColumn: column,
    relativePath: null,
    text: null,
  };
}

function fileReferenceTabTitle(
  reference: MarkdownFileReference,
  externalPreview: boolean,
  t: Translate,
): string {
  const name = reference.path.split("/").filter(Boolean).at(-1)
    ?? t("console.rightSidebar.fileReference");
  const locatedName = reference.hasExplicitLine
    ? `${name}:${String(reference.line)}${reference.column === null ? "" : `:${String(reference.column)}`}`
    : name;
  return externalPreview
    ? t("console.fileReference.previewTabTitle", { name: locatedName })
    : locatedName;
}
