import fs from "node:fs/promises";
import crypto from "node:crypto";
import path from "node:path";
import { LOCAL_CONSOLE_SESSION_LOG_ROOT, LOCAL_CONSOLE_STORE_TIMEOUT_MS } from "../config.js";
import {
  closeSqliteStateWorkers,
  runSqliteStateCommand,
  type SessionFactIndexCheckpoint,
  type SqliteStateCommand,
} from "../sqlite-state.js";
import {
  LOCAL_CONSOLE_PROJECT_ID,
  LocalConsoleSessionProjectError,
  LocalConsoleSessionRunningError,
  type LocalConsoleMessage,
  type LocalAttachment,
  type LocalAttachmentContentRecord,
  type LocalAttachmentKind,
  type LocalAttachmentRemovalResult,
  type LocalAttachmentStorageReconciliation,
  type LocalConsoleMessageStatus,
  type LocalConsoleAwaitsHumanReason,
  type MoveEmptySessionResult,
  type LocalConsoleProjectRemovalResult,
  type LocalConsoleProjectSummary,
  type LocalConsoleSessionArchiveResult,
  type LocalRouteDecisionRecord,
  type LocalConsoleSessionStatus,
  type LocalConsoleSessionSummary,
  type LocalConsoleRoundFactProjection,
  type LocalConsoleSessionSearchResult,
  type LocalConsoleSessionWorkspaceSource,
  type LocalConsoleAgentTeamSnapshot,
  type LocalConsoleWorkspaceMode,
  type LocalConsoleAgentTeamOwnership,
  type LocalConsoleSpeaker,
  type LocalConsoleSystemEventKind,
  type LocalConsoleTerminal,
  type LocalConsoleEntryTemplate,
  type LocalConsoleWritePolicy,
  type LocalConsoleTextFragment,
  type LocalConsoleStore,
} from "./types.js";
import type { LocalCodexThreadLinkFact } from "./codex-thread-link.js";
import { readCodexThreadLinks } from "./codex-thread-link-reader.js";
import {
  appendSessionFactLogLine,
  invalidateSessionFactLog,
  readSessionFactLogFingerprint,
  readSessionFactLog,
  type SessionFactLogFingerprint,
} from "./session-fact-log.js";
import type {
  LocalCodexResumeConsumedFact,
  LocalCodexResumeIntentFact,
  LocalCodexRunUsageFact,
} from "./codex-resume.js";
import type {
  LocalAgentSessionLinkFact,
  LocalAgentTimelineCursorFact,
  LocalExecutionSessionLinkFact,
  LocalProviderInvocationFact,
  LocalProviderProcessStartedFact,
  LocalProviderSessionObservedFact,
  LocalRunExecutionContextFact,
} from "./execution-context.js";
import {
  readAgentSessionLinks,
  readExecutionSessionLinks,
  readRunExecutionContexts,
  readProviderProcessStartedFacts,
} from "./execution-context-reader.js";
import { planRuntimeFallback } from "./runtime-domain.js";
import { planHandoffDispatchGeneration, planHandoffDispatchState } from "./control-dispatch.js";
import {
  LOCAL_PRIMARY_CLOSEOUT_FACT_TYPE,
  LOCAL_ROUND_FACT_TYPE,
  parsePrimaryCloseoutFact,
  parseRoundPersistedFact,
  planLatestPrimaryCloseout,
  planLatestRoundFact,
} from "./round-closeout-plan.js";

export interface SqliteLocalConsoleStoreOptions {
  sqlitePath: string;
  sessionLogRoot?: string;
  busyTimeoutMs?: number;
  timeoutMs?: number;
}

export async function createSqliteLocalConsoleStore(
  options: SqliteLocalConsoleStoreOptions,
): Promise<SqliteLocalConsoleStore> {
  await fs.mkdir(path.dirname(options.sqlitePath), { recursive: true });
  return new SqliteLocalConsoleStore(
    options.sqlitePath,
    planRuntimeFallback(options.sessionLogRoot, defaultSessionLogRoot(options.sqlitePath)),
    options.busyTimeoutMs ?? 2_000,
    options.timeoutMs ?? LOCAL_CONSOLE_STORE_TIMEOUT_MS,
  );
}

export class SqliteLocalConsoleStore implements LocalConsoleStore {
  private operationTail: Promise<void> = Promise.resolve();
  private messageIndexDirty = false;
  private stateRevision = 0;

  constructor(
    readonly sqlitePath: string,
    readonly sessionLogRoot = LOCAL_CONSOLE_SESSION_LOG_ROOT,
    private readonly busyTimeoutMs = 2_000,
    private readonly timeoutMs = LOCAL_CONSOLE_STORE_TIMEOUT_MS,
  ) {}

  getStateRevision(): number {
    return this.stateRevision;
  }

  async init(): Promise<void> {
    await this.enqueue(async () => {
      await this.runDirect({ kind: "local-init" });
      await this.migrateSessionMessages();
      await this.rebuildMessageIndexDirect();
    });
  }

  async close(): Promise<void> {
    await this.operationTail;
    await closeSqliteStateWorkers({ sqlitePath: this.sqlitePath });
  }

  async createProject(input: { folderPath: string; worktreeMode: boolean; now: string }): Promise<LocalConsoleProjectSummary> {
    return this.run({ kind: "local-create-project", ...input });
  }

  async updateProject(input: { projectId: string; worktreeMode: boolean; now: string }): Promise<LocalConsoleProjectSummary> {
    return this.run({ kind: "local-update-project", ...input });
  }

  async renameProject(input: { projectId: string; title: string; now: string }): Promise<LocalConsoleProjectSummary> {
    return this.run({ kind: "local-rename-project", ...input });
  }

  async repairProjectFolder(input: { projectId: string; folderPath: string; now: string }): Promise<LocalConsoleProjectSummary> {
    return this.run({ kind: "local-repair-project-folder", ...input });
  }

  async removeProject(input: { projectId: string; force: boolean; now: string }): Promise<LocalConsoleProjectRemovalResult> {
    return this.run({ kind: "local-remove-project", ...input });
  }

  async reorderProjects(projectIds: string[]): Promise<LocalConsoleProjectSummary[]> {
    return this.run({ kind: "local-reorder-projects", projectIds });
  }

  async listProjects(): Promise<LocalConsoleProjectSummary[]> {
    return this.run({ kind: "local-list-projects" });
  }

  async getProject(projectId: string): Promise<LocalConsoleProjectSummary | null> {
    return this.run({ kind: "local-get-project", projectId });
  }

  async getSessionWorkspace(sessionId: string): Promise<LocalConsoleSessionWorkspaceSource> {
    return this.enqueue(async () => {
      if (this.messageIndexDirty) {
        await this.rebuildMessageIndexDirect(undefined, true);
        this.messageIndexDirty = false;
      }
      const source = await this.runDirect<LocalConsoleSessionWorkspaceSource>({
        kind: "local-get-session-workspace",
        sessionId,
      });
      return {
        ...source,
        baselineCommit: await readSessionBaselineCommit(this.getSessionFactLogPath(sessionId), sessionId),
      };
    });
  }

  async getSessionBaselineCommit(sessionId: string): Promise<string | null> {
    return this.enqueue(async () => {
      return await readSessionBaselineCommit(this.getSessionFactLogPath(sessionId), sessionId);
    });
  }

  async switchSessionWorkspace(input: {
    sessionId: string;
    workspaceMode: LocalConsoleWorkspaceMode;
    now: string;
  }): Promise<LocalConsoleSessionSummary> {
    return this.run({ kind: "local-switch-session-workspace", ...input });
  }

  async switchSessionTeam(input: {
    sessionId: string;
    agentTeamOwnership: LocalConsoleAgentTeamOwnership;
    agentTeamId: string;
    agentTeamSnapshot?: LocalConsoleAgentTeamSnapshot;
    now: string;
  }): Promise<LocalConsoleSessionSummary> {
    return this.run({ kind: "local-switch-session-team", ...input });
  }

  async applyPendingSessionContext(input: { sessionId: string; now: string }): Promise<LocalConsoleSessionSummary> {
    return this.run({ kind: "local-apply-pending-session-context", ...input });
  }

  async listSessionAgentTeamSnapshot(sessionId: string): Promise<LocalConsoleAgentTeamSnapshot | null> {
    return this.run({ kind: "local-list-session-agent-team-snapshot", sessionId });
  }

  async writeSessionAgentTeamCandidate(input: {
    sessionId: string;
    snapshot: LocalConsoleAgentTeamSnapshot | null;
  }): Promise<void> {
    await this.run({ kind: "local-write-session-team-candidate", ...input });
  }

  async readSessionTeamUpdateRecord(sessionId: string): Promise<import("./types.js").LocalConsoleSessionTeamUpdateRecord> {
    return this.run({ kind: "local-read-session-team-update-record", sessionId });
  }

  async beginSessionTeamUpdate(input: { sessionId: string; expectedUpdateToken?: string | null; now: string }): Promise<void> {
    await this.run({ kind: "local-begin-session-team-update", ...input });
  }

  async retrySessionTeamUpdate(input: { sessionId: string; expectedUpdateToken?: string | null; now: string }): Promise<void> {
    await this.run({ kind: "local-retry-session-team-update", ...input });
  }

  async cancelSessionTeamUpdate(input: { sessionId: string; expectedUpdateToken?: string | null; now: string }): Promise<void> {
    await this.run({ kind: "local-cancel-session-team-update", ...input });
  }

  async markSessionTeamUpdateFailed(input: {
    sessionId: string;
    code: string;
    summary: string;
  }): Promise<void> {
    await this.run({ kind: "local-mark-session-team-update-failed", ...input });
  }

  async updateSessionMemberExecution(input: {
    sessionId: string;
    memberName: string;
    action: "migrate" | "end";
    executionProfile?: import("./types.js").LocalConsoleExecutionProfile;
    now: string;
  }): Promise<LocalConsoleAgentTeamSnapshot> {
    return this.runFact({ kind: "local-update-session-member-execution", ...input }, [input.sessionId]);
  }

  async recordProjectWorkspaceStatus(input: {
    projectId: string;
    cwd: string;
    mode: "direct" | "worktree";
    worktreePath: string | null;
    worktreeUnavailableReason: string | null;
    now: string;
  }): Promise<void> {
    await this.run({ kind: "local-record-project-workspace-status", ...input });
  }

  async createSession(input: {
    sessionId: string;
    projectId?: string;
    title: string;
    agentTeamOwnership?: "system" | "user";
    agentTeamId?: string;
    agentTeamSnapshot?: LocalConsoleAgentTeamSnapshot;
    workspaceMode?: LocalConsoleWorkspaceMode;
    initialMessage?: string;
    initialDispatch?: {
      lane: "primary" | "worker";
      role: string;
      reason: "single-valid-mention" | "no-valid-mention" | "multiple-valid-mentions";
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
  }): Promise<LocalConsoleSessionSummary> {
    return this.runFact(
      { kind: "local-create-session", ...input, projectId: planRuntimeFallback(input.projectId, LOCAL_CONSOLE_PROJECT_ID) },
      [input.sessionId],
      new Set([input.sessionId]),
    );
  }

  async moveEmptySessionToProject(input: {
    sessionId: string;
    projectId: string;
    now: string;
  }): Promise<LocalConsoleSessionSummary> {
    const result = await this.run<MoveEmptySessionResult>({
      kind: "local-move-empty-session",
      ...input,
    });
    if (!result.ok) {
      throw new LocalConsoleSessionProjectError(result.code);
    }
    return result.session;
  }

  async archiveSession(input: { sessionId: string; now: string }): Promise<LocalConsoleSessionArchiveResult> {
    try {
      return await this.run({ kind: "local-archive-session", ...input });
    } catch (error) {
      if (error instanceof Error && error.message.includes("SESSION_HAS_RUNNING_AGENT")) {
        throw new LocalConsoleSessionRunningError();
      }
      throw error;
    }
  }

  async restoreSession(input: { sessionId: string; now: string }): Promise<LocalConsoleSessionSummary> {
    return this.run({ kind: "local-restore-session", ...input });
  }

  async listSessions(): Promise<LocalConsoleSessionSummary[]> {
    return this.run({ kind: "local-list-sessions" });
  }

  async searchSessions(input: {
    query: string;
    includeArchived: boolean;
  }): Promise<LocalConsoleSessionSearchResult[]> {
    return this.run({ kind: "local-search-sessions", ...input });
  }

  async updateSessionAnalysisGate(input: {
    sessionId: string;
    proposalVersion: string | null;
    writeLeaseVersion: string | null;
    now: string;
  }): Promise<LocalConsoleSessionSummary> {
    return this.runFact(
      { kind: "local-update-session-analysis-gate", ...input },
      [input.sessionId],
      new Set([input.sessionId]),
    );
  }

  async markSessionResultRead(input: { sessionId: string; unreadSince: string; now: string }): Promise<boolean> {
    return this.run({ kind: "local-mark-session-result-read", ...input });
  }

  async updateSessionReadState(input: {
    sessionId: string;
    action: "mark-read-attention" | "mark-read-unread" | "mark-unread";
    expectedAttentionRevision: number;
    expectedReadStateRevision: number;
    expectedTitleRevision: number;
    isCurrent: boolean;
    now: string;
  }): Promise<LocalConsoleSessionSummary> {
    return this.run({ kind: "local-update-session-read-state", ...input });
  }

  async armSessionManualUnread(input: {
    sessionId: string;
    now: string;
  }): Promise<LocalConsoleSessionSummary> {
    return this.run({ kind: "local-arm-session-manual-unread", ...input });
  }

  async markSessionViewed(input: {
    sessionId: string;
    now: string;
  }): Promise<LocalConsoleSessionSummary> {
    return this.run({ kind: "local-mark-session-viewed", ...input });
  }

  async setSessionPinned(input: {
    sessionId: string;
    pinned: boolean;
    expectedPinnedAt: string | null;
    now: string;
  }): Promise<LocalConsoleSessionSummary> {
    return this.run({ kind: "local-set-session-pinned", ...input });
  }

  async renameSession(input: {
    sessionId: string;
    title: string;
    expectedTitleRevision: number;
    now: string;
  }): Promise<LocalConsoleSessionSummary> {
    return this.run({ kind: "local-rename-session", ...input });
  }

  async syncSessionContinuationAttention(input: {
    sessionId: string;
    kind: "project-unavailable" | "team-deleted" | "team-needs-repair" | null;
    now: string;
  }): Promise<LocalConsoleSessionSummary> {
    return this.run({
      kind: "local-sync-session-continuation-attention",
      sessionId: input.sessionId,
      attentionKind: input.kind,
      now: input.now,
    });
  }

  async appendUserMessage(input: {
    sessionId: string;
    body: string;
    attachmentIds?: string[];
    attachmentDraftKey?: string;
    textFragments?: LocalConsoleTextFragment[];
    dispatch?: {
      lane: "primary" | "worker" | "awaiting-team";
      role: string | null;
      reason: "single-valid-mention" | "no-valid-mention" | "multiple-valid-mentions";
    };
    now: string;
  }): Promise<LocalConsoleMessage> {
    return this.runFact({ kind: "local-append-user", ...input }, [input.sessionId], new Set([input.sessionId]));
  }

  async markPendingReferenceError(input: {
    sessionId: string;
    messageId: number;
    error: string | null;
    now: string;
  }): Promise<LocalConsoleMessage> {
    return this.runFact({ kind: "local-mark-pending-reference-error", ...input }, [input.sessionId]);
  }

  async updatePendingUserMessage(input: {
    sessionId: string;
    messageId: number;
    body: string;
    now: string;
  }): Promise<LocalConsoleMessage> {
    return this.runFact({ kind: "local-update-pending-user", ...input }, [input.sessionId]);
  }

  async removePendingUserMessage(input: {
    sessionId: string;
    messageId: number;
    now: string;
  }): Promise<void> {
    await this.runFact({ kind: "local-remove-pending-user", ...input }, [input.sessionId]);
  }

  async addDraftAttachment(input: {
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
  }): Promise<LocalAttachment> {
    const { kind: attachmentKind, ...rest } = input;
    return this.run({ kind: "local-add-draft-attachment", ...rest, attachmentKind });
  }

  async listDraftAttachments(draftKey: string): Promise<LocalAttachment[]> {
    return this.run({ kind: "local-list-draft-attachments", draftKey });
  }

  async removeDraftAttachment(input: {
    attachmentId: string;
    draftKey: string;
  }): Promise<LocalAttachmentRemovalResult> {
    return this.run({ kind: "local-remove-draft-attachment", ...input });
  }

  async cloneMessageAttachmentsToDraft(input: {
    sessionId: string;
    sourceMessageId: number;
    targetDraftKey: string;
    now: string;
  }): Promise<LocalAttachment[]> {
    return this.run({ kind: "local-clone-message-attachments", ...input });
  }

  async getAttachmentContentRecord(input: {
    attachmentId: string;
    draftKey?: string;
    sessionId?: string;
  }): Promise<LocalAttachmentContentRecord | null> {
    return this.run({ kind: "local-get-attachment-content-record", ...input });
  }

  async listMessageAttachmentContentRecords(messageIds: number[]): Promise<LocalAttachmentContentRecord[]> {
    return this.run({ kind: "local-list-message-attachment-content-records", messageIds });
  }

  async listAttachmentStorageKeys(): Promise<string[]> {
    return this.run({ kind: "local-list-attachment-storage-keys" });
  }

  async pruneOrphanAttachmentBlobs(): Promise<LocalAttachmentStorageReconciliation> {
    return this.run({ kind: "local-prune-orphan-attachment-blobs" });
  }

  async listMessages(sessionId: string): Promise<LocalConsoleMessage[]> {
    return this.enqueue(() => this.readMessagesForView(sessionId));
  }

  async hasRunningMessage(sessionId: string): Promise<boolean> {
    return this.enqueue(async () => (await this.readMessagesFromFacts(sessionId)).some((message) => message.status === "running"));
  }

  async claimNextPendingMessage(input: {
    sessionId: string;
    runId: string;
    gracefulResumeTargets?: Array<{
      sourceMessageId: number;
      targetRunId: string;
    }>;
    now: string;
  }): Promise<LocalConsoleMessage | null> {
    return this.runFact({ kind: "local-claim-next", ...input }, [input.sessionId]);
  }

  async claimNextPendingWorkerMessage(input: {
    sessionId: string;
    role: string;
    runId: string;
    now: string;
  }): Promise<LocalConsoleMessage | null> {
    return this.runFact({ kind: "local-claim-next-worker", ...input }, [input.sessionId]);
  }

  async resolveAwaitingUserMessageDispatches(input: {
    sessionId: string;
    dispatches: Array<{
      messageId: number;
      lane: "primary" | "worker";
      role: string;
      reason: "single-valid-mention" | "no-valid-mention" | "multiple-valid-mentions";
    }>;
    now: string;
  }): Promise<void> {
    await this.runFact(
      { kind: "local-resolve-awaiting-user-dispatches", ...input },
      [input.sessionId],
      new Set([input.sessionId]),
    );
  }

  async setRunDir(input: { id: number; sessionId?: string; runDir: string; now: string }): Promise<void> {
    await this.enqueue(async () => {
      const discovered = (await this.runDirect<{ sessionId: string } | null>({
        kind: "local-find-message-session",
        messageId: input.id,
      }))?.sessionId;
      const sessionId = planRuntimeFallback(input.sessionId, discovered);
      if (sessionId === undefined) {
        throw new Error(`local console message not found: ${String(input.id)}`);
      }
      await this.runFactDirect({
        kind: "local-set-run-dir",
        id: input.id,
        runDir: input.runDir,
        now: input.now,
      }, [sessionId]);
    });
  }

  async recordAgentResponse(input: {
    userMessageId: number;
    sessionId: string;
    role: string;
    body: string;
    runId: string;
    runDir: string;
    processSteps: readonly import("./run-activity.js").LocalRunActivity[];
    now: string;
  }): Promise<void> {
    await this.runFact({ kind: "local-record-agent-response", ...input }, [input.sessionId]);
  }

  async recordDetachedAgentResponse(input: {
    sessionId: string;
    role: string;
    body: string;
    runId: string;
    runDir: string;
    processSteps: readonly import("./run-activity.js").LocalRunActivity[];
    now: string;
  }): Promise<void> {
    await this.runFact({ kind: "local-record-detached-agent-response", ...input }, [input.sessionId]);
  }

  async recordDetachedRunStarted(input: {
    sessionId: string;
    role: string;
    runId: string;
    runDir: string;
    now: string;
  }): Promise<void> {
    await this.runFact({ kind: "local-record-detached-run-started", ...input }, [input.sessionId]);
  }

  async recordDetachedRunTerminal(input: {
    sessionId: string;
    body: string;
    systemEventKind: LocalConsoleSystemEventKind;
    runId: string;
    runDir: string | null;
    error: string;
    status: "failed" | "interrupted" | "stuck";
    role: string | null;
    processSteps: readonly import("./run-activity.js").LocalRunActivity[];
    terminal?: LocalConsoleTerminal | null;
    now: string;
  }): Promise<void> {
    await this.runFact({ kind: "local-record-detached-run-terminal", ...input }, [input.sessionId]);
  }

  async recordSystemAndComplete(input: {
    userMessageId: number;
    sessionId: string;
    body: string;
    systemEventKind?: LocalConsoleSystemEventKind;
    runId: string;
    runDir: string | null;
    now: string;
  }): Promise<void> {
    await this.runFact({ kind: "local-record-system-and-complete", ...input, systemEventKind: input.systemEventKind ?? "other" }, [input.sessionId]);
  }

  async recordSystemMessage(input: {
    sessionId: string;
    body: string;
    runId: string | null;
    runDir: string | null;
    error: string | null;
    status?: "displayed" | "failed" | "interrupted" | "stuck";
    systemEventKind?: LocalConsoleSystemEventKind;
    role: string | null;
    processSteps: readonly import("./run-activity.js").LocalRunActivity[];
    terminal?: LocalConsoleTerminal | null;
    now: string;
  }): Promise<void> {
    await this.runFact(
      { kind: "local-record-system", ...input, systemEventKind: input.systemEventKind ?? "other" },
      [input.sessionId],
      new Set([input.sessionId]),
    );
  }

  async recordMessageProcessed(input: {
    userMessageId: number;
    sessionId: string;
    runId: string;
    runDir: string | null;
    now: string;
  }): Promise<void> {
    await this.runFact({ kind: "local-record-message-processed", ...input }, [input.sessionId]);
  }

  async findRouteDecision(input: { sessionId: string; routeKey: string }): Promise<LocalRouteDecisionRecord | null> {
    return this.run({ kind: "local-find-route-decision", ...input });
  }

  async recordRouteAppend(input: {
    userMessageId: number;
    sessionId: string;
    routeKey: string;
    body: string;
    targetRole: string;
    runId: string;
    runDir: string | null;
    now: string;
  }): Promise<void> {
    await this.runFact({ kind: "local-record-route-append", ...input }, [input.sessionId]);
  }

  async recordRouteNoAction(input: {
    userMessageId: number;
    sessionId: string;
    routeKey: string;
    outcome: "no_action" | "fail_open" | "dead_letter";
    reason: string;
    runId: string;
    runDir: string | null;
    now: string;
  }): Promise<void> {
    await this.runFact({ kind: "local-record-route-no-action", ...input }, [input.sessionId]);
  }

  async releaseMessageForRetry(input: { userMessageId: number; sessionId: string; now: string }): Promise<void> {
    await this.runFact({ kind: "local-release-message-for-retry", ...input }, [input.sessionId]);
  }

  async releaseMessageForResume(input: {
    userMessageId: number;
    sessionId: string;
    sourceDisposition: import("./codex-resume.js").LocalRunSourceDisposition;
    targetRunId: string;
    role: string;
    now: string;
  }): Promise<void> {
    await this.runFact({ kind: "local-release-message-for-resume", ...input }, [input.sessionId]);
  }

  async repairAgentHandoffResumeSource(input: {
    sessionId: string;
    intentId: string;
    targetRunId: string;
    sourceMessageId: number;
    role: string;
    now: string;
  }): Promise<"repaired" | "already-repaired"> {
    return this.enqueue(async () => {
      const events = await readFactEvents(
        this.getSessionFactLogPath(input.sessionId),
        input.sessionId,
        false,
      );
      if (events.some((event) =>
        event.type === "repair_agent_handoff_resume_source"
        && isRecord(event.payload)
        && event.payload.intentId === input.intentId)) {
        return "already-repaired";
      }
      return this.runFactDirect({
        kind: "local-repair-agent-handoff-resume-source",
        ...input,
      }, [input.sessionId]);
    });
  }

  async recordFailure(input: {
    userMessageId: number;
    sessionId: string;
    error: string;
    runId: string | null;
    runDir: string | null;
    now: string;
    body?: string;
    systemEventKind?: LocalConsoleSystemEventKind;
    role: string | null;
    processSteps: readonly import("./run-activity.js").LocalRunActivity[];
    terminal?: import("./types.js").LocalConsoleTerminal | null;
    sourceKind?: string | null;
    sourceId?: string | null;
  }): Promise<void> {
    await this.runFact({ kind: "local-record-failure", ...input }, [input.sessionId]);
  }

  async recordRetryableFailure(input: {
    userMessageId: number;
    sessionId: string;
    error: string;
    runId: string | null;
    runDir: string | null;
    now: string;
  }): Promise<LocalConsoleMessage> {
    return this.runFact({ kind: "local-record-retryable-failure", ...input }, [input.sessionId]);
  }

  async recordDeadLetter(input: {
    userMessageId: number;
    sessionId: string;
    error: string;
    runId: string | null;
    runDir: string | null;
    failureCount: number;
    now: string;
    role: string | null;
    processSteps: readonly import("./run-activity.js").LocalRunActivity[];
  }): Promise<void> {
    await this.runFact({ kind: "local-record-dead-letter-and-complete", ...input }, [input.sessionId]);
  }

  async recordInterrupted(input: {
    userMessageId: number;
    sessionId: string;
    reason: string;
    interruptionKind?: "user" | "redirect" | "context-unavailable" | "system";
    runId: string | null;
    runDir: string | null;
    now: string;
    role: string | null;
    processSteps: readonly import("./run-activity.js").LocalRunActivity[];
    terminal?: import("./types.js").LocalConsoleTerminal | null;
  }): Promise<void> {
    await this.runFact({ kind: "local-record-interrupted", ...input }, [input.sessionId]);
  }

  async recordStuck(input: {
    userMessageId: number;
    sessionId: string;
    reason: string;
    runId: string | null;
    runDir: string | null;
    now: string;
    role: string | null;
    processSteps: readonly import("./run-activity.js").LocalRunActivity[];
    terminal?: import("./types.js").LocalConsoleTerminal | null;
  }): Promise<void> {
    await this.runFact({ kind: "local-record-stuck", ...input }, [input.sessionId]);
  }

  async markStaleRunning(input: {
    sessionId: string;
    cutoffIso: string;
    now: string;
    reason: string;
    roles: Record<number, string | null>;
  }): Promise<number> {
    return this.runFact({ kind: "local-mark-stale-running", ...input }, [input.sessionId]);
  }

  async createChildSession(input: {
    parentSessionId: string;
    childSessionId: string;
    projectId: string;
    title: string;
    relation: string;
    hiddenKey: string;
    initialBody: string;
    initialRole: string | null;
    now: string;
  }): Promise<LocalConsoleSessionSummary> {
    return this.runFact(
      { kind: "local-create-child-session", ...input },
      [input.parentSessionId, input.childSessionId],
      new Set([input.childSessionId]),
    );
  }

  async recordChildSessionCard(input: {
    parentSessionId: string;
    sourceId: string;
    childSessionIds: string[];
    runId: string;
    runDir: string;
    now: string;
  }): Promise<void> {
    await this.runFact({
      kind: "local-record-child-session-card",
      parentSessionId: input.parentSessionId,
      sourceId: input.sourceId,
      body: JSON.stringify({ version: 1, childSessionIds: input.childSessionIds }),
      runId: input.runId,
      runDir: input.runDir,
      now: input.now,
    }, [input.parentSessionId]);
  }

  async recordWorkspaceDiff(input: {
    sessionId: string;
    runId: string;
    originalRepoRoot: string | null;
    baseRef: string;
    branchName: string;
    worktreePath: string;
    patchPath: string;
    affectedFiles: string[];
    status: "generated" | "applied" | "failed" | "abandoned" | "rolled_back";
    error: string | null;
    now: string;
  }): Promise<void> {
    await this.runFact({
      kind: "local-record-workspace-diff",
      ...input,
      affectedFilesJson: JSON.stringify(input.affectedFiles),
    }, [input.sessionId]);
  }

  async recordProgressEvent(input: {
    sessionId: string;
    runId: string;
    role: string;
    body: string;
    now: string;
  }): Promise<void> {
    await this.enqueue(async () => {
      await this.readMessagesFromFacts(input.sessionId);
      await this.appendFactEvent(input.sessionId, {
        version: 1,
        eventId: crypto.randomUUID(),
        sessionId: input.sessionId,
        type: "agent_progress",
        recordedAt: input.now,
        payload: {
          runId: input.runId,
          role: input.role,
          body: input.body,
        },
        messageUpserts: [],
      });
    });
  }

  async recordHandoffDispatch(input: {
    sessionId: string;
    role: string;
    runId: string;
    sourceMessageId: number;
    now: string;
  }): Promise<number> {
    return this.enqueue(async () => {
      await this.readMessagesFromFacts(input.sessionId);
      const events = await readFactEvents(this.getSessionFactLogPath(input.sessionId), input.sessionId, false);
      const generation = planHandoffDispatchGeneration(events, input);
      await this.appendFactEvent(input.sessionId, {
        version: 1,
        eventId: crypto.randomUUID(),
        sessionId: input.sessionId,
        type: "handoff_dispatch",
        recordedAt: input.now,
        payload: { ...input, generation },
        messageUpserts: [],
      });
      return generation;
    });
  }

  async readHandoffDispatchState(input: {
    sessionId: string;
    role: string;
    runId: string;
  }): Promise<{ runGeneration: number | null; latestGeneration: number | null }> {
    return this.enqueue(async () => {
      const events = await readFactEvents(this.getSessionFactLogPath(input.sessionId), input.sessionId, false);
      return planHandoffDispatchState(events, input);
    });
  }

  async nextRunAttempt(input: { sessionId: string; stepId: string }): Promise<number> {
    return await this.enqueue(async () => {
      const events = await readFactEvents(this.getSessionFactLogPath(input.sessionId), input.sessionId, true);
      let maximum = 0;
      for (const event of events) {
        if (event.type !== "run_lifecycle" || !isRecord(event.payload)) continue;
        if (event.payload.phase !== "created" || event.payload.stepId !== input.stepId) continue;
        if (typeof event.payload.attempt === "number" && Number.isInteger(event.payload.attempt)) {
          maximum = Math.max(maximum, event.payload.attempt);
        }
      }
      return maximum + 1;
    });
  }

  async getRunTiming(input: {
    sessionId: string;
    runId: string;
  }): Promise<import("./types.js").LocalConsoleRunTiming | null> {
    return await this.enqueue(async () => {
      const events = await readFactEvents(this.getSessionFactLogPath(input.sessionId), input.sessionId, true);
      return readRunTimings(events).get(input.runId) ?? null;
    });
  }

  async recordRunLifecycleEvent(input: {
    sessionId: string;
    runId: string;
    stepId: string;
    attempt: number;
    phase: "created" | "started" | "paused" | "resumed" | "terminal";
    role: string | null;
    engine: import("./types.js").LocalConsoleExecutionEngine;
    processOutputAvailable: boolean;
    createdAt: string;
    startedAt: string | null;
    elapsedMs: number | null;
    completedAt: string | null;
    status: import("./types.js").LocalConsoleRunTiming["status"];
    recordedAt: string;
  }): Promise<void> {
    await this.enqueue(async () => {
      await this.readMessagesFromFacts(input.sessionId);
      const events = await readFactEvents(this.getSessionFactLogPath(input.sessionId), input.sessionId, false);
      const singletonPhase = input.phase === "created" || input.phase === "started" || input.phase === "terminal";
      const existing = singletonPhase
        ? events.find((event) =>
            event.type === "run_lifecycle"
            && isRecord(event.payload)
            && event.payload.runId === input.runId
            && event.payload.phase === input.phase)
        : undefined;
      if (existing !== undefined) {
        if (JSON.stringify(existing.payload) !== JSON.stringify(input)) {
          throw new Error(`conflicting run lifecycle ${input.runId}:${input.phase}`);
        }
        await this.bestEffortIndexRunTiming(input.sessionId, input.runId, timingFromLifecycleInput(input));
        return;
      }
      await this.appendFactEvent(input.sessionId, {
        version: 1,
        eventId: crypto.randomUUID(),
        sessionId: input.sessionId,
        type: "run_lifecycle",
        recordedAt: input.recordedAt,
        payload: input,
        messageUpserts: [],
      });
      await this.bestEffortIndexRunTiming(input.sessionId, input.runId, timingFromLifecycleInput(input));
    });
  }

  async recordRunActivityEvent(input: {
    sessionId: string;
    runId: string;
    activity: import("./run-activity.js").LocalRunActivity;
  }): Promise<void> {
    await this.enqueue(async () => {
      await this.readMessagesFromFacts(input.sessionId);
      await this.appendFactEvent(input.sessionId, {
        version: 1,
        eventId: crypto.randomUUID(),
        sessionId: input.sessionId,
        type: "run_activity",
        recordedAt: input.activity.occurredAt,
        payload: input,
        messageUpserts: [],
      });
    });
  }

  async recordRoundTerminal(input: {
    sessionId: string;
    roundId: number;
    outcome: import("./round-closeout-plan.js").LocalRoundTerminalOutcome;
    terminalMessageId: number | null;
    conversationTitle: string;
    occurredAt: string;
  }): Promise<void> {
    await this.enqueue(async () => {
      await this.readMessagesFromFacts(input.sessionId);
      const payload = {
        roundId: input.roundId,
        outcome: input.outcome,
        terminalMessageId: input.terminalMessageId,
        conversationTitle: input.conversationTitle,
        occurredAt: input.occurredAt,
      };
      const events = await readFactEvents(this.getSessionFactLogPath(input.sessionId), input.sessionId, false);
      const existing = events.find((event) =>
        event.type === "round_terminal"
        && isRecord(event.payload)
        && typeof event.payload.roundId === "number"
        && event.payload.roundId === input.roundId);
      if (existing !== undefined) {
        if (JSON.stringify(existing.payload) !== JSON.stringify(payload)) {
          throw new Error(`conflicting round_terminal fact for round:${String(input.roundId)}`);
        }
        return;
      }
      await this.appendFactEvent(input.sessionId, {
        version: 1,
        eventId: crypto.randomUUID(),
        sessionId: input.sessionId,
        type: "round_terminal",
        recordedAt: input.occurredAt,
        payload,
        messageUpserts: [],
      });
      try {
        await this.runDirect({
          kind: "local-index-round-fact",
          sessionId: input.sessionId,
          roundFact: payload,
        });
        await this.refreshRoundFactCheckpoint(input.sessionId);
      } catch {
        // JSONL 已经是事实源；派生索引失败时留给下一次读取回放重建。
        this.messageIndexDirty = true;
      }
    });
  }

  async recordPrimaryCloseout(input: {
    sessionId: string;
    messageId: number;
    role: string;
    occurredAt: string;
  }): Promise<void> {
    // 与 appendIdempotentSessionFact 不同：同一消息可能因 rewind/重试被再次
    // complete-source，occurredAt 会变化；收束信号对消息是确定的，已存在即
    // 幂等忽略（保留首次判定时刻），不因时间戳差异抛冲突。
    await this.enqueue(async () => {
      await this.readMessagesFromFacts(input.sessionId);
      const events = await readFactEvents(this.getSessionFactLogPath(input.sessionId), input.sessionId, false);
      const existing = events.find((event) =>
        event.type === "primary_closeout"
        && isRecord(event.payload)
        && event.payload.messageId === input.messageId);
      if (existing !== undefined) {
        return;
      }
      await this.appendFactEvent(input.sessionId, {
        version: 1,
        eventId: crypto.randomUUID(),
        sessionId: input.sessionId,
        type: "primary_closeout",
        recordedAt: input.occurredAt,
        payload: {
          messageId: input.messageId,
          role: input.role,
          occurredAt: input.occurredAt,
        },
        messageUpserts: [],
      });
      try {
        await this.runDirect({
          kind: "local-index-primary-closeout",
          sessionId: input.sessionId,
          closeout: {
            messageId: input.messageId,
            role: input.role,
            occurredAt: input.occurredAt,
          },
        });
        await this.refreshRoundFactCheckpoint(input.sessionId);
      } catch {
        // JSONL 已经是事实源；派生索引失败时留给下一次读取回放重建。
        this.messageIndexDirty = true;
      }
    });
  }

  async recordCodexThreadLink(input: LocalCodexThreadLinkFact): Promise<void> {
    await this.enqueue(async () => {
      await this.readMessagesFromFacts(input.sessionId);
      const existing = (await readCodexThreadLinks(
        this.getSessionFactLogPath(input.sessionId),
        input.sessionId,
      )).find((link) => link.runId === input.runId);
      if (existing !== undefined) {
        if (
          existing.threadId !== input.threadId
          || existing.sourceMessageId !== input.sourceMessageId
          || existing.role !== input.role
          || existing.startedAt !== input.startedAt
          || (existing.contextFingerprint ?? null) !== (input.contextFingerprint ?? null)
        ) {
          throw new Error(`conflicting Codex thread link for run ${input.runId}`);
        }
        return;
      }
      await this.appendFactEvent(input.sessionId, {
        version: 1,
        eventId: crypto.randomUUID(),
        sessionId: input.sessionId,
        type: "codex_thread_link",
        recordedAt: input.startedAt,
        payload: input,
        messageUpserts: [],
      });
    });
  }

  async recordRunExecutionContext(input: LocalRunExecutionContextFact): Promise<void> {
    await this.appendIdempotentSessionFact(
      input.sessionId,
      "run_execution_context",
      input.runId,
      input.recordedAt,
      input,
    );
    await this.run({
      kind: "local-index-run-execution-context",
      sessionId: input.sessionId,
      runId: input.runId,
      context: input,
    });
    await this.bestEffortRefreshSessionFactCheckpoint(input.sessionId);
  }

  async recordProviderProcessStarted(input: LocalProviderProcessStartedFact): Promise<void> {
    await this.enqueue(async () => {
      await this.readMessagesFromFacts(input.sessionId);
      await this.appendFactEvent(input.sessionId, {
        version: 1,
        eventId: crypto.randomUUID(),
        sessionId: input.sessionId,
        type: "provider_process_started",
        recordedAt: input.startedAt,
        payload: input,
        messageUpserts: [],
      });
    });
  }

  async readRunAgentAuditSource(input: { sessionId: string; runId: string }): Promise<{
    context: LocalRunExecutionContextFact | null;
    processStarted: boolean;
  }> {
    const logPath = this.getSessionFactLogPath(input.sessionId);
    const [contexts, starts] = await Promise.all([
      readRunExecutionContexts(logPath, input.sessionId),
      readProviderProcessStartedFacts(logPath, input.sessionId),
    ]);
    return {
      context: contexts.find((context) => context.runId === input.runId) ?? null,
      processStarted: starts.some((fact) => fact.runId === input.runId),
    };
  }

  async recordExecutionSessionLink(input: LocalExecutionSessionLinkFact): Promise<void> {
    await this.appendIdempotentSessionFact(
      input.sessionId,
      "execution_session_link",
      input.runId,
      input.startedAt,
      input,
    );
    await this.run({
      kind: "local-index-execution-session-link",
      sessionId: input.sessionId,
      runId: input.runId,
      link: input,
    });
    await this.bestEffortRefreshSessionFactCheckpoint(input.sessionId);
  }

  async recordAgentSessionLink(input: LocalAgentSessionLinkFact): Promise<void> {
    await this.enqueue(async () => {
      await this.readMessagesFromFacts(input.sessionId);
      const links = await readAgentSessionLinks(
        this.getSessionFactLogPath(input.sessionId),
        input.sessionId,
      );
      const existing = links.find((link) =>
        link.agentIdentityFingerprint === input.agentIdentityFingerprint);
      if (existing !== undefined) {
        if (
          existing.externalSessionId !== input.externalSessionId
          || existing.role !== input.role
          || existing.engine !== input.engine
          || existing.profileFingerprint !== input.profileFingerprint
          || existing.contextFingerprint !== input.contextFingerprint
        ) {
          throw new Error(
            `conflicting Agent session link for ${input.agentIdentityFingerprint}`,
          );
        }
        return;
      }
      await this.appendFactEvent(input.sessionId, {
        version: 1,
        eventId: crypto.randomUUID(),
        sessionId: input.sessionId,
        type: "agent_session_link",
        recordedAt: input.linkedAt,
        payload: input,
        messageUpserts: [],
      });
    });
  }

  async recordProviderSessionObserved(input: LocalProviderSessionObservedFact): Promise<void> {
    await this.appendIdempotentSessionFact(
      input.sessionId,
      "provider_session_observed",
      input.runId,
      input.observedAt,
      input,
    );
  }

  async recordAgentTimelineCursor(input: LocalAgentTimelineCursorFact): Promise<void> {
    await this.appendIdempotentSessionFact(
      input.sessionId,
      "agent_timeline_cursor",
      input.runId,
      input.recordedAt,
      input,
    );
  }

  async recordProviderInvocation(input: LocalProviderInvocationFact): Promise<void> {
    await this.appendIdempotentSessionFact(
      input.sessionId,
      "provider_invocation",
      `${input.invocationId}:${input.phase}`,
      input.recordedAt,
      input,
    );
  }

  async recordCodexResumeIntent(input: LocalCodexResumeIntentFact): Promise<void> {
    await this.appendIdempotentSessionFact(
      input.sessionId,
      "codex_resume_intent",
      input.intentId,
      input.createdAt,
      input,
    );
  }

  async recordCodexResumeConsumed(input: LocalCodexResumeConsumedFact): Promise<void> {
    await this.appendIdempotentSessionFact(
      input.sessionId,
      "codex_resume_consumed",
      input.intentId,
      input.consumedAt,
      input,
    );
  }

  async recordCodexRunUsage(input: LocalCodexRunUsageFact): Promise<void> {
    await this.appendIdempotentSessionFact(
      input.sessionId,
      "codex_run_usage",
      input.runId,
      input.recordedAt,
      input,
    );
  }

  getSessionFactLogPath(sessionId: string): string {
    return path.join(this.sessionLogRoot, `${Buffer.from(sessionId, "utf8").toString("base64url")}.jsonl`);
  }

  /**
   * 读取会话最新轮次收束事实与一等收束信号。
   *
   * 优先读 SQLite 派生投影（检查点 + 行数校验通过时）；索引缺失或失配时回退到
   * 事实日志扫描，并把该会话的轮次索引惰性重建后刷新检查点。索引只是可重建
   * 优化，事实日志仍是唯一事实源。
   */
  async readRoundFacts(sessionId: string): Promise<LocalConsoleRoundFactProjection> {
    return this.enqueue(async () => {
      const logPath = this.getSessionFactLogPath(sessionId);
      const fingerprint = await readSessionFactLogFingerprint(logPath);
      if (fingerprint === null) {
        return { lastRoundFact: null, lastPrimaryCloseout: null };
      }
      const indexed = await this.runDirect<{
        current: boolean;
        lastRoundFact: LocalConsoleRoundFactProjection["lastRoundFact"];
        lastPrimaryCloseout: LocalConsoleRoundFactProjection["lastPrimaryCloseout"];
      }>({ kind: "local-read-round-facts", sessionId, fingerprint });
      if (indexed.current) {
        return {
          lastRoundFact: indexed.lastRoundFact,
          lastPrimaryCloseout: indexed.lastPrimaryCloseout,
        };
      }
      const events = await readFactEvents(logPath, sessionId, true);
      const roundFacts = readRoundFactsFromEvents(events, sessionId);
      if (roundFacts.roundFacts.length > 0 || roundFacts.primaryCloseouts.length > 0) {
        await this.runDirect({
          kind: "local-rebuild-session-round-fact-index",
          sessionId,
          roundFacts: roundFacts.roundFacts,
          primaryCloseouts: roundFacts.primaryCloseouts,
        });
        await this.bestEffortRefreshSessionFactCheckpoint(sessionId);
        await this.bestEffortRefreshRoundFactCheckpoint(sessionId);
      }
      // 一次性扫描：索引已落盘，丢弃解析缓存避免大日志长期驻留内存。
      invalidateSessionFactLog(logPath);
      return {
        lastRoundFact: roundFacts.lastRoundFact,
        lastPrimaryCloseout: roundFacts.lastPrimaryCloseout,
      };
    });
  }

  async rebuildMessageIndex(sessionId?: string): Promise<void> {
    await this.enqueue(() => this.rebuildMessageIndexDirect(sessionId, true));
  }

  private async run<T>(command: SqliteStateCommand): Promise<T> {
    return this.enqueue(async () => {
      if (this.messageIndexDirty) {
        await this.rebuildMessageIndexDirect(undefined, true);
        this.messageIndexDirty = false;
      }
      const result = await this.runDirect<T>(command);
      if (!isStateReadCommand(command)) this.stateRevision += 1;
      return result;
    });
  }

  private async runDirect<T>(command: SqliteStateCommand, sqlitePath = this.sqlitePath): Promise<T> {
    const result = await runSqliteStateCommand<unknown>({
      sqlitePath,
      busyTimeoutMs: this.busyTimeoutMs,
      timeoutMs: this.timeoutMs,
      command,
    });
    return normalizeResult(result) as T;
  }

  private async runFact<T>(
    command: SqliteStateCommand,
    sessionIds: string[],
    allowMissing = new Set<string>(),
  ): Promise<T> {
    return this.enqueue(() => this.runFactDirect<T>(command, sessionIds, allowMissing));
  }

  private async runFactDirect<T>(
    command: SqliteStateCommand,
    sessionIds: string[],
    allowMissing = new Set<string>(),
  ): Promise<T> {
    const uniqueSessionIds = [...new Set(sessionIds)];
    if (this.messageIndexDirty) {
      await this.rebuildMessageIndexDirect(undefined, true);
      this.messageIndexDirty = false;
    }
    const before = new Map<string, LocalConsoleMessage[]>();
    for (const sessionId of uniqueSessionIds) {
      const messages = await this.readMessagesFromFacts(sessionId, allowMissing.has(sessionId));
      before.set(sessionId, messages);
    }

    try {
      const committed = await this.runDirect<{
        result: T;
        sessions: Array<{ sessionId: string; messages: LocalConsoleMessage[] }>;
      }>({
        kind: "local-commit-session-fact-write",
        factCommand: command,
        facts: uniqueSessionIds.map((sessionId) => {
          const event = buildFactEvent(command, sessionId, []);
          return {
            sessionId,
            logPath: this.getSessionFactLogPath(sessionId),
            eventId: event.eventId,
            type: event.type,
            recordedAt: event.recordedAt,
            payload: event.payload,
            beforeMessages: planRuntimeFallback(before.get(sessionId), []),
          };
        }),
      });
      await Promise.all(uniqueSessionIds.map((currentSessionId) =>
        this.bestEffortRefreshSessionFactCheckpoint(currentSessionId)));
      this.stateRevision += 1;
      return committed.result;
    } catch (error) {
      this.messageIndexDirty = true;
      throw error;
    }
  }

  private async migrateSessionMessages(): Promise<void> {
    const status = await this.runDirect<{ complete: boolean }>({ kind: "local-session-fact-migration-status" });
    if (status.complete) {
      return;
    }
    const indexes = await this.runDirect<Array<{ sessionId: string; parentSessionId: string | null; messages: LocalConsoleMessage[] }>>({
      kind: "local-list-session-message-indexes",
    });
    const childIdsByParent = new Map<string, string[]>();
    for (const index of indexes) {
      if (index.parentSessionId !== null) {
        const childIds = planRuntimeFallback(childIdsByParent.get(index.parentSessionId), []);
        childIds.push(index.sessionId);
        childIdsByParent.set(index.parentSessionId, childIds);
      }
    }
    for (const index of indexes) {
      const logPath = this.getSessionFactLogPath(index.sessionId);
      if (await fileExists(logPath)) {
        await this.readMessagesFromFacts(index.sessionId);
        continue;
      }
      await this.appendFactEvent(index.sessionId, {
        version: 1,
        eventId: crypto.randomUUID(),
        sessionId: index.sessionId,
        type: "session_history_migrated",
        recordedAt: new Date().toISOString(),
        payload: {
          source: "session_messages",
          parentSessionId: index.parentSessionId,
          childSessionIds: planRuntimeFallback(childIdsByParent.get(index.sessionId), []),
        },
        messageUpserts: index.messages,
      });
      const migrated = await this.readMessagesFromFacts(index.sessionId);
      assertMigrationSample(index.sessionId, index.messages, migrated);
    }
    await this.runDirect({ kind: "local-complete-session-fact-migration", now: new Date().toISOString() });
  }

  private async rebuildMessageIndexDirect(sessionId?: string, force = false): Promise<void> {
    const inventory = await this.runDirect<{
      sessionIds: string[];
      checkpoints: Array<SessionFactIndexCheckpoint & {
        sessionId: string;
        currentMessageCount: number;
        currentContextCount: number;
        currentLinkCount: number;
        currentTimingCount: number;
      }>;
    }>({ kind: "local-list-session-fact-checkpoints" });
    const checkpoints = new Map(inventory.checkpoints.map((checkpoint) => [checkpoint.sessionId, checkpoint]));
    const sessionIds = sessionId === undefined
      ? [...new Set([
          ...inventory.sessionIds,
          ...inventory.checkpoints.map((checkpoint) => checkpoint.sessionId),
          ...await this.listFactLogSessionIds(),
        ])]
      : [sessionId];
    for (const currentSessionId of sessionIds) {
      const logPath = this.getSessionFactLogPath(currentSessionId);
      const fingerprint = await readSessionFactLogFingerprint(logPath);
      if (
        !force
        && sessionId === undefined
        && fingerprint !== null
        && sameSessionFactLogFingerprint(checkpoints.get(currentSessionId), fingerprint)
      ) {
        continue;
      }
      const messages = await this.readMessagesFromFacts(currentSessionId);
      await this.runDirect({ kind: "local-rebuild-session-message-index", sessionId: currentSessionId, messages });
      const events = await readFactEvents(logPath, currentSessionId, true);
      await this.runDirect({
        kind: "local-rebuild-session-run-timing-index",
        sessionId: currentSessionId,
        timings: [...readRunTimings(events)].map(([runId, timing]) => ({ runId, timing })),
      });
      const roundFacts = readRoundFactsFromEvents(events, currentSessionId);
      await this.runDirect({
        kind: "local-rebuild-session-round-fact-index",
        sessionId: currentSessionId,
        roundFacts: roundFacts.roundFacts,
        primaryCloseouts: roundFacts.primaryCloseouts,
      });
      const [contexts, links] = await Promise.all([
        readRunExecutionContexts(logPath, currentSessionId),
        readExecutionSessionLinks(logPath, currentSessionId),
      ]);
      await this.runDirect({
        kind: "local-rebuild-execution-index",
        sessionId: currentSessionId,
        contexts,
        links,
      });
      const currentFingerprint = await readSessionFactLogFingerprint(logPath);
      if (currentFingerprint !== null) {
        await this.runDirect({
          kind: "local-record-session-fact-checkpoint",
          sessionId: currentSessionId,
          checkpoint: currentFingerprint,
        });
        await this.runDirect({
          kind: "local-record-round-fact-checkpoint",
          sessionId: currentSessionId,
          checkpoint: currentFingerprint,
        });
      }
      invalidateSessionFactLog(logPath);
    }
  }

  private async listFactLogSessionIds(): Promise<string[]> {
    let entries;
    try {
      entries = await fs.readdir(this.sessionLogRoot, { withFileTypes: true });
    } catch (error) {
      if (isNodeError(error) && error.code === "ENOENT") {
        return [];
      }
      throw error;
    }
    return entries
      .filter((entry) => entry.isFile() && entry.name.endsWith(".jsonl"))
      .map((entry) => {
        const encoded = entry.name.slice(0, -".jsonl".length);
        const decoded = Buffer.from(encoded, "base64url").toString("utf8");
        if (Buffer.from(decoded, "utf8").toString("base64url") !== encoded) {
          throw new Error(`invalid session fact log filename: ${entry.name}`);
        }
        return decoded;
      });
  }

  private async readMessagesFromFacts(sessionId: string, allowMissing = false): Promise<LocalConsoleMessage[]> {
    const events = await readFactEvents(this.getSessionFactLogPath(sessionId), sessionId, allowMissing);
    const messages = new Map<number, LocalConsoleMessage>();
    for (const event of events) {
      for (const message of event.messageUpserts) {
        messages.set(message.id, message);
      }
    }
    const timings = readRunTimings(events);
    return [...messages.values()].map((message) => {
      const timing = message.runId === null ? undefined : timings.get(message.runId);
      return timing === undefined ? message : { ...message, runTiming: timing };
    }).sort((left, right) => {
      const leftTimelineAt = left.speaker === "user"
        ? left.activatedAt ?? left.createdAt
        : left.createdAt;
      const rightTimelineAt = right.speaker === "user"
        ? right.activatedAt ?? right.createdAt
        : right.createdAt;
      return leftTimelineAt.localeCompare(rightTimelineAt) || left.id - right.id;
    });
  }

  private async readMessagesForView(sessionId: string): Promise<LocalConsoleMessage[]> {
    const fingerprint = await readSessionFactLogFingerprint(this.getSessionFactLogPath(sessionId));
    if (fingerprint !== null) {
      const indexed = await this.runDirect<{
        sessionId: string;
        messages: LocalConsoleMessage[];
      } | null>({
        kind: "local-list-session-messages-if-current",
        sessionId,
        fingerprint,
      });
      if (indexed !== null) {
        return indexed.messages;
      }
    }
    return this.readMessagesFromFacts(sessionId);
  }

  private async refreshSessionFactCheckpoint(sessionId: string): Promise<void> {
    const checkpoint = await readSessionFactLogFingerprint(this.getSessionFactLogPath(sessionId));
    if (checkpoint === null) {
      return;
    }
    await this.runDirect({
      kind: "local-record-session-fact-checkpoint",
      sessionId,
      checkpoint,
    });
    this.stateRevision += 1;
  }

  private async refreshRoundFactCheckpoint(sessionId: string): Promise<void> {
    const checkpoint = await readSessionFactLogFingerprint(this.getSessionFactLogPath(sessionId));
    if (checkpoint === null) {
      return;
    }
    await this.runDirect({
      kind: "local-record-round-fact-checkpoint",
      sessionId,
      checkpoint,
    });
  }

  private async bestEffortRefreshSessionFactCheckpoint(sessionId: string): Promise<void> {
    try {
      await this.refreshSessionFactCheckpoint(sessionId);
    } catch {
      // 检查点只是可重建索引的启动优化；事实日志已经落盘时，失败应退化为下次启动重建。
      this.messageIndexDirty = true;
    }
  }

  private async bestEffortRefreshRoundFactCheckpoint(sessionId: string): Promise<void> {
    try {
      await this.refreshRoundFactCheckpoint(sessionId);
    } catch {
      // 轮次投影只是可重建缓存；事实日志已经落盘时，失败应退化为下次回放。
      this.messageIndexDirty = true;
    }
  }

  private async bestEffortIndexRunTiming(
    sessionId: string,
    runId: string,
    timing: import("./types.js").LocalConsoleRunTiming,
  ): Promise<void> {
    try {
      await this.runDirect({ kind: "local-index-run-timing", sessionId, runId, timing });
      this.stateRevision += 1;
      await this.refreshSessionFactCheckpoint(sessionId);
    } catch {
      // 时序投影只是可重建缓存；事实日志已提交时，失败应退化为下次启动重建。
      this.messageIndexDirty = true;
    }
  }

  private async appendFactEvent(sessionId: string, event: SessionFactEvent): Promise<void> {
    await appendSessionFactLogLine(this.getSessionFactLogPath(sessionId), JSON.stringify(event));
    this.stateRevision += 1;
    if (
      event.messageUpserts.length === 0
      && event.type !== "session_history_migrated"
      && event.type !== "run_execution_context"
      && event.type !== "execution_session_link"
    ) {
      await this.bestEffortRefreshSessionFactCheckpoint(sessionId);
    }
  }

  private async appendIdempotentSessionFact(
    sessionId: string,
    type: string,
    key: string,
    recordedAt: string,
    payload: unknown,
  ): Promise<void> {
    await this.enqueue(async () => {
      await this.readMessagesFromFacts(sessionId);
      const events = await readFactEvents(this.getSessionFactLogPath(sessionId), sessionId, false);
      const existing = events.find((event) =>
        event.type === type
        && isRecord(event.payload)
        && (
          event.payload.intentId === key
          || event.payload.runId === key
          || event.payload.agentIdentityFingerprint === key
          || (
            typeof event.payload.invocationId === "string"
            && typeof event.payload.phase === "string"
            && `${event.payload.invocationId}:${event.payload.phase}` === key
          )
          || (
            typeof event.payload.roundId === "number"
            && `round:${event.payload.roundId}` === key
          )
        ));
      if (existing !== undefined) {
        if (JSON.stringify(existing.payload) !== JSON.stringify(payload)) {
          throw new Error(`conflicting ${type} fact for ${key}`);
        }
        return;
      }
      await this.appendFactEvent(sessionId, {
        version: 1,
        eventId: crypto.randomUUID(),
        sessionId,
        type,
        recordedAt,
        payload,
        messageUpserts: [],
      });
    });
  }

  private async enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const pending = this.operationTail.then(operation, operation);
    this.operationTail = pending.then(() => undefined, () => undefined);
    return pending;
  }
}

function isStateReadCommand(command: SqliteStateCommand): boolean {
  const kind = command.kind;
  return kind === "local-list"
    || kind === "local-has-running"
    || kind === "local-session-fact-migration-status"
    || kind === "local-find-message-session"
    || kind === "local-find-route-decision"
    || kind.startsWith("local-list-")
    || kind.startsWith("local-get-")
    || kind.startsWith("local-read-")
    || kind.startsWith("local-find-")
    || kind.startsWith("local-search-")
    || kind.startsWith("provider-list-")
    || kind.startsWith("provider-get-");
}

function sameSessionFactLogFingerprint(
  checkpoint: (SessionFactIndexCheckpoint & {
    currentMessageCount: number;
    currentContextCount: number;
    currentLinkCount: number;
    currentTimingCount: number;
  }) | undefined,
  fingerprint: SessionFactLogFingerprint,
): boolean {
  return checkpoint !== undefined
    && checkpoint.ino === fingerprint.ino
    && checkpoint.size === fingerprint.size
    && checkpoint.mtimeMs === fingerprint.mtimeMs
    && checkpoint.head === fingerprint.head
    && checkpoint.tail === fingerprint.tail
    && checkpoint.messageCount === checkpoint.currentMessageCount
    && checkpoint.contextCount === checkpoint.currentContextCount
    && checkpoint.linkCount === checkpoint.currentLinkCount
    && checkpoint.timingCount === checkpoint.currentTimingCount;
}

function readRunTimings(events: SessionFactEvent[]): Map<string, import("./types.js").LocalConsoleRunTiming> {  const timings = new Map<string, import("./types.js").LocalConsoleRunTiming>();
  for (const event of events) {
    if (event.type !== "run_lifecycle" || !isRecord(event.payload)) continue;
    const payload = event.payload;
    const runId = typeof payload.runId === "string" ? payload.runId : null;
    const stepId = typeof payload.stepId === "string" ? payload.stepId : null;
    const attempt = typeof payload.attempt === "number" ? payload.attempt : null;
    const engine = payload.engine === "kimi"
      ? "kimi"
      : payload.engine === "claude"
        ? "claude"
        : payload.engine === "codex"
          ? "codex"
          : payload.engine === "pi"
            ? "pi"
            : null;
    if (runId === null || stepId === null || attempt === null || engine === null) continue;
    timings.set(runId, {
      stepId,
      attempt,
      createdAt: typeof payload.createdAt === "string" ? payload.createdAt : event.recordedAt,
      startedAt: typeof payload.startedAt === "string" ? payload.startedAt : null,
      elapsedMs: typeof payload.elapsedMs === "number" ? Math.max(0, payload.elapsedMs) : null,
      completedAt: typeof payload.completedAt === "string" ? payload.completedAt : null,
      status: readRunTimingStatus(payload.status),
      engine,
      processOutputAvailable: true,
    });
  }
  return timings;
}

function readRunTimingStatus(value: unknown): import("./types.js").LocalConsoleRunTiming["status"] {
  return value === "running"
    || value === "completed"
    || value === "failed"
    || value === "interrupted"
    || value === "stuck"
    || value === "paused"
    ? value
    : "created";
}

/** 从事实事件流提取轮次收束事实与一等收束信号（JSONL → 可重建索引）。 */
function readRoundFactsFromEvents(
  events: readonly SessionFactEvent[],
  sessionId: string,
): {
  roundFacts: unknown[];
  primaryCloseouts: unknown[];
  lastRoundFact: LocalConsoleRoundFactProjection["lastRoundFact"];
  lastPrimaryCloseout: LocalConsoleRoundFactProjection["lastPrimaryCloseout"];
} {
  const roundFacts: unknown[] = [];
  const primaryCloseouts: unknown[] = [];
  let lastRoundFact: LocalConsoleRoundFactProjection["lastRoundFact"] = null;
  let lastPrimaryCloseout: LocalConsoleRoundFactProjection["lastPrimaryCloseout"] = null;
  for (const event of events) {
    if (event.type === LOCAL_ROUND_FACT_TYPE) {
      const fact = parseRoundPersistedFact(event, sessionId, LOCAL_ROUND_FACT_TYPE);
      if (fact !== null) {
        roundFacts.push({
          roundId: fact.roundId,
          outcome: fact.outcome,
          terminalMessageId: fact.terminalMessageId,
          conversationTitle: fact.conversationTitle,
          occurredAt: fact.occurredAt,
        });
        lastRoundFact = planLatestRoundFact(lastRoundFact, fact);
      }
    } else if (event.type === LOCAL_PRIMARY_CLOSEOUT_FACT_TYPE) {
      const closeout = parsePrimaryCloseoutFact(event, sessionId, LOCAL_PRIMARY_CLOSEOUT_FACT_TYPE);
      if (closeout !== null) {
        primaryCloseouts.push(closeout);
        lastPrimaryCloseout = planLatestPrimaryCloseout(lastPrimaryCloseout, closeout);
      }
    }
  }
  return { roundFacts, primaryCloseouts, lastRoundFact, lastPrimaryCloseout };
}

function timingFromLifecycleInput(input: {
  stepId: string;
  attempt: number;
  engine: import("./types.js").LocalConsoleExecutionEngine;
  processOutputAvailable: boolean;
  createdAt: string;
  startedAt: string | null;
  elapsedMs: number | null;
  completedAt: string | null;
  status: import("./types.js").LocalConsoleRunTiming["status"];
}): import("./types.js").LocalConsoleRunTiming {
  return {
    stepId: input.stepId,
    attempt: input.attempt,
    createdAt: input.createdAt,
    startedAt: input.startedAt,
    elapsedMs: input.elapsedMs,
    completedAt: input.completedAt,
    status: input.status,
    engine: input.engine,
    processOutputAvailable: input.processOutputAvailable,
  };
}

interface SessionFactEvent {
  version: 1;
  eventId: string;
  sessionId: string;
  type: string;
  recordedAt: string;
  payload: unknown;
  messageUpserts: LocalConsoleMessage[];
}

function buildFactEvent(command: SqliteStateCommand, sessionId: string, messageUpserts: LocalConsoleMessage[]): SessionFactEvent {
  const type = command.kind === "local-create-child-session"
    ? sessionId === command.parentSessionId ? "child_session_created" : "session_created"
    : command.kind.replace(/^local-/u, "").replaceAll("-", "_");
  return {
    version: 1,
    eventId: crypto.randomUUID(),
    sessionId,
    type,
    recordedAt: "now" in command && typeof command.now === "string" ? command.now : new Date().toISOString(),
    payload: command,
    messageUpserts,
  };
}

// 事实事件的投影缓存：键是 readSessionFactLog 返回的原始值数组，日志只追加时该数组身份不变，
// 于是每次轮询只需要投影新增的几行，而不是整份日志。
const factEventProjections = new WeakMap<readonly unknown[], SessionFactEvent[]>();

async function readFactEvents(logPath: string, sessionId: string, allowMissing: boolean): Promise<SessionFactEvent[]> {
  const snapshot = await readSessionFactLog(logPath, sessionId);
  if (snapshot === null) {
    if (allowMissing) {
      return [];
    }
    throw new Error(`session fact log not found: ${sessionId}`);
  }
  if (snapshot.parsedLength !== snapshot.size) {
    await fs.truncate(logPath, snapshot.parsedLength);
    invalidateSessionFactLog(logPath);
  }
  const projected = planRuntimeFallback(factEventProjections.get(snapshot.values), []);
  for (let index = projected.length; index < snapshot.values.length; index += 1) {
    projected.push(parseFactEvent(snapshot.values[index], sessionId, index + 1));
  }
  factEventProjections.set(snapshot.values, projected);
  return projected;
}

function parseFactEvent(value: unknown, sessionId: string, lineNumber: number): SessionFactEvent {
  if (!isRecord(value) || value.version !== 1 || value.sessionId !== sessionId || !Array.isArray(value.messageUpserts)) {
    throw new Error(`invalid session fact event ${sessionId} line ${String(lineNumber)}`);
  }
  const messageUpserts = value.messageUpserts.map((message) => {
    const normalized = normalizeStoreRecordIfNeeded(message);
    if (!isLocalConsoleMessage(normalized) || normalized.sessionId !== sessionId) {
      throw new Error(`invalid session fact message ${sessionId} line ${String(lineNumber)}`);
    }
    return normalized;
  });
  return {
    version: 1,
    eventId: readString(value.eventId, "eventId"),
    sessionId,
    type: readString(value.type, "type"),
    recordedAt: readString(value.recordedAt, "recordedAt"),
    payload: value.payload,
    messageUpserts,
  };
}

/**
 * 有界读取会话基线提交。
 *
 * 基线只在会话诞生时的 create-session 事实里记录，必然位于日志首行。只解析
 * 首个完整行，绝不对整份日志做全量解析——getSessionWorkspace /
 * getSessionBaselineCommit 是状态刷新的高频路径，全量解析会让大日志会话的每次
 * 切换慢数百毫秒。首行在扫描预算内无法闭合时（超大单行事件）回退到全量解析，
 * 保证不丢基线。
 */
const BASELINE_SCAN_MAX_BYTES = 4 * 1024 * 1024;

async function readSessionBaselineCommit(logPath: string, sessionId: string): Promise<string | null> {
  let handle: fs.FileHandle;
  try {
    handle = await fs.open(logPath, "r");
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") {
      return null;
    }
    throw error;
  }
  try {
    const size = (await handle.stat()).size;
    if (size <= 0) {
      return null;
    }
    const chunk = Buffer.alloc(Math.min(size, BASELINE_SCAN_MAX_BYTES));
    await readExactly(handle, chunk, 0);
    const text = chunk.toString("utf8");
    const firstLineEnd = text.indexOf("\n");
    if (firstLineEnd < 0) {
      if (chunk.length >= size) {
        // 整个文件只有一行且未闭合：按现有语义视为无基线。
        return null;
      }
      // 首行超出扫描预算：回退全量解析（罕见路径，保持基线可读）。
      const events = await readFactEvents(logPath, sessionId, true);
      return readConversationBaselineCommit(events);
    }
    const firstLine = text.slice(0, firstLineEnd);
    let event: unknown;
    try {
      event = JSON.parse(firstLine);
    } catch {
      return null;
    }
    if (
      isRecord(event)
      && event.sessionId === sessionId
      && isRecord(event.payload)
      && event.payload.kind === "local-create-session"
    ) {
      return typeof event.payload.baselineCommit === "string" ? event.payload.baselineCommit : null;
    }
    return null;
  } finally {
    await handle.close();
  }
}

async function readExactly(handle: fs.FileHandle, buffer: Buffer, position: number): Promise<void> {
  let read = 0;
  while (read < buffer.length) {
    const result = await handle.read(buffer, read, buffer.length - read, position + read);
    if (result.bytesRead === 0) {
      throw new Error(`unexpected end of session fact log at ${String(position + read)}`);
    }
    read += result.bytesRead;
  }
}

function readConversationBaselineCommit(events: SessionFactEvent[]): string | null {
  for (const event of events) {
    if (!isRecord(event.payload) || event.payload.kind !== "local-create-session") {
      continue;
    }
    return typeof event.payload.baselineCommit === "string" ? event.payload.baselineCommit : null;
  }
  return null;
}

function isLocalConsoleMessage(value: unknown): value is LocalConsoleMessage {
  return isRecord(value) && typeof value.id === "number" && typeof value.sessionId === "string" && typeof value.speaker === "string";
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await fs.stat(filePath);
    return true;
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") {
      return false;
    }
    throw error;
  }
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}

function assertMigrationSample(sessionId: string, expected: LocalConsoleMessage[], actual: LocalConsoleMessage[]): void {
  const expectedSample = [expected[0] ?? null, expected.at(-1) ?? null];
  const actualSample = [actual[0] ?? null, actual.at(-1) ?? null];
  if (expected.length !== actual.length || JSON.stringify(expectedSample) !== JSON.stringify(actualSample)) {
    throw new Error(`session fact migration verification failed: ${sessionId}`);
  }
}

function defaultSessionLogRoot(sqlitePath: string): string {
  const stateDir = path.dirname(sqlitePath);
  const dataRoot = path.basename(stateDir) === ".state" ? path.dirname(stateDir) : stateDir;
  return path.join(dataRoot, "sessions");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function readString(value: unknown, field: string): string {
  if (typeof value !== "string") {
    throw new Error(`Invalid local console message ${field}`);
  }
  return value;
}

function readNullableString(value: unknown, field: string): string | null {
  if (value === null) {
    return null;
  }
  return readString(value, field);
}

function readNumber(value: unknown, field: string): number {
  if (typeof value !== "number" || !Number.isInteger(value)) {
    throw new Error(`Invalid local console message ${field}`);
  }
  return value;
}

function readNullableFiniteNumber(value: unknown, field: string): number | null {
  if (value === null) {
    return null;
  }
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`Invalid local console message ${field}`);
  }
  return value;
}

function readSpeaker(value: unknown): LocalConsoleSpeaker {
  if (value === "user" || value === "agent" || value === "system") {
    return value;
  }
  throw new Error(`Invalid local console message speaker: ${String(value)}`);
}

function readStatus(value: unknown): LocalConsoleMessageStatus {
  if (
    value === "pending" ||
    value === "running" ||
    value === "completed" ||
    value === "failed" ||
    value === "interrupted" ||
    value === "stuck" ||
    value === "displayed"
  ) {
    return value;
  }
  throw new Error(`Invalid local console message status: ${String(value)}`);
}

function readSessionStatus(value: unknown): LocalConsoleSessionStatus {
  if (
    value === "idle" ||
    value === "running" ||
    value === "waiting" ||
    value === "stuck" ||
    value === "failed" ||
    value === "interrupted"
  ) {
    return value;
  }
  throw new Error(`Invalid local console session status: ${String(value)}`);
}

function normalizeRouteDecision(value: unknown): LocalRouteDecisionRecord | null {
  if (value === null) {
    return null;
  }
  if (!isRecord(value)) {
    throw new Error("Invalid local route decision");
  }
  return {
    sessionId: readString(value.sessionId, "sessionId"),
    messageId: readNumber(value.messageId, "messageId"),
    routeKey: readString(value.routeKey, "routeKey"),
    outcome: readRouteDecisionOutcome(value.outcome),
    targetRole: readNullableString(value.targetRole, "targetRole"),
    reason: readString(value.reason, "reason"),
    createdAt: readString(value.createdAt, "createdAt"),
  };
}

function readRouteDecisionOutcome(value: unknown): LocalRouteDecisionRecord["outcome"] {
  if (value === "append" || value === "no_action" || value === "fail_open" || value === "dead_letter") {
    return value;
  }
  throw new Error(`Invalid local route decision outcome: ${String(value)}`);
}

function normalizeResult(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(normalizeStoreRecordIfNeeded);
  }
  return normalizeStoreRecordIfNeeded(value);
}

function normalizeStoreRecordIfNeeded(value: unknown): unknown {
  if (isRecord(value) && "result" in value && Array.isArray(value.sessions)) {
    return {
      result: normalizeResult(value.result),
      sessions: value.sessions.map(normalizeStoreRecordIfNeeded),
    };
  }
  if (isRecord(value) && "sessionId" in value && Array.isArray(value.messages)) {
    return {
      sessionId: readString(value.sessionId, "sessionId"),
      parentSessionId: "parentSessionId" in value ? readNullableString(value.parentSessionId, "parentSessionId") : null,
      messages: value.messages.map(normalizeStoreRecordIfNeeded),
    };
  }
  if (isRecord(value) && Object.keys(value).length === 1 && "sessionId" in value) {
    return { sessionId: readString(value.sessionId, "sessionId") };
  }
  if (isRecord(value) && "routeKey" in value && "outcome" in value) {
    return normalizeRouteDecision(value);
  }
  if (isRecord(value) && "selectedSessionId" in value && "sessionId" in value && "projectId" in value) {
    return {
      sessionId: readString(value.sessionId, "sessionId"),
      projectId: readString(value.projectId, "projectId"),
      selectedSessionId: readNullableString(value.selectedSessionId, "selectedSessionId"),
      archivedSessionIds: "archivedSessionIds" in value && Array.isArray(value.archivedSessionIds)
        ? value.archivedSessionIds.map((sessionId) => readString(sessionId, "archivedSessionIds"))
        : [readString(value.sessionId, "sessionId")],
    } satisfies LocalConsoleSessionArchiveResult;
  }
  if (!isRecord(value) || !("sessionId" in value)) {
    return value;
  }
  if ("speaker" in value) {
    return {
      id: readNumber(value.id, "id"),
      sessionId: readString(value.sessionId, "sessionId"),
      speaker: readSpeaker(value.speaker),
      role: readNullableString(value.role, "role"),
      body: readString(value.body, "body"),
      status: readStatus(value.status),
      runId: readNullableString(value.runId, "runId"),
      runDir: readNullableString(value.runDir, "runDir"),
      error: readNullableString(value.error, "error"),
      systemEventKind: readMessageSystemEventKind(value.systemEventKind, value.error),
      terminal: "terminal" in value ? normalizeTerminal(value.terminal) : null,
      processSteps: "processSteps" in value ? readProcessSteps(value.processSteps) : [],
      failureCount: "failureCount" in value ? readNumber(value.failureCount, "failureCount") : 0,
      lastFailureReason: "lastFailureReason" in value ? readNullableString(value.lastFailureReason, "lastFailureReason") : null,
      sourceKind: "sourceKind" in value ? readNullableString(value.sourceKind, "sourceKind") : null,
      sourceId: "sourceId" in value ? readNullableString(value.sourceId, "sourceId") : null,
      attachments: "attachments" in value && Array.isArray(value.attachments)
        ? value.attachments.map(normalizeAttachment)
        : [],
      textFragments: "textFragments" in value && Array.isArray(value.textFragments)
        ? value.textFragments.map(normalizeTextFragment)
        : [],
      activatedAt: "activatedAt" in value ? readNullableString(value.activatedAt, "activatedAt") : null,
      dispatchLane: "dispatchLane" in value
        ? readDispatchLane(value.dispatchLane)
        : value.speaker === "user" ? "primary" : null,
      dispatchRole: "dispatchRole" in value ? readNullableString(value.dispatchRole, "dispatchRole") : null,
      dispatchReason: "dispatchReason" in value
        ? readDispatchReason(value.dispatchReason)
        : value.speaker === "user" ? "no-valid-mention" : null,
      createdAt: readString(value.createdAt, "createdAt"),
      updatedAt: readString(value.updatedAt, "updatedAt"),
      ...("runTiming" in value ? { runTiming: normalizeRunTiming(value.runTiming) } : {}),
    } satisfies LocalConsoleMessage;
  }
  return {
    sessionId: readString(value.sessionId, "sessionId"),
    projectId: readString(value.projectId, "projectId"),
    parentSessionId: "parentSessionId" in value ? readNullableString(value.parentSessionId, "parentSessionId") : null,
    analysisParentSessionId: "analysisParentSessionId" in value
      ? readNullableString(value.analysisParentSessionId, "analysisParentSessionId")
      : null,
    originSessionId: "originSessionId" in value
      ? readNullableString(value.originSessionId, "originSessionId")
      : null,
    entryTemplate: "entryTemplate" in value ? readEntryTemplate(value.entryTemplate) : null,
    writePolicy: "writePolicy" in value ? readWritePolicy(value.writePolicy) : "normal",
    proposalVersion: "proposalVersion" in value
      ? readNullableString(value.proposalVersion, "proposalVersion")
      : null,
    writeLeaseVersion: "writeLeaseVersion" in value
      ? readNullableString(value.writeLeaseVersion, "writeLeaseVersion")
      : null,
    agentTeamOwnership: "agentTeamOwnership" in value
      ? readNullableAgentTeamOwnership(value.agentTeamOwnership)
      : null,
    agentTeamId: "agentTeamId" in value ? readNullableString(value.agentTeamId, "agentTeamId") : null,
    agentTeamPendingOwnership: "agentTeamPendingOwnership" in value
      ? readNullableAgentTeamOwnership(value.agentTeamPendingOwnership)
      : null,
    agentTeamPendingId: "agentTeamPendingId" in value
      ? readNullableString(value.agentTeamPendingId, "agentTeamPendingId")
      : null,
    workspaceMode: "workspaceMode" in value ? readWorkspaceMode(value.workspaceMode, "workspaceMode") : "direct",
    workspacePendingMode: "workspacePendingMode" in value
      ? readNullableWorkspaceMode(value.workspacePendingMode, "workspacePendingMode")
      : null,
    workspaceUnavailableReason: "workspaceUnavailableReason" in value
      ? readNullableString(value.workspaceUnavailableReason, "workspaceUnavailableReason")
      : null,
    branchName: "branchName" in value ? readNullableString(value.branchName, "branchName") : null,
    title: readString(value.title, "title"),
    titleRevision: "titleRevision" in value ? readNumber(value.titleRevision, "titleRevision") : 0,
    pinnedAt: "pinnedAt" in value ? readNullableString(value.pinnedAt, "pinnedAt") : null,
    status: readSessionStatus(value.status),
    awaitsHumanReason: readAwaitsHumanReason(value.awaitsHumanReason),
    unreadSince: readNullableString(value.unreadSince, "unreadSince"),
    manualUnreadAt: "manualUnreadAt" in value
      ? readNullableString(value.manualUnreadAt, "manualUnreadAt")
      : null,
    manualUnreadRequiresLeave: value.manualUnreadRequiresLeave === true,
    readStateRevision: "readStateRevision" in value
      ? readNumber(value.readStateRevision, "readStateRevision")
      : 0,
    attentionRevision: "attentionRevision" in value
      ? readNumber(value.attentionRevision, "attentionRevision")
      : 0,
    attentionAcknowledgedRevision: "attentionAcknowledgedRevision" in value
      ? readNumber(value.attentionAcknowledgedRevision, "attentionAcknowledgedRevision")
      : 0,
    attentionKind: "attentionKind" in value
      ? readAttentionKind(value.attentionKind)
      : null,
    hasUnacknowledgedAttention: value.hasUnacknowledgedAttention === true,
    unresolvedSystemEventKind: "unresolvedSystemEventKind" in value && value.unresolvedSystemEventKind !== null
      ? readSystemEventKind(value.unresolvedSystemEventKind)
      : null,
    lastMessageMentionsAgent: value.lastMessageMentionsAgent === true,
    hasPendingControlWork: value.hasPendingControlWork === true,
    runningCount: readNumber(value.runningCount, "runningCount"),
    waitingCount: readNumber(value.waitingCount, "waitingCount"),
    stuckCount: readNumber(value.stuckCount, "stuckCount"),
    errorCount: readNumber(value.errorCount, "errorCount"),
    interruptedCount: readNumber(value.interruptedCount, "interruptedCount"),
    childCount: "childCount" in value ? readNumber(value.childCount, "childCount") : 0,
    createdAt: readString(value.createdAt, "createdAt"),
    updatedAt: readString(value.updatedAt, "updatedAt"),
  } satisfies LocalConsoleSessionSummary;
}

function readDispatchLane(value: unknown): LocalConsoleMessage["dispatchLane"] {
  if (value === null || value === "primary" || value === "worker" || value === "awaiting-team") {
    return value;
  }
  throw new Error("Invalid local message dispatch lane");
}

function readDispatchReason(value: unknown): LocalConsoleMessage["dispatchReason"] {
  if (
    value === null
    || value === "single-valid-mention"
    || value === "no-valid-mention"
    || value === "multiple-valid-mentions"
  ) {
    return value;
  }
  throw new Error("Invalid local message dispatch reason");
}

function normalizeAttachment(value: unknown): LocalAttachment {
  if (!isRecord(value)) {
    throw new Error("Invalid local attachment");
  }
  const kind = value.kind;
  if (kind !== "image" && kind !== "file") {
    throw new Error(`Invalid local attachment kind: ${String(kind)}`);
  }
  return {
    attachmentId: readString(value.attachmentId, "attachmentId"),
    kind,
    displayName: readString(value.displayName, "displayName"),
    mediaType: readString(value.mediaType, "mediaType"),
    byteSize: readNumber(value.byteSize, "byteSize"),
  };
}

function normalizeTerminal(value: unknown): LocalConsoleTerminal | null {
  if (value === null || value === undefined) return null;
  if (!isRecord(value)) throw new Error("Invalid local terminal");
  const kind = readString(value.kind, "terminal.kind");
  if (
    kind !== "interrupted"
    && kind !== "timeout"
    && kind !== "quota-exhausted"
    && kind !== "rate-limited"
    && kind !== "auth"
    && kind !== "crashed"
  ) {
    throw new Error(`Invalid local terminal kind: ${kind}`);
  }
  if (value.contentIncomplete !== true) {
    throw new Error("Invalid local terminal completeness");
  }
  return {
    kind,
    subkind: readNullableString(value.subkind, "terminal.subkind"),
    safeCode: readNullableString(value.safeCode, "terminal.safeCode"),
    retryable: value.retryable === null
      ? null
      : typeof value.retryable === "boolean"
        ? value.retryable
        : (() => { throw new Error("Invalid terminal.retryable"); })(),
    partialMarkdown: readString(value.partialMarkdown, "terminal.partialMarkdown"),
    contentIncomplete: true,
    actualProfile: value.actualProfile === null || value.actualProfile === undefined
      ? null
      : normalizeExecutionProfile(value.actualProfile),
  };
}

function normalizeRunTiming(value: unknown): import("./types.js").LocalConsoleRunTiming {
  if (!isRecord(value)) {
    throw new Error("Invalid local run timing");
  }
  const engine = readString(value.engine, "runTiming.engine");
  if (engine !== "codex" && engine !== "claude" && engine !== "kimi" && engine !== "pi") {
    throw new Error(`Invalid local run timing engine: ${engine}`);
  }
  return {
    stepId: readString(value.stepId, "runTiming.stepId"),
    attempt: readNumber(value.attempt, "runTiming.attempt"),
    createdAt: readString(value.createdAt, "runTiming.createdAt"),
    startedAt: readNullableString(value.startedAt, "runTiming.startedAt"),
    elapsedMs: readNullableFiniteNumber(value.elapsedMs, "runTiming.elapsedMs"),
    completedAt: readNullableString(value.completedAt, "runTiming.completedAt"),
    status: readRunTimingStatus(value.status),
    engine,
    processOutputAvailable: typeof value.processOutputAvailable === "boolean"
      ? value.processOutputAvailable
      : (() => { throw new Error("Invalid runTiming.processOutputAvailable"); })(),
  };
}

function normalizeExecutionProfile(value: unknown): LocalConsoleTerminal["actualProfile"] {
  if (!isRecord(value)) throw new Error("Invalid terminal.actualProfile");
  const cli = readString(value.cli, "terminal.actualProfile.cli");
  if (cli !== "codex" && cli !== "claude" && cli !== "kimi" && cli !== "pi") {
    throw new Error(`Invalid terminal.actualProfile.cli: ${cli}`);
  }
  const model = readString(value.model, "terminal.actualProfile.model");
  const effort = readString(value.effort, "terminal.actualProfile.effort");
  if (cli === "pi") {
    if (value.providerId !== "deepseek") throw new Error("Invalid terminal.actualProfile.providerId");
    return {
      cli,
      providerId: "deepseek",
      providerProfileId: readString(value.providerProfileId, "terminal.actualProfile.providerProfileId"),
      model,
      effort,
    };
  }
  return { cli, model, effort };
}

function readProcessSteps(value: unknown): readonly import("./run-activity.js").LocalRunActivity[] {
  if (!Array.isArray(value)) {
    throw new Error("Invalid local process steps");
  }
  const seen = new Set<number>();
  return value.map((step) => {
    if (!isRecord(step)) {
      throw new Error("Invalid local process step");
    }
    const cursor = readNumber(step.cursor, "process step cursor");
    if (seen.has(cursor)) {
      throw new Error("Local process step cursors must be unique");
    }
    seen.add(cursor);
    const kind = readString(step.kind, "process step kind");
    if (
      kind !== "command"
      && kind !== "tool"
      && kind !== "search"
      && kind !== "read"
      && kind !== "edit"
      && kind !== "thinking"
      && kind !== "progress"
    ) {
      throw new Error(`Invalid local process step kind: ${String(kind)}`);
    }
    const phase = readString(step.phase, "process step phase");
    if (phase !== "running" && phase !== "completed") {
      throw new Error(`Invalid local process step phase: ${String(phase)}`);
    }
    return {
      cursor,
      kind,
      phase,
      action: readString(step.action, "process step action"),
      object: readNullableString(step.object, "process step object"),
      occurredAt: readString(step.occurredAt, "process step occurredAt"),
      ...(step.lineObject === undefined ? {} : { lineObject: readNullableString(step.lineObject, "process step lineObject") }),
      ...(step.callId === undefined ? {} : { callId: readNullableString(step.callId, "process step callId") }),
      ...(step.input === undefined ? {} : { input: readNullableString(step.input, "process step input") }),
      ...(step.output === undefined ? {} : { output: readNullableString(step.output, "process step output") }),
      ...(step.outputRemainingLines === undefined
        ? {}
        : { outputRemainingLines: readNumber(step.outputRemainingLines, "process step outputRemainingLines") }),
      ...(step.error === undefined ? {} : { error: readNullableString(step.error, "process step error") }),
    };
  });
}

function normalizeTextFragment(value: unknown): LocalConsoleTextFragment {
  if (!isRecord(value)) {
    throw new Error("Invalid local text fragment");
  }
  return {
    id: readString(value.id, "id"),
    label: readString(value.label, "label"),
    text: readString(value.text, "text"),
  };
}

function readEntryTemplate(value: unknown): LocalConsoleEntryTemplate | null {
  if (value === null || value === "session-analysis") return value;
  throw new Error(`Invalid local console entry template: ${String(value)}`);
}

function readWritePolicy(value: unknown): LocalConsoleWritePolicy {
  if (value === "normal" || value === "confirm-current-plan-before-write") return value;
  throw new Error(`Invalid local console write policy: ${String(value)}`);
}

function readNullableAgentTeamOwnership(value: unknown): "system" | "user" | null {
  if (value === null || value === "system" || value === "user") {
    return value;
  }
  throw new Error(`Invalid local console agent team ownership: ${String(value)}`);
}

function readSystemEventKind(value: unknown): LocalConsoleSystemEventKind {
  if (
    value === "run-not-started" ||
    value === "run-stuck" ||
    value === "user-stopped" ||
    value === "resume-unavailable" ||
    value === "retry-exhausted" ||
    value === "other"
  ) {
    return value;
  }
  throw new Error(`Invalid local console system event kind: ${String(value)}`);
}

function readAttentionKind(
  value: unknown,
): "project-unavailable" | "team-deleted" | "team-needs-repair" | null {
  if (
    value === null
    || value === "project-unavailable"
    || value === "team-deleted"
    || value === "team-needs-repair"
  ) {
    return value;
  }
  throw new Error(`Invalid local console attention kind: ${String(value)}`);
}

function readMessageSystemEventKind(kind: unknown, error: unknown): LocalConsoleSystemEventKind {
  const persisted = readSystemEventKind(kind);
  return persisted === "other"
    && typeof error === "string"
    && error.startsWith("resume-unavailable:")
    ? "resume-unavailable"
    : persisted;
}

function readWorkspaceMode(value: unknown, field: string): "direct" | "worktree" {
  const mode = readString(value, field);
  if (mode === "direct" || mode === "worktree") {
    return mode;
  }
  throw new Error(`Invalid local console ${field}: ${String(value)}`);
}

function readNullableWorkspaceMode(value: unknown, field: string): "direct" | "worktree" | null {
  if (value === null) {
    return null;
  }
  return readWorkspaceMode(value, field);
}

function readAwaitsHumanReason(value: unknown): LocalConsoleAwaitsHumanReason | null {
  if (value === null) {
    return null;
  }
  if (value === "answer" || value === "confirmation" || value === "acceptance" || value === "exception") {
    return value;
  }
  throw new Error(`Invalid local console awaits human reason: ${String(value)}`);
}
