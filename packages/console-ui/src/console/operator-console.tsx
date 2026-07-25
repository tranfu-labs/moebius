import {
  AlertTriangle,
  ArrowDown,
  Diamond,
  FileText,
  PanelLeft,
  PanelLeftClose,
  PanelRight,
  PanelRightClose,
  Plus,
  CircleHelp,
  Search,
  Settings,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";

import {
  type AgentTeamDetailState,
  type AgentTeamSaveAllFailureView,
} from "@/console/agent-team-detail";
import { MoebiusLogo } from "@/brand/moebius-logo";
import {
  AgentTeamsPage,
  type AgentTeamBuilderController,
  type AgentTeamInformationInput,
  type OperatorAgentTeam,
  type OperatorAgentTeamsState,
} from "@/console/agent-teams-page";
import { ConversationEmptyState } from "@/console/conversation-empty-state";
import {
  MAIN_CONVERSATION_COLUMN_GUTTER_CLASS,
  MAIN_CONVERSATION_COLUMN_WIDTH_CLASS,
} from "@/console/conversation-layout";
import { ComposerContext } from "@/console/composer-context";
import { ChangeTab, type WorkspaceDiffData } from "@/console/change-tab";
import type { WorkspaceFileContent } from "@/console/file-diff-view";
import { NewConversationPage } from "@/console/new-conversation-page";
import { ProjectFilesTab, type ProjectFilesData } from "@/console/project-files-tab";
import {
  ProcessTab,
  nextProcessTabTitle,
  type OperatorProcessOutputState,
} from "@/console/process-tab";
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
import { SubSessionCard, type SubSessionCardItem } from "@/console/sub-session-card";
import { SubtaskTab, type OperatorSubSessionViewState } from "@/console/subtask-tab";
import {
  DEFAULT_RIGHT_SIDEBAR_WIDTH_PX,
  RIGHT_SIDEBAR_OVERLAY_WIDTH_PX,
  RightSidebar,
  clampRightSidebarWidth,
} from "@/console/right-sidebar";
import {
  createRunOutputSourceKey,
  EMPTY_RIGHT_SIDEBAR_TABS,
  ensureRightSidebarTabsForOpen,
  openRightSidebarSourceTab,
  updateRightSidebarProcessScroll,
  parseRunOutputSourceKey,
  type RightSidebarTabsState,
} from "@/console/right-sidebar-tabs";
import { containsMachineText, sanitizeMachineText } from "@/console/machine-text";
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
const AGENT_TEAMS_REPAIR_INDICATOR_LABEL = "有 Agent 团队需要修复";

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
  agentTeamOwnership?: "system" | "user" | null;
  agentTeamId?: string | null;
  agentTeamHealth?: "usable" | "deleted" | "needs-repair" | null;
  agentTeamHealthReason?: string | null;
  agentTeamPendingOwnership?: "system" | "user" | null;
  agentTeamPendingId?: string | null;
  workspaceMode: "direct" | "worktree";
  workspacePendingMode: "direct" | "worktree" | null;
  workspaceUnavailableReason?: string | null;
  branchName?: string | null;
  title: string;
  status: OperatorSessionStatus;
  awaitsHumanReason: "answer" | "confirmation" | "acceptance" | "exception" | null;
  unreadSince: string | null;
  unresolvedSystemEventKind?: "run-not-started" | "run-stuck" | "user-stopped" | "retry-exhausted" | "other" | null;
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
  systemEventKind?: "run-not-started" | "run-stuck" | "user-stopped" | "retry-exhausted" | "other";
  sourceKind?: string | null;
  sourceId?: string | null;
  createdAt: string;
  updatedAt: string;
  attachments?: StructuredAttachment[];
}

export type OperatorChildSessionSummary = SubSessionCardItem;

export interface OperatorSubSessionView {
  session: OperatorSession;
  messages: OperatorMessage[];
  memberIdentities?: OperatorMemberIdentity[];
  activeRun: OperatorRunSnapshot | null;
}

export type OperatorEvidenceOpenIntent =
  | { kind: "workspace-diff"; sessionId: string; fileCount: number }
  | {
      kind: "run-output";
      sessionId: string;
      runId: string;
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
  startedAt: string;
  elapsedMs: number;
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
}

export interface OperatorEditAndResendTarget {
  stoppedMessageId: number;
  sessionId: string;
  runId: string | null;
}

export interface OperatorConsoleProps {
  project: OperatorProject;
  projects?: OperatorProject[];
  selectedProjectId?: string;
  selectedSessionId: string;
  selectedSession: OperatorSession | null;
  messages: OperatorMessage[];
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
  processOutputs?: Readonly<Record<string, OperatorProcessOutputState>>;
  onRightSidebarOpenChange?: (open: boolean) => void;
  onRightSidebarWidthChange?: (width: number) => void;
  onRightSidebarTabsChange?: (state: RightSidebarTabsState) => void;
  onLoadProcessOutputPrevious?: (sourceKey: string, cursor: string) => void;
  className?: string;
}

export function OperatorConsole({
  project,
  projects,
  selectedProjectId,
  selectedSessionId,
  selectedSession,
  messages,
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
  onDuplicateBuiltInAgentTeam,
  onRecheckAgentTeam,
  onRelocateAgentTeam,
  onRemoveAgentTeamRecord,
  agentTeamFileManagerLabel = "在文件管理器中打开",
  onOpenAgentTeamLocation,
  onDuplicateUserAgentTeam,
  onDuplicateAgentTeamMember,
  onTrashAgentTeamMember,
  onTrashUserAgentTeam,
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
  processOutputs = {},
  onRightSidebarOpenChange,
  onRightSidebarWidthChange,
  onRightSidebarTabsChange,
  onLoadProcessOutputPrevious,
  className,
}: OperatorConsoleProps): JSX.Element {
  const displayedActiveRuns = activeRuns ?? (activeRun === null ? [] : [activeRun]);
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
  const [showJumpToBottom, setShowJumpToBottom] = useState(false);
  const [applicationView, setApplicationView] = useState<OperatorApplicationView>("conversation");
  const [applicationOverlay, setApplicationOverlay] = useState<OperatorApplicationOverlay | null>(null);
  const [pendingConversationRoute, setPendingConversationRoute] = useState<{
    run: ConversationRouteAction;
    cancel?: () => void;
  } | null>(null);
  const [conversationRouteConflictOpen, setConversationRouteConflictOpen] = useState(false);
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
  const sidebarProjects = visibleProjects.map(toSidebarProject);
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
  const resultCardVisible = shouldShowResultCard({
    diffAvailable: workspaceDiff.available,
    isRunning: displayedActiveRuns.length > 0 || selectedSession?.status === "running" || (selectedSession?.runningCount ?? 0) > 0,
    lastMessageMentionsAgent: selectedSession?.lastMessageMentionsAgent === true,
    hasCompletedStep: messages.some((message) => message.speaker === "agent" || terminalOutcome(message) !== null),
    hasPendingWork: messages.some((message) => message.status === "pending" || message.status === "running"),
  });
  const requestedSidebarOpen = sidebarOpen ?? uncontrolledSidebarOpen;
  const sidebarAutoCollapsed = requestedSidebarOpen && isNarrowWindow;
  const effectiveSidebarOpen = requestedSidebarOpen && !isNarrowWindow;
  const requestedRightSidebarOpen = rightSidebarOpen ?? uncontrolledRightSidebarOpen;
  const effectiveRightSidebarOpen = applicationView === "conversation" && requestedRightSidebarOpen;
  const effectiveRightSidebarWidth = clampRightSidebarWidth(
    rightSidebarWidth ?? uncontrolledRightSidebarWidth,
  );
  const effectiveRightSidebarTabs = rightSidebarTabs ?? uncontrolledRightSidebarTabs;
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

  useEffect(() => {
    if (!effectiveRightSidebarOpen || effectiveRightSidebarTabs.tabs.length > 0) {
      return;
    }
    const nextState = ensureRightSidebarTabsForOpen(effectiveRightSidebarTabs, {
      id: createRightSidebarTabId(nextRightSidebarTabIdRef),
      isGitRepository: activeProject.isGitRepository === true,
    });
    if (rightSidebarTabs === undefined) {
      setUncontrolledRightSidebarTabs(nextState);
    }
    onRightSidebarTabsChange?.(nextState);
  }, [
    activeProject.isGitRepository,
    effectiveRightSidebarOpen,
    effectiveRightSidebarTabs,
    onRightSidebarTabsChange,
    rightSidebarTabs,
  ]);

  useEffect(() => {
    followTimelineRef.current = true;
    setShowJumpToBottom(false);
  }, [selectedSessionId]);

  useLayoutEffect(() => {
    const timeline = timelineScrollRef.current;
    if (timeline !== null && followTimelineRef.current) {
      timeline.scrollTop = timeline.scrollHeight;
    }
  }, [
    messages.length,
    displayedActiveRuns.map((run) => `${run.runId}:${run.lastOutputSummary}:${run.liveMarkdown ?? ""}`).join("|"),
    selectedSessionId,
  ]);

  const openSubSession = (sessionId: string) => {
    parentScrollTopRef.current = timelineScrollRef.current?.scrollTop ?? 0;
    const childSession = childSessions.find((session) => session.sessionId === sessionId);
    setRightSidebarOpen(true, { ensureTabs: false });
    updateRightSidebarTabs(openRightSidebarSourceTab(effectiveRightSidebarTabs, {
      id: createRightSidebarTabId(nextRightSidebarTabIdRef),
      type: "sub-session",
      title: childSession?.title ?? "子任务",
      sourceKey: `sub-session:${sessionId}`,
    }));
    onOpenSubSession?.(sessionId);
  };

  const openEvidence = (
    intent: OperatorEvidenceOpenIntent,
    identities: readonly OperatorMemberIdentity[] = memberIdentities,
  ) => {
    parentScrollTopRef.current = timelineScrollRef.current?.scrollTop ?? 0;
    setRightSidebarOpen(true, { ensureTabs: false });
    updateRightSidebarTabs(openRightSidebarSourceTab(effectiveRightSidebarTabs, intent.kind === "workspace-diff"
      ? {
          id: createRightSidebarTabId(nextRightSidebarTabIdRef),
          type: "workspace-diff",
          title: "改动",
          sourceKey: `workspace-diff:${intent.sessionId}`,
        }
      : {
          id: createRightSidebarTabId(nextRightSidebarTabIdRef),
          type: "run-output",
          title: nextProcessTabTitle(effectiveRightSidebarTabs, intent.role, identities),
          sourceKey: createRunOutputSourceKey(intent.sessionId, intent.runId),
        }));
    onOpenEvidence?.(intent);
  };

  const setSidebarOpen = (open: boolean) => {
    if (sidebarOpen === undefined) {
      setUncontrolledSidebarOpen(open);
    }
    onSidebarOpenChange?.(open);
  };

  function updateRightSidebarTabs(nextState: RightSidebarTabsState): void {
    if (rightSidebarTabs === undefined) {
      setUncontrolledRightSidebarTabs(nextState);
    }
    onRightSidebarTabsChange?.(nextState);
  }

  function setRightSidebarOpen(open: boolean, options: { ensureTabs?: boolean } = {}): void {
    if (open) {
      parentScrollTopRef.current = timelineScrollRef.current?.scrollTop ?? 0;
      if (options.ensureTabs !== false && effectiveRightSidebarTabs.tabs.length === 0) {
        updateRightSidebarTabs(ensureRightSidebarTabsForOpen(effectiveRightSidebarTabs, {
          id: createRightSidebarTabId(nextRightSidebarTabIdRef),
          isGitRepository: activeProject.isGitRepository === true,
        }));
      }
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
    <div className={cn("relative flex h-screen min-h-[560px] overflow-hidden bg-canvas text-ink", className)}>
      <aside
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
            aria-label="关闭侧边栏"
            title="关闭侧边栏"
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

        <nav className="shrink-0 space-y-1 px-2.5 pb-1 pt-3" aria-label="应用导航" data-testid="sidebar-app-actions">
          <SidebarAction
            icon={Plus}
            label="新建对话"
            selected={newConversation !== null && applicationView === "conversation"}
            disabled={projectListUnavailable || isSelectionMutationPending || projectConfigurationPending}
            disabledReason={(projectListUnavailable ? "项目数据尚不可用" : undefined)
              ?? (isSelectionMutationPending || projectConfigurationPending ? "项目正在变更，请稍后再试" : undefined)}
            onClick={() => openNewConversation()}
          />
          <SidebarAction
            icon={Search}
            label="搜索"
            disabled={projectListUnavailable}
            disabledReason={projectListUnavailable ? "项目数据尚不可用" : undefined}
            onClick={() => setApplicationOverlay({ kind: "search" })}
          />
          <SidebarAction
            icon={Diamond}
            label="Agent 团队"
            selected={applicationView === "agent-teams"}
            statusIndicatorLabel={hasAgentTeamNeedingRepair ? AGENT_TEAMS_REPAIR_INDICATOR_LABEL : undefined}
            disabled={activeProjectUnavailable}
            disabledReason={activeProject.directoryUnavailableReason ?? undefined}
            onClick={() => setApplicationView("agent-teams")}
          />
        </nav>

        <div className="flex shrink-0 items-center justify-between px-5 pb-1.5 pt-4 text-[11.5px] font-semibold uppercase tracking-[0.06em] text-sub">
          <span>项目</span>
          {projectConfigurationPending ? <span role="status">正在更新…</span> : null}
        </div>
        <ConversationSidebar
          projects={sidebarProjects}
          dataState={projectListState}
          selectedSessionId={newConversation === null ? selectedSessionId : undefined}
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
          disabledReason="项目正在变更，请稍后再试"
          projectActionsDisabled={projectConfigurationPending}
          projectActionsDisabledReason="项目配置正在更新"
          className="min-h-0 w-full flex-1 overflow-hidden border-0"
        />

        <footer className="shrink-0 border-t border-line p-2" data-testid="sidebar-footer">
          <SidebarAction
            icon={CircleHelp}
            label="重新查看引导"
            onClick={onReplayOnboarding}
          />
          <SidebarAction icon={Settings} label="设置" />
        </footer>

        <div
          className="window-no-drag group absolute inset-y-0 right-0 z-30 w-1 cursor-col-resize touch-none"
          role="separator"
          aria-label="调整侧边栏宽度"
          aria-orientation="vertical"
          aria-valuemin={MIN_SIDEBAR_WIDTH_PX}
          aria-valuemax={MAX_SIDEBAR_WIDTH_PX}
          aria-valuenow={sidebarWidth}
          aria-valuetext={`${sidebarWidth} 像素`}
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
      </aside>

      <div className="relative flex min-w-0 flex-1" data-testid="operator-content-shell">
      <main
        className="relative flex min-w-0 flex-1 flex-col bg-canvas"
        data-testid="operator-main"
        data-sidebar-open={effectiveSidebarOpen ? "true" : "false"}
        data-sidebar-auto-collapsed={sidebarAutoCollapsed ? "true" : "false"}
      >
        <div
          className="window-drag-region absolute inset-x-0 top-0 z-30 flex h-[var(--window-header-height)] items-center"
          data-testid="main-window-drag-region"
        >
          {!effectiveSidebarOpen ? (
            <button
              type="button"
              className="window-no-drag z-20 ml-[96px] flex h-7 w-7 items-center justify-center rounded-md text-sub hover:bg-hover hover:text-ink"
              aria-label="打开侧边栏"
              title="打开侧边栏"
              onClick={() => setSidebarOpen(true)}
            >
              <PanelLeft className="h-4 w-4" strokeWidth={1.5} aria-hidden="true" />
            </button>
          ) : null}
          <button
            type="button"
            className="window-no-drag z-20 ml-auto mr-3 flex h-7 w-7 items-center justify-center rounded-md text-sub hover:bg-hover hover:text-ink"
            aria-label={requestedRightSidebarOpen ? "隐藏右侧栏" : "显示右侧栏"}
            title={requestedRightSidebarOpen ? "隐藏右侧栏" : "显示右侧栏"}
            aria-pressed={requestedRightSidebarOpen}
            onClick={() => setRightSidebarOpen(!requestedRightSidebarOpen)}
          >
            {requestedRightSidebarOpen ? (
              <PanelRightClose className="h-4 w-4" strokeWidth={1.5} aria-hidden="true" />
            ) : (
              <PanelRight className="h-4 w-4" strokeWidth={1.5} aria-hidden="true" />
            )}
          </button>
        </div>

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
            onDuplicateBuiltInTeam={onDuplicateBuiltInAgentTeam}
            onRecheckTeam={onRecheckAgentTeam}
            onRelocateTeam={onRelocateAgentTeam}
            onRemoveTeamRecord={onRemoveAgentTeamRecord}
            fileManagerActionLabel={agentTeamFileManagerLabel}
            onOpenLocation={onOpenAgentTeamLocation}
            onDuplicateUserTeam={onDuplicateUserAgentTeam}
            onDuplicateMember={onDuplicateAgentTeamMember}
            onTrashMember={onTrashAgentTeamMember}
            onTrashUserTeam={onTrashUserAgentTeam}
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
                .filter((team) => team.canCreateConversation)
                .map((team) => ({
                  teamKey: team.teamKey,
                  label: team.name?.trim() || "未命名团队",
                  members: team.members,
                }))
              : []}
            selectedProjectId={newConversation.selectedProjectId}
            selectedWorkspaceMode={newConversation.selectedWorkspaceMode}
            selectedTeamKey={newConversation.selectedTeamKey}
            draft={newConversation.draft}
            attachments={composerAttachments}
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
            onSubmit={() => onSubmitNewConversation?.()}
          />
        ) : (
          <>
            <div
              className="relative flex min-h-0 flex-1 flex-col"
              data-testid="parent-conversation-pane"
            >
            <section
              className={cn(
                "scroll-thin min-h-0 flex-1 overflow-auto",
                pendingPrimaryMessages.length > 0 ? "pb-72" : "pb-44",
              )}
              aria-label="会话时间线"
              ref={timelineScrollRef}
              onScroll={(event) => {
                const timeline = event.currentTarget;
                const atBottom = timeline.scrollHeight - timeline.scrollTop - timeline.clientHeight <= 48;
                followTimelineRef.current = atBottom;
                setShowJumpToBottom(!atBottom);
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
                        <TimelineEntry
                          key={message.id}
                          message={message}
                          memberIdentities={memberIdentities}
                          childSessions={childSessions}
                          openedSubSessionId={openedSubSessionId}
                          onOpenSubSession={openSubSession}
                          onRetryRun={onRetryRun}
                          onEditAndResend={onEditAndResend}
                          onOpenDiagnostics={onOpenDiagnostics}
                          onOpenExternalLink={onOpenExternalLink}
                          onOpenEvidence={openEvidence}
                        />
                      ))}
                    </div>

                    {displayedActiveRuns.map((run) => {
                      const isPrimaryRun = activeRun?.runId === run.runId;
                      const roleLabel = resolveOperatorMemberName(run.role, memberIdentities);
                      return (
                        <div data-testid="active-run-block" data-run-id={run.runId} key={run.runId}>
                          <RunBlock
                            role={run.role ?? "dev"}
                            memberIdentities={memberIdentities}
                            summary={safeRunSummary(run.lastOutputSummary)}
                            liveMarkdown={run.liveMarkdown}
                            rawOutput={runRawOutput(run)}
                            onOpenExternalLink={onOpenExternalLink}
                            onOpenOutput={(fallbackOutput) => openEvidence({
                              kind: "run-output",
                              sessionId: run.sessionId,
                              runId: run.runId,
                              role: run.role,
                              fallbackOutput,
                            })}
                            onInterrupt={!isPrimaryRun && run.interruptible
                              ? () => onInterrupt(run.sessionId, run.runId)
                              : undefined}
                            interruptLabel={!isPrimaryRun ? `停下${roleLabel}` : undefined}
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
                        <span>操作台遇到问题，请打开开发者诊断查看日志。</span>
                        {onOpenDiagnostics ? (
                          <Button type="button" variant="outline" size="sm" onClick={onOpenDiagnostics}>
                            查看日志
                          </Button>
                        ) : null}
                      </div>
                    ) : null}
                  </div>
                </div>
              )}
            </section>

            {showJumpToBottom ? (
              <button
                type="button"
                className={cn(
                  "absolute left-1/2 z-20 flex -translate-x-1/2 items-center gap-1.5 rounded-full border border-line bg-card px-3 py-1.5 text-xs text-sub hover:text-ink",
                  pendingPrimaryMessages.length > 0 ? "bottom-64" : "bottom-36",
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
                回到底部
              </button>
            ) : null}

            <div
              className={cn(
                "pointer-events-none absolute inset-x-0 bottom-0 bg-canvas pb-5 pt-3",
                MAIN_CONVERSATION_COLUMN_GUTTER_CLASS,
              )}
            >
                {pendingPrimaryMessages.length > 0 ? (
                  <section
                    className={cn(
                      "pointer-events-auto mx-auto mb-2 w-full rounded-[14px] border border-accent/35 bg-accent/10 px-3.5 py-2.5",
                      MAIN_CONVERSATION_COLUMN_WIDTH_CLASS,
                    )}
                    aria-label="待发射给主理人"
                    data-testid="primary-pending-zone"
                  >
                    <p className="text-xs font-medium text-accent">待发射给主理人</p>
                    <ol className="scroll-thin mt-1.5 max-h-24 space-y-1 overflow-y-auto pr-1 text-sm text-ink">
                      {pendingPrimaryMessages.map((message, index) => (
                        <li key={message.id} className="flex min-w-0 gap-2">
                          <span className="shrink-0 text-sub">{index + 1}</span>
                          <span className="truncate">
                            {message.body.trim() || message.attachments?.map((attachment) => attachment.displayName).join("、") || "附件消息"}
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
                    ? "项目文件夹不可用，请先使用红色扳手修复"
                    : selectedSession?.agentTeamHealth === "deleted"
                      ? "这支团队已删除，请改选一支团队"
                      : selectedAgentTeamUnavailable
                        ? "当前 Agent 团队需要修复"
                        : continuationBlocked
                          ? selectedSession?.continuation?.reason ?? "当前对话暂时不能继续"
                      : activeRun
                        ? "继续告诉主理人…"
                        : "告诉主理人你的目标…"}
                  statusText={activeProjectUnavailable
                    ? "历史对话只读；修复文件夹后可继续"
                    : selectedSession?.agentTeamHealth === "deleted"
                      ? "历史对话只读；改选一支团队后可继续"
                      : selectedAgentTeamUnavailable
                        ? "历史对话只读；修复或改选团队后可继续"
                        : continuationBlocked
                          ? selectedSession?.continuation?.reason ?? "历史对话只读"
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
              />
            );
          },
          "run-output": (tab) => {
            const locator = parseRunOutputSourceKey(tab.sourceKey, selectedSessionId);
            const subSessionState = locator === null
              ? undefined
              : subSessionViews[locator.sessionId];
            const processMemberIdentities = locator === null || locator.sessionId === selectedSessionId
              ? memberIdentities
              : subSessionState?.status === "ready"
                ? subSessionState.view.memberIdentities ?? []
                : [];
            return (
              <ProcessTab
                title={tab.title}
                state={tab.sourceKey === null
                  ? { status: "idle" }
                  : processOutputs[tab.sourceKey] ?? { status: "idle" }}
                memberIdentities={processMemberIdentities}
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
                onOpenExternalLink={onOpenExternalLink}
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
        }}
      />
      </div>

      {applicationOverlay ? (
        <ApplicationPlaceholder overlay={applicationOverlay} onClose={() => setApplicationOverlay(null)} />
      ) : null}

      {renameTarget ? (
        <ProjectActionDialog
          title="修改显示名称"
          description="只修改 Moebius 中显示的名称，不会重命名磁盘文件夹。留空会恢复为文件夹名。"
          error={projectActionError}
          onCancel={() => {
            if (!isProjectMutationPending) {
              setRenameTarget(null);
            }
          }}
        >
          <label className="grid gap-1.5 text-sm font-medium text-ink">
            显示名称
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
            confirmLabel="保存"
            onCancel={() => setRenameTarget(null)}
            onConfirm={() => {
              void submitProjectRename(renameTarget, renameValue, onRenameProject, setProjectActionError, setRenameTarget);
            }}
          />
        </ProjectActionDialog>
      ) : null}

      {repairRequest ? (
        <ProjectActionDialog
          title="修复项目文件夹"
          description="确认后，Moebius 将从新位置继续使用原项目历史；不会移动、复制或重命名任何磁盘文件。"
          error={projectActionError}
          onCancel={() => {
            if (!isProjectMutationPending) {
              setRepairRequest(null);
            }
          }}
        >
          <dl className="grid gap-3 rounded-lg border border-line bg-rail p-3 text-xs">
            <div className="grid gap-1">
              <dt className="font-medium text-sub">原位置</dt>
              <dd className="break-all text-ink" data-testid="repair-original-folder">{repairRequest.project.folderPath}</dd>
            </div>
            <div className="grid gap-1 border-t border-line pt-3">
              <dt className="font-medium text-sub">新位置</dt>
              <dd className="break-all text-ink" data-testid="repair-new-folder">{repairRequest.folderPath}</dd>
            </div>
          </dl>
          <DialogButtons
            pending={isProjectMutationPending}
            confirmLabel="确认新位置"
            onCancel={() => setRepairRequest(null)}
            onConfirm={() => {
              void submitProjectFolderRepair(repairRequest, onRepairProjectFolder, setProjectActionError, setRepairRequest);
            }}
          />
        </ProjectActionDialog>
      ) : null}

      {runningRemovalTarget ? (
        <ProjectActionDialog
          title="项目中仍有 Agent 正在运行"
          description={`“${runningRemovalTarget.title}”中的运行必须先停止。你可以取消，或继续到强制中止与移除确认。`}
          icon={<AlertTriangle className="h-5 w-5 text-danger" strokeWidth={1.5} aria-hidden="true" />}
          onCancel={() => setRunningRemovalTarget(null)}
        >
          <DialogButtons
            pending={false}
            confirmLabel="强制中止并继续"
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
          title="移除项目？"
          description={`“${removalRequest.project.title}”会从侧边栏消失，其对话将归档并保留。此操作绝不会删除或修改磁盘上的项目文件夹。`}
          error={projectActionError}
          onCancel={() => {
            if (!isProjectMutationPending) {
              setRemovalRequest(null);
            }
          }}
        >
          <p className="rounded-md border border-line bg-rail px-3 py-2 text-xs text-sub">
            磁盘文件夹将保留：{removalRequest.project.folderPath}
          </p>
          <DialogButtons
            pending={isProjectMutationPending}
            confirmLabel={removalRequest.force ? "中止并移除" : "移除项目"}
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
          title="还有未保存的修改"
          description="可以继续编辑、放弃全部修改，或保存全部后前往对话。"
          onCancel={() => {
            pendingConversationRoute.cancel?.();
            setPendingConversationRoute(null);
          }}
        >
          <DialogButtons
            pending={savingConversationRouteDrafts}
            confirmLabel="保存全部并离开"
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
            放弃全部
          </Button>
        </ProjectActionDialog>
      ) : null}

      {conversationRouteConflictOpen ? (
        <ProjectActionDialog
          title="无法前往对话"
          description="有 Agent 文件在应用外被修改。请先在团队详情中选择载入外部版本或用当前内容覆盖。"
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
            }}>知道了</Button>
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
  return (
    <div className="flex justify-end gap-2">
      <Button type="button" variant="ghost" disabled={pending} onClick={onCancel}>取消</Button>
      <Button type="button" variant={danger ? "danger" : "default"} disabled={pending} onClick={onConfirm}>
        {pending ? "处理中…" : confirmLabel}
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
}: {
  icon: LucideIcon;
  label: string;
  selected?: boolean;
  statusIndicatorLabel?: string;
  onClick?: () => void;
  disabled?: boolean;
  disabledReason?: string;
}): JSX.Element {
  return (
    <button
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
  return (
    <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/50 p-6" data-testid="application-overlay">
      <section
        className="w-full max-w-md rounded-[14px] border border-line bg-sunken p-5"
        role="dialog"
        aria-modal="true"
        aria-labelledby="application-placeholder-title"
      >
        <h1 id="application-placeholder-title" className="text-lg font-semibold tracking-[-0.01em] text-ink">
          全局搜索
        </h1>
        <p className="mt-2 text-sm leading-6 text-sub">
          全局搜索将在后续任务中提供。关闭此窗口后会回到原来的项目和对话。
        </p>
        <div className="mt-5 flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={onClose}>
            关闭
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

function TimelineEntry({
  message,
  memberIdentities,
  childSessions = [],
  openedSubSessionId = null,
  onOpenSubSession,
  onRetryRun,
  onEditAndResend,
  onOpenDiagnostics,
  onOpenExternalLink,
  onOpenEvidence,
}: {
  message: OperatorMessage;
  memberIdentities: readonly OperatorMemberIdentity[];
  childSessions?: readonly OperatorChildSessionSummary[];
  openedSubSessionId?: string | null;
  onOpenSubSession?: (sessionId: string) => void;
  onRetryRun?: (sessionId: string, runId: string) => void;
  onEditAndResend?: (target: OperatorEditAndResendTarget) => void;
  onOpenDiagnostics?: () => void;
  onOpenExternalLink?: (url: string) => void;
  onOpenEvidence?: (intent: OperatorEvidenceOpenIntent) => void;
}): JSX.Element {
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
      <RunOutcome
        status={outcome}
        role={message.role}
        memberIdentities={memberIdentities}
        rawReason={message.error ?? message.body}
        rawOutput={message.error ?? message.body}
        onRetry={(outcome === "run-not-started" || outcome === "run-stuck") && message.runId !== null
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
        onOpenOutput={message.runId === null ? undefined : (fallbackOutput) => onOpenEvidence?.({
          kind: "run-output",
          sessionId: message.sessionId,
          runId: message.runId!,
          role: message.role,
          fallbackOutput,
        })}
        className="my-4"
      />
    );
  }

  if (message.speaker === "user") {
    return (
      <div className="group py-4 text-sm">
        <div className="mb-1.5 flex items-center justify-end gap-2 text-[12.5px] text-sub">
          <span className="tnum text-hint opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100">{formatTime(message.updatedAt)}</span>
          <span className="font-semibold text-ink">你</span>
          <RoleTag label="你" toneKey="user" />
        </div>
        <div className="flex justify-end">
          <div className="max-w-[85%] rounded-[14px] border border-line bg-card px-3.5 py-2.5">
            {message.body.trim() === "" ? null : (
              <MarkdownMessage
                content={sanitizeMachineText(message.body)}
                mode="static"
                onOpenExternalLink={onOpenExternalLink}
              />
            )}
            <StructuredAttachmentList
              attachments={message.attachments ?? []}
              mode="message"
              className={message.body.trim() === "" ? "" : "mt-2"}
            />
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="group py-4 text-sm">
      <div className="mb-1.5 flex items-center gap-2 text-[12.5px] text-sub">
        {message.speaker === "agent" ? (
          <RoleTag
            label={resolveOperatorMemberName(message.role, memberIdentities)}
            toneKey={message.role ?? "agent"}
          />
        ) : null}
        <span className="font-semibold text-ink">
          {message.speaker === "agent"
            ? resolveOperatorMemberName(message.role, memberIdentities)
            : "系统提示"}
        </span>
        <span className="tnum text-hint opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100">{formatTime(message.updatedAt)}</span>
      </div>
      <div className="relative pl-7">
      {message.speaker === "system" ? (
        <div className="whitespace-pre-wrap break-words leading-6 text-ink">{systemSummary(message)}</div>
      ) : (
        <>
          {message.body.trim() === "" ? null : (
            <MarkdownMessage
              content={sanitizeMachineText(message.body)}
              mode="static"
              onOpenExternalLink={onOpenExternalLink}
            />
          )}
          <StructuredAttachmentList
            attachments={message.attachments ?? []}
            mode="message"
            className={message.body.trim() === "" ? "" : "mt-2"}
          />
        </>
      )}
      {message.speaker === "agent" && message.runId !== null && onOpenEvidence ? (
        <button
          type="button"
          className="absolute left-7 top-full z-10 mt-1 flex h-6 w-6 items-center justify-center rounded-md text-sub opacity-0 transition-[color,background-color,opacity] hover:bg-hover hover:text-ink focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent group-hover:opacity-100 group-focus-within:opacity-100"
          aria-label="完整输出"
          title="完整输出"
          onClick={() => onOpenEvidence({
            kind: "run-output",
            sessionId: message.sessionId,
            runId: message.runId!,
            role: message.role,
            fallbackOutput: message.body,
          })}
        >
          <FileText className="h-3.5 w-3.5" strokeWidth={1.5} aria-hidden="true" />
        </button>
      ) : null}
      </div>
    </div>
  );
}

function toSidebarProject(project: OperatorProject): ConversationSidebarProject {
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
      createdAt: session.createdAt,
      summary: sessionSummary(session),
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

function sessionSummary(session: OperatorSession): string | undefined {
  if (session.errorCount > 0) {
    return `错误 ${session.errorCount}`;
  }
  if (session.stuckCount > 0) {
    return `卡住 ${session.stuckCount}`;
  }
  if (session.interruptedCount > 0) {
    return `中断 ${session.interruptedCount}`;
  }
  return undefined;
}

function terminalOutcome(message: OperatorMessage): RunOutcomeStatus | null {
  return message.speaker === "system" && message.systemEventKind !== undefined && message.systemEventKind !== "other"
    ? message.systemEventKind
    : null;
}

function systemSummary(message: OperatorMessage): string {
  return sanitizeMachineText(message.body, "系统记录已更新。");
}

function safeRunSummary(summary: string | null | undefined): string {
  const text = nonBlank(summary);
  if (!text || containsMachineText(text)) {
    return "正在推进这一步…";
  }
  return sanitizeMachineText(text, "正在推进这一步…");
}

function runRawOutput(activeRun: OperatorRunSnapshot): string {
  return [activeRun.stdoutTail, activeRun.stderrTail, activeRun.tailDiagnostic].filter(nonBlank).join("\n");
}

function formatTime(value: string): string {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return value;
  }
  return new Intl.DateTimeFormat("zh-CN", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(parsed);
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
