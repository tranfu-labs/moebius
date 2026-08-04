export const LOCAL_CONSOLE_DEFAULT_SESSION_ID = "default";
export const LOCAL_CONSOLE_PROJECT_ID = "local";
export const LOCAL_CONSOLE_PROJECT_SOURCE_TYPE = "local-folder";

export type LocalConsoleSpeaker = "user" | "agent" | "system";
export type LocalAttachmentKind = "image" | "file";
export type LocalConsoleEntryTemplate = "session-analysis";
export type LocalConsoleWritePolicy = "normal" | "confirm-current-plan-before-write";
export type LocalConsoleSessionReferenceScope = "message" | "conversation";

export interface LocalConsoleTextFragment {
  id: string;
  label: string;
  text: string;
}

export interface LocalAttachment {
  attachmentId: string;
  kind: LocalAttachmentKind;
  displayName: string;
  mediaType: string;
  byteSize: number;
}

export interface LocalAttachmentContentRecord extends LocalAttachment {
  blobId: string;
  sha256: string;
  storageKey: string;
  draftKey: string | null;
  messageId: number | null;
  position: number;
}

export interface LocalAttachmentRemovalResult {
  removed: boolean;
  orphanedStorageKey: string | null;
}

export interface LocalAttachmentStorageReconciliation {
  liveStorageKeys: string[];
  orphanedStorageKeys: string[];
}
export type LocalConsoleMessageStatus =
  | "pending"
  | "running"
  | "completed"
  | "failed"
  | "interrupted"
  | "stuck"
  | "displayed";
export type LocalUserMessageDispatchLane = "primary" | "worker" | "awaiting-team";
export type LocalUserMessageDispatchReason =
  | "single-valid-mention"
  | "no-valid-mention"
  | "multiple-valid-mentions";

export const LOCAL_CONSOLE_SYSTEM_EVENT_KINDS = [
  "run-not-started",
  "run-stuck",
  "user-stopped",
  "resume-unavailable",
  "retry-exhausted",
  "other",
] as const;
export type LocalConsoleSystemEventKind = (typeof LOCAL_CONSOLE_SYSTEM_EVENT_KINDS)[number];

export interface LocalConsoleTerminal {
  kind:
    | "interrupted"
    | "timeout"
    | "quota-exhausted"
    | "rate-limited"
    | "auth"
    | "crashed";
  subkind: string | null;
  safeCode: string | null;
  retryable: boolean | null;
  partialMarkdown: string;
  contentIncomplete: true;
  actualProfile: LocalConsoleExecutionProfile | null;
}

export interface LocalConsoleMessage {
  id: number;
  sessionId: string;
  speaker: LocalConsoleSpeaker;
  role: string | null;
  body: string;
  status: LocalConsoleMessageStatus;
  runId: string | null;
  runDir: string | null;
  error: string | null;
  systemEventKind: LocalConsoleSystemEventKind;
  terminal?: LocalConsoleTerminal | null;
  failureCount: number;
  lastFailureReason: string | null;
  sourceKind?: string | null;
  sourceId?: string | null;
  attachments?: LocalAttachment[];
  textFragments?: LocalConsoleTextFragment[];
  /** When a queued user message actually entered the primary-agent timeline. */
  activatedAt?: string | null;
  dispatchLane?: LocalUserMessageDispatchLane | null;
  dispatchRole?: string | null;
  dispatchReason?: LocalUserMessageDispatchReason | null;
  runTiming?: LocalConsoleRunTiming | null;
  createdAt: string;
  updatedAt: string;
}

export interface LocalConsolePendingDispatch {
  message: LocalConsoleMessage;
  targetLane: LocalUserMessageDispatchLane;
  targetRole: string | null;
  waitingForTeam: boolean;
}

export interface LocalConsoleRunTiming {
  stepId: string;
  attempt: number;
  createdAt: string;
  startedAt: string | null;
  elapsedMs: number | null;
  completedAt: string | null;
  status: "created" | "running" | "completed" | "failed" | "interrupted" | "stuck" | "paused";
  engine: "codex" | "claude" | "kimi";
  processOutputAvailable: boolean;
}

export type LocalConsoleChildSessionStatus =
  | "running"
  | "waiting"
  | "finished"
  | "not-started"
  | "stuck"
  | "stopped"
  | "retry-exhausted"
  | "unavailable";

export interface LocalConsoleChildSessionSummary {
  sessionId: string;
  title: string;
  memberName: string;
  status: LocalConsoleChildSessionStatus;
  statusLabel: string;
}

export type LocalRouteDecisionOutcome = "append" | "no_action" | "fail_open" | "dead_letter";

export interface LocalRouteDecisionRecord {
  sessionId: string;
  messageId: number;
  routeKey: string;
  outcome: LocalRouteDecisionOutcome;
  targetRole: string | null;
  reason: string;
  createdAt: string;
}

export type LocalConsoleSessionStatus = "idle" | "running" | "waiting" | "stuck" | "failed" | "interrupted";
export const LOCAL_CONSOLE_AWAITS_HUMAN_REASONS = [
  "answer",
  "confirmation",
  "acceptance",
  "exception",
] as const;
export type LocalConsoleAwaitsHumanReason = (typeof LOCAL_CONSOLE_AWAITS_HUMAN_REASONS)[number];
export type LocalConsoleProjectSourceType = typeof LOCAL_CONSOLE_PROJECT_SOURCE_TYPE;
export type LocalConsoleWorkspaceMode = "direct" | "worktree";
export type LocalConsoleAgentTeamOwnership = "system" | "user";
export type LocalConsoleAgentTeamHealth = "usable" | "deleted" | "needs-repair";

export type LocalConsoleNonContinuableKind =
  | "project-unavailable"
  | "team-deleted"
  | "team-needs-repair";

export type LocalConsoleContinuationStatus =
  | { canContinue: true; kind: "available"; reason: null; recoveryAction: null }
  | {
      canContinue: false;
      kind: LocalConsoleNonContinuableKind;
      reason: string;
      recoveryAction: "repair-project" | "select-team" | "repair-or-select-team";
    };

export interface LocalConsoleAgentTeamSnapshotMember {
  name: string;
  agentMarkdown: string;
  executionProfile?: LocalConsoleExecutionProfile | null;
}

export interface LocalConsoleAgentTeamSnapshot {
  members: LocalConsoleAgentTeamSnapshotMember[];
}

export interface LocalConsoleExecutionProfile {
  cli: "codex" | "claude" | "kimi";
  model: string;
  effort: string;
}

export interface LocalConsoleMemberIdentity {
  slug: string;
  displayName: string;
}

export interface LocalConsoleSessionWorkspaceSource {
  projectId: string;
  title: string;
  folderPath: string;
  workspaceMode: LocalConsoleWorkspaceMode;
  workspacePendingMode: LocalConsoleWorkspaceMode | null;
  session?: LocalConsoleSessionSummary;
  baselineCommit?: string | null;
}

export type LocalConsoleWorkspaceDiffSummary =
  | { available: true; fileCount: number; reason: null }
  | {
      available: false;
      fileCount: null;
      reason: "missing-baseline" | "not-git-repository" | "workspace-unavailable" | "baseline-unavailable" | "no-session";
    };

export interface LocalConsoleWorkspaceDiffFile {
  path: string;
  additions: number | null;
  deletions: number | null;
}

export type LocalConsoleWorkspaceDiffDetail =
  | {
      available: true;
      fileCount: number;
      files: LocalConsoleWorkspaceDiffFile[];
      reason: null;
      workspaceMode: LocalConsoleWorkspaceMode;
    }
  | {
      available: false;
      fileCount: null;
      files: [];
      reason: Exclude<LocalConsoleWorkspaceDiffSummary, { available: true }>["reason"];
      workspaceMode: LocalConsoleWorkspaceMode;
    };

export interface LocalConsoleFileLine {
  kind: "addition" | "deletion" | "unchanged";
  oldLineNumber: number | null;
  newLineNumber: number | null;
  text: string;
}

export type LocalConsoleFileContent =
  | {
      available: true;
      path: string;
      lines: LocalConsoleFileLine[];
      reason: null;
    }
  | {
      available: false;
      path: string;
      lines: [];
      reason:
        | "binary-file"
        | "file-too-large"
        | "not-found"
        | "not-file"
        | "outside-workspace"
        | "workspace-unavailable";
    };

export interface LocalConsoleFileReferenceLine {
  lineNumber: number;
  text: string;
}

export type LocalConsoleFileReferenceContent =
  | {
      available: true;
      scope: "workspace-file" | "external-preview";
      isComplete: boolean;
      path: string;
      lines: LocalConsoleFileReferenceLine[];
      reason: null;
      targetLine: number;
      targetColumn: number | null;
      truncatedBefore: boolean;
      truncatedAfter: boolean;
      relativePath: string | null;
      text: string | null;
    }
  | {
      available: false;
      scope: "workspace-file" | "external-preview" | null;
      isComplete: null;
      path: string;
      lines: [];
      reason:
        | "invalid-path"
        | "not-found"
        | "not-file"
        | "binary-file"
        | "line-too-large"
        | "response-too-large"
        | "line-not-found"
        | "scan-limit"
        | "file-too-large"
        | "workspace-unavailable"
        | "unavailable";
      targetLine: number;
      targetColumn: number | null;
      relativePath: string | null;
      text: null;
    };

export interface LocalConsoleProjectFileEntry {
  path: string;
  additions: number | null;
  deletions: number | null;
  changed: boolean;
}

export type LocalConsoleProjectFiles =
  | {
      available: true;
      files: LocalConsoleProjectFileEntry[];
      reason: null;
      workspaceMode: LocalConsoleWorkspaceMode;
    }
  | {
      available: false;
      files: [];
      reason: "workspace-unavailable";
      workspaceMode: LocalConsoleWorkspaceMode;
    };

export interface LocalConsoleRunOutput {
  sessionId: string;
  runId: string;
  role: string | null;
  stdout: string | null;
  stderr: string | null;
  fallback: string | null;
}

export interface LocalConsoleSessionSummary {
  sessionId: string;
  projectId: string;
  parentSessionId?: string | null;
  analysisParentSessionId?: string | null;
  originSessionId?: string | null;
  entryTemplate?: LocalConsoleEntryTemplate | null;
  writePolicy?: LocalConsoleWritePolicy;
  proposalVersion?: string | null;
  writeLeaseVersion?: string | null;
  agentTeamOwnership?: LocalConsoleAgentTeamOwnership | null;
  agentTeamId?: string | null;
  agentTeamHealth?: LocalConsoleAgentTeamHealth | null;
  agentTeamHealthReason?: string | null;
  continuation?: LocalConsoleContinuationStatus;
  agentTeamPendingOwnership?: LocalConsoleAgentTeamOwnership | null;
  agentTeamPendingId?: string | null;
  analysisRecordAvailable?: boolean;
  workspaceMode: LocalConsoleWorkspaceMode;
  workspacePendingMode: LocalConsoleWorkspaceMode | null;
  workspaceUnavailableReason?: string | null;
  branchName?: string | null;
  title: string;
  titleRevision?: number;
  pinnedAt?: string | null;
  status: LocalConsoleSessionStatus;
  awaitsHumanReason: LocalConsoleAwaitsHumanReason | null;
  unreadSince: string | null;
  manualUnreadAt?: string | null;
  manualUnreadRequiresLeave?: boolean;
  readStateRevision?: number;
  attentionRevision?: number;
  attentionAcknowledgedRevision?: number;
  attentionKind?: "project-unavailable" | "team-deleted" | "team-needs-repair" | null;
  hasUnacknowledgedAttention?: boolean;
  unresolvedSystemEventKind?: LocalConsoleSystemEventKind | null;
  lastMessageMentionsAgent?: boolean;
  hasPendingControlWork?: boolean;
  runningCount: number;
  waitingCount: number;
  stuckCount: number;
  errorCount: number;
  interruptedCount: number;
  childCount?: number;
  createdAt: string;
  updatedAt: string;
}

export const LOCAL_SESSION_PROJECT_ERROR_CODES = [
  "LOCAL_SESSION_NOT_FOUND",
  "LOCAL_PROJECT_NOT_FOUND",
  "SESSION_PROJECT_LOCKED",
] as const;

export type LocalConsoleSessionProjectErrorCode = (typeof LOCAL_SESSION_PROJECT_ERROR_CODES)[number];

export class LocalConsoleSessionProjectError extends Error {
  constructor(readonly code: LocalConsoleSessionProjectErrorCode) {
    super(localSessionProjectErrorMessage(code));
    this.name = "LocalConsoleSessionProjectError";
  }
}

export class LocalConsoleSessionWorkspaceLockedError extends Error {
  constructor() {
    super("这段对话已经开始，工作空间已锁定");
    this.name = "LocalConsoleSessionWorkspaceLockedError";
  }
}

export type MoveEmptySessionResult =
  | { ok: true; session: LocalConsoleSessionSummary }
  | { ok: false; code: LocalConsoleSessionProjectErrorCode };

export interface LocalConsoleProjectSummary {
  projectId: string;
  sourceType: LocalConsoleProjectSourceType;
  title: string;
  folderPath: string;
  worktreeMode: boolean;
  workspaceCwd: string | null;
  workspaceMode: LocalConsoleWorkspaceMode | null;
  worktreePath: string | null;
  worktreeUnavailableReason: string | null;
  workspaceUpdatedAt: string | null;
  branchName?: string | null;
  isGitRepository?: boolean;
  directoryAvailable?: boolean;
  directoryUnavailableReason?: string | null;
  newConversationDisabledReason?: string | null;
  sessions: LocalConsoleSessionSummary[];
  runningCount: number;
  waitingCount: number;
  stuckCount: number;
  errorCount: number;
}

export const LOCAL_PROJECT_FOLDER_ERROR_CODES = [
  "PROJECT_DIRECTORY_UNAVAILABLE",
  "PROJECT_FOLDER_ALREADY_BOUND",
  "LOCAL_PROJECT_NOT_FOUND",
] as const;

export type LocalConsoleProjectFolderErrorCode = (typeof LOCAL_PROJECT_FOLDER_ERROR_CODES)[number];

export class LocalConsoleProjectFolderError extends Error {
  constructor(
    readonly code: LocalConsoleProjectFolderErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "LocalConsoleProjectFolderError";
  }
}

export interface LocalConsoleProjectRemovalResult {
  projectId: string;
  archivedSessionIds: string[];
}

export interface LocalConsoleSessionArchiveResult {
  sessionId: string;
  projectId: string;
  selectedSessionId: string | null;
  archivedSessionIds?: string[];
}

export interface LocalConsoleSessionSearchResult {
  session: LocalConsoleSessionSummary;
  project: Pick<LocalConsoleProjectSummary, "projectId" | "title">;
  archived: boolean;
  originAvailable: boolean;
}

export interface LocalConsoleSessionReferenceText {
  fragment: LocalConsoleTextFragment;
  sessionId: string;
  runId: string | null;
  scope: LocalConsoleSessionReferenceScope;
}

export class LocalConsoleProjectRunningError extends Error {
  readonly code = "PROJECT_HAS_RUNNING_AGENTS";

  constructor() {
    super("Project has running agents");
    this.name = "LocalConsoleProjectRunningError";
  }
}

export class LocalConsoleSessionRunningError extends Error {
  readonly code = "SESSION_HAS_RUNNING_AGENT";

  constructor() {
    super("Running sessions cannot be archived");
    this.name = "LocalConsoleSessionRunningError";
  }
}

export interface LocalConsoleRunSnapshot {
  sessionId: string;
  runId: string;
  role: string | null;
  status: "running";
  createdAt: string;
  startedAt: string | null;
  elapsedMs: number | null;
  stepId: string;
  attempt: number;
  engine: "codex" | "claude" | "kimi";
  processOutputAvailable: boolean;
  activity: import("./run-activity.js").LocalRunActivity | null;
  runDir: string | null;
  cwd: string | null;
  workspaceMode: LocalConsoleWorkspaceMode | null;
  worktreeUnavailableReason: string | null;
  branchName?: string | null;
  baseRef?: string | null;
  stdoutTail: string | null;
  stderrTail: string | null;
  liveMarkdown: string | null;
  lastOutputSummary: string;
  tailDiagnostic: string | null;
  interruptible: boolean;
}

export interface LocalConsoleSnapshot {
  sessionId: string;
  status: "idle" | "running" | "failed" | "stuck";
  messages: LocalConsoleMessage[];
  pendingDispatchMessages?: LocalConsolePendingDispatch[];
  pendingPrimaryMessages: LocalConsoleMessage[];
  sqlitePath: string;
  lastError: string | null;
  activeRuns: LocalConsoleRunSnapshot[];
  /** @deprecated Transitional primary-agent projection. New consumers use activeRuns. */
  activeRun: LocalConsoleRunSnapshot | null;
}

export interface LocalConsoleStateSnapshot {
  projects: LocalConsoleProjectSummary[];
  project: LocalConsoleProjectSummary;
  selectedProjectId: string;
  selectedSessionId: string;
  selectedSession: LocalConsoleSessionSummary | null;
  messages: LocalConsoleMessage[];
  pendingDispatchMessages?: LocalConsolePendingDispatch[];
  pendingPrimaryMessages: LocalConsoleMessage[];
  childSessions: LocalConsoleChildSessionSummary[];
  memberIdentities: LocalConsoleMemberIdentity[];
  activeRuns: LocalConsoleRunSnapshot[];
  /** @deprecated Transitional primary-agent projection. New consumers use activeRuns. */
  activeRun: LocalConsoleRunSnapshot | null;
  workspaceDiff: LocalConsoleWorkspaceDiffSummary;
  sqlitePath: string;
  lastError: string | null;
}

export interface LocalConsoleSessionView {
  session: LocalConsoleSessionSummary;
  messages: LocalConsoleMessage[];
  pendingDispatchMessages?: LocalConsolePendingDispatch[];
  pendingPrimaryMessages: LocalConsoleMessage[];
  memberIdentities: LocalConsoleMemberIdentity[];
  activeRuns: LocalConsoleRunSnapshot[];
  /** @deprecated Transitional primary-agent projection. New consumers use activeRuns. */
  activeRun: LocalConsoleRunSnapshot | null;
  workspaceDiff: LocalConsoleWorkspaceDiffSummary;
}

export interface LocalConsoleStore {
  readonly sqlitePath: string;
  init(): Promise<void>;
  close(): Promise<void>;
  createProject(input: { folderPath: string; worktreeMode: boolean; now: string }): Promise<LocalConsoleProjectSummary>;
  updateProject(input: { projectId: string; worktreeMode: boolean; now: string }): Promise<LocalConsoleProjectSummary>;
  renameProject?(input: { projectId: string; title: string; now: string }): Promise<LocalConsoleProjectSummary>;
  repairProjectFolder?(input: { projectId: string; folderPath: string; now: string }): Promise<LocalConsoleProjectSummary>;
  removeProject?(input: { projectId: string; force: boolean; now: string }): Promise<LocalConsoleProjectRemovalResult>;
  reorderProjects(projectIds: string[]): Promise<LocalConsoleProjectSummary[]>;
  listProjects(): Promise<LocalConsoleProjectSummary[]>;
  getProject?(projectId: string): Promise<LocalConsoleProjectSummary | null>;
  getSessionWorkspace(sessionId: string): Promise<LocalConsoleSessionWorkspaceSource>;
  getSessionBaselineCommit?(sessionId: string): Promise<string | null>;
  switchSessionWorkspace(input: {
    sessionId: string;
    workspaceMode: LocalConsoleWorkspaceMode;
    now: string;
  }): Promise<LocalConsoleSessionSummary>;
  switchSessionTeam(input: {
    sessionId: string;
    agentTeamOwnership: LocalConsoleAgentTeamOwnership;
    agentTeamId: string;
    agentTeamSnapshot?: LocalConsoleAgentTeamSnapshot;
    now: string;
  }): Promise<LocalConsoleSessionSummary>;
  applyPendingSessionContext(input: { sessionId: string; now: string }): Promise<LocalConsoleSessionSummary>;
  listSessionAgentTeamSnapshot?(sessionId: string): Promise<LocalConsoleAgentTeamSnapshot | null>;
  recordProjectWorkspaceStatus(input: {
    projectId: string;
    cwd: string;
    mode: LocalConsoleWorkspaceMode;
    worktreePath: string | null;
    worktreeUnavailableReason: string | null;
    now: string;
  }): Promise<void>;
  createSession(input: {
    sessionId: string;
    projectId?: string;
    title: string;
    agentTeamOwnership?: LocalConsoleAgentTeamOwnership;
    agentTeamId?: string;
    agentTeamSnapshot?: LocalConsoleAgentTeamSnapshot;
    workspaceMode?: LocalConsoleWorkspaceMode;
    initialMessage?: string;
    initialDispatch?: {
      lane: Exclude<LocalUserMessageDispatchLane, "awaiting-team">;
      role: string;
      reason: LocalUserMessageDispatchReason;
    };
    initialAttachmentIds?: string[];
    attachmentDraftKey?: string;
    baselineCommit?: string | null;
    originSessionId?: string | null;
    analysisParentSessionId?: string | null;
    entryTemplate?: LocalConsoleEntryTemplate | null;
    writePolicy?: LocalConsoleWritePolicy;
    initialTextFragments?: LocalConsoleTextFragment[];
    now: string;
  }): Promise<LocalConsoleSessionSummary>;
  moveEmptySessionToProject(input: {
    sessionId: string;
    projectId: string;
    now: string;
  }): Promise<LocalConsoleSessionSummary>;
  archiveSession?(input: { sessionId: string; now: string }): Promise<LocalConsoleSessionArchiveResult>;
  restoreSession?(input: { sessionId: string; now: string }): Promise<LocalConsoleSessionSummary>;
  listSessions(): Promise<LocalConsoleSessionSummary[]>;
  searchSessions?(input: {
    query: string;
    includeArchived: boolean;
  }): Promise<LocalConsoleSessionSearchResult[]>;
  updateSessionAnalysisGate?(input: {
    sessionId: string;
    proposalVersion: string | null;
    writeLeaseVersion: string | null;
    now: string;
  }): Promise<LocalConsoleSessionSummary>;
  markSessionResultRead(input: { sessionId: string; unreadSince: string; now: string }): Promise<boolean>;
  updateSessionReadState?(input: {
    sessionId: string;
    action: "mark-read-attention" | "mark-read-unread" | "mark-unread";
    expectedAttentionRevision: number;
    expectedReadStateRevision: number;
    expectedTitleRevision: number;
    isCurrent: boolean;
    now: string;
  }): Promise<LocalConsoleSessionSummary>;
  armSessionManualUnread?(input: { sessionId: string; now: string }): Promise<LocalConsoleSessionSummary>;
  markSessionViewed?(input: { sessionId: string; now: string }): Promise<LocalConsoleSessionSummary>;
  setSessionPinned?(input: {
    sessionId: string;
    pinned: boolean;
    expectedPinnedAt: string | null;
    now: string;
  }): Promise<LocalConsoleSessionSummary>;
  renameSession?(input: {
    sessionId: string;
    title: string;
    expectedTitleRevision: number;
    now: string;
  }): Promise<LocalConsoleSessionSummary>;
  syncSessionContinuationAttention?(input: {
    sessionId: string;
    kind: "project-unavailable" | "team-deleted" | "team-needs-repair" | null;
    now: string;
  }): Promise<LocalConsoleSessionSummary>;
  appendUserMessage(input: {
    sessionId: string;
    body: string;
    attachmentIds?: string[];
    attachmentDraftKey?: string;
    textFragments?: LocalConsoleTextFragment[];
    dispatch?: {
      lane: LocalUserMessageDispatchLane;
      role: string | null;
      reason: LocalUserMessageDispatchReason;
    };
    now: string;
  }): Promise<LocalConsoleMessage>;
  markPendingReferenceError?(input: {
    sessionId: string;
    messageId: number;
    error: string | null;
    now: string;
  }): Promise<LocalConsoleMessage>;
  updatePendingUserMessage?(input: {
    sessionId: string;
    messageId: number;
    body: string;
    now: string;
  }): Promise<LocalConsoleMessage>;
  removePendingUserMessage?(input: {
    sessionId: string;
    messageId: number;
    now: string;
  }): Promise<void>;
  addDraftAttachment?(input: {
    blobId: string;
    attachmentId: string;
    draftKey: string;
    kind: LocalAttachmentKind;
    displayName: string;
    mediaType: string;
    byteSize: number;
    sha256: string;
    storageKey: string;
    now: string;
  }): Promise<LocalAttachment>;
  listDraftAttachments?(draftKey: string): Promise<LocalAttachment[]>;
  removeDraftAttachment?(input: {
    attachmentId: string;
    draftKey: string;
  }): Promise<LocalAttachmentRemovalResult>;
  cloneMessageAttachmentsToDraft?(input: {
    sessionId: string;
    sourceMessageId: number;
    targetDraftKey: string;
    now: string;
  }): Promise<LocalAttachment[]>;
  getAttachmentContentRecord?(input: {
    attachmentId: string;
    draftKey?: string;
    sessionId?: string;
  }): Promise<LocalAttachmentContentRecord | null>;
  listMessageAttachmentContentRecords?(messageIds: number[]): Promise<LocalAttachmentContentRecord[]>;
  listAttachmentStorageKeys?(): Promise<string[]>;
  pruneOrphanAttachmentBlobs?(): Promise<LocalAttachmentStorageReconciliation>;
  listMessages(sessionId: string): Promise<LocalConsoleMessage[]>;
  hasRunningMessage(sessionId: string): Promise<boolean>;
  claimNextPendingMessage(input: {
    sessionId: string;
    runId: string;
    gracefulResumeTargets?: Array<{
      sourceMessageId: number;
      targetRunId: string;
    }>;
    now: string;
  }): Promise<LocalConsoleMessage | null>;
  claimNextPendingWorkerMessage?(input: {
    sessionId: string;
    role: string;
    runId: string;
    now: string;
  }): Promise<LocalConsoleMessage | null>;
  resolveAwaitingUserMessageDispatches?(input: {
    sessionId: string;
    dispatches: Array<{
      messageId: number;
      lane: Exclude<LocalUserMessageDispatchLane, "awaiting-team">;
      role: string;
      reason: LocalUserMessageDispatchReason;
    }>;
    now: string;
  }): Promise<void>;
  setRunDir(input: { id: number; sessionId?: string; runDir: string; now: string }): Promise<void>;
  recordAgentResponse(input: {
    userMessageId: number;
    sessionId: string;
    role: string;
    body: string;
    runId: string;
    runDir: string;
    now: string;
  }): Promise<void>;
  recordDetachedAgentResponse?(input: {
    sessionId: string;
    role: string;
    body: string;
    runId: string;
    runDir: string;
    now: string;
  }): Promise<void>;
  recordDetachedRunStarted?(input: {
    sessionId: string;
    role: string;
    runId: string;
    runDir: string;
    now: string;
  }): Promise<void>;
  recordDetachedRunTerminal?(input: {
    sessionId: string;
    body: string;
    systemEventKind: LocalConsoleSystemEventKind;
    runId: string;
    runDir: string | null;
    error: string;
    status: "failed" | "interrupted" | "stuck";
    terminal?: LocalConsoleTerminal | null;
    now: string;
  }): Promise<void>;
  recordCodexThreadLink?(input: {
    sessionId: string;
    runId: string;
    sourceMessageId: number;
    role: string;
    threadId: string;
    startedAt: string;
    contextFingerprint?: string | null;
  }): Promise<void>;
  recordRunExecutionContext?(input: import("./execution-context.js").LocalRunExecutionContextFact): Promise<void>;
  recordExecutionSessionLink?(input: import("./execution-context.js").LocalExecutionSessionLinkFact): Promise<void>;
  recordAgentSessionLink?(input: import("./execution-context.js").LocalAgentSessionLinkFact): Promise<void>;
  recordProviderSessionObserved?(input: import("./execution-context.js").LocalProviderSessionObservedFact): Promise<void>;
  recordAgentTimelineCursor?(input: import("./execution-context.js").LocalAgentTimelineCursorFact): Promise<void>;
  recordProviderInvocation?(input: import("./execution-context.js").LocalProviderInvocationFact): Promise<void>;
  nextRunAttempt?(input: { sessionId: string; stepId: string }): Promise<number>;
  getRunTiming?(input: { sessionId: string; runId: string }): Promise<LocalConsoleRunTiming | null>;
  recordRunLifecycleEvent?(input: {
    sessionId: string;
    runId: string;
    stepId: string;
    attempt: number;
    phase: "created" | "started" | "paused" | "resumed" | "terminal";
    role: string | null;
    engine: "codex" | "claude" | "kimi";
    processOutputAvailable: boolean;
    createdAt: string;
    startedAt: string | null;
    elapsedMs: number | null;
    completedAt: string | null;
    status: LocalConsoleRunTiming["status"];
    recordedAt: string;
  }): Promise<void>;
  recordRunActivityEvent?(input: {
    sessionId: string;
    runId: string;
    activity: import("./run-activity.js").LocalRunActivity;
  }): Promise<void>;
  recordSystemAndComplete(input: {
    userMessageId: number;
    sessionId: string;
    body: string;
    systemEventKind?: LocalConsoleSystemEventKind;
    runId: string;
    runDir: string | null;
    now: string;
  }): Promise<void>;
  recordSystemMessage(input: {
    sessionId: string;
    body: string;
    runId: string | null;
    runDir: string | null;
    error: string | null;
    status?: "displayed" | "failed" | "interrupted" | "stuck";
    systemEventKind?: LocalConsoleSystemEventKind;
    terminal?: LocalConsoleTerminal | null;
    now: string;
  }): Promise<void>;
  recordMessageProcessed(input: {
    userMessageId: number;
    sessionId: string;
    runId: string;
    runDir: string | null;
    now: string;
  }): Promise<void>;
  findRouteDecision(input: {
    sessionId: string;
    routeKey: string;
  }): Promise<LocalRouteDecisionRecord | null>;
  recordRouteAppend(input: {
    userMessageId: number;
    sessionId: string;
    routeKey: string;
    body: string;
    targetRole: string;
    runId: string;
    runDir: string | null;
    now: string;
  }): Promise<void>;
  recordRouteNoAction(input: {
    userMessageId: number;
    sessionId: string;
    routeKey: string;
    outcome: Exclude<LocalRouteDecisionOutcome, "append">;
    reason: string;
    runId: string;
    runDir: string | null;
    now: string;
  }): Promise<void>;
  releaseMessageForRetry(input: {
    userMessageId: number;
    sessionId: string;
    now: string;
  }): Promise<void>;
  releaseMessageForResume?(input: {
    userMessageId: number;
    sessionId: string;
    sourceDisposition: import("./codex-resume.js").LocalRunSourceDisposition;
    targetRunId: string;
    role: string;
    now: string;
  }): Promise<void>;
  repairAgentHandoffResumeSource?(input: {
    sessionId: string;
    intentId: string;
    targetRunId: string;
    sourceMessageId: number;
    role: string;
    now: string;
  }): Promise<"repaired" | "already-repaired">;
  recordFailure(input: {
    userMessageId: number;
    sessionId: string;
    error: string;
    runId: string | null;
    runDir: string | null;
    now: string;
    body?: string;
    systemEventKind?: LocalConsoleSystemEventKind;
    terminal?: LocalConsoleTerminal | null;
    sourceKind?: string | null;
    sourceId?: string | null;
  }): Promise<void>;
  recordRetryableFailure(input: {
    userMessageId: number;
    sessionId: string;
    error: string;
    runId: string | null;
    runDir: string | null;
    now: string;
  }): Promise<LocalConsoleMessage>;
  recordDeadLetter(input: {
    userMessageId: number;
    sessionId: string;
    error: string;
    runId: string | null;
    runDir: string | null;
    failureCount: number;
    now: string;
  }): Promise<void>;
  recordInterrupted(input: {
    userMessageId: number;
    sessionId: string;
    reason: string;
    interruptionKind?: "user" | "redirect" | "context-unavailable" | "system";
    runId: string | null;
    runDir: string | null;
    now: string;
    terminal?: LocalConsoleTerminal | null;
  }): Promise<void>;
  recordStuck(input: {
    userMessageId: number;
    sessionId: string;
    reason: string;
    runId: string | null;
    runDir: string | null;
    now: string;
    terminal?: LocalConsoleTerminal | null;
  }): Promise<void>;
  markStaleRunning(input: {
    sessionId: string;
    cutoffIso: string;
    now: string;
    reason: string;
  }): Promise<number>;
}

function localSessionProjectErrorMessage(code: LocalConsoleSessionProjectErrorCode): string {
  switch (code) {
    case "LOCAL_SESSION_NOT_FOUND":
      return "Local session not found";
    case "LOCAL_PROJECT_NOT_FOUND":
      return "Local project not found";
    case "SESSION_PROJECT_LOCKED":
      return "Session project is locked after activity or orchestration";
  }
}

export class LocalConsoleStoreTimeoutError extends Error {
  constructor(
    readonly label: string,
    readonly timeoutMs: number,
  ) {
    super(`${label}-timeout:${timeoutMs}ms`);
    this.name = "LocalConsoleStoreTimeoutError";
  }
}

export class LocalConsoleBusyError extends Error {
  constructor(message = "local console session is running") {
    super(message);
    this.name = "LocalConsoleBusyError";
  }
}
