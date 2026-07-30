import {
  AlertTriangle,
  ArrowDown,
  Diamond,
  Ellipsis,
  FileText,
  PanelLeft,
  PanelLeftClose,
  PanelRight,
  PanelRightClose,
  Plus,
  CircleHelp,
  RefreshCw,
  Search,
  Settings,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
  type Ref,
  type SyntheticEvent,
} from "react";

import {
  type AgentExecutionProfile,
  type AgentExecutionProfileDocument,
  type AgentOfficialUpdateResult,
  type AgentTeamDetailState,
  type AgentTeamSaveAllFailureView,
} from "@/console/agent-team-detail";
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
  type OperatorAgentTeam,
  type OperatorAgentTeamsState,
} from "@/console/agent-teams-page";
import { ConversationEmptyState } from "@/console/conversation-empty-state";
import { ConversationRelayRail } from "@/console/conversation-relay-rail";
import {
  projectConversationRelayEvents,
  type ConversationRelayEvent,
} from "@/console/conversation-relay-rail-model";
import {
  MAIN_CONVERSATION_COLUMN_GUTTER_CLASS,
  MAIN_CONVERSATION_COLUMN_WIDTH_CLASS,
} from "@/console/conversation-layout";
import { ComposerContext } from "@/console/composer-context";
import { ChangeTab, type WorkspaceDiffData } from "@/console/change-tab";
import type { WorkspaceFileContent } from "@/console/file-diff-view";
import {
  FileReferenceTab,
  type FileReferenceContent,
} from "@/console/file-reference-tab";
import type { MarkdownFileReference } from "@/console/markdown-internal-reference";
import { NewConversationPage } from "@/console/new-conversation-page";
import { ProjectFilesTab, type ProjectFilesData } from "@/console/project-files-tab";
import {
  ProcessTab,
  nextProcessTabTitle,
  type OperatorProcessOutputState,
} from "@/console/process-tab";
import type { OperatorProcessInvocationState } from "@/console/process-event";
import {
  resolveOperatorMemberName,
  type OperatorMemberIdentity,
} from "@/console/member-name";
import {
  ConversationSidebar,
  type ConversationSidebarProject,
  type CopySessionLogPathResult,
} from "@/console/conversation-sidebar";
import { RoleComposer, type RoleCompletion } from "@/console/role-composer";
import { RoleTag } from "@/console/role-tag";
import {
  SettingsDialog,
  type LanguageSaveStatus,
  type SettingsAboutState,
  type SettingsSection,
} from "@/console/settings-dialog";
import {
  StructuredAttachmentList,
  hasBlockingComposerAttachment,
  readyComposerAttachmentIds,
  type ComposerAttachment,
  type StructuredAttachment,
} from "@/console/structured-attachments";
import { ResultCard, shouldShowResultCard } from "@/console/result-card";
import { RunBlock } from "@/console/run-block";
import { MarkdownMessage } from "@/console/markdown-message";
import { RunOutcome, type RunOutcomeStatus } from "@/console/run-outcome";
import { RunTime } from "@/console/run-time";
import { SubSessionCard, type SubSessionCardItem } from "@/console/sub-session-card";
import { SubtaskTab, type OperatorSubSessionViewState } from "@/console/subtask-tab";
import { getAgentTeamSelectionLabel } from "@/console/team-selection-label";
import {
  DEFAULT_RIGHT_SIDEBAR_WIDTH_PX,
  RIGHT_SIDEBAR_OVERLAY_WIDTH_PX,
  RightSidebar,
  clampRightSidebarWidth,
  type RightSidebarContentSlots,
} from "@/console/right-sidebar";
import {
  createFileReferenceSourceKey,
  createRunOutputSourceKey,
  dedupeRunOutputTabsByStableStep,
  EMPTY_RIGHT_SIDEBAR_TABS,
  RIGHT_SIDEBAR_BUILTIN_TAB_TITLES,
  openRightSidebarSourceTab,
  parseFileReferenceSourceKey,
  updateRightSidebarProcessScroll,
  parseRunOutputSourceKey,
  type RightSidebarTabsState,
} from "@/console/right-sidebar-tabs";
import {
  TextFragmentList,
  type ComposerTextFragment,
} from "@/console/text-fragment-list";
import {
  containsMachineText,
  machineTextPlaceholders,
  sanitizeMachineText,
} from "@/console/machine-text";
import { cn } from "@/lib/utils";
import { Button } from "@/ui/button";
import { Input } from "@/ui/input";

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
export type OperatorRunnerStatus = "starting" | "running" | "stopped" | "crashed" | "error";
export type OperatorApplicationView = "conversation" | "agent-teams";
export type OperatorProjectListState = "ready" | "loading" | "error";
export type OperatorApplicationOverlay = { kind: "search" };

export const DEFAULT_SIDEBAR_WIDTH_PX = 248;
export const MIN_SIDEBAR_WIDTH_PX = 220;
export const MAX_SIDEBAR_WIDTH_PX = 360;
export const NARROW_WINDOW_WIDTH_PX = 760;
export const STACKED_TEAM_ROW_WINDOW_WIDTH_PX = 1024;
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
  originSessionId?: string | null;
  entryTemplate?: "session-analysis" | null;
  writePolicy?: "normal" | "confirm-current-plan-before-write";
  agentTeamOwnership?: "system" | "user" | null;
  agentTeamId?: string | null;
  agentTeamHealth?: "usable" | "deleted" | "needs-repair" | null;
  agentTeamHealthReason?: string | null;
  agentTeamPendingOwnership?: "system" | "user" | null;
  agentTeamPendingId?: string | null;
  analysisRecordAvailable?: boolean;
  workspaceMode: "direct" | "worktree";
  workspacePendingMode: "direct" | "worktree" | null;
  workspaceUnavailableReason?: string | null;
  branchName?: string | null;
  title: string;
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
  waitingCount: number;
  stuckCount: number;
  errorCount: number;
  interruptedCount: number;
  childCount?: number;
  createdAt: string;
  updatedAt: string;
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
  waitingCount: number;
  stuckCount: number;
  errorCount: number;
}

export interface OperatorMessage {
  id: number;
  sessionId: string;
  speaker: OperatorMessageSpeaker;
  role: string | null;
  body: string;
  status: OperatorMessageStatus;
  runId: string | null;
  runDir: string | null;
  error: string | null;
  systemEventKind?: "run-not-started" | "run-stuck" | "user-stopped" | "resume-unavailable" | "retry-exhausted" | "other";
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
    engine: "codex" | "kimi";
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
  engine?: "codex" | "kimi";
  processOutputAvailable?: boolean;
  activity?: {
    cursor: number;
    kind: "command" | "tool" | "search" | "read" | "edit" | "progress";
    phase: "running" | "completed";
    action: string;
    object: string | null;
    occurredAt: string;
  } | null;
  runDir: string | null;
  cwd: string | null;
  workspaceMode: "direct" | "worktree" | null;
  worktreeUnavailableReason: string | null;
  stdoutTail: string | null;
  stderrTail: string | null;
  liveMarkdown: string | null;
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

export interface OperatorConsoleProps {
  presentation?: "application" | "conversation";
  project: OperatorProject;
  projects?: OperatorProject[];
  selectedProjectId?: string;
  selectedSessionId: string;
  navigationSessionId?: string;
  selectedSession: OperatorSession | null;
  conversationNotice?: ReactNode;
  messages: OperatorMessage[];
  initialReadingMessageId?: number | null;
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
  workspaceDiff?: OperatorWorkspaceDiffSummary;
  composerValue: string;
  composerAttachments?: readonly ComposerAttachment[];
  runnerStatus?: OperatorRunnerStatus;
  sqlitePath?: string;
  lastError?: string | null;
  projectListState?: OperatorProjectListState;
  agentTeamsState?: OperatorAgentTeamsState;
  lastUsedAgentTeamKey?: string | null;
  conversationAgentTeamKey?: string | null;
  selectedAgentTeamKey?: string | null;
  selectedAgentTeamMemberSlug?: string | null;
  agentTeamDetailState?: AgentTeamDetailState | null;
  agentTeamBuilder?: AgentTeamBuilderController;
  newConversation?: OperatorNewConversationState | null;
  activeCliInstallations?: Array<"codex" | "kimi">;
  activeLocale?: Locale;
  pendingLocale?: Locale | null;
  languageSaveStatus?: LanguageSaveStatus;
  settingsAbout?: SettingsAboutState;
  settingsExternalLinks?: {
    releaseNotes: string;
    feedback: string;
    repository: string;
  };
  onSelectLocale?: (locale: Locale) => void;
  onRetryLocaleSave?: () => void;
  onCheckSettingsUpdates?: () => void;
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
  onSubSessionRetry?: (sessionId: string, runId: string) => void;
  onSubSessionInterrupt?: (sessionId: string, runId: string) => void;
  onOpenEvidence?: (intent: OperatorEvidenceOpenIntent) => void;
  onCloseEvidence?: () => void;
  onLoadWorkspaceDiff?: (sessionId: string) => Promise<WorkspaceDiffData>;
  onLoadProjectFiles?: (sessionId: string) => Promise<ProjectFilesData>;
  onLoadProjectFile?: (sessionId: string, filePath: string) => Promise<WorkspaceFileContent>;
  onLoadFileReference?: (
    sessionId: string,
    filePath: string,
    line: number,
    column: number | null,
  ) => Promise<FileReferenceContent>;
  onChangeSessionProject?: (sessionId: string, projectId: string) => void;
  onShowProjectInFolder?: (folderPath: string) => void | Promise<void>;
  onRenameProject?: (projectId: string, title: string) => void | Promise<void>;
  onRemoveProject?: (projectId: string, force: boolean) => void | Promise<void>;
  onSelectFolderForRepair?: (projectId: string) => Promise<string | null>;
  onRepairProjectFolder?: (projectId: string, folderPath: string) => void | Promise<void>;
  onArchiveSession?: (sessionId: string, projectId: string) => void | Promise<void>;
  onCopySessionLogPath?: (sessionId: string, projectId: string) => Promise<CopySessionLogPathResult>;
  onInterrupt(sessionId: string, runId: string): void;
  onRetryRun?: (sessionId: string, runId: string) => void;
  onAnalyzeSession?: (input: { sessionId: string; projectId: string }) => void;
  onAnalyzeConversation?: (input: {
    sessionId: string;
    runId: string | null;
    messageId: number | null;
  }) => void;
  onEditAndResend?: (target: OperatorEditAndResendTarget) => void;
  onOpenDiagnostics?: () => void;
  onReplayOnboarding?: () => void;
  onOpenExternalLink?: (url: string) => void;
  onRetryProjectList?: () => void;
  onRetryAgentTeams?: () => void;
  onCreateAgentTeam?: (information: AgentTeamInformationInput) => Promise<OperatorAgentTeam>;
  onOpenAgentTeam?: (teamKey: string) => void;
  onCloseAgentTeam?: () => void;
  onSelectAgentTeamMember?: (teamKey: string, memberSlug: string) => void;
  onChangeAgentTeamPrimaryAgent?: (teamKey: string, memberSlug: string) => void | Promise<void>;
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
  onSaveAllAgentTeamDrafts?: (teamKey: string) => Promise<{ failures: AgentTeamSaveAllFailureView[] }>;
  onSaveAgentExecutionProfile?: (
    teamKey: string,
    memberSlug: string,
    profile: AgentExecutionProfile,
  ) => Promise<AgentExecutionProfileDocument>;
  onRestoreAgentRecommendedProfile?: (
    teamKey: string,
    memberSlug: string,
  ) => Promise<AgentExecutionProfileDocument>;
  onApplyOfficialAgentTeamUpdate?: (
    teamKey: string,
  ) => Promise<AgentOfficialUpdateResult>;
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
  rightSidebarWidth?: number;
  rightSidebarTabs?: RightSidebarTabsState;
  rightSidebarContentSlots?: RightSidebarContentSlots;
  processOutputs?: Readonly<Record<string, OperatorProcessOutputState>>;
  processInvocationStates?: Readonly<Record<string, OperatorProcessInvocationState>>;
  onLoadProcessInvocation?: (sessionId: string, runId: string) => void;
  onRightSidebarOpenChange?: (open: boolean) => void;
  onRightSidebarWidthChange?: (width: number) => void;
  onRightSidebarTabsChange?: (state: RightSidebarTabsState) => void;
  onBeforeCloseRightSidebarTab?: (tab: import("@/console/right-sidebar-tabs").RightSidebarTab) => boolean;
  onLoadProcessOutputPrevious?: (sourceKey: string, cursor: string) => void;
  className?: string;
}

export function OperatorConsole({
  presentation = "application",
  project,
  projects,
  selectedProjectId,
  selectedSessionId,
  navigationSessionId,
  selectedSession,
  conversationNotice,
  messages,
  initialReadingMessageId = null,
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
  workspaceDiff = { available: false, fileCount: null, reason: "unavailable" },
  composerValue,
  composerAttachments = [],
  lastError,
  projectListState = "ready",
  agentTeamsState = { status: "loading" },
  lastUsedAgentTeamKey = null,
  conversationAgentTeamKey = null,
  selectedAgentTeamKey,
  selectedAgentTeamMemberSlug,
  agentTeamDetailState,
  agentTeamBuilder,
  newConversation = null,
  activeCliInstallations = [],
  activeLocale = "zh-CN",
  pendingLocale = null,
  languageSaveStatus = "idle",
  settingsAbout,
  settingsExternalLinks,
  onSelectLocale,
  onRetryLocaleSave,
  onCheckSettingsUpdates,
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
  onLoadFileReference = unavailableFileReference,
  onChangeSessionProject,
  onShowProjectInFolder,
  onRenameProject,
  onRemoveProject,
  onSelectFolderForRepair,
  onRepairProjectFolder,
  onArchiveSession,
  onCopySessionLogPath,
  onInterrupt,
  onRetryRun,
  onAnalyzeSession,
  onAnalyzeConversation,
  onEditAndResend,
  onOpenDiagnostics,
  onReplayOnboarding,
  onOpenExternalLink,
  onRetryProjectList,
  onRetryAgentTeams,
  onCreateAgentTeam,
  onOpenAgentTeam,
  onCloseAgentTeam,
  onSelectAgentTeamMember,
  onChangeAgentTeamPrimaryAgent,
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
  onApplyOfficialAgentTeamUpdate,
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
  rightSidebarContentSlots,
  processOutputs = {},
  processInvocationStates = {},
  onLoadProcessInvocation,
  onRightSidebarOpenChange,
  onRightSidebarWidthChange,
  onRightSidebarTabsChange,
  onBeforeCloseRightSidebarTab,
  onLoadProcessOutputPrevious,
  className,
}: OperatorConsoleProps): JSX.Element {
  const embeddedConversation = presentation === "conversation";
  const t: Translate = (key, values) => translate(activeLocale, key, values);
  const resolvedAgentTeamFileManagerLabel = agentTeamFileManagerLabel ?? t("console.operator.fileManager");
  const displayedActiveRuns = activeRuns ?? (activeRun === null ? [] : [activeRun]);
  const visiblePendingDispatches = pendingDispatchMessages
    ?? pendingPrimaryMessages.map((message) => ({
      message,
      targetLane: "primary" as const,
      targetRole: null,
      waitingForTeam: false,
    }));
  const [uncontrolledSidebarOpen, setUncontrolledSidebarOpen] = useState(true);
  const [sidebarWidth, setSidebarWidth] = useState(DEFAULT_SIDEBAR_WIDTH_PX);
  const [uncontrolledRightSidebarOpen, setUncontrolledRightSidebarOpen] = useState(false);
  const [uncontrolledRightSidebarWidth, setUncontrolledRightSidebarWidth] = useState(DEFAULT_RIGHT_SIDEBAR_WIDTH_PX);
  const [uncontrolledRightSidebarTabs, setUncontrolledRightSidebarTabs] = useState<RightSidebarTabsState>(
    EMPTY_RIGHT_SIDEBAR_TABS,
  );
  const [isNarrowWindow, setIsNarrowWindow] = useState(() => viewportIsNarrow());
  const [rightSidebarOverlay, setRightSidebarOverlay] = useState(() => viewportUsesRightSidebarOverlay());
  const [useStackedTeamRows, setUseStackedTeamRows] = useState(() => viewportUsesStackedTeamRows());
  const sidebarResizeGestureRef = useRef<SidebarResizeGesture | null>(null);
  const nextRightSidebarTabIdRef = useRef(1);
  const timelineScrollRef = useRef<HTMLElement | null>(null);
  const followTimelineRef = useRef(true);
  const parentScrollTopRef = useRef(0);
  const parentConversationPaneRef = useRef<HTMLDivElement | null>(null);
  const conversationMessageRefs = useRef(new Map<number, HTMLElement>());
  const restoredReadingSessionRef = useRef<string | null>(null);
  const conversationFocusFrameRef = useRef<number | null>(null);
  const conversationHighlightTimerRef = useRef<number | null>(null);
  const settingsTriggerRef = useRef<HTMLButtonElement | null>(null);
  const settingsOpenRef = useRef(false);
  const previousLanguageSaveStatusRef = useRef(languageSaveStatus);
  const previousUpdateStatusRef = useRef(settingsAbout?.updateStatus ?? "idle");
  const nextSettingsNotificationIdRef = useRef(1);
  const [conversationPaneWidth, setConversationPaneWidth] = useState(760);
  const [currentRelayEventId, setCurrentRelayEventId] = useState<string | null>(null);
  const [highlightedMessageId, setHighlightedMessageId] = useState<number | null>(null);
  const [relayFeedback, setRelayFeedback] = useState("");
  const [showJumpToBottom, setShowJumpToBottom] = useState(false);
  const [applicationView, setApplicationView] = useState<OperatorApplicationView>("conversation");
  const [applicationOverlay, setApplicationOverlay] = useState<OperatorApplicationOverlay | null>(null);
  const [fileReferenceContents, setFileReferenceContents] = useState<Record<string, FileReferenceContent>>({});
  const [pendingConversationRoute, setPendingConversationRoute] = useState<{
    run: ConversationRouteAction;
    cancel?: () => void;
  } | null>(null);
  const [conversationRouteConflictOpen, setConversationRouteConflictOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsSection, setSettingsSection] = useState<SettingsSection>("general");
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

  useEffect(() => {
    const currentStatus = settingsAbout?.updateStatus ?? "idle";
    const previousStatus = previousUpdateStatusRef.current;
    previousUpdateStatusRef.current = currentStatus;
    if (previousStatus !== "checking" || currentStatus === "checking" || settingsOpenRef.current) {
      return;
    }
    const message = currentStatus === "available"
      ? t("settings.notification.updateAvailable", { version: settingsAbout?.latestVersion ?? "" })
      : currentStatus === "latest"
        ? t("settings.notification.updateLatest")
        : t("settings.notification.updateFailed");
    setSettingsNotifications((current) => [...current, {
      id: nextSettingsNotificationIdRef.current++,
      section: "about",
      message,
    }]);
  }, [activeLocale, settingsAbout?.latestVersion, settingsAbout?.updateStatus]);

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
  const conversationAgentTeam = agentTeamsState.status === "ready"
    ? agentTeamsState.teams.find((team) => team.teamKey === conversationAgentTeamKey)
    : undefined;
  const pendingConversationAgentTeam = agentTeamsState.status === "ready"
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
    && !isSelectionMutationPending
    && !isSessionProjectUpdating
    && !activeProjectUnavailable
    && !selectedAgentTeamUnavailable
    && !continuationBlocked;
  const emptyConversation = messages.length === 0 && displayedActiveRuns.length === 0;
  const conversationRelayEvents = useMemo(
    () => projectConversationRelayEvents(
      messages,
      (role) => resolveOperatorMemberName(role, memberIdentities, t),
      t,
    ),
    [memberIdentities, messages, t],
  );
  const resultCardVisible = shouldShowResultCard({
    diffAvailable: workspaceDiff.available,
    isRunning: displayedActiveRuns.length > 0 || selectedSession?.status === "running" || (selectedSession?.runningCount ?? 0) > 0,
    lastMessageMentionsAgent: selectedSession?.lastMessageMentionsAgent === true,
    hasCompletedStep: messages.some((message) => message.speaker === "agent" || terminalOutcome(message) !== null),
    hasPendingWork: messages.some((message) => message.status === "pending" || message.status === "running"),
  });
  const requestedSidebarOpen = sidebarOpen ?? uncontrolledSidebarOpen;
  const sidebarAutoCollapsed = requestedSidebarOpen && isNarrowWindow;
  const effectiveSidebarOpen = !embeddedConversation && requestedSidebarOpen && !isNarrowWindow;
  const requestedRightSidebarOpen = rightSidebarOpen ?? uncontrolledRightSidebarOpen;
  const effectiveRightSidebarOpen = !embeddedConversation
    && applicationView === "conversation"
    && requestedRightSidebarOpen;
  const effectiveRightSidebarWidth = clampRightSidebarWidth(
    rightSidebarWidth ?? uncontrolledRightSidebarWidth,
  );
  const effectiveRightSidebarTabs = rightSidebarTabs ?? uncontrolledRightSidebarTabs;
  const latestRightSidebarTabsRef = useRef(effectiveRightSidebarTabs);
  latestRightSidebarTabsRef.current = effectiveRightSidebarTabs;
  const pendingFileReferenceOpensRef = useRef(0);
  const activeRightSidebarTab = effectiveRightSidebarTabs.tabs.find(
    (tab) => tab.id === effectiveRightSidebarTabs.activeTabId,
  ) ?? null;
  const openedSubSessionId = activeRightSidebarTab?.type === "sub-session"
    ? activeRightSidebarTab.sourceKey?.replace(/^sub-session:/u, "") ?? null
    : null;

  useEffect(() => {
    const updateResponsiveLayout = () => {
      setIsNarrowWindow(viewportIsNarrow());
      setRightSidebarOverlay(viewportUsesRightSidebarOverlay());
      setUseStackedTeamRows(viewportUsesStackedTeamRows());
    };
    window.addEventListener("resize", updateResponsiveLayout);
    return () => window.removeEventListener("resize", updateResponsiveLayout);
  }, []);

  useLayoutEffect(() => {
    const pane = parentConversationPaneRef.current;
    if (pane === null) return;
    const update = () => setConversationPaneWidth(Math.round(pane.getBoundingClientRect().width));
    update();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(update);
    observer.observe(pane);
    return () => observer.disconnect();
  }, [applicationView, newConversation]);

  useEffect(() => () => {
    if (conversationFocusFrameRef.current !== null) {
      window.cancelAnimationFrame(conversationFocusFrameRef.current);
    }
    if (conversationHighlightTimerRef.current !== null) {
      window.clearTimeout(conversationHighlightTimerRef.current);
    }
  }, []);

  useLayoutEffect(() => {
    if (restoredReadingSessionRef.current === selectedSessionId) return;
    if (conversationRelayEvents.length === 0) {
      setCurrentRelayEventId(null);
      return;
    }
    if (!messages.some((message) => message.sessionId === selectedSessionId)) return;
    const savedEvent = initialReadingMessageId === null
      ? undefined
      : conversationRelayEvents.find((event) => event.messageId === initialReadingMessageId);
    const targetEvent = savedEvent ?? conversationRelayEvents.at(-1);
    if (targetEvent === undefined) return;
    restoredReadingSessionRef.current = selectedSessionId;
    setCurrentRelayEventId(targetEvent.id);
    onReadingMessageChange?.(selectedSessionId, targetEvent.messageId);

    const timeline = timelineScrollRef.current;
    const target = conversationMessageRefs.current.get(targetEvent.messageId);
    const followsLatest = targetEvent.id === conversationRelayEvents.at(-1)?.id;
    followTimelineRef.current = followsLatest;
    setShowJumpToBottom(!followsLatest);
    if (timeline === null) return;
    if (followsLatest || target === undefined) {
      timeline.scrollTop = timeline.scrollHeight;
      return;
    }
    target.scrollIntoView({ block: "center", behavior: "auto" });
  }, [
    conversationRelayEvents,
    initialReadingMessageId,
    onReadingMessageChange,
    selectedSessionId,
  ]);

  useLayoutEffect(() => {
    const timeline = timelineScrollRef.current;
    if (timeline !== null && followTimelineRef.current) {
      timeline.scrollTop = timeline.scrollHeight;
      const latestEvent = conversationRelayEvents.at(-1);
      if (latestEvent !== undefined) {
        setCurrentRelayEventId(latestEvent.id);
        onReadingMessageChange?.(selectedSessionId, latestEvent.messageId);
      }
    }
  }, [
    conversationRelayEvents,
    messages.length,
    displayedActiveRuns.map((run) => `${run.runId}:${run.lastOutputSummary}:${run.liveMarkdown ?? ""}`).join("|"),
    onReadingMessageChange,
    selectedSessionId,
  ]);

  const locateConversationRelayEvent = (event: ConversationRelayEvent) => {
    const timeline = timelineScrollRef.current;
    const target = conversationMessageRefs.current.get(event.messageId);
    if (timeline === null || target === undefined || !target.isConnected) {
      followTimelineRef.current = false;
      setRelayFeedback(t("console.operator.relayNotFound"));
      return;
    }
    const latestEvent = conversationRelayEvents.at(-1);
    followTimelineRef.current = latestEvent?.id === event.id;
    setShowJumpToBottom(!followTimelineRef.current);
    setCurrentRelayEventId(event.id);
    onReadingMessageChange?.(selectedSessionId, event.messageId);
    target.scrollIntoView({
      block: "center",
      behavior: prefersReducedMotion() ? "auto" : "smooth",
    });
    target.focus({ preventScroll: true });
    setHighlightedMessageId(event.messageId);
    setRelayFeedback(t("console.operator.relayLocated"));
    if (conversationHighlightTimerRef.current !== null) {
      window.clearTimeout(conversationHighlightTimerRef.current);
    }
    conversationHighlightTimerRef.current = window.setTimeout(() => {
      setHighlightedMessageId(null);
    }, prefersReducedMotion() ? 700 : 1500);
  };

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
    pendingFileReferenceOpensRef.current += 1;
    setRightSidebarOpen(true);
    void onLoadFileReference(sessionId, reference.path, reference.line, reference.column)
      .catch(() => unavailableFileReference(
        sessionId,
        reference.path,
        reference.line,
        reference.column,
      ))
      .then((content) => {
        const canonicalReference = { ...reference, path: content.path };
        const sourceKey = createFileReferenceSourceKey(sessionId, canonicalReference);
        setFileReferenceContents((current) => ({ ...current, [sourceKey]: content }));
        updateRightSidebarTabs((current) => openRightSidebarSourceTab(current, {
          id: createRightSidebarTabId(nextRightSidebarTabIdRef),
          type: "file-reference",
          title: fileReferenceTabTitle(canonicalReference, t),
          sourceKey,
        }));
      })
      .finally(() => {
        pendingFileReferenceOpensRef.current = Math.max(
          0,
          pendingFileReferenceOpensRef.current - 1,
        );
      });
  };

  const openMentionedTeamMember = (_slug: string) => {
    if (conversationAgentTeamKey === null || onOpenAgentTeam === undefined) {
      return;
    }
    setApplicationView("agent-teams");
    onOpenAgentTeam(conversationAgentTeamKey);
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
    if (open) {
      parentScrollTopRef.current = timelineScrollRef.current?.scrollTop ?? 0;
    } else {
      restoreTimelineScroll(timelineScrollRef, parentScrollTopRef.current);
      onCloseEvidence?.();
      onCloseSubSession?.();
    }
    if (rightSidebarOpen === undefined) {
      setUncontrolledRightSidebarOpen(open);
    }
    onRightSidebarOpenChange?.(open);
  }

  function setRightSidebarWidth(width: number): void {
    const clamped = clampRightSidebarWidth(width);
    if (rightSidebarWidth === undefined) {
      setUncontrolledRightSidebarWidth(clamped);
    }
    onRightSidebarWidthChange?.(clamped);
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

  return (
    <div className={cn(
      "relative flex overflow-hidden bg-canvas text-ink",
      embeddedConversation ? "h-full min-h-0" : "h-screen min-h-[560px]",
      className,
    )}>
      {!embeddedConversation && activeCliInstallations.length > 0 ? (
        <div
          className="window-no-drag absolute left-1/2 top-2 z-[80] flex -translate-x-1/2 items-center gap-2 rounded-full border border-line bg-card px-3 py-1.5 text-xs text-sub shadow-sm"
          role="status"
          data-testid="operator-cli-install-aggregate"
        >
          <RefreshCw className="h-3 w-3 motion-safe:animate-spin" strokeWidth={1.5} aria-hidden="true" />
          {activeCliInstallations.length === 1
            ? t("console.operator.installingCli", { cli: activeCliInstallations[0] === "codex" ? "Codex" : "Kimi" })
            : t("console.operator.installingClis", { count: activeCliInstallations.length })}
        </div>
      ) : null}
      {!embeddedConversation ? <aside
        className={cn(
          "relative shrink-0 flex-col overflow-hidden border-r border-line bg-rail",
          effectiveSidebarOpen ? "flex" : "hidden",
        )}
        data-testid="operator-sidebar"
        hidden={!effectiveSidebarOpen}
        style={{ width: `${sidebarWidth}px` }}
      >
        <header
          className="window-drag-region flex h-[var(--window-header-height)] shrink-0 items-center justify-end pl-[76px] pr-2"
          data-testid="sidebar-window-controls"
        >
          <button
            type="button"
            className="window-no-drag flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-sub hover:bg-hover hover:text-ink disabled:pointer-events-none disabled:opacity-40"
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
          <span className="truncate font-display text-[14.5px] font-semibold tracking-[-0.01em]">Moebius</span>
        </div>

        <nav
          className="shrink-0 space-y-1 px-2.5 pb-1 pt-3"
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
            icon={Diamond}
            label={translate(activeLocale, "sidebar.agentTeams")}
            selected={applicationView === "agent-teams"}
            statusIndicatorLabel={hasAgentTeamNeedingRepair ? t("console.operator.teamNeedsRepair") : undefined}
            disabled={activeProjectUnavailable}
            disabledReason={activeProject.directoryUnavailableReason ?? undefined}
            onClick={() => setApplicationView("agent-teams")}
          />
        </nav>

        <div className="flex shrink-0 items-center justify-between px-5 pb-1.5 pt-4 text-[11.5px] font-semibold uppercase tracking-[0.06em] text-sub">
          <span>{translate(activeLocale, "sidebar.projects")}</span>
          {projectConfigurationPending
            ? <span role="status">{translate(activeLocale, "sidebar.updating")}</span>
            : null}
        </div>
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
            setProjectActionError(null);
            if (target.runningCount > 0) {
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
          className="min-h-0 w-full flex-1 overflow-hidden border-0"
        />

        <footer className="shrink-0 border-t border-line p-2" data-testid="sidebar-footer">
          <SidebarAction
            icon={CircleHelp}
            label={translate(activeLocale, "sidebar.help")}
            onClick={onReplayOnboarding}
          />
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
        </footer>

        <div
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
          <span className="absolute inset-y-0 right-0 w-px bg-line transition-colors group-hover:bg-accent group-active:bg-accent" />
        </div>
      </aside> : null}

      <div className="relative flex min-w-0 flex-1" data-testid="operator-content-shell">
      <main
        className="relative flex min-w-0 flex-1 flex-col bg-canvas"
        data-testid="operator-main"
        data-sidebar-open={effectiveSidebarOpen ? "true" : "false"}
        data-sidebar-auto-collapsed={sidebarAutoCollapsed ? "true" : "false"}
      >
        {!embeddedConversation ? <div
          className="window-drag-region absolute inset-x-0 top-0 z-30 flex h-[var(--window-header-height)] items-center"
          data-testid="main-window-drag-region"
        >
          {!effectiveSidebarOpen ? (
            <button
              type="button"
              className="window-no-drag z-20 ml-[96px] flex h-7 w-7 items-center justify-center rounded-md text-sub hover:bg-hover hover:text-ink"
              aria-label={t("console.operator.openSidebar")}
              title={t("console.operator.openSidebar")}
              onClick={() => setSidebarOpen(true)}
            >
              <PanelLeft className="h-4 w-4" strokeWidth={1.5} aria-hidden="true" />
            </button>
          ) : null}
          <button
            type="button"
            className="window-no-drag z-20 ml-auto mr-3 flex h-7 w-7 items-center justify-center rounded-md text-sub hover:bg-hover hover:text-ink"
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

        {applicationView === "agent-teams" ? (
          <AgentTeamsPage
            state={agentTeamsState}
            selectedTeamKey={selectedAgentTeamKey}
            selectedMemberSlug={selectedAgentTeamMemberSlug}
            detailState={agentTeamDetailState}
            useStackedRows={useStackedTeamRows}
            aiTeamBuilder={agentTeamBuilder}
            onRetry={onRetryAgentTeams}
            onCreateTeam={onCreateAgentTeam}
            onOpenTeam={onOpenAgentTeam}
            onCloseTeam={onCloseAgentTeam}
            onSelectMember={onSelectAgentTeamMember}
            onChangePrimaryAgent={onChangeAgentTeamPrimaryAgent}
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
            onApplyOfficialUpdate={onApplyOfficialAgentTeamUpdate}
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
                className={cn(
                  "pointer-events-none absolute left-3 top-[var(--window-header-height)] z-20 w-11",
                  visiblePendingDispatches.length > 0 ? "bottom-72" : "bottom-40",
                )}
                data-testid="main-conversation-relay-slot"
              >
                <ConversationRelayRail
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
            <section
              className={cn(
                "scroll-thin min-h-0 flex-1 overflow-auto",
                visiblePendingDispatches.length > 0 ? "pb-72" : "pb-44",
              )}
              aria-label={t("console.operator.timeline")}
              ref={timelineScrollRef}
              onScroll={(event) => {
                const timeline = event.currentTarget;
                const atBottom = timeline.scrollHeight - timeline.scrollTop - timeline.clientHeight <= 48;
                followTimelineRef.current = atBottom;
                setShowJumpToBottom(!atBottom);
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
            >
              {selectedSession ? (
                <header
                  className={cn(
                    "sticky top-0 z-10 flex h-[var(--window-header-height)] items-center bg-canvas",
                    MAIN_CONVERSATION_COLUMN_GUTTER_CLASS,
                  )}
                  data-testid="conversation-title-header"
                >
                  <h1
                    className={cn(
                      "mx-auto w-full truncate text-left font-display text-[15px] font-semibold tracking-[-0.01em] text-ink",
                      MAIN_CONVERSATION_COLUMN_WIDTH_CLASS,
                    )}
                    title={selectedSession.title}
                  >
                    {selectedSession.title}
                  </h1>
                </header>
              ) : null}
              {conversationNotice ? (
                <div className={MAIN_CONVERSATION_COLUMN_GUTTER_CLASS}>
                  <div
                    className={cn(
                      "mx-auto mt-3 rounded-lg border border-line bg-sunken px-3 py-2 text-xs leading-5 text-sub",
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
                <div className={MAIN_CONVERSATION_COLUMN_GUTTER_CLASS}>
                  <div className={cn("mx-auto", MAIN_CONVERSATION_COLUMN_WIDTH_CLASS)}>
                    <div>
                      {messages.map((message) => (
                        <div
                          key={message.id}
                          ref={(element) => {
                            if (element === null) conversationMessageRefs.current.delete(message.id);
                            else conversationMessageRefs.current.set(message.id, element);
                          }}
                          className={cn(
                            "rounded-md outline-none transition-colors",
                            highlightedMessageId === message.id && "bg-accent/10",
                          )}
                          data-message-id={message.id}
                          data-testid={`timeline-message-${String(message.id)}`}
                          tabIndex={-1}
                        >
                          <TimelineEntry
                            message={message}
                            processRole={resolveMessageProcessRole(message, messages)}
                            memberIdentities={memberIdentities}
                            childSessions={childSessions}
                            openedSubSessionId={openedSubSessionId}
                            onOpenSubSession={openSubSession}
                            onRetryRun={onRetryRun}
                            onAnalyzeConversation={onAnalyzeConversation}
                            onEditAndResend={onEditAndResend}
                            onOpenDiagnostics={onOpenDiagnostics}
                            onOpenExternalLink={onOpenExternalLink}
                            onOpenFileReference={(reference) => openFileReference(message.sessionId, reference)}
                            onOpenTeamMember={openMentionedTeamMember}
                            onOpenEvidence={openEvidence}
                          />
                        </div>
                      ))}
                    </div>

                    {displayedActiveRuns.map((run) => {
                      const isPrimaryRun = activeRun?.runId === run.runId;
                      const roleLabel = resolveOperatorMemberName(run.role, memberIdentities, t);
                      return (
                        <div data-testid="active-run-block" data-run-id={run.runId} key={run.runId}>
                          <RunBlock
                            role={run.role ?? "dev"}
                            memberIdentities={memberIdentities}
                            elapsedMs={run.elapsedMs}
                            activity={run.activity}
                            processOutputAvailable={run.processOutputAvailable}
                            outputUnavailableMessage={t("console.common.kimiOutputUnavailable")}
                            summary={safeRunSummary(run.lastOutputSummary, t)}
                            liveMarkdown={run.liveMarkdown}
                            rawOutput={runRawOutput(run)}
                            onOpenExternalLink={onOpenExternalLink}
                            onOpenFileReference={(reference) => openFileReference(run.sessionId, reference)}
                            onOpenTeamMember={openMentionedTeamMember}
                            onOpenOutput={run.processOutputAvailable !== false
                              ? (fallbackOutput) => openEvidence({
                                  kind: "run-output",
                                  sessionId: run.sessionId,
                                  runId: run.runId,
                                  stepId: run.stepId ?? null,
                                  role: run.role,
                                  fallbackOutput,
                                })
                              : undefined}
                            onInterrupt={!isPrimaryRun && run.interruptible
                              ? () => onInterrupt(run.sessionId, run.runId)
                              : undefined}
                            onAnalyzeConversation={onAnalyzeConversation === undefined
                              ? undefined
                              : () => onAnalyzeConversation({
                                  sessionId: run.sessionId,
                                  runId: run.runId,
                                  messageId: null,
                                })}
                            interruptLabel={!isPrimaryRun ? t("console.runBlock.stopMember", { member: roleLabel }) : undefined}
                            className="mt-4 max-w-none"
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

                    {lastError ? (
                      <div className="mt-4 flex items-center justify-between gap-3 border-t border-line py-3 text-sm text-danger">
                        <span>{t("console.operator.consoleError")}</span>
                        {onOpenDiagnostics ? (
                          <Button type="button" variant="outline" size="sm" onClick={onOpenDiagnostics}>
                            {t("console.operator.viewLogs")}
                          </Button>
                        ) : null}
                      </div>
                    ) : null}
                  </div>
                </div>
              )}
            </section>
            <p className="sr-only" aria-live="polite" data-testid="conversation-relay-feedback">
              {relayFeedback}
            </p>

            {showJumpToBottom ? (
              <button
                type="button"
                className={cn(
                  "absolute left-1/2 z-20 flex -translate-x-1/2 items-center gap-1.5 rounded-full border border-line bg-card px-3 py-1.5 text-xs text-sub hover:text-ink",
                  visiblePendingDispatches.length > 0 ? "bottom-64" : "bottom-36",
                )}
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
              className={cn(
                "pointer-events-none absolute inset-x-0 bottom-0 bg-canvas pb-5 pt-3",
                MAIN_CONVERSATION_COLUMN_GUTTER_CLASS,
              )}
            >
                {visiblePendingDispatches.length > 0 ? (
                  <section
                    className={cn(
                      "pointer-events-auto mx-auto mb-2 w-full rounded-[14px] border border-accent/35 bg-accent/10 px-3.5 py-2.5",
                      MAIN_CONVERSATION_COLUMN_WIDTH_CLASS,
                    )}
                    aria-label={t("console.operator.pendingDispatch")}
                    data-testid="primary-pending-zone"
                  >
                    <p className="text-xs font-medium text-accent">{t("console.operator.pendingDispatch")}</p>
                    <ol className="scroll-thin mt-1.5 max-h-24 space-y-1 overflow-y-auto pr-1 text-sm text-ink">
                      {visiblePendingDispatches.map((dispatch, index) => (
                        <li key={dispatch.message.id} className="flex min-w-0 gap-2">
                          <span className="shrink-0 text-sub">{index + 1}</span>
                          <span className="shrink-0 text-accent">
                            {dispatch.waitingForTeam
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
                          <span className="truncate">
                            {dispatch.message.body.trim()
                              || dispatch.message.attachments?.map((attachment) => attachment.displayName).join(", ")
                              || t("console.operator.attachmentMessage")}
                          </span>
                        </li>
                      ))}
                    </ol>
                  </section>
                ) : null}
                <RoleComposer
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
                      : undefined}
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
                    />
                  }
                  className={cn(
                    "pointer-events-auto mx-auto",
                    MAIN_CONVERSATION_COLUMN_WIDTH_CLASS,
                  )}
                />
            </div>
            </div>
          </>
        )}
      </main>
      <RightSidebar
        open={effectiveRightSidebarOpen}
        width={effectiveRightSidebarWidth}
        narrow={rightSidebarOverlay}
        isGitRepository={activeProject.isGitRepository === true}
        state={effectiveRightSidebarTabs}
        onStateChange={updateRightSidebarTabs}
        onOpenChange={setRightSidebarOpen}
        onWidthChange={setRightSidebarWidth}
        onBeforeCloseTab={onBeforeCloseRightSidebarTab}
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
                composerValue={subSessionComposerValue}
                composerAttachments={subSessionComposerAttachments}
                roles={roleCompletionsForTeam(displayedConversationAgentTeam)}
                sending={isSubSessionSending}
                onComposerChange={(value) => onSubSessionComposerChange?.(sessionId, value)}
                onComposerFilesAdded={onSubSessionComposerFilesAdded}
                onComposerAttachmentRemove={onSubSessionComposerAttachmentRemove}
                onComposerAttachmentRetry={onSubSessionComposerAttachmentRetry}
                onSend={() => onSubSessionSend?.(sessionId)}
                onRetry={(runId) => onSubSessionRetry?.(sessionId, runId)}
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
                initialContent={tab.sourceKey === null ? undefined : fileReferenceContents[tab.sourceKey]}
                loadReference={onLoadFileReference}
              />
            );
          },
          "workspace-diff": () => selectedSession === null ? null : (
            <ChangeTab
              sessionId={selectedSession.sessionId}
              workspaceMode={selectedSession.workspaceMode}
              conversationStarted={messages.length > 0}
              isWorking={
                activeRun !== null
                || selectedSession.status === "running"
                || selectedSession.runningCount > 0
              }
              loadDiff={onLoadWorkspaceDiff}
              loadFile={onLoadProjectFile}
            />
          ),
          "project-files": () => selectedSession === null ? null : (
            <ProjectFilesTab
              sessionId={selectedSession.sessionId}
              workspaceMode={selectedSession.workspaceMode}
              loadFiles={onLoadProjectFiles}
              loadFile={onLoadProjectFile}
            />
          ),
          ...rightSidebarContentSlots,
        }}
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
          externalLinkStatus={settingsExternalLinkStatus}
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
          onCopyVersion={() => onCopySettingsVersion?.()}
          onDownloadUpdate={() => openSettingsExternalLink(settingsAbout?.downloadUrl)}
          onOpenReleaseNotes={() => openSettingsExternalLink(settingsExternalLinks?.releaseNotes)}
          onOpenFeedback={() => openSettingsExternalLink(settingsExternalLinks?.feedback)}
          onOpenRepository={() => openSettingsExternalLink(settingsExternalLinks?.repository)}
        />

        {settingsNotifications.length > 0 ? (
          <div
            className="fixed bottom-4 right-4 z-[90] grid w-[min(360px,calc(100vw-32px))] gap-2"
            aria-label={t("settings.title")}
            data-testid="settings-notifications"
          >
            {settingsNotifications.map((notification) => (
              <div
                key={notification.id}
                className="rounded-sm border border-line bg-card p-3 text-sm text-ink shadow-lg"
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
          onCancel={() => {
            if (!isProjectMutationPending) {
              setRenameTarget(null);
            }
          }}
        >
          <label className="grid gap-1.5 text-sm font-medium text-ink">
            {t("console.operator.displayName")}
            <Input
              autoFocus
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
          <dl className="grid gap-3 rounded-lg border border-line bg-rail p-3 text-xs">
            <div className="grid gap-1">
              <dt className="font-medium text-sub">{t("console.operator.oldLocation")}</dt>
              <dd className="break-all text-ink" data-testid="repair-original-folder">{repairRequest.project.folderPath}</dd>
            </div>
            <div className="grid gap-1 border-t border-line pt-3">
              <dt className="font-medium text-sub">{t("console.operator.newLocation")}</dt>
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
          onCancel={() => {
            if (!isProjectMutationPending) {
              setRemovalRequest(null);
            }
          }}
        >
          <p className="rounded-md border border-line bg-rail px-3 py-2 text-xs text-sub">
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

function viewportIsNarrow(): boolean {
  return typeof window !== "undefined" && window.innerWidth < NARROW_WINDOW_WIDTH_PX;
}

function viewportUsesRightSidebarOverlay(): boolean {
  return typeof window !== "undefined" && window.innerWidth < RIGHT_SIDEBAR_OVERLAY_WIDTH_PX;
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

function ProjectActionDialog({
  title,
  description,
  icon,
  error,
  onCancel,
  children,
}: {
  title: string;
  description: string;
  icon?: JSX.Element;
  error?: string | null;
  onCancel(): void;
  children: ReactNode;
}): JSX.Element {
  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 p-6"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) {
          onCancel();
        }
      }}
    >
      <div className="w-full max-w-md rounded-[14px] border border-line bg-sunken p-5 text-ink" role="dialog" aria-modal="true" aria-label={title}>
        <div className="flex items-start gap-3">
          {icon}
          <div className="min-w-0">
            <h2 className="font-display text-base font-semibold tracking-[-0.01em]">{title}</h2>
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
): Promise<void> {
  if (!onRemoveProject) {
    return;
  }
  setError(null);
  try {
    await onRemoveProject(request.project.projectId, request.force);
    close(null);
  } catch (error) {
    setError(error instanceof Error ? error.message : String(error));
  }
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

function SidebarAction({
  icon: Icon,
  label,
  selected = false,
  statusIndicatorLabel,
  onClick,
  disabled = false,
  disabledReason,
  buttonRef,
}: {
  icon: LucideIcon;
  label: string;
  selected?: boolean;
  statusIndicatorLabel?: string;
  onClick?: () => void;
  disabled?: boolean;
  disabledReason?: string;
  buttonRef?: Ref<HTMLButtonElement>;
}): JSX.Element {
  return (
    <button
      ref={buttonRef}
      type="button"
      className={cn(
        "flex h-10 w-full items-center gap-3 rounded-md px-3 text-left text-sm font-medium text-ink hover:bg-hover",
        selected ? "bg-sel" : "bg-transparent",
      )}
      aria-label={label}
      aria-current={selected ? "page" : undefined}
      aria-description={disabled ? disabledReason : undefined}
      title={disabled ? disabledReason ?? label : label}
      disabled={disabled}
      onClick={onClick}
    >
      <Icon
        className={cn("h-[18px] w-[18px] shrink-0", selected ? "text-ink" : "text-sub")}
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
        className="w-full max-w-md rounded-[14px] border border-line bg-sunken p-5"
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
  message,
  processRole,
  memberIdentities,
  childSessions = [],
  openedSubSessionId = null,
  onOpenSubSession,
  onRetryRun,
  onAnalyzeConversation,
  onEditAndResend,
  onOpenDiagnostics,
  onOpenExternalLink,
  onOpenFileReference,
  onOpenTeamMember,
  onOpenEvidence,
}: {
  message: OperatorMessage;
  processRole: string | null;
  memberIdentities: readonly OperatorMemberIdentity[];
  childSessions?: readonly OperatorChildSessionSummary[];
  openedSubSessionId?: string | null;
  onOpenSubSession?: (sessionId: string) => void;
  onRetryRun?: (sessionId: string, runId: string) => void;
  onAnalyzeConversation?: (input: {
    sessionId: string;
    runId: string | null;
    messageId: number | null;
  }) => void;
  onEditAndResend?: (target: OperatorEditAndResendTarget) => void;
  onOpenDiagnostics?: () => void;
  onOpenExternalLink?: (url: string) => void;
  onOpenFileReference?: (reference: MarkdownFileReference) => void;
  onOpenTeamMember?: (slug: string) => void;
  onOpenEvidence?: (intent: OperatorEvidenceOpenIntent) => void;
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
  if (outcome) {
    return (
      <div
        className="relative my-4"
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
        {onAnalyzeConversation ? (
          <ConversationAnalysisMenu
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
        <RunOutcome
          status={outcome}
          role={processRole}
          memberIdentities={memberIdentities}
          rawReason={message.error ?? message.body}
          rawOutput={message.error ?? message.body}
          description={terminalOutcomeDescription(message, t)}
          elapsedMs={message.runTiming?.elapsedMs}
          completedAt={message.runTiming?.completedAt}
          onRetry={(outcome === "run-not-started" || outcome === "run-stuck" || outcome === "resume-unavailable") && message.runId !== null
            ? () => onRetryRun?.(message.sessionId, message.runId!)
            : undefined}
          onEditAndResend={outcome === "user-stopped" && onEditAndResend !== undefined
            ? () => onEditAndResend({
                stoppedMessageId: message.id,
                sessionId: message.sessionId,
                runId: message.runId,
              })
            : undefined}
          onOpenDiagnostics={onOpenDiagnostics}
          onOpenOutput={message.runId === null || message.runTiming?.processOutputAvailable === false ? undefined : (fallbackOutput) => onOpenEvidence?.({
            kind: "run-output",
            sessionId: message.sessionId,
            runId: message.runId!,
            stepId: message.runTiming?.stepId ?? null,
            role: processRole,
            fallbackOutput,
          })}
        />
        {message.runTiming?.processOutputAvailable === false ? (
          <p className="mt-2 pl-7 text-xs text-hint">
            {t("console.common.kimiOutputUnavailable")}
          </p>
        ) : null}
      </div>
    );
  }

  if (message.speaker === "user") {
    return (
      <div className="group py-4 text-sm">
        <div className="mb-1.5 flex items-center justify-end gap-2 text-[12.5px] text-sub">
          <span className="tnum text-hint opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100">{formatTime(message.updatedAt, locale)}</span>
          <span className="font-semibold text-ink">{t("console.common.you")}</span>
          <RoleTag label={t("console.common.you")} toneKey="user" />
        </div>
        <div className="flex justify-end">
          <div className="max-w-[85%] rounded-[14px] border border-line bg-card px-3.5 py-2.5">
            {message.body.trim() === "" ? null : (
              <MarkdownMessage
                content={message.body}
                mode="static"
                onOpenExternalLink={onOpenExternalLink}
                onOpenFileReference={onOpenFileReference}
                memberIdentities={memberIdentities}
                onOpenTeamMember={onOpenTeamMember}
              />
            )}
            <StructuredAttachmentList
              attachments={message.attachments ?? []}
              mode="message"
              className={message.body.trim() === "" ? "" : "mt-2"}
            />
            <TextFragmentList
              fragments={message.textFragments ?? []}
              mode="message"
              className={message.body.trim() === "" && (message.attachments?.length ?? 0) === 0 ? "" : "mt-2"}
            />
          </div>
        </div>
      </div>
    );
  }

  return (
    <div
      className="group py-4 text-sm"
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
      <div className="mb-1.5 flex items-center gap-2 text-[12.5px] text-sub">
        {message.speaker === "agent" ? (
          <RoleTag
            label={resolveOperatorMemberName(message.role, memberIdentities, t)}
            toneKey={message.role ?? "agent"}
          />
        ) : null}
        <span className="font-semibold text-ink">
          {message.speaker === "agent"
            ? resolveOperatorMemberName(message.role, memberIdentities, t)
            : t("console.common.systemNotice")}
        </span>
        {message.speaker === "agent"
        && message.runTiming?.elapsedMs !== null
        && message.runTiming?.elapsedMs !== undefined ? (
          <RunTime
            mode="completed"
            elapsedMs={message.runTiming.elapsedMs}
            completedAt={message.runTiming.completedAt}
          />
        ) : null}
        <span className="tnum text-hint opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100">{formatTime(message.updatedAt, locale)}</span>
        {message.speaker === "agent" && onAnalyzeConversation ? (
          <ConversationAnalysisMenu
            inline
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
      </div>
      <div className="relative pl-7">
      {message.speaker === "system" ? (
        <div className="whitespace-pre-wrap break-words leading-6 text-ink">{systemSummary(message, t)}</div>
      ) : (
        <>
          {message.body.trim() === "" ? null : (
            <MarkdownMessage
              content={message.body}
              mode="static"
              onOpenExternalLink={onOpenExternalLink}
              onOpenFileReference={onOpenFileReference}
              memberIdentities={memberIdentities}
              onOpenTeamMember={onOpenTeamMember}
            />
          )}
          <StructuredAttachmentList
            attachments={message.attachments ?? []}
            mode="message"
            className={message.body.trim() === "" ? "" : "mt-2"}
          />
        </>
      )}
      {message.speaker === "agent"
      && message.runId !== null
      && onOpenEvidence
      && message.runTiming?.processOutputAvailable !== false ? (
        <button
          type="button"
          className="absolute left-7 top-full z-10 mt-1 flex h-6 w-6 items-center justify-center rounded-md text-sub opacity-0 transition-[color,background-color,opacity] hover:bg-hover hover:text-ink focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent group-hover:opacity-100 group-focus-within:opacity-100"
          aria-label={t("console.common.fullOutput")}
          title={t("console.common.fullOutput")}
          onClick={() => onOpenEvidence({
            kind: "run-output",
            sessionId: message.sessionId,
            runId: message.runId!,
            stepId: message.runTiming?.stepId ?? null,
            role: message.role,
            fallbackOutput: message.body,
          })}
        >
          <FileText className="h-3.5 w-3.5" strokeWidth={1.5} aria-hidden="true" />
        </button>
      ) : null}
      {message.speaker === "agent" && message.runTiming?.processOutputAvailable === false ? (
        <p className="mt-2 text-xs text-hint">
          {t("console.common.kimiOutputUnavailable")}
        </p>
      ) : null}
      </div>
    </div>
  );
}

function ConversationAnalysisMenu({
  inline = false,
  open,
  onOpenChange,
  returnFocusTarget,
  onSelect,
}: {
  inline?: boolean;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  returnFocusTarget?: HTMLElement | null;
  onSelect(): void;
}): JSX.Element {
  const { t } = useI18n();
  return (
    <div className={inline ? "ml-auto" : "absolute right-0 top-0 z-10"}>
      <DropdownMenu open={open} onOpenChange={onOpenChange}>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            className="flex h-6 w-6 items-center justify-center rounded-md text-sub opacity-0 transition-opacity hover:bg-hover hover:text-ink focus-visible:opacity-100 group-hover:opacity-100 group-focus-within:opacity-100"
            aria-label={t("console.sessionAnalysis.moreActions")}
            title={t("console.sessionAnalysis.moreActions")}
          >
            <Ellipsis className="h-3.5 w-3.5" strokeWidth={1.5} aria-hidden="true" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          align="end"
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
    sessions: project.sessions.filter((session) => session.parentSessionId == null).map((session) => ({
      id: session.sessionId,
      title: session.title,
      unreadSince: session.unreadSince,
      isRunning: session.status === "running" || session.runningCount > 0 || session.hasPendingControlWork === true,
      hasPendingControlWork: session.hasPendingControlWork ?? false,
      unresolvedSystemEventKind: session.unresolvedSystemEventKind === "run-not-started"
        || session.unresolvedSystemEventKind === "run-stuck"
        || session.unresolvedSystemEventKind === "retry-exhausted"
        ? session.unresolvedSystemEventKind
        : null,
      isNonContinuable: project.directoryAvailable === false || session.continuation?.canContinue === false,
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
  return message.speaker === "system" && message.systemEventKind !== undefined && message.systemEventKind !== "other"
    ? message.systemEventKind
    : null;
}

function terminalOutcomeDescription(message: OperatorMessage, t: Translate): string | null {
  return isSafeTerminalFailureCode(message.error)
    ? sanitizeMachineText(
        message.body,
        machineTextPlaceholders(t).machine,
        machineTextPlaceholders(t),
      )
    : null;
}

function isSafeTerminalFailureCode(error: string | null | undefined): boolean {
  return error === "codex-cli-upgrade-required"
    || error === "kimi-cli-not-found"
    || error === "kimi-cli-not-executable"
    || error === "kimi-cli-spawn-failed"
    || error === "kimi-cli-exited"
    || error === "kimi-acp-timeout";
}

function systemSummary(message: OperatorMessage, t: Translate): string {
  return sanitizeMachineText(
    message.body,
    t("console.operator.systemUpdated"),
    machineTextPlaceholders(t),
  );
}

function safeRunSummary(summary: string | null | undefined, t: Translate): string {
  const text = nonBlank(summary);
  if (!text || containsMachineText(text)) {
    return t("console.runBlock.progress");
  }
  return sanitizeMachineText(
    text,
    t("console.runBlock.progress"),
    machineTextPlaceholders(t),
  );
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
): Promise<FileReferenceContent> {
  return {
    available: false,
    path: filePath,
    lines: [],
    reason: "unavailable",
    targetLine: line,
    targetColumn: column,
  };
}

function fileReferenceTabTitle(reference: MarkdownFileReference, t: Translate): string {
  const name = reference.path.split("/").filter(Boolean).at(-1)
    ?? t("console.rightSidebar.fileReference");
  const column = reference.column === null ? "" : `:${String(reference.column)}`;
  return `${name}:${String(reference.line)}${column}`;
}
