import fs from "node:fs/promises";
import crypto from "node:crypto";
import path from "node:path";
import { loadCeoScripts } from "../ceo-scripts.js";
import {
  parseCeoOrchestrationOutput,
} from "../ceo-orchestration.js";
import {
  type CodexRunOptions,
  type CodexRunResult,
  executionInterruptionCauseForResult,
  executionTimeoutKind,
  isInterruptedCodexRunResult,
} from "../codex.js";
import { log } from "../log.js";
import { parseTrailingStageMarker } from "../stages.js";
import type { ExecutionProgressEvent } from "../execution-contract.js";
import { resolveTrigger } from "../triggers/index.js";
import { listLocalChildSessionSummaries } from "./child-session-summary-reader.js";
import { maybeRouteLocalNoMentionMessage, type LocalRouteJudgment } from "./route-bus.js";
import type { LocalAttachmentManager } from "./attachments.js";
import {
  buildLocalConsoleRoutingTimeline,
  buildLocalConsoleTimeline,
} from "./timeline.js";
import { deriveSessionTitle } from "./title.js";
import {
  LOCAL_CONSOLE_DEFAULT_SESSION_ID,
  LOCAL_CONSOLE_PROJECT_ID,
  LocalConsoleProjectFolderError,
  type LocalConsoleFileContent,
  type LocalConsoleMessage,
  type LocalConsoleProjectFiles,
  type LocalConsoleSystemEventKind,
  type LocalConsoleProjectSummary,
  type LocalConsoleProjectRemovalResult,
  LocalConsoleProjectRunningError,
  type LocalConsoleSessionArchiveResult,
  LocalConsoleSessionRunningError,
  LocalConsoleSessionWorkspaceLockedError,
  type LocalConsoleRunSnapshot,
  type LocalConsoleRunOutput,
  type LocalConsoleSessionSummary,
  type LocalConsoleSessionSearchResult,
  type LocalConsoleSessionReferenceText,
  type LocalConsoleSessionReferenceScope,
  type LocalConsoleSessionWorkspaceSource,
  type LocalConsoleWorkspaceMode,
  type LocalConsoleAgentTeamOwnership,
  type LocalConsoleAgentTeamSnapshot,
  type LocalConsoleExecutionProfile,
  type LocalConsoleSnapshot,
  type LocalConsoleStateSnapshot,
  type LocalConsoleSessionView,
  type LocalConsoleWorkspaceDiffDetail,
  type LocalConsoleWorkspaceDiffSummary,
  type LocalConsoleStore,
  type LocalConsoleEntryTemplate,
  type LocalConsoleWritePolicy,
  type LocalConsoleTextFragment,
  type LocalConsoleTerminal,
} from "./types.js";
import {
  buildMoebiusReferenceText,
  plainTextExcerpt,
  serializeTextFragmentReferences,
} from "./session-reference-text.js";
import {
  createLocalExecutionRunner,
  type LocalExecutionRunner,
} from "./execution-driver.js";
import {
  legacyCodexContextFingerprint,
  type LocalAgentSessionLinkFact,
  type LocalAgentTimelineCursorFact,
  type LocalExecutionSessionLinkFact,
  type LocalProviderInvocationFact,
  type LocalProviderSessionObservedFact,
  type LocalRunExecutionContextFact,
} from "./execution-context.js";
import {
  readExecutionSessionLinks,
  readRunExecutionContexts,
} from "./execution-context-reader.js";
import { projectLocalConsoleMemberIdentities } from "./member-identity.js";
import {
  resolveClaimedControlAction,
  selectSourceRetryIntent,
} from "./control-dispatch.js";
import { resolveLocalUserMessageDispatch } from "./user-message-routing.js";
import { readLocalRunRecoverySnapshot } from "./run-recovery-reader.js";
import { LocalConversationWorkspaceRuntime } from "./conversation-workspace-runtime.js";
import { LocalSessionContinuationRuntime } from "./session-continuation-runtime.js";
import { LocalSessionPresentationRuntime } from "./session-presentation-runtime.js";
import { LocalRunFailureRuntime } from "./run-failure-runtime.js";
import {
  LocalRunLifecycleRuntime,
  type LocalRunLifecycleFactStore,
} from "./run-lifecycle-runtime.js";
import { LocalPendingSessionContextRuntime } from "./pending-session-context-runtime.js";
import { LocalRunRecoveryRuntime } from "./run-recovery-runtime.js";
import { LocalLegacyHandoffRecoveryRuntime } from "./legacy-handoff-recovery-runtime.js";
import { LocalStartupRecoveryRuntime } from "./startup-recovery-runtime.js";
import { LocalProjectCommandRuntime } from "./project-command-runtime.js";
import { LocalSessionCreationRuntime } from "./session-creation-runtime.js";
import { LocalSessionSettingsRuntime } from "./session-settings-runtime.js";
import { LocalSessionReferenceRuntime } from "./session-reference-runtime.js";
import { LocalConsoleStateQueryRuntime } from "./state-query-runtime.js";
import { LocalConsoleRunOutputRuntime } from "./run-output-runtime.js";
import { LocalConsoleWorkspaceQueryRuntime } from "./workspace-query-runtime.js";
import { LocalConsoleSessionMetadataRuntime } from "./session-metadata-runtime.js";
import { LocalConsoleMessageCommandRuntime } from "./message-command-runtime.js";
import { LocalConsoleRunRetryRuntime } from "./run-retry-runtime.js";
import { emptyRetryRecoveryBundle } from "./run-retry-plan.js";
import {
  LocalWorkerDispatchRuntime,
} from "./worker-dispatch-runtime.js";
import type { LocalConsoleAgentFile } from "./agent-file.js";
export type { LocalConsoleAgentFile } from "./agent-file.js";
import type { ActiveLocalRun } from "./active-run.js";
import { LocalWorkerPreparationRuntime } from "./worker-preparation-runtime.js";
import { LocalWorkerProviderRuntime } from "./worker-provider-runtime.js";
import { LocalWorkerTerminalRuntime } from "./worker-terminal-runtime.js";
import { LocalWorkerExecutionRuntime } from "./worker-execution-runtime.js";
import {
  LocalPrimaryPreparationRuntime,
  type LocalPrimaryRunInput,
} from "./primary-preparation-runtime.js";
import { LocalPrimaryProviderRuntime } from "./primary-provider-runtime.js";
import { LocalPrimaryAnalysisRuntime } from "./primary-analysis-runtime.js";
import { LocalPrimaryTerminalRuntime } from "./primary-terminal-runtime.js";
import {
  assertTextFragments,
  buildFallbackProjectSummary,
  formatLocalError,
  hasPendingStartupControlWork,
  isPendingDispatchMessage,
  isPendingPrimaryMessage,
  isVisibleTimelineMessage,
  isWorkerRunPlaceholder,
  noSessionWorkspaceDiff,
  normalizeTitle,
  projectPendingDispatch,
  requireAgentFilePath,
} from "./runtime-domain.js";
import {
  collectLocalCeoLedgerTaskIds,
  localChildSessionId,
  localOrchestrationKey,
  renderLocalChildSessionInitialBody,
} from "./local-child-session-plan.js";
import {
  directoryAvailable,
  fileAvailable,
  readOptionalTextFile,
} from "./runtime-file-support.js";
import { withLocalConsoleTimeout } from "./store-timeout.js";
import {
  generateLocalWorkspaceDiff,
  invalidateLocalWorkspaceFacts,
  localSessionWorktreePath,
  readCachedLocalWorkspaceFacts,
  readLocalGitStatus,
  resolveLocalWorkspaceSource,
  type ResolvedLocalWorkspace,
} from "./workspace-source.js";
import {
  readLocalConversationBaselineCommit,
  readLocalConversationDiffFile,
  readLocalConversationWorkspaceDiff,
  readLocalConversationWorkspaceDiffDetail,
} from "./workspace-diff.js";
import {
  listLocalWorkspaceFiles,
  readLocalFileReferenceWindow,
  readLocalWorkspaceTextFile,
} from "./file-read.js";
import { resolveSessionWorkspaceContext } from "./workspace-resolution.js";
import { nonContinuableSystemMessage, resolveLocalSessionContinuation } from "./session-status.js";
import { decideSessionWorkspaceSwitch } from "./session-workspace-policy.js";
import { readCodexThreadLinks } from "./codex-thread-link-reader.js";
import {
  readLocalCodexRecoveryFacts,
  type LocalCodexResumeConsumedFact,
  type LocalCodexResumeIntentFact,
  type LocalCodexRunUsageFact,
} from "./codex-resume.js";
import {
  loadLocalProcessAppendPage,
  loadLocalProcessDebugInvocation,
  loadLocalProcessHistoryPage,
  type LocalConsoleProcessDebugInvocation,
  type LocalConsoleProcessAppendPage,
  type LocalConsoleProcessHistoryPage,
} from "./process-history.js";
import { localProcessFactReader } from "./process-fact-reader.js";
import { resolveCodexRollout } from "./codex-rollout.js";
import {
  buildConfirmedPlanExecutionPrompt,
  buildSessionAnalysisReadOnlyContract,
} from "./session-analysis-gate.js";

export interface LocalConsoleRuntimeOptions {
  store: LocalConsoleStore;
  listAgentFiles: (sessionId: string) => Promise<LocalConsoleAgentFile[]>;
  loadAgentTeamSnapshot?: (
    binding: { ownership: LocalConsoleAgentTeamOwnership; id: string },
  ) => Promise<LocalConsoleAgentTeamSnapshot>;
  resolveAgentTeamHealth?: (
    session: LocalConsoleSessionSummary,
  ) => Promise<{ health: "usable" | "deleted" | "needs-repair"; reason: string | null }>;
  runCodex: (options: CodexRunOptions) => Promise<CodexRunResult>;
  runExecution?: LocalExecutionRunner;
  makeRunDir: (count: number, now?: Date) => string;
  dataRoot?: string;
  projectRoot: string;
  workdirRoot: string;
  sessionId?: string;
  storeTimeoutMs?: number;
  codexIdleTimeoutMs?: number;
  toolInFlightTimeoutMs?: number;
  codexMaxDurationMs?: number;
  workspaceGitTimeoutMs?: number;
  staleRunningGraceMs?: number;
  routeJudgment?: LocalRouteJudgment;
  routeTimeoutMs?: number;
  failureRetryLimit?: number;
  attachmentManager?: LocalAttachmentManager;
  isCodexThreadAvailable?: (threadId: string) => Promise<boolean>;
  now?: () => Date;
}

interface SessionFactWritingStore extends LocalConsoleStore {
  getSessionFactLogPath(sessionId: string): string;
  recordProgressEvent(input: {
    sessionId: string;
    runId: string;
    role: string;
    body: string;
    now: string;
  }): Promise<void>;
  createChildSession(input: {
    parentSessionId: string;
    childSessionId: string;
    projectId: string;
    title: string;
    relation: string;
    hiddenKey: string;
    initialBody: string;
    initialRole: string | null;
    now: string;
  }): Promise<LocalConsoleSessionSummary>;
  recordChildSessionCard(input: {
    parentSessionId: string;
    sourceId: string;
    childSessionIds: string[];
    runId: string;
    runDir: string;
    now: string;
  }): Promise<void>;
  recordWorkspaceDiff(input: {
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
  }): Promise<void>;
}

interface CodexRecoveryFactStore extends LocalConsoleStore {
  getSessionFactLogPath(sessionId: string): string;
  recordCodexResumeIntent(input: LocalCodexResumeIntentFact): Promise<void>;
  recordCodexResumeConsumed(input: LocalCodexResumeConsumedFact): Promise<void>;
  recordCodexRunUsage(input: LocalCodexRunUsageFact): Promise<void>;
  recordAgentSessionLink(input: LocalAgentSessionLinkFact): Promise<void>;
  recordProviderSessionObserved(input: LocalProviderSessionObservedFact): Promise<void>;
  recordAgentTimelineCursor(input: LocalAgentTimelineCursorFact): Promise<void>;
  recordProviderInvocation(input: LocalProviderInvocationFact): Promise<void>;
}

export class LocalConsoleRuntime {
  private readonly sessionId: string;
  private readonly storeTimeoutMs: number;
  private readonly codexIdleTimeoutMs?: number;
  private readonly toolInFlightTimeoutMs?: number;
  private readonly codexMaxDurationMs?: number;
  private readonly routeTimeoutMs?: number;
  private readonly staleRunningGraceMs: number;
  private readonly now: () => Date;
  private readonly executionRunner: LocalExecutionRunner;
  private readonly processingSessions = new Set<string>();
  private readonly pendingProcessSessions = new Set<string>();
  private readonly activeRuns = new Map<string, ActiveLocalRun>();
  private readonly inactiveSessions = new Set<string>();
  private readonly conversationBaselineCommits = new Map<string, string | null>();
  private readonly conversationWorkspaceRuntime: LocalConversationWorkspaceRuntime;
  private readonly sessionContinuationRuntime: LocalSessionContinuationRuntime;
  private readonly sessionPresentationRuntime: LocalSessionPresentationRuntime;
  private readonly runFailureRuntime: LocalRunFailureRuntime;
  private readonly runLifecycleRuntime: LocalRunLifecycleRuntime;
  private readonly pendingSessionContextRuntime: LocalPendingSessionContextRuntime;
  private readonly runRecoveryRuntime: LocalRunRecoveryRuntime;
  private readonly startupRecoveryRuntime: LocalStartupRecoveryRuntime;
  private readonly projectCommandRuntime: LocalProjectCommandRuntime;
  private readonly sessionCreationRuntime: LocalSessionCreationRuntime;
  private readonly sessionSettingsRuntime: LocalSessionSettingsRuntime;
  private readonly sessionReferenceRuntime: LocalSessionReferenceRuntime;
  private readonly stateQueryRuntime: LocalConsoleStateQueryRuntime;
  private readonly runOutputRuntime: LocalConsoleRunOutputRuntime;
  private readonly workspaceQueryRuntime: LocalConsoleWorkspaceQueryRuntime;
  private readonly sessionMetadataRuntime: LocalConsoleSessionMetadataRuntime;
  private readonly messageCommandRuntime: LocalConsoleMessageCommandRuntime;
  private readonly runRetryRuntime: LocalConsoleRunRetryRuntime;
  private readonly workerDispatchRuntime: LocalWorkerDispatchRuntime;
  private readonly workerPreparationRuntime: LocalWorkerPreparationRuntime;
  private readonly workerProviderRuntime: LocalWorkerProviderRuntime;
  private readonly workerTerminalRuntime: LocalWorkerTerminalRuntime;
  private readonly workerExecutionRuntime: LocalWorkerExecutionRuntime;
  private readonly primaryPreparationRuntime: LocalPrimaryPreparationRuntime;
  private readonly primaryProviderRuntime: LocalPrimaryProviderRuntime;
  private readonly primaryAnalysisRuntime: LocalPrimaryAnalysisRuntime;
  private readonly primaryTerminalRuntime: LocalPrimaryTerminalRuntime;
  private closing = false;
  private lastError: string | null = null;

  constructor(private readonly options: LocalConsoleRuntimeOptions) {
    this.sessionId = options.sessionId ?? LOCAL_CONSOLE_DEFAULT_SESSION_ID;
    this.storeTimeoutMs = options.storeTimeoutMs ?? 2_000;
    this.codexIdleTimeoutMs = options.codexIdleTimeoutMs;
    this.toolInFlightTimeoutMs = options.toolInFlightTimeoutMs;
    this.codexMaxDurationMs = options.codexMaxDurationMs;
    this.routeTimeoutMs = options.routeTimeoutMs;
    this.staleRunningGraceMs = options.staleRunningGraceMs ?? 5_000;
    this.now = options.now ?? (() => new Date());
    this.executionRunner = options.runExecution ?? createLocalExecutionRunner({
      dataRoot: options.dataRoot ?? options.projectRoot,
      runCodex: options.runCodex,
    });
    this.conversationWorkspaceRuntime = new LocalConversationWorkspaceRuntime({
      store: options.store,
      storeCall: (label, operation) => this.storeCall(label, operation),
      baselineCommits: this.conversationBaselineCommits,
      workdirRoot: options.workdirRoot,
      ...(options.workspaceGitTimeoutMs === undefined ? {} : { gitTimeoutMs: options.workspaceGitTimeoutMs }),
      worktreePath: localSessionWorktreePath,
      readWorkspaceDiff: readLocalConversationWorkspaceDiff,
    });
    this.sessionContinuationRuntime = new LocalSessionContinuationRuntime({
      store: options.store,
      storeCall: (label, operation) => this.storeCall(label, operation),
      directoryAvailable,
      ...(options.resolveAgentTeamHealth === undefined
        ? {}
        : { resolveAgentTeamHealth: options.resolveAgentTeamHealth }),
    });
    this.sessionPresentationRuntime = new LocalSessionPresentationRuntime({
      store: options.store,
      storeCall: (label, operation) => this.storeCall(label, operation),
      nowIso: () => this.nowIso(),
      withAgentTeamHealth: (session) => this.sessionContinuationRuntime.withAgentTeamHealth(session),
      activeRuns: () => this.activeRuns.values(),
      activeRunCount: (sessionId) => this.activeRunsForSession(sessionId).length,
      getSessionFactLogPath: (sessionId) => this.getSessionFactLogPath(sessionId),
      workdirRoot: options.workdirRoot,
      ...(options.workspaceGitTimeoutMs === undefined ? {} : { gitTimeoutMs: options.workspaceGitTimeoutMs }),
      readWorkspaceFacts: async (folderPath) => await readCachedLocalWorkspaceFacts({
        folderPath,
        gitTimeoutMs: options.workspaceGitTimeoutMs,
      }),
      worktreePath: localSessionWorktreePath,
      directoryAvailable,
      fileAvailable,
    });
    this.runFailureRuntime = new LocalRunFailureRuntime({
      store: options.store,
      storeCall: (label, operation) => this.storeCall(label, operation),
      nowIso: () => this.nowIso(),
      timeoutKind: executionTimeoutKind,
      interrupted: isInterruptedCodexRunResult,
      interruptionCause: executionInterruptionCauseForResult,
      logTimeout: (input) => log(input),
      activeRun: (runId) => this.activeRuns.get(runId),
      recordStuck: (message, sessionId, runId, runDir, reason, terminal) =>
        this.recordStuckBestEffort(message, sessionId, runId, runDir, reason, terminal),
      recordInterrupted: (message, sessionId, runId, runDir, reason, cause, terminal) =>
        this.recordInterruptedBestEffort(message, sessionId, runId, runDir, reason, cause, terminal),
      recordFailure: (message, sessionId, runId, runDir, reason, body, terminal) =>
        this.recordTerminalFailureBestEffort(message, sessionId, runId, runDir, reason, body, terminal),
      recordDetached: (input) => this.recordDetachedRunTerminal(input),
    });
    this.runLifecycleRuntime = new LocalRunLifecycleRuntime({
      activeRun: (runId) => this.activeRuns.get(runId),
      activeRuns: () => this.activeRuns.values(),
      lifecycleStore: () => this.runLifecycleFactStore(),
      storeCall: (label, operation) => this.storeCall(label, operation),
      now: () => this.now(),
      nowIso: () => this.nowIso(),
      recordError: (error) => {
        this.lastError = formatLocalError(error);
      },
    });
    this.workerDispatchRuntime = new LocalWorkerDispatchRuntime({
      hasClaimCapability: () => options.store.claimNextPendingWorkerMessage !== undefined,
      listMessages: (sessionId, label) => this.storeCall(label, () => options.store.listMessages(sessionId)),
      activeRunForRole: (sessionId, role) => this.activeRunForRole(sessionId, role),
      listAgentFiles: async (sessionId) => {
        const persisted = await options.store.listSessionAgentTeamSnapshot?.(sessionId) ?? null;
        return persisted === null
          ? await options.listAgentFiles(sessionId)
          : persisted.members.map((member) => ({
              name: member.name,
              agentMarkdown: member.agentMarkdown,
              executionProfile: member.executionProfile ?? null,
            }));
      },
      stopping: (sessionId) => this.closing || this.inactiveSessions.has(sessionId),
      nextRunId: (sessionId, messageId) => this.gracefulResumeTargetForMessage(sessionId, messageId),
      claim: (sessionId, role, runId) => this.storeCall("local-console-store-claim-worker", () =>
        options.store.claimNextPendingWorkerMessage!.call(options.store, {
          sessionId,
          role,
          runId,
          now: this.nowIso(),
        })),
      release: (message, sessionId) => this.storeCall("local-console-store-release-stopped-worker-claim", () =>
        options.store.releaseMessageForRetry({ userMessageId: message.id, sessionId, now: this.nowIso() })),
      recordMissingAgent: (message, sessionId, runId, role) =>
        this.recordTerminalFailureBestEffort(message, sessionId, runId, null, `Agent not found: ${role}`),
      prepareTimeline: (messages, agents) => {
        const timelineMessages = messages.filter(
          (message) => message.status !== "pending" && !isWorkerRunPlaceholder(message),
        );
        return {
          timelineMessages,
          timeline: buildLocalConsoleTimeline(timelineMessages, agents.map((agent) => agent.name)),
        };
      },
      nowRunId: () => `local-${this.now().toISOString()}-${Math.random().toString(36).slice(2, 10)}`,
      scheduleRun: (input) => this.workerExecutionRuntime.run(input),
      continuableWorkspace: (sessionId) => this.continuableSessionWorkspace(sessionId),
      applyPendingContext: (sessionId) => this.applyPendingSessionContextWhenIdle(sessionId),
      processPending: (sessionId) => { void this.processPending(sessionId); },
      setError: (error) => {
        this.lastError = formatLocalError(error);
        return this.lastError;
      },
      log: (event, sessionId, role, error) => log({ event, sessionId, ...(role === null ? {} : { role }), error }),
    });
    this.workerPreparationRuntime = new LocalWorkerPreparationRuntime({
      nowIso: () => this.nowIso(),
      stopping: (sessionId) => this.closing || this.inactiveSessions.has(sessionId),
      releaseClaim: (message, sessionId) => this.releaseClaimedUserDirectMessageWhenStopping(message, sessionId).then(() => undefined),
      sessionSummary: (sessionId) => this.sessionSummary(sessionId),
      makeRunDir: (messageCount) => path.resolve(options.makeRunDir(messageCount, this.now())),
      setSourceRunDir: (message, sessionId, runDir) =>
        this.storeCall("local-console-store-set-worker-source-rundir", () => options.store.setRunDir({
          id: message.id,
          sessionId,
          runDir,
          now: this.nowIso(),
        })),
      resolveWorkspace: (sessionId, source, signal) => this.resolveWorkspace(sessionId, source, signal),
      loadSelectedAgentMarkdown: (selectedAgent) => selectedAgent.agentMarkdown === undefined
        ? fs.readFile(requireAgentFilePath(selectedAgent), "utf8")
        : Promise.resolve(selectedAgent.agentMarkdown),
      loadAgentContents: async (agentFiles, selectedAgent, selectedMarkdown) => {
        return await Promise.all(agentFiles.map(async (agent) => ({
          name: agent.name,
          agentMarkdown: agent.name === selectedAgent.name
            ? selectedMarkdown
            : agent.agentMarkdown ?? await fs.readFile(requireAgentFilePath(agent), "utf8"),
          executionProfile: agent.executionProfile ?? null,
        })));
      },
      loadRecoverySnapshot: (sessionId) => readLocalRunRecoverySnapshot({
        factLogPath: this.codexRecoveryFactStore()?.getSessionFactLogPath(sessionId) ?? null,
        sessionId,
      }),
      isCodexThreadAvailable: options.isCodexThreadAvailable ?? defaultCodexThreadAvailability,
      settleUnavailable: ({ sessionId, runId, sourceMessage, role, runDir, unavailable }) =>
        this.settleUnavailableResume({
          sessionId,
          runId,
          sourceMessage,
          intent: unavailable.intent,
          role,
          engine: unavailable.context.engine,
          reason: unavailable.reason,
          runDir,
        }),
      recordRunExecutionContext: (context) => this.recordRunExecutionContext(context),
      recordAgentSessionLink: (link) => this.recordAgentSessionLink(link),
      prepareAttachments: ({ messages, runDir }) => options.attachmentManager?.prepareRunAttachments({ messages, runDir })
        ?? Promise.resolve({ promptSuffix: "", imagePaths: [] }),
      consumeRecoveryIntent: ({ sessionId, runId, intentId, mode, reason }) =>
        this.storeCall("local-console-store-consume-worker-resume", () =>
          this.requireCodexRecoveryFactStore().recordCodexResumeConsumed({
            sessionId,
            intentId,
            resumedByRunId: runId,
            mode,
            reason,
            consumedAt: this.nowIso(),
          })),
      recordDetachedStarted: (input, runDir) => {
        const record = options.store.recordDetachedRunStarted;
        if (record === undefined) throw new Error("local console detached run persistence capability unavailable");
        return this.storeCall("local-console-store-record-worker-started", () => record.call(options.store, {
          sessionId: input.sessionId,
          role: input.role,
          runId: input.runId,
          runDir,
          now: this.nowIso(),
        }));
      },
      prepareLifecycle: (input) => this.runLifecycleRuntime.prepare(input),
      setActiveRun: (runId, active) => { this.activeRuns.set(runId, active); },
      recordLifecycle: (active) => this.runLifecycleRuntime.record(active, "created", "created"),
    });
    this.workerProviderRuntime = new LocalWorkerProviderRuntime({
      nowIso: () => this.nowIso(),
      releaseIfStopping: async (input) => {
        if (input.origin !== "user-direct" || (!this.closing && !this.inactiveSessions.has(input.sessionId))) return false;
        await this.releaseClaimedUserDirectMessageWhenStopping(input.sourceMessage, input.sessionId);
        await this.finishRunLifecycle(input.runId, "interrupted");
        return true;
      },
      recordProviderInvocation: (fact) => this.recordProviderInvocation(fact),
      runProvider: (preparation, callbacks) => this.executionRunner({
        prompt: preparation.prompt,
        runDir: preparation.runDir,
        cwd: preparation.workspace.cwd,
        profile: preparation.executionContext.profile,
        mode: preparation.invocationPlan.providerMode,
        signal: preparation.controller.signal,
        ...(this.codexIdleTimeoutMs === undefined ? {} : { idleTimeoutMs: this.codexIdleTimeoutMs }),
        ...(this.toolInFlightTimeoutMs === undefined ? {} : { toolTimeoutMs: this.toolInFlightTimeoutMs }),
        ...(preparation.preparedAttachments.imagePaths.length === 0
          ? {}
          : { imagePaths: preparation.preparedAttachments.imagePaths }),
        workspaceAccess: preparation.invocationPlan.workspaceAccess,
        ...callbacks,
      }),
      onVisibleAgentMarkdown: (input, text) => {
        const active = this.activeRuns.get(input.runId);
        if (active?.sessionId !== input.sessionId) return async () => undefined;
        active.liveMarkdown = text;
        this.updateAgentProgressActivity(input.runId, text);
        const recordedAt = this.nowIso();
        return () => this.storeCall("local-console-store-record-worker-progress", () =>
          this.sessionFactStore().recordProgressEvent({
            sessionId: input.sessionId,
            runId: input.runId,
            role: input.role,
            body: text,
            now: recordedAt,
          }));
      },
      onProcessStarted: (runId) => this.markRunStarted(runId),
      onStructuredActivity: (runId, event) => this.updateStructuredRunActivity(runId, event),
      onExecutionProgress: (runId, event) => this.updateExecutionProgressActivity(runId, event),
      setActiveExternalSessionId: (sessionId, runId, externalSessionId) => {
        const active = this.activeRuns.get(runId);
        if (active?.sessionId === sessionId) active.threadId = externalSessionId;
      },
      recordProviderSessionObserved: (fact) => this.recordProviderSessionObserved(fact),
      recordAgentSessionLink: (fact) => this.recordAgentSessionLink(fact),
      recordExecutionSessionLink: (fact) => this.recordExecutionSessionLink(fact),
      recordCodexThreadLink: (fact) => this.recordCodexThreadLink(fact),
    });
    this.workerTerminalRuntime = new LocalWorkerTerminalRuntime({
      store: options.store,
      storeCall: (label, operation) => this.storeCall(label, operation),
      nowIso: () => this.nowIso(),
      activeRun: (runId) => this.activeRuns.get(runId),
      recoveryStore: () => this.codexRecoveryFactStore(),
      recordProviderInvocation: (fact) => this.recordProviderInvocation(fact),
      classifyFailure: (result) => ({
        runtimeClosing: executionInterruptionCauseForResult(result) === "runtime-closing",
        failureStatus: runTimingStatusForFailedResult(result),
      }),
      pauseLifecycle: (runId) => this.pauseRunLifecycle(runId),
      finishLifecycle: (runId, status) => this.finishRunLifecycle(runId, status),
      recordDirectFailure: (input, result) =>
        this.recordFailedCodexResult(input.sourceMessage, input.sessionId, input.runId, result),
      recordDetachedFailure: (input, result) => this.recordDetachedWorkerResult(input.sessionId, input.runId, result),
      sourceDirectoryAvailable: (sessionId) => this.sessionProjectDirectoryAvailable(sessionId),
      executeChildSession: (input, runDir, result) => this.executeLocalCeoChildSessionOrchestrationIfNeeded({
        sessionId: input.sessionId,
        runId: input.runId,
        runDir: result.runDir,
        finalText: result.finalText,
        availableAgentNames: input.agentFiles.map((agent) => agent.name),
      }),
      recordWorkspaceDiff: (input, preparation, result) => this.recordWorkspaceDiffIfNeeded(
        input.sessionId,
        input.runId,
        preparation.runDir,
        preparation.workspace,
        result.finalText,
        preparation.controller.signal,
      ),
      recordTimelineCursor: (input, agentIdentityFingerprint, lastSeenIndex) =>
        this.recordAgentTimelineCursor({
          sessionId: input.sessionId,
          runId: input.runId,
          role: input.role,
          agentIdentityFingerprint,
          lastSeenIndex,
          recordedAt: this.nowIso(),
        }),
      recordChildSessionCard: (input, card, result) =>
        this.storeCall("local-console-store-worker-child-session-card", () =>
          this.sessionFactStore().recordChildSessionCard({
            parentSessionId: input.sessionId,
            sourceId: card.sourceId,
            childSessionIds: card.childSessionIds,
            runId: input.runId,
            runDir: result.runDir,
            now: this.nowIso(),
          })),
    });
    this.workerExecutionRuntime = new LocalWorkerExecutionRuntime({
      preparation: this.workerPreparationRuntime,
      provider: this.workerProviderRuntime,
      terminal: this.workerTerminalRuntime,
      stopping: (sessionId) => this.closing || this.inactiveSessions.has(sessionId),
      releaseClaim: (input) => this.releaseClaimedUserDirectMessageWhenStopping(input.sourceMessage, input.sessionId).then(() => undefined),
      formatError: (error) => formatLocalError(error),
      setError: (error) => { this.lastError = error; },
      recordDirectFailure: (input, runDir, error) =>
        this.recordTerminalFailureBestEffort(input.sourceMessage, input.sessionId, input.runId, runDir, error),
      recordDetachedFailure: (input, runDir, error) => this.recordDetachedRunTerminal({
        sessionId: input.sessionId,
        body: "这一步没跑起来。你可以直接告诉主理人下一步怎么处理。",
        systemEventKind: "run-not-started",
        runId: input.runId,
        runDir,
        error,
        status: "failed",
      }),
      activeRun: (runId) => this.activeRuns.get(runId),
      pauseLifecycle: (runId) => this.pauseRunLifecycle(runId),
      failLifecycle: (runId) => this.finishRunLifecycle(runId, "failed"),
      deleteActiveRun: (runId) => { this.activeRuns.delete(runId); },
      invalidateWorkspace: (cwd) => invalidateLocalWorkspaceFacts(cwd),
    });
    this.primaryPreparationRuntime = new LocalPrimaryPreparationRuntime({
      nowIso: () => this.nowIso(),
      inactive: (sessionId) => this.inactiveSessions.has(sessionId),
      loadSelectedAgentMarkdown: (agent) => agent.agentMarkdown === undefined
        ? fs.readFile(requireAgentFilePath(agent), "utf8")
        : Promise.resolve(agent.agentMarkdown),
      makeRunDir: (messageCount) => {
        const providerRunDir = options.makeRunDir(messageCount, this.now());
        return { providerRunDir, resolvedRunDir: path.resolve(providerRunDir) };
      },
      setSourceRunDir: (message, sessionId, runDir) => this.storeCall("local-console-store-set-rundir", () =>
        options.store.setRunDir({ id: message.id, sessionId, runDir, now: this.nowIso() })),
      resolveWorkspace: (sessionId, source, signal) => this.resolveWorkspace(sessionId, source, signal),
      loadAgentContents: async (agents, selected, selectedMarkdown) => await Promise.all(agents.map(async (agent) => ({
        name: agent.name,
        agentMarkdown: agent.name === selected.name
          ? selectedMarkdown
          : agent.agentMarkdown ?? await fs.readFile(requireAgentFilePath(agent), "utf8"),
        executionProfile: agent.executionProfile ?? null,
      }))),
      concurrentRecoveryWorkspace: (sessionId) => this.concurrentAgentHandoffRecoveryWorkspace(sessionId),
      buildAnalysisContract: (proposalVersion) => buildSessionAnalysisReadOnlyContract(proposalVersion),
      loadRecoverySnapshot: (sessionId) => readLocalRunRecoverySnapshot({
        factLogPath: this.codexRecoveryFactStore()?.getSessionFactLogPath(sessionId) ?? null,
        sessionId,
      }),
      isCodexThreadAvailable: options.isCodexThreadAvailable ?? defaultCodexThreadAvailability,
      settleUnavailable: ({ sessionId, runId, sourceMessage, role, runDir, unavailable }) =>
        this.settleUnavailableResume({
          sessionId,
          runId,
          sourceMessage,
          intent: unavailable.intent,
          role,
          engine: unavailable.context.engine,
          reason: unavailable.reason,
          runDir,
        }),
      recordRunExecutionContext: (context) => this.recordRunExecutionContext(context),
      recordAgentSessionLink: (link) => this.recordAgentSessionLink(link),
      prepareAttachments: ({ messages, runDir }) => options.attachmentManager?.prepareRunAttachments({ messages, runDir })
        ?? Promise.resolve({ promptSuffix: "", imagePaths: [] }),
      consumeRecoveryIntent: ({ sessionId, runId, intentId, mode, reason }) =>
        this.storeCall("local-console-store-consume-resume", () =>
          this.requireCodexRecoveryFactStore().recordCodexResumeConsumed({
            sessionId,
            intentId,
            resumedByRunId: runId,
            mode,
            reason,
            consumedAt: this.nowIso(),
          })),
      prepareLifecycle: (input) => this.prepareRunLifecycle(input),
      setActiveRun: (runId, active) => { this.activeRuns.set(runId, active); },
      recordLifecycle: (active) => this.recordRunLifecycle(active, "created", "created"),
    });
    this.primaryProviderRuntime = new LocalPrimaryProviderRuntime({
      nowIso: () => this.nowIso(),
      recordProviderInvocation: (fact) => this.recordProviderInvocation(fact),
      runProvider: (preparation, callbacks) => this.executionRunner({
        prompt: preparation.prompt,
        runDir: preparation.providerRunDir,
        cwd: preparation.workspace.cwd,
        profile: preparation.executionContext.profile,
        mode: preparation.invocationPlan.providerMode,
        signal: preparation.controller.signal,
        ...(this.codexIdleTimeoutMs === undefined ? {} : { idleTimeoutMs: this.codexIdleTimeoutMs }),
        ...(this.toolInFlightTimeoutMs === undefined ? {} : { toolTimeoutMs: this.toolInFlightTimeoutMs }),
        ...(preparation.preparedAttachments.imagePaths.length === 0
          ? {}
          : { imagePaths: preparation.preparedAttachments.imagePaths }),
        workspaceAccess: preparation.invocationPlan.workspaceAccess,
        ...callbacks,
      }),
      onVisibleAgentMarkdown: (input, text) => {
        const active = this.activeRuns.get(input.runId);
        if (active?.sessionId !== input.sessionId) return async () => undefined;
        active.liveMarkdown = text;
        this.updateAgentProgressActivity(input.runId, text);
        const recordedAt = this.nowIso();
        return () => this.storeCall("local-console-store-record-progress", () =>
          this.sessionFactStore().recordProgressEvent({
            sessionId: input.sessionId,
            runId: input.runId,
            role: input.role,
            body: text,
            now: recordedAt,
          }));
      },
      onProcessStarted: (runId) => this.markRunStarted(runId),
      onStructuredActivity: (runId, event) => this.updateStructuredRunActivity(runId, event),
      onExecutionProgress: (runId, event) => this.updateExecutionProgressActivity(runId, event),
      setActiveExternalSessionId: (sessionId, runId, externalSessionId) => {
        const active = this.activeRuns.get(runId);
        if (active?.sessionId === sessionId) active.threadId = externalSessionId;
      },
      recordProviderSessionObserved: (fact) => this.recordProviderSessionObserved(fact),
      recordAgentSessionLink: (fact) => this.recordAgentSessionLink(fact),
      recordExecutionSessionLink: (fact) => this.recordExecutionSessionLink(fact),
      recordCodexThreadLink: (fact) => this.recordCodexThreadLink(fact),
    });
    this.primaryAnalysisRuntime = new LocalPrimaryAnalysisRuntime({
      updateGate: async (input) => {
        await this.updateSessionAnalysisGate(input);
      },
      resumeConfirmed: async ({ run, preparation, confirmedVersion, externalSessionId }) =>
        await this.executionRunner({
          prompt: buildConfirmedPlanExecutionPrompt(confirmedVersion),
          runDir: preparation.providerRunDir,
          cwd: preparation.workspace.cwd,
          profile: preparation.executionContext.profile,
          mode: { kind: "resume", externalSessionId },
          signal: preparation.controller.signal,
          workspaceAccess: "read-write",
          ...(this.codexIdleTimeoutMs === undefined ? {} : { idleTimeoutMs: this.codexIdleTimeoutMs }),
          ...(this.toolInFlightTimeoutMs === undefined ? {} : { toolTimeoutMs: this.toolInFlightTimeoutMs }),
          onVisibleAgentMarkdown: (text) => {
            const active = this.activeRuns.get(run.runId);
            if (active?.sessionId === run.sessionId) {
              active.liveMarkdown = text;
              this.updateAgentProgressActivity(run.runId, text);
            }
          },
          onStructuredActivity: (event) => this.updateStructuredRunActivity(run.runId, event),
          onExecutionProgress: (event) => this.updateExecutionProgressActivity(run.runId, event),
          onSessionStarted: async ({ externalSessionId: resumedSessionId }) => {
            if (resumedSessionId !== externalSessionId) {
              throw new Error("analysis-write-lease-provider-session-mismatch");
            }
          },
        }),
    });
    this.primaryTerminalRuntime = new LocalPrimaryTerminalRuntime({
      store: options.store,
      storeCall: (label, operation) => this.storeCall(label, operation),
      nowIso: () => this.nowIso(),
      activeRun: (runId) => this.activeRuns.get(runId),
      recoveryStore: () => this.codexRecoveryFactStore(),
      recordProviderInvocation: (fact) => this.recordProviderInvocation(fact),
      classifyFailure: (result) => ({
        runtimeClosing: executionInterruptionCauseForResult(result) === "runtime-closing",
        failureStatus: runTimingStatusForFailedResult(result),
      }),
      pauseLifecycle: (runId) => this.pauseRunLifecycle(runId),
      finishLifecycle: (runId, status) => this.finishRunLifecycle(runId, status),
      recordFailure: (run, result) =>
        this.recordFailedCodexResult(run.sourceMessage, run.sessionId, run.runId, result),
      sourceDirectoryAvailable: (sessionId) => this.sessionProjectDirectoryAvailable(sessionId),
      executeChildSession: (run, result) => this.executeLocalCeoChildSessionOrchestrationIfNeeded({
        sessionId: run.sessionId,
        runId: run.runId,
        runDir: result.runDir,
        finalText: result.finalText,
        availableAgentNames: run.agentFiles.map((agent) => agent.name),
      }),
      recordWorkspaceDiff: (run, preparation, result) => this.recordWorkspaceDiffIfNeeded(
        run.sessionId,
        run.runId,
        preparation.resolvedRunDir,
        preparation.workspace,
        result.finalText,
        preparation.controller.signal,
      ),
      recordTimelineCursor: (run, agentIdentityFingerprint, lastSeenIndex) =>
        this.recordAgentTimelineCursor({
          sessionId: run.sessionId,
          runId: run.runId,
          role: run.role,
          agentIdentityFingerprint,
          lastSeenIndex,
          recordedAt: this.nowIso(),
        }),
      recordChildSessionCard: (run, card, result) =>
        this.storeCall("local-console-store-child-session-card", () =>
          this.sessionFactStore().recordChildSessionCard({
            parentSessionId: run.sessionId,
            sourceId: card.sourceId,
            childSessionIds: card.childSessionIds,
            runId: run.runId,
            runDir: result.runDir,
            now: this.nowIso(),
          })),
      recordChildSessionCardError: async (sessionId, error) => {
        const reason = formatLocalError(error);
        this.lastError = reason;
        await this.recordVisibleChildSessionFailureBestEffort(sessionId, reason);
      },
    });
    this.pendingSessionContextRuntime = new LocalPendingSessionContextRuntime({
      store: options.store,
      storeCall: (label, operation) => this.storeCall(label, operation),
      nowIso: () => this.nowIso(),
      hasActiveRun: (sessionId) => this.hasActiveRunForSession(sessionId),
      hasScheduledWorker: (sessionId) => this.workerDispatchRuntime.hasScheduledWorker(sessionId),
      listAgentNames: async (sessionId) =>
        (await options.listAgentFiles(sessionId)).map((agent) => agent.name),
    });
    this.runRecoveryRuntime = new LocalRunRecoveryRuntime({
      store: options.store,
      storeCall: (label, operation) => this.storeCall(label, operation),
      nowIso: () => this.nowIso(),
      recoveryStore: () => this.codexRecoveryFactStore(),
      requireRecoveryStore: () => this.requireCodexRecoveryFactStore(),
      lifecycleStore: () => this.runLifecycleFactStore(),
      readRecoveryFacts: readLocalCodexRecoveryFacts,
    });
    this.projectCommandRuntime = new LocalProjectCommandRuntime({
      store: options.store,
      storeCall: (label, operation) => this.storeCall(label, operation),
      nowIso: () => this.nowIso(),
      assertDirectoryAvailable: (projectId) => this.assertProjectDirectoryAvailable(projectId),
      withDirectoryAvailability: (project, knownAvailable) =>
        this.withDirectoryAvailability(project, knownAvailable),
      processPending: (sessionId) => void this.processPending(sessionId),
      activeRunsForSession: (sessionId) => this.activeRunsForSession(sessionId),
      inactiveSessions: this.inactiveSessions,
      resolvePath: path.resolve,
      directoryAvailable,
    });
    this.sessionCreationRuntime = new LocalSessionCreationRuntime({
      store: options.store,
      storeCall: (label, operation) => this.storeCall(label, operation),
      createSessionId: () => `local:${this.now().toISOString()}-${Math.random().toString(36).slice(2, 8)}`,
      nowIso: () => this.nowIso(),
      resolveProjectId: async (projectId) => projectId ?? (await this.defaultProjectId()),
      assertProjectDirectoryAvailable: (projectId) => this.assertProjectDirectoryAvailable(projectId),
      storedProject: (projectId) => this.storedProject(projectId),
      ...(options.loadAgentTeamSnapshot === undefined
        ? {}
        : { loadAgentTeamSnapshot: options.loadAgentTeamSnapshot }),
      listAgentNames: async (sessionId) =>
        (await options.listAgentFiles(sessionId)).map((agent) => agent.name),
      ...(options.attachmentManager === undefined
        ? {}
        : {
            findDraftAttachment: async (draftKey: string, attachmentId: string) =>
              (await options.attachmentManager!.listDraft(draftKey))
                .find((attachment) => attachment.attachmentId === attachmentId),
          }),
      readWorkspaceFacts: async (folderPath) => await readCachedLocalWorkspaceFacts({
        folderPath,
        gitTimeoutMs: options.workspaceGitTimeoutMs,
      }),
      readBaselineCommit: async (folderPath) => await readLocalConversationBaselineCommit({
        folderPath,
        gitTimeoutMs: options.workspaceGitTimeoutMs,
      }),
      logBaselineUnavailable: ({ projectId, error }) => log({
        event: "local-console-conversation-baseline-unavailable",
        projectId,
        error,
      }),
      baselineCommits: this.conversationBaselineCommits,
      processPending: (sessionId) => void this.processPending(sessionId),
    });
    this.sessionSettingsRuntime = new LocalSessionSettingsRuntime({
      store: options.store,
      storeCall: (label, operation) => this.storeCall(label, operation),
      nowIso: () => this.nowIso(),
      ...(options.loadAgentTeamSnapshot === undefined
        ? {}
        : { loadAgentTeamSnapshot: options.loadAgentTeamSnapshot }),
      ...(options.workspaceGitTimeoutMs === undefined ? {} : { workspaceGitTimeoutMs: options.workspaceGitTimeoutMs }),
      hasActiveRun: (sessionId) => this.hasActiveRunForSession(sessionId),
      inactiveSessions: this.inactiveSessions,
      processPending: (sessionId) => void this.processPending(sessionId),
      readWorkspaceFacts: async (folderPath) => await readCachedLocalWorkspaceFacts({
        folderPath,
        gitTimeoutMs: options.workspaceGitTimeoutMs,
      }),
      invalidateWorkspaceFacts: invalidateLocalWorkspaceFacts,
    });
    this.sessionReferenceRuntime = new LocalSessionReferenceRuntime({
      store: options.store,
      storeCall: (label, operation) => this.storeCall(label, operation),
      randomId: () => crypto.randomUUID(),
    });
    this.stateQueryRuntime = new LocalConsoleStateQueryRuntime({
      store: options.store,
      storeCall: (label, operation) => this.storeCall(label, operation),
      defaultSessionId: this.sessionId,
      projectRoot: options.projectRoot,
      lastError: () => this.lastError,
      withDirectoryAvailability: (project) => this.withDirectoryAvailability(project),
      withSessionWorkspaceContext: (project) => this.withSessionWorkspaceContext(project),
      withRuntimeActivity: (project) => this.withRuntimeActivity(project),
      synchronizeNonContinuableRecords: (projects) => this.synchronizeNonContinuableRecords(projects),
      stopUnsafeRunsWithUnavailableContext: (projects) => this.stopUnsafeRunsWithUnavailableContext(projects),
      primaryRunId: (sessionId) => this.activeRunForLane(sessionId, "primary")?.runId ?? null,
      activeRunSnapshots: (sessionId) => this.activeRunSnapshots(sessionId),
      listChildSessions: (parentSessionId) => this.storeCall("local-console-store-list-child-sessions", () =>
        listLocalChildSessionSummaries({
          sqlitePath: options.store.sqlitePath,
          timeoutMs: this.storeTimeoutMs,
        }, parentSessionId)),
      readWorkspaceDiff: (sessionId) => this.readConversationWorkspaceDiff(sessionId),
      loadTeamSnapshot: (sessionId) =>
        options.store.listSessionAgentTeamSnapshot?.(sessionId) ?? Promise.resolve(null),
    });
    this.runOutputRuntime = new LocalConsoleRunOutputRuntime({
      store: options.store,
      storeCall: (label, operation) => this.storeCall(label, operation),
      activeRun: (runId) => this.activeRuns.get(runId),
      activeRunIds: (sessionId) => new Set(this.activeRunsForSession(sessionId).map((run) => run.runId)),
      readOptionalTextFile,
      sessionFactLogPath: (sessionId) => {
        const store = options.store as LocalConsoleStore
          & Partial<Pick<SessionFactWritingStore, "getSessionFactLogPath">>;
        const getSessionFactLogPath = store.getSessionFactLogPath;
        if (getSessionFactLogPath === undefined) {
          throw new Error("local console store does not provide the session fact log path");
        }
        return getSessionFactLogPath.call(store, sessionId);
      },
      factReader: localProcessFactReader,
      traceDataRoot: options.dataRoot ?? options.projectRoot,
    });
    this.workspaceQueryRuntime = new LocalConsoleWorkspaceQueryRuntime({
      readContext: (sessionId) => this.readConversationWorkspaceContext(sessionId),
      readWorkspaceMode: (sessionId) => this.readWorkspaceModeBestEffort(sessionId),
      readDiff: (context) => readLocalConversationWorkspaceDiffDetail({
        workspacePath: context.workspacePath,
        baselineCommit: context.baselineCommit,
        gitTimeoutMs: options.workspaceGitTimeoutMs,
      }),
      listFiles: listLocalWorkspaceFiles,
      readDiffFile: (context, filePath) => readLocalConversationDiffFile({
        workspacePath: context.workspacePath,
        baselineCommit: context.baselineCommit,
        filePath,
        gitTimeoutMs: options.workspaceGitTimeoutMs,
      }),
      readWorkspaceFile: (workspacePath, filePath) => readLocalWorkspaceTextFile({ workspacePath, filePath }),
      readFileReference: readLocalFileReferenceWindow,
      log: (event) => log(event),
    });
    this.sessionMetadataRuntime = new LocalConsoleSessionMetadataRuntime({
      nowIso: () => this.nowIso(),
      storeCall: (label, operation) => this.storeCall(label, operation),
      assertProjectDirectoryAvailable: (projectId) => this.assertProjectDirectoryAvailable(projectId),
      createChildSession: (input) => this.sessionFactStore().createChildSession(input),
      recordVisibleChildFailure: (parentSessionId, reason) =>
        this.recordVisibleChildSessionFailureBestEffort(parentSessionId, reason),
      setLastError: (error) => { this.lastError = error; },
      sessionFactLogPath: (sessionId) => {
        const store = options.store as LocalConsoleStore
          & Partial<Pick<SessionFactWritingStore, "getSessionFactLogPath">>;
        const getSessionFactLogPath = store.getSessionFactLogPath;
        if (getSessionFactLogPath === undefined) {
          throw new Error("local console store does not provide the session fact log path");
        }
        return getSessionFactLogPath.call(store, sessionId);
      },
      interruptRun: ({ sessionId, runId }) => {
        const active = this.activeRuns.get(runId);
        if (active === undefined || active.sessionId !== sessionId) return false;
        active.controller.abort("user-interrupted");
        return true;
      },
      markSessionResultRead: (input) => options.store.markSessionResultRead(input),
      updateSessionReadState: (input) => {
        if (options.store.updateSessionReadState === undefined) throw new Error("local console session read state unavailable");
        return options.store.updateSessionReadState(input);
      },
      armSessionManualUnread: (input) => {
        if (options.store.armSessionManualUnread === undefined) throw new Error("local console manual unread unavailable");
        return options.store.armSessionManualUnread(input);
      },
      markSessionViewed: (input) => {
        if (options.store.markSessionViewed === undefined) throw new Error("local console session view state unavailable");
        return options.store.markSessionViewed(input);
      },
      setSessionPinned: (input) => {
        if (options.store.setSessionPinned === undefined) throw new Error("local console session pin unavailable");
        return options.store.setSessionPinned(input);
      },
      renameSession: (input) => {
        if (options.store.renameSession === undefined) throw new Error("local console session rename unavailable");
        return options.store.renameSession(input);
      },
    });
    this.messageCommandRuntime = new LocalConsoleMessageCommandRuntime({
      defaultSessionId: this.sessionId,
      nowIso: () => this.nowIso(),
      assertSessionCanContinue: (sessionId) => this.assertSessionCanContinue(sessionId),
      hasActivePrimary: (sessionId) => this.activeRunForLane(sessionId, "primary") !== undefined,
      hasPersistedPrimary: (sessionId) => this.hasPersistedPrimaryRun(sessionId),
      sessionSummary: (sessionId) => this.sessionSummary(sessionId),
      resolveDispatch: (sessionId, body) => this.resolveUserMessageDispatch(sessionId, body),
      appendUserMessage: (input) => options.store.appendUserMessage({ ...input, textFragments: [] }),
      resolveResumeLink: async (sessionId, runId) => {
        const recoveryStore = this.codexRecoveryFactStore();
        if (recoveryStore === null) return undefined;
        const factLogPath = recoveryStore.getSessionFactLogPath(sessionId);
        const [executionLinks, codexLinks] = await Promise.all([
          readExecutionSessionLinks(factLogPath, sessionId),
          readCodexThreadLinks(factLogPath, sessionId),
        ]);
        return executionLinks.find((candidate) => candidate.runId === runId)
          ?? codexLinks.find((candidate) => candidate.runId === runId);
      },
      recordEditResume: (input) => this.requireCodexRecoveryFactStore().recordCodexResumeIntent({
        ...input,
        intentId: crypto.randomUUID(),
        reason: "edit-resend",
      }),
      scheduleWorkerWake: (sessionId) => this.workerDispatchRuntime.scheduleWake(sessionId),
      processPending: (sessionId) => { void this.processPending(sessionId); },
      markPendingReferenceError: (input) => {
        if (options.store.markPendingReferenceError === undefined) throw new Error("pending message retry unavailable");
        return options.store.markPendingReferenceError(input);
      },
      updatePendingUserMessage: (input) => {
        if (options.store.updatePendingUserMessage === undefined) throw new Error("pending message editing unavailable");
        return options.store.updatePendingUserMessage(input);
      },
      removePendingUserMessage: (input) => {
        if (options.store.removePendingUserMessage === undefined) throw new Error("pending message removal unavailable");
        return options.store.removePendingUserMessage(input);
      },
      storeCall: (label, operation) => this.storeCall(label, operation),
      setLastError: (error) => { this.lastError = error; },
      schedulePendingProcessing: (sessionId) => this.schedulePendingProcessing(sessionId),
    });
    this.runRetryRuntime = new LocalConsoleRunRetryRuntime({
      nowIso: () => this.nowIso(),
      randomId: () => crypto.randomUUID(),
      assertSessionCanContinue: (sessionId) => this.assertSessionCanContinue(sessionId),
      listMessages: (sessionId) => this.storeCall("local-console-store-list-retry-source", () =>
        options.store.listMessages(sessionId)),
      loadRecoveryBundle: async (sessionId) => {
        const recoveryStore = this.codexRecoveryFactStore();
        if (recoveryStore === null) return emptyRetryRecoveryBundle();
        const factLogPath = recoveryStore.getSessionFactLogPath(sessionId);
        const [executionLinks, codexLinks, runContexts, recoveryFacts] = await Promise.all([
          readExecutionSessionLinks(factLogPath, sessionId),
          readCodexThreadLinks(factLogPath, sessionId),
          readRunExecutionContexts(factLogPath, sessionId),
          readLocalCodexRecoveryFacts(factLogPath, sessionId),
        ]);
        return { available: true, executionLinks, codexLinks, runContexts, recoveryFacts };
      },
      activeRunForRole: (sessionId, role) => this.activeRunForRole(sessionId, role) !== undefined,
      recordRetryIntent: (input) => this.requireCodexRecoveryFactStore().recordCodexResumeIntent(input),
      releaseMessageForRetry: (input) => options.store.releaseMessageForRetry(input),
      processAfterCurrent: (sessionId) => { void this.processAfterCurrent(sessionId); },
      storeCall: (label, operation) => this.storeCall(label, operation),
    });
    const legacyHandoffRecoveryRuntime = new LocalLegacyHandoffRecoveryRuntime({
      store: options.store,
      storeCall: (label, operation) => this.storeCall(label, operation),
      nowIso: () => this.nowIso(),
      recoveryStore: () => this.codexRecoveryFactStore(),
      readRecoveryFacts: readLocalCodexRecoveryFacts,
      readRunContexts: readRunExecutionContexts,
      activeRunIds: () => new Set(this.activeRuns.keys()),
      report: (input) => log(input),
    });
    this.startupRecoveryRuntime = new LocalStartupRecoveryRuntime({
      store: options.store,
      defaultSessionId: this.sessionId,
      storeCall: (label, operation) => this.storeCall(label, operation),
      now: () => this.now(),
      nowIso: () => this.nowIso(),
      idleTimeoutMs: this.codexIdleTimeoutMs,
      maxDurationMs: this.codexMaxDurationMs,
      staleGraceMs: this.staleRunningGraceMs,
      activeSessionIds: () => new Set([...this.activeRuns.values()].map((active) => active.sessionId)),
      recoveryStore: () => this.codexRecoveryFactStore(),
      readRecoveryFacts: readLocalCodexRecoveryFacts,
      legacyRecovery: legacyHandoffRecoveryRuntime,
      recordError: (error) => {
        const formatted = formatLocalError(error);
        this.lastError = formatted;
        return formatted;
      },
      report: (input) => log(input),
    });
  }

  get sqlitePath(): string {
    return this.options.store.sqlitePath;
  }

  async init(): Promise<void> {
    await this.startupRecoveryRuntime.init();
  }

  async close(): Promise<void> {
    if (this.closing) {
      return;
    }
    this.closing = true;
    this.pendingProcessSessions.clear();
    for (const active of [...this.activeRuns.values()]) {
      try {
        if (active.threadId !== null) {
          const intent: LocalCodexResumeIntentFact = {
            sessionId: active.sessionId,
            intentId: `graceful-shutdown:${active.runId}:${crypto.randomUUID()}`,
            targetRunId: active.runId,
            sourceMessageId: active.userMessageId,
            role: active.role ?? "",
            reason: "graceful-shutdown",
            sourceDisposition: active.sourceDisposition,
            createdAt: this.nowIso(),
          };
          if (intent.role !== "") {
            const recoveryStore = this.requireCodexRecoveryFactStore();
            await this.storeCall("local-console-store-record-graceful-resume", () =>
              recoveryStore.recordCodexResumeIntent(intent));
            const releaseMessageForResume = this.options.store.releaseMessageForResume;
            if (releaseMessageForResume === undefined) {
              throw new Error("local console graceful resume persistence capability unavailable");
            }
            await this.storeCall("local-console-store-release-graceful-resume", () =>
              releaseMessageForResume.call(this.options.store, {
                userMessageId: active.userMessageId,
                sessionId: active.sessionId,
                sourceDisposition: active.sourceDisposition,
                targetRunId: active.runId,
                role: active.role ?? "",
                now: this.nowIso(),
              }));
            active.gracefulResumePrepared = true;
          }
        }
      } catch (error) {
        this.lastError = formatLocalError(error);
        log({
          event: "local-console-prepare-graceful-resume-failed",
          sessionId: active.sessionId,
          runId: active.runId,
          error: this.lastError,
        });
      }
      active.controller.abort("runtime-closing");
    }
    const processingDeadline = Date.now() + this.storeTimeoutMs;
    while (
      (
        this.processingSessions.size > 0
        || this.workerDispatchRuntime.hasOutstandingWork()
      )
      && Date.now() < processingDeadline
    ) {
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    await this.options.store.close();
  }

  async createProject(input: { folderPath: string; worktreeMode: boolean }): Promise<LocalConsoleProjectSummary> {
    return await this.projectCommandRuntime.create(input);
  }

  async updateProject(input: { projectId: string; worktreeMode: boolean }): Promise<LocalConsoleProjectSummary> {
    return await this.projectCommandRuntime.update(input);
  }

  async repairProjectFolder(input: { projectId: string; folderPath: string }): Promise<LocalConsoleProjectSummary> {
    return await this.projectCommandRuntime.repairFolder(input);
  }

  async renameProject(input: { projectId: string; title: string }): Promise<LocalConsoleProjectSummary> {
    return await this.projectCommandRuntime.rename(input);
  }

  async removeProject(input: { projectId: string; force: boolean }): Promise<LocalConsoleProjectRemovalResult> {
    return await this.projectCommandRuntime.remove(input);
  }

  async reorderProjects(projectIds: string[]): Promise<LocalConsoleProjectSummary[]> {
    return await this.projectCommandRuntime.reorder(projectIds);
  }

  async createSession(
    title?: string,
    projectId?: string,
    agentTeam?: { ownership: "system" | "user"; id: string },
    initialMessage?: string,
    workspaceMode?: LocalConsoleWorkspaceMode,
    attachmentIds: string[] = [],
    metadata: {
      originSessionId?: string | null;
      analysisParentSessionId?: string | null;
      entryTemplate?: LocalConsoleEntryTemplate | null;
      writePolicy?: LocalConsoleWritePolicy;
      textFragments?: LocalConsoleTextFragment[];
      attachmentDraftKey?: string;
    } = {},
  ): Promise<LocalConsoleSessionSummary> {
    return await this.sessionCreationRuntime.create(
      title,
      projectId,
      agentTeam,
      initialMessage,
      workspaceMode,
      attachmentIds,
      metadata,
    );
  }

  async moveEmptySessionToProject(input: {
    sessionId: string;
    projectId: string;
  }): Promise<LocalConsoleSessionSummary> {
    return await this.sessionSettingsRuntime.moveEmpty(input);
  }

  async switchSessionWorkspace(input: {
    sessionId: string;
    workspaceMode: LocalConsoleWorkspaceMode;
  }): Promise<LocalConsoleSessionSummary> {
    return await this.sessionSettingsRuntime.switchWorkspace(input);
  }

  async switchSessionTeam(input: {
    sessionId: string;
    agentTeamOwnership: LocalConsoleAgentTeamOwnership;
    agentTeamId: string;
  }): Promise<LocalConsoleSessionSummary> {
    return await this.sessionSettingsRuntime.switchTeam(input);
  }

  async archiveSession(sessionId: string): Promise<LocalConsoleSessionArchiveResult> {
    return await this.sessionSettingsRuntime.archive(sessionId);
  }

  async restoreSession(sessionId: string): Promise<LocalConsoleSessionSummary> {
    return await this.sessionSettingsRuntime.restore(sessionId);
  }

  async searchSessions(input: {
    query: string;
    includeArchived: boolean;
  }): Promise<LocalConsoleSessionSearchResult[]> {
    return await this.sessionReferenceRuntime.search(input);
  }

  async sessionReferenceText(input: {
    sessionId: string;
    scope: LocalConsoleSessionReferenceScope;
    runId?: string | null;
    messageId?: number | null;
  }): Promise<LocalConsoleSessionReferenceText> {
    return await this.sessionReferenceRuntime.referenceText(input);
  }

  async createChildSession(input: {
    parentSessionId: string;
    childSessionId: string;
    projectId: string;
    title: string;
    relation?: string;
    hiddenKey: string;
    initialBody: string;
    initialRole?: string | null;
  }): Promise<LocalConsoleSessionSummary> {
    return await this.sessionMetadataRuntime.createChildSession(input);
  }

  getSessionFactLogPath(sessionId: string): string {
    return this.sessionMetadataRuntime.getSessionFactLogPath(sessionId);
  }

  async submitUserMessage(
    body: string,
    sessionId = this.sessionId,
    attachmentIds: string[] = [],
    resumeRunId?: string,
    textFragments: LocalConsoleTextFragment[] = [],
  ): Promise<LocalConsoleMessage> {
    return await this.messageCommandRuntime.submit(body, sessionId, attachmentIds, resumeRunId, textFragments);
  }

  async retryPendingUserMessage(input: { sessionId: string; messageId: number }): Promise<void> {
    await this.messageCommandRuntime.retryPending(input);
  }

  async updatePendingUserMessage(input: {
    sessionId: string;
    messageId: number;
    body: string;
  }): Promise<LocalConsoleMessage> {
    return await this.messageCommandRuntime.updatePending(input);
  }

  async removePendingUserMessage(input: { sessionId: string; messageId: number }): Promise<void> {
    await this.messageCommandRuntime.removePending(input);
  }

  async retryRun(input: {
    sessionId: string;
    runId: string;
    executionOverride?: {
      overrideId: string;
      profile: LocalConsoleExecutionProfile;
      scope: "single-run";
    };
  }): Promise<boolean> {
    return await this.runRetryRuntime.retry(input);
  }

  async interruptRun(input: { sessionId: string; runId: string }): Promise<boolean> {
    return await this.sessionMetadataRuntime.interruptRun(input);
  }

  async markSessionResultRead(input: { sessionId: string; unreadSince: string }): Promise<boolean> {
    return await this.sessionMetadataRuntime.markSessionResultRead(input);
  }

  async updateSessionReadState(input: {
    sessionId: string;
    action: "mark-read-attention" | "mark-read-unread" | "mark-unread";
    expectedAttentionRevision: number;
    expectedReadStateRevision: number;
    expectedTitleRevision: number;
    isCurrent: boolean;
  }): Promise<LocalConsoleSessionSummary> {
    return await this.sessionMetadataRuntime.updateSessionReadState(input);
  }

  async armSessionManualUnread(sessionId: string): Promise<LocalConsoleSessionSummary> {
    return await this.sessionMetadataRuntime.armSessionManualUnread(sessionId);
  }

  async markSessionViewed(sessionId: string): Promise<LocalConsoleSessionSummary> {
    return await this.sessionMetadataRuntime.markSessionViewed(sessionId);
  }

  async setSessionPinned(input: {
    sessionId: string;
    pinned: boolean;
    expectedPinnedAt: string | null;
  }): Promise<LocalConsoleSessionSummary> {
    return await this.sessionMetadataRuntime.setSessionPinned(input);
  }

  async renameSession(input: {
    sessionId: string;
    title: string;
    expectedTitleRevision: number;
  }): Promise<LocalConsoleSessionSummary> {
    return await this.sessionMetadataRuntime.renameSession(input);
  }

  async snapshot(sessionId = this.sessionId): Promise<LocalConsoleSnapshot> {
    return await this.stateQueryRuntime.snapshot(sessionId);
  }

  async state(selected: string | { sessionId?: string; projectId?: string } = this.sessionId): Promise<LocalConsoleStateSnapshot> {
    return await this.stateQueryRuntime.state(selected);
  }

  async sessionView(sessionId: string): Promise<LocalConsoleSessionView> {
    return await this.stateQueryRuntime.sessionView(sessionId);
  }

  async runOutput(sessionId: string, runId: string): Promise<LocalConsoleRunOutput> {
    return await this.runOutputRuntime.runOutput(sessionId, runId);
  }

  async workspaceDiffDetail(sessionId: string): Promise<LocalConsoleWorkspaceDiffDetail> {
    return await this.workspaceQueryRuntime.workspaceDiffDetail(sessionId);
  }

  async projectFiles(sessionId: string): Promise<LocalConsoleProjectFiles> {
    return await this.workspaceQueryRuntime.projectFiles(sessionId);
  }

  async projectFile(sessionId: string, filePath: string): Promise<LocalConsoleFileContent> {
    return await this.workspaceQueryRuntime.projectFile(sessionId, filePath);
  }

  async fileReference(
    sessionId: string,
    input: { filePath: string; line: number; column: number | null },
  ): Promise<import("./types.js").LocalConsoleFileReferenceContent> {
    return await this.workspaceQueryRuntime.fileReference(sessionId, input);
  }

  async processOutput(
    sessionId: string,
    runId: string,
    cursor?: string,
  ): Promise<LocalConsoleProcessHistoryPage> {
    return await this.runOutputRuntime.processOutput(sessionId, runId, cursor);
  }

  async processOutputAppend(
    sessionId: string,
    runId: string,
    appendCursor: string,
  ): Promise<LocalConsoleProcessAppendPage> {
    return await this.runOutputRuntime.processOutputAppend(sessionId, runId, appendCursor);
  }

  async processDebugInvocation(
    sessionId: string,
    runId: string,
  ): Promise<LocalConsoleProcessDebugInvocation> {
    return await this.runOutputRuntime.processDebugInvocation(sessionId, runId);
  }

  async childSessionSummaries(parentSessionId: string) {
    return await this.stateQueryRuntime.childSessionSummaries(parentSessionId);
  }

  async processPending(sessionId = this.sessionId): Promise<void> {
    if (this.closing || this.inactiveSessions.has(sessionId)) {
      return;
    }
    if (this.processingSessions.has(sessionId)) {
      this.pendingProcessSessions.add(sessionId);
      return;
    }

    this.processingSessions.add(sessionId);

    try {
      await this.repairStaleRunning(sessionId);
      await this.applyPendingSessionContextWhenIdle(sessionId);
      while (true) {
        if (this.closing || this.inactiveSessions.has(sessionId)) {
          return;
        }
        const workspaceSource = await this.continuableSessionWorkspace(sessionId);
        if (workspaceSource === null) {
          return;
        }
        await this.workerDispatchRuntime.dispatch(sessionId, workspaceSource);
        if (await this.hasPersistedPrimaryRun(sessionId)) {
          return;
        }
        let activeMessage: LocalConsoleMessage | null = null;
        let activeRunId: string | null = null;
        let activeRunDir: string | null = null;

        try {
          const gracefulResumeTargets = await this.gracefulResumeTargetsForClaim(sessionId);
          const freshRunId = `local-${this.now().toISOString()}-${Math.random().toString(36).slice(2, 10)}`;
          activeMessage = await this.storeCall("local-console-store-claim", () =>
            this.options.store.claimNextPendingMessage({
              sessionId,
              runId: freshRunId,
              gracefulResumeTargets,
              now: this.nowIso(),
            }),
          );
          if (activeMessage === null) {
            return;
          }
          if (this.inactiveSessions.has(sessionId)) {
            return;
          }
          const claimedMessage = activeMessage;
          const nextRunId = gracefulResumeTargets.find((target) =>
            target.sourceMessageId === claimedMessage.id)?.targetRunId ?? freshRunId;
          activeRunId = nextRunId;
          if (this.inactiveSessions.has(sessionId)) {
            return;
          }

          const persistedSnapshot = await this.options.store.listSessionAgentTeamSnapshot?.(sessionId) ?? null;
          const agentFiles: LocalConsoleAgentFile[] = persistedSnapshot === null
            ? await this.options.listAgentFiles(sessionId)
            : persistedSnapshot.members.map((member) => ({
                name: member.name,
                agentMarkdown: member.agentMarkdown,
                executionProfile: member.executionProfile ?? null,
              }));
          if (this.inactiveSessions.has(sessionId)) {
            return;
          }
          const messages = await this.storeCall("local-console-store-list", () => this.options.store.listMessages(sessionId));
          const policySession = await this.sessionSummary(sessionId);
          const analysisGateEnabled =
            policySession.writePolicy === "confirm-current-plan-before-write";
          const timelineMessages = messages.filter(
            (message) => message.status !== "pending" && !isWorkerRunPlaceholder(message),
          );
          const timeline = buildLocalConsoleTimeline(
            timelineMessages,
            agentFiles.map((agent) => agent.name),
          );
          const routingTimeline = buildLocalConsoleRoutingTimeline(
            timelineMessages,
            claimedMessage.id,
            agentFiles.map((agent) => agent.name),
          );
          const explicitTrigger = resolveTrigger({
            // Runs can complete out of submission order when roles execute in parallel.
            // Keep the public context through the claimed source, but never route from
            // whichever later message currently sorts last in the shared timeline.
            timeline: routingTimeline,
            availableAgentNames: agentFiles.map((agent) => agent.name),
          });
          const primaryAgent = agentFiles[0]?.name ?? null;
          let controlAction = resolveClaimedControlAction({
            source: claimedMessage,
            primaryAgent,
            explicitTrigger,
            availableAgentNames: agentFiles.map((agent) => agent.name),
            retryIntent: null,
          });
          if (controlAction.kind === "complete-source" && claimedMessage.speaker === "agent") {
            const recoveryStore = this.codexRecoveryFactStore();
            const recoveryFacts = recoveryStore === null
              ? null
              : await readLocalCodexRecoveryFacts(
                  recoveryStore.getSessionFactLogPath(sessionId),
                  sessionId,
                );
            const retryIntent = recoveryFacts === null
              ? null
              : selectSourceRetryIntent({
                  sourceMessageId: claimedMessage.id,
                  intents: recoveryFacts.intents,
                  consumedIntentIds: recoveryFacts.consumedIntentIds,
                });
            controlAction = resolveClaimedControlAction({
              source: claimedMessage,
              primaryAgent,
              explicitTrigger,
              availableAgentNames: agentFiles.map((agent) => agent.name),
              retryIntent,
            });
          }

          if (controlAction.kind === "record-retry-trigger-missing") {
            await this.storeCall("local-console-store-record-retry-trigger-missing", () =>
              this.options.store.recordFailure({
                userMessageId: claimedMessage.id,
                sessionId,
                error: "retry-source-trigger-missing",
                runId: nextRunId,
                runDir: null,
                body: "这一步没跑起来。你可以直接告诉主理人下一步怎么处理。",
                systemEventKind: "run-not-started",
                sourceKind: "local-retry-intent",
                sourceId: controlAction.intent.intentId,
                now: this.nowIso(),
              }));
            continue;
          }
          if (controlAction.kind === "complete-source") {
            await this.storeCall("local-console-store-primary-closeout-complete", () =>
              this.options.store.recordMessageProcessed({
                userMessageId: claimedMessage.id,
                sessionId,
                runId: nextRunId,
                runDir: null,
                now: this.nowIso(),
              }),
            );
            continue;
          }
          if (controlAction.kind === "route-without-primary-agent") {
            let route: Awaited<ReturnType<typeof maybeRouteLocalNoMentionMessage>>;
            try {
              route = await maybeRouteLocalNoMentionMessage({
                store: this.options.store,
                message: claimedMessage,
                sessionId,
                timeline,
                availableAgentNames: agentFiles.map((agent) => agent.name),
                runId: nextRunId,
                runDir: activeRunDir,
                agentsDir: path.join(this.options.projectRoot, "agents"),
                now: this.nowIso(),
                routeJudgment: this.options.routeJudgment,
                timeoutMs: this.routeTimeoutMs,
                runCodex: this.options.runCodex,
              });
            } catch (error) {
              await this.recordTerminalFailureBestEffort(
                claimedMessage,
                sessionId,
                nextRunId,
                activeRunDir,
                formatLocalError(error),
              );
              activeMessage = null;
              activeRunId = null;
              activeRunDir = null;
              throw error;
            }
            if (route.kind === "retry") {
              this.lastError = `local-route-retry:${route.reason}`;
              await this.recordTerminalFailureBestEffort(claimedMessage, sessionId, nextRunId, activeRunDir, this.lastError);
              return;
            }
            continue;
          }

          if (controlAction.kind === "fail-missing-agent") {
            await this.recordTerminalFailureBestEffort(
              claimedMessage,
              sessionId,
              nextRunId,
              null,
              `Agent not found: ${controlAction.role}`,
            );
            return;
          }
          const triggerRole = controlAction.role;
          const selectedAgent = agentFiles.find((agent) => agent.name === triggerRole)!;

          if (controlAction.kind === "schedule-worker") {
            await this.storeCall("local-console-store-detached-worker-source-processed", () =>
              this.options.store.recordMessageProcessed({
                userMessageId: claimedMessage.id,
                sessionId,
                runId: nextRunId,
                runDir: null,
                now: this.nowIso(),
              }),
            );
            activeMessage = null;
            this.workerDispatchRuntime.schedule({
              origin: "primary-redirect",
              sessionId,
              runId: nextRunId,
              sourceMessage: claimedMessage,
              role: triggerRole,
              selectedAgent,
              agentFiles,
              timeline,
              timelineMessages,
              workspaceSource,
            });
            activeRunId = null;
            continue;
          }

          const primaryRunInput: LocalPrimaryRunInput = {
            sessionId,
            runId: nextRunId,
            sourceMessage: claimedMessage,
            role: triggerRole,
            primaryAgent,
            selectedAgent,
            agentFiles,
            timeline,
            timelineMessages,
            workspaceSource,
            analysisGateEnabled,
            proposalVersion: policySession.proposalVersion ?? null,
          };
          const preparation = await this.primaryPreparationRuntime.prepare(
            primaryRunInput,
            (runDir) => { activeRunDir = runDir; },
          );
          if (preparation.kind === "settled") return;
          const providerInvocation = await this.primaryProviderRuntime.invoke(primaryRunInput, preparation);
          let { result } = providerInvocation;
          const { observedExternalSessionId } = providerInvocation;
          result = await this.primaryAnalysisRuntime.apply({
            run: primaryRunInput,
            preparation,
            result,
            observedExternalSessionId,
          });

          const terminalOutcome = await this.primaryTerminalRuntime.complete(
            primaryRunInput,
            preparation,
            { result, observedExternalSessionId },
            async (error, successResult) => {
              await this.recordTerminalFailureBestEffort(
                claimedMessage,
                sessionId,
                nextRunId,
                successResult.runDir,
                formatLocalError(error),
              );
              activeMessage = null;
              activeRunDir = null;
            },
          );
          if (terminalOutcome === "failed") return;
          this.lastError = null;
          if (terminalOutcome === "succeeded-directory-unavailable") return;
        } catch (error) {
          this.lastError = formatLocalError(error);
          if (activeMessage !== null && activeRunId !== null) {
            await this.recordTerminalFailureBestEffort(activeMessage, sessionId, activeRunId, activeRunDir, this.lastError);
          }
          log({ event: "local-console-processing-failed", error: this.lastError });
          return;
        } finally {
          const completedWorkspace = activeRunId === null
            ? null
            : this.activeRuns.get(activeRunId)?.cwd ?? null;
          if (activeRunId !== null) {
            const unfinished = this.activeRuns.get(activeRunId);
            if (unfinished !== undefined && !unfinished.terminalRecorded) {
              try {
                if (unfinished.gracefulResumePrepared) {
                  await this.pauseRunLifecycle(activeRunId);
                } else {
                  await this.finishRunLifecycle(activeRunId, "failed");
                }
              } catch (error) {
                this.lastError = formatLocalError(error);
              }
            }
            this.activeRuns.delete(activeRunId);
          }
          await this.applyPendingSessionContextWhenIdle(sessionId);
          if (completedWorkspace !== null) {
            invalidateLocalWorkspaceFacts(completedWorkspace);
          }
        }
      }
    } catch (error) {
      this.lastError = formatLocalError(error);
      log({ event: "local-console-processing-failed", error: this.lastError });
    } finally {
      this.processingSessions.delete(sessionId);
      if (!this.closing && this.pendingProcessSessions.delete(sessionId)) {
        void this.processPending(sessionId);
      } else if (this.closing) {
        this.pendingProcessSessions.delete(sessionId);
      }
    }
  }

  async processAllPending(): Promise<void> {
    const sessions = await this.storeCall("local-console-store-list-sessions", () => this.options.store.listSessions());
    const sessionIds = sessions
      .filter(hasPendingStartupControlWork)
      .map((session) => session.sessionId);
    for (const sessionId of sessionIds) {
      await this.processPending(sessionId);
    }
  }

  private async processAfterCurrent(sessionId: string): Promise<void> {
    while (!this.closing && this.processingSessions.has(sessionId)) {
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    if (!this.closing) {
      await this.processPending(sessionId);
    }
  }

  private schedulePendingProcessing(sessionId: string): void {
    setTimeout(() => {
      if (!this.closing) void this.processPending(sessionId);
    }, 25);
  }

  private async sessionSummary(sessionId: string): Promise<LocalConsoleSessionSummary> {
    const sessions = await this.storeCall(
      "local-console-store-list-session-policy",
      () => this.options.store.listSessions(),
    );
    const session = sessions.find((candidate) => candidate.sessionId === sessionId);
    if (session === undefined) {
      throw new Error(`local console session not found: ${sessionId}`);
    }
    return session;
  }

  private async updateSessionAnalysisGate(input: {
    sessionId: string;
    proposalVersion: string | null;
    writeLeaseVersion: string | null;
  }): Promise<LocalConsoleSessionSummary> {
    if (this.options.store.updateSessionAnalysisGate === undefined) {
      throw new Error("local console analysis gate persistence unavailable");
    }
    return await this.storeCall("local-console-store-update-analysis-gate", () =>
      this.options.store.updateSessionAnalysisGate!({
        ...input,
        now: this.nowIso(),
      }),
    );
  }

  private async releaseClaimedUserDirectMessageWhenStopping(
    sourceMessage: LocalConsoleMessage,
    sessionId: string,
  ): Promise<boolean> {
    if (!this.closing && !this.inactiveSessions.has(sessionId)) {
      return false;
    }
    await this.storeCall("local-console-store-release-stopped-worker-claim", () =>
      this.options.store.releaseMessageForRetry({
        userMessageId: sourceMessage.id,
        sessionId,
        now: this.nowIso(),
      }));
    return true;
  }

  private async recordDetachedRunTerminal(input: {
    sessionId: string;
    body: string;
    systemEventKind: LocalConsoleSystemEventKind;
    runId: string;
    runDir: string | null;
    error: string;
    status: "failed" | "interrupted" | "stuck";
    terminal?: LocalConsoleTerminal | null;
  }): Promise<void> {
    const recordDetachedRunTerminal = this.options.store.recordDetachedRunTerminal;
    if (recordDetachedRunTerminal === undefined) {
      await this.options.store.recordSystemMessage({
        ...input,
        now: this.nowIso(),
      });
      return;
    }
    await recordDetachedRunTerminal.call(this.options.store, {
      ...input,
      now: this.nowIso(),
    });
  }

  private async hasPersistedPrimaryRun(sessionId: string): Promise<boolean> {
    const messages = await this.storeCall("local-console-store-list-primary-running", () =>
      this.options.store.listMessages(sessionId),
    );
    return messages.some((message) =>
      message.speaker === "user"
      && message.status === "running"
      && message.dispatchLane !== "worker");
  }

  private async resolveUserMessageDispatch(sessionId: string, body: string) {
    const persistedSnapshot = await this.options.store.listSessionAgentTeamSnapshot?.(sessionId) ?? null;
    const agentNames = persistedSnapshot === null
      ? (await this.options.listAgentFiles(sessionId)).map((agent) => agent.name)
      : persistedSnapshot.members.map((member) => member.name);
    const primaryAgent = agentNames[0];
    if (primaryAgent === undefined) {
      throw new Error("Local console session has no primary Agent");
    }
    return resolveLocalUserMessageDispatch({
      body,
      availableAgentNames: agentNames,
      primaryAgent,
    });
  }

  async repairStaleRunning(sessionId = this.sessionId): Promise<number> {
    return await this.startupRecoveryRuntime.repairStaleRunning(sessionId);
  }

  private async defaultProjectId(): Promise<string> {
    return this.sessionContinuationRuntime.defaultProjectId();
  }

  private async assertProjectDirectoryAvailable(projectId: string): Promise<void> {
    await this.sessionContinuationRuntime.assertProjectDirectoryAvailable(projectId);
  }

  private async storedProject(projectId: string): Promise<LocalConsoleProjectSummary | undefined> {
    return this.sessionContinuationRuntime.storedProject(projectId);
  }

  private async assertSessionProjectDirectoryAvailable(sessionId: string): Promise<void> {
    await this.sessionContinuationRuntime.assertSessionProjectDirectoryAvailable(sessionId);
  }

  private async assertSessionCanContinue(sessionId: string): Promise<void> {
    await this.sessionContinuationRuntime.assertSessionCanContinue(sessionId);
  }

  private async continuableSessionWorkspace(sessionId: string): Promise<LocalConsoleSessionWorkspaceSource | null> {
    return this.sessionContinuationRuntime.continuableSessionWorkspace(sessionId);
  }

  private async sessionProjectDirectoryAvailable(sessionId: string): Promise<boolean> {
    return this.sessionContinuationRuntime.sessionProjectDirectoryAvailable(sessionId);
  }

  private async withDirectoryAvailability(
    project: LocalConsoleProjectSummary,
    knownAvailable?: boolean,
  ): Promise<LocalConsoleProjectSummary> {
    return this.sessionContinuationRuntime.withDirectoryAvailability(project, knownAvailable);
  }

  private async withAgentTeamHealth(session: LocalConsoleSessionSummary): Promise<LocalConsoleSessionSummary> {
    return this.sessionContinuationRuntime.withAgentTeamHealth(session);
  }

  private async withSessionWorkspaceContext(project: LocalConsoleProjectSummary): Promise<LocalConsoleProjectSummary> {
    return this.sessionPresentationRuntime.withSessionWorkspaceContext(project);
  }

  private withRuntimeActivity(project: LocalConsoleProjectSummary): LocalConsoleProjectSummary {
    return this.sessionPresentationRuntime.withRuntimeActivity(project);
  }

  private async synchronizeNonContinuableRecords(projects: LocalConsoleProjectSummary[]): Promise<void> {
    await this.sessionPresentationRuntime.synchronizeNonContinuableRecords(projects);
  }

  private async stopUnsafeRunsWithUnavailableContext(projects: LocalConsoleProjectSummary[]): Promise<void> {
    await this.sessionPresentationRuntime.stopUnsafeRunsWithUnavailableContext(projects);
  }

  private async resolveWorkspace(
    sessionId: string,
    source: LocalConsoleSessionWorkspaceSource,
    signal: AbortSignal,
  ): Promise<ResolvedLocalWorkspace> {
    const workspace = await resolveLocalWorkspaceSource({
      projectId: source.projectId,
      sessionId,
      folderPath: source.folderPath,
      worktreeMode: source.workspaceMode === "worktree",
      workdirRoot: this.options.workdirRoot,
      gitTimeoutMs: this.options.workspaceGitTimeoutMs,
      signal,
    });
    await this.storeCall("local-console-store-record-workspace", () =>
      this.options.store.recordProjectWorkspaceStatus({
        projectId: source.projectId,
        cwd: workspace.cwd,
        mode: workspace.mode,
        worktreePath: workspace.worktreePath,
        worktreeUnavailableReason: workspace.worktreeUnavailableReason,
        now: this.nowIso(),
      }),
    );
    return workspace;
  }

  private concurrentAgentHandoffRecoveryWorkspace(
    sessionId: string,
  ): ResolvedLocalWorkspace | null {
    const candidates = [...this.activeRuns.values()].filter((active) =>
      active.sessionId === sessionId
      && active.sourceDisposition === "agent-handoff"
      && active.resuming
      && active.cwd !== null
      && active.workspaceMode !== null);
    if (candidates.length !== 1) {
      return null;
    }
    const active = candidates[0];
    return {
      cwd: active.cwd!,
      mode: active.workspaceMode!,
      worktreePath: active.workspaceMode === "worktree" ? active.cwd : null,
      worktreeUnavailableReason: active.worktreeUnavailableReason,
      branchName: active.branchName,
      baseRef: active.baseRef,
      originalRepoRoot: active.originalRepoRoot,
    };
  }

  private async readConversationWorkspaceDiff(sessionId: string): Promise<LocalConsoleWorkspaceDiffSummary> {
    return this.conversationWorkspaceRuntime.readDiff(sessionId);
  }

  private async readConversationWorkspaceContext(sessionId: string): Promise<{
    workspacePath: string;
    workspaceMode: LocalConsoleWorkspaceMode;
    baselineCommit: string | null;
  }> {
    return this.conversationWorkspaceRuntime.readContext(sessionId);
  }

  private async readWorkspaceModeBestEffort(sessionId: string): Promise<LocalConsoleWorkspaceMode> {
    return this.conversationWorkspaceRuntime.readModeBestEffort(sessionId);
  }

  private async recordFailedCodexResult(
    message: LocalConsoleMessage,
    sessionId: string,
    runId: string,
    result: Extract<CodexRunResult, { ok: false }>,
  ): Promise<void> {
    await this.runFailureRuntime.recordDirect(message, sessionId, runId, result);
  }

  private async recordDetachedWorkerResult(
    sessionId: string,
    runId: string,
    result: Extract<CodexRunResult, { ok: false }>,
  ): Promise<void> {
    await this.runFailureRuntime.recordDetached(sessionId, runId, result);
  }

  private async recordNoTrigger(message: LocalConsoleMessage, sessionId: string, runId: string): Promise<void> {
    if (message.speaker === "agent") {
      await this.storeCall("local-console-store-no-trigger-agent", () =>
        this.options.store.recordMessageProcessed({
          userMessageId: message.id,
          sessionId,
          runId,
          runDir: null,
          now: this.nowIso(),
        }),
      );
      return;
    }
    await this.storeCall("local-console-store-no-trigger", () =>
      this.options.store.recordSystemAndComplete({
        userMessageId: message.id,
        sessionId,
        body: "没有找到可以接手这条消息的团队成员。请改选一支可用团队后再试。",
        systemEventKind: "other",
        runId,
        runDir: null,
        now: this.nowIso(),
      }),
    );
  }

  private async releaseForRetryBestEffort(message: LocalConsoleMessage, sessionId: string): Promise<void> {
    try {
      await this.storeCall("local-console-store-release-retry", () =>
        this.options.store.releaseMessageForRetry({
          userMessageId: message.id,
          sessionId,
          now: this.nowIso(),
        }),
      );
    } catch (error) {
      this.lastError = formatLocalError(error);
      log({ event: "local-console-release-retry-failed", error: this.lastError });
    }
  }

  private activeRunsForSession(sessionId: string): ActiveLocalRun[] {
    return this.runLifecycleRuntime.runsForSession(sessionId) as ActiveLocalRun[];
  }

  private hasActiveRunForSession(sessionId: string): boolean {
    return this.activeRunsForSession(sessionId).length > 0;
  }

  private activeRunForLane(sessionId: string, lane: ActiveLocalRun["lane"]): ActiveLocalRun | undefined {
    return this.runLifecycleRuntime.runForLane(sessionId, lane) as ActiveLocalRun | undefined;
  }

  private activeRunForRole(sessionId: string, role: string): ActiveLocalRun | undefined {
    return this.runLifecycleRuntime.runForRole(sessionId, role) as ActiveLocalRun | undefined;
  }

  private async activeRunSnapshots(sessionId: string): Promise<LocalConsoleRunSnapshot[]> {
    return await this.runLifecycleRuntime.snapshots(sessionId);
  }

  private async gracefulResumeTargetsForClaim(
    sessionId: string,
  ): Promise<Array<{ sourceMessageId: number; targetRunId: string }>> {
    return await this.runRecoveryRuntime.targetsForClaim(sessionId);
  }

  private async gracefulResumeTargetForMessage(
    sessionId: string,
    sourceMessageId: number,
    knownRecoveryFacts?: Awaited<ReturnType<typeof readLocalCodexRecoveryFacts>>,
  ): Promise<string | null> {
    return await this.runRecoveryRuntime.targetForMessage(sessionId, sourceMessageId, knownRecoveryFacts);
  }

  private async markRunStarted(runId: string): Promise<void> {
    await this.runLifecycleRuntime.markStarted(runId);
  }

  private updateStructuredRunActivity(runId: string, event: unknown): void {
    this.runLifecycleRuntime.updateStructuredActivity(runId, event);
  }

  private updateExecutionProgressActivity(
    runId: string,
    event: ExecutionProgressEvent,
  ): void {
    this.runLifecycleRuntime.updateExecutionProgress(runId, event);
  }

  private updateAgentProgressActivity(runId: string, markdown: string): void {
    this.runLifecycleRuntime.updateAgentProgress(runId, markdown);
  }

  private async finishRunLifecycle(
    runId: string,
    status: import("./types.js").LocalConsoleRunTiming["status"],
  ): Promise<void> {
    await this.runLifecycleRuntime.finish(runId, status);
  }

  private async pauseRunLifecycle(runId: string): Promise<void> {
    await this.runLifecycleRuntime.pause(runId);
  }

  private async recordRunLifecycle(
    active: ActiveLocalRun,
    phase: "created" | "started" | "paused" | "resumed" | "terminal",
    status: import("./types.js").LocalConsoleRunTiming["status"],
  ): Promise<void> {
    await this.runLifecycleRuntime.record(active, phase, status);
  }

  private async prepareRunLifecycle(input: {
    sessionId: string;
    runId: string;
    stepId: string;
    resumeExisting: boolean;
  }): Promise<{
    attempt: number;
    createdAt: string;
    startedAt: string | null;
    accumulatedMs: number;
    resuming: boolean;
  }> {
    return await this.runLifecycleRuntime.prepare(input);
  }

  private async applyPendingSessionContextWhenIdle(sessionId: string): Promise<void> {
    await this.pendingSessionContextRuntime.applyWhenIdle(sessionId);
  }

  private async recordTerminalFailureBestEffort(
    message: LocalConsoleMessage,
    sessionId: string,
    runId: string | null,
    runDir: string | null,
    error: string,
    body?: string,
    terminal?: LocalConsoleTerminal | null,
  ): Promise<void> {
    try {
      await this.storeCall("local-console-store-record-failure", () =>
        this.options.store.recordFailure({
          userMessageId: message.id,
          sessionId,
          error,
          runId,
          runDir,
          now: this.nowIso(),
          ...(body === undefined ? {} : { body }),
          ...(terminal == null ? {} : { terminal }),
        }),
      );
    } catch (recordError) {
      this.lastError = formatLocalError(recordError);
      log({ event: "local-console-record-retryable-failure-failed", error: this.lastError, originalError: error });
      await this.releaseForRetryBestEffort(message, sessionId);
    }
  }

  private async settleUnavailableResume(input: {
    sessionId: string;
    runId: string;
    sourceMessage: LocalConsoleMessage;
    intent: LocalCodexResumeIntentFact | null;
    role: string;
    engine: "codex" | "claude" | "kimi";
    reason: string;
    runDir: string | null;
  }): Promise<void> {
    await this.runRecoveryRuntime.settleUnavailable(input);
  }

  private async recordInterruptedBestEffort(
    message: LocalConsoleMessage,
    sessionId: string,
    runId: string | null,
    runDir: string | null,
    reason: string,
    interruptionKind: "user" | "redirect" | "context-unavailable" | "system" = "user",
    terminal?: LocalConsoleTerminal | null,
  ): Promise<void> {
    try {
      await this.storeCall("local-console-store-record-interrupted", () =>
        this.options.store.recordInterrupted({
          userMessageId: message.id,
          sessionId,
          reason,
          interruptionKind,
          runId,
          runDir,
          now: this.nowIso(),
          ...(terminal == null ? {} : { terminal }),
        }),
      );
    } catch (recordError) {
      this.lastError = formatLocalError(recordError);
      log({ event: "local-console-record-interrupted-failed", error: this.lastError, originalError: reason });
    }
  }

  private async recordStuckBestEffort(
    message: LocalConsoleMessage,
    sessionId: string,
    runId: string | null,
    runDir: string | null,
    reason: string,
    terminal?: LocalConsoleTerminal | null,
  ): Promise<void> {
    try {
      await this.storeCall("local-console-store-record-stuck", () =>
        this.options.store.recordStuck({
          userMessageId: message.id,
          sessionId,
          reason,
          runId,
          runDir,
          now: this.nowIso(),
          ...(terminal == null ? {} : { terminal }),
        }),
      );
    } catch (recordError) {
      this.lastError = formatLocalError(recordError);
      log({ event: "local-console-record-stuck-failed", error: this.lastError, originalError: reason });
    }
  }

  private async recordVisibleChildSessionFailureBestEffort(parentSessionId: string, reason: string): Promise<void> {
    try {
      await this.storeCall("local-console-store-child-session-failure", () =>
        this.options.store.recordSystemMessage({
          sessionId: parentSessionId,
          body: "子任务没有创建成功。你可以继续说话，或换一个成员接手。",
          systemEventKind: "run-not-started",
          runId: `local-child-session-${this.now().toISOString()}`,
          runDir: null,
          error: reason,
          status: "failed",
          now: this.nowIso(),
        }),
      );
    } catch (error) {
      this.lastError = formatLocalError(error);
      log({ event: "local-console-child-session-failure-record-failed", error: this.lastError, originalError: reason });
    }
  }

  private async executeLocalCeoChildSessionOrchestrationIfNeeded(input: {
    sessionId: string;
    runId: string;
    runDir: string;
    finalText: string;
    availableAgentNames: string[];
  }): Promise<{ sourceId: string; childSessionIds: string[] } | null> {
    const visibleTaskIds = collectLocalCeoLedgerTaskIds(input.finalText);
    if (visibleTaskIds.length === 0) {
      return null;
    }
    const scripts = await loadCeoScripts({ agentsDir: path.join(this.options.projectRoot, "agents"), required: false });
    const parsed = parseCeoOrchestrationOutput({
      output: input.finalText,
      scripts,
      availableAgentNames: input.availableAgentNames,
      visibleTaskIds,
      childTaskCheckPolicy: "local-optional",
    });
    if (!parsed.ok) {
      return null;
    }
    const descriptors =
      parsed.value.action === "spawn_child_issues"
        ? { workflowId: parsed.value.workflowId, groups: parsed.value.groups, issues: parsed.value.issues }
        : parsed.value.action === "goal_intake" && parsed.value.mode === "confirm"
          ? { workflowId: parsed.value.workflowId, groups: parsed.value.groups, issues: parsed.value.issues }
          : null;
    if (descriptors === null || descriptors.issues.length === 0) {
      return null;
    }

    const workspace = await this.storeCall("local-console-store-session-workspace", () => this.options.store.getSessionWorkspace(input.sessionId));
    const created: LocalConsoleSessionSummary[] = [];
    for (const descriptor of descriptors.issues) {
      const group = descriptors.groups.find((entry) => entry.id === descriptor.groupId);
      if (group === undefined) {
        throw new Error(`local child orchestration missing group: ${descriptor.groupId}`);
      }
      const hiddenKey = localOrchestrationKey({
        parentSessionId: input.sessionId,
        workflowId: descriptors.workflowId,
        ledgerTaskId: descriptor.ledgerTaskId,
      });
      created.push(
        await this.createChildSession({
          parentSessionId: input.sessionId,
          childSessionId: localChildSessionId(input.sessionId, descriptor.ledgerTaskId),
          projectId: workspace.projectId,
          title: descriptor.title,
          relation: "task",
          hiddenKey,
          initialRole: descriptor.initialRole,
          initialBody: renderLocalChildSessionInitialBody({
            parentSessionId: input.sessionId,
            workflowId: descriptors.workflowId,
            group,
            descriptor,
            orchestrationKey: hiddenKey,
          }),
        }),
      );
    }
    for (const child of created) {
      void this.processPending(child.sessionId);
    }
    return {
      sourceId: `workflow:${descriptors.workflowId}`,
      childSessionIds: created.map((child) => child.sessionId),
    };
  }

  private async recordWorkspaceDiffIfNeeded(
    sessionId: string,
    runId: string,
    runDir: string,
    workspace: ResolvedLocalWorkspace,
    finalText: string,
    signal: AbortSignal,
  ): Promise<void> {
    if (workspace.mode !== "worktree" || workspace.worktreePath === null) {
      return;
    }
    if (parseTrailingStageMarker(finalText) !== "code-verified") {
      return;
    }
    try {
      const originalStatus = workspace.originalRepoRoot === null
        ? ""
        : await readLocalGitStatus({
          folderPath: workspace.originalRepoRoot,
          gitTimeoutMs: this.options.workspaceGitTimeoutMs,
          signal,
        });
      if (originalStatus !== "") {
        throw new Error(`original-repo-dirty-before-diff:${originalStatus}`);
      }
      const diff = await generateLocalWorkspaceDiff({
        worktreePath: workspace.worktreePath,
        runDir,
        baseRef: workspace.baseRef,
        branchName: workspace.branchName,
        originalRepoRoot: workspace.originalRepoRoot,
        gitTimeoutMs: this.options.workspaceGitTimeoutMs,
        signal,
      });
      await this.storeCall("local-console-store-record-workspace-diff", () =>
        this.sessionFactStore().recordWorkspaceDiff({
          sessionId,
          runId,
          originalRepoRoot: workspace.originalRepoRoot,
          baseRef: diff.baseRef,
          branchName: diff.branchName,
          worktreePath: diff.worktreePath,
          patchPath: diff.patchPath,
          affectedFiles: diff.affectedFiles,
          status: "generated",
          error: null,
          now: this.nowIso(),
        }),
      );
    } catch (error) {
      const message = formatLocalError(error);
      log({ event: "local-console-workspace-diff-failed", error: message, sessionId, runId });
      await this.sessionFactStore().recordWorkspaceDiff({
        sessionId,
        runId,
        originalRepoRoot: workspace.originalRepoRoot,
        baseRef: workspace.baseRef ?? "unknown",
        branchName: workspace.branchName ?? "unknown",
        worktreePath: workspace.worktreePath,
        patchPath: path.join(runDir, "workspace.patch"),
        affectedFiles: [],
        status: "failed",
        error: message,
        now: this.nowIso(),
      });
    }
  }

  private async storeCall<T>(label: string, operation: () => Promise<T>): Promise<T> {
    return await withLocalConsoleTimeout(Promise.resolve().then(operation), this.storeTimeoutMs, label);
  }

  private async recordRunExecutionContext(
    input: LocalRunExecutionContextFact,
  ): Promise<void> {
    const record = this.options.store.recordRunExecutionContext;
    if (record === undefined) {
      return;
    }
    await this.storeCall("local-console-store-record-run-execution-context", () =>
      record.call(this.options.store, input));
  }

  private async recordExecutionSessionLink(
    input: LocalExecutionSessionLinkFact,
  ): Promise<void> {
    const record = this.options.store.recordExecutionSessionLink;
    if (record === undefined) {
      return;
    }
    await this.storeCall("local-console-store-record-execution-session-link", () =>
      record.call(this.options.store, input));
  }

  private async recordAgentSessionLink(input: LocalAgentSessionLinkFact): Promise<void> {
    const store = this.requireCodexRecoveryFactStore();
    await this.storeCall("local-console-store-record-agent-session-link", () =>
      store.recordAgentSessionLink(input));
  }

  private async recordProviderSessionObserved(
    input: LocalProviderSessionObservedFact,
  ): Promise<void> {
    const store = this.requireCodexRecoveryFactStore();
    await this.storeCall("local-console-store-record-provider-session-observed", () =>
      store.recordProviderSessionObserved(input));
  }

  private async recordAgentTimelineCursor(input: LocalAgentTimelineCursorFact): Promise<void> {
    const store = this.requireCodexRecoveryFactStore();
    await this.storeCall("local-console-store-record-agent-timeline-cursor", () =>
      store.recordAgentTimelineCursor(input));
  }

  private async recordProviderInvocation(input: LocalProviderInvocationFact): Promise<void> {
    const store = this.requireCodexRecoveryFactStore();
    await this.storeCall("local-console-store-record-provider-invocation", () =>
      store.recordProviderInvocation(input));
  }

  private async recordCodexThreadLink(input: {
    sessionId: string;
    runId: string;
    sourceMessageId: number;
    role: string;
    threadId: string;
    startedAt: string;
    contextFingerprint: string;
  }): Promise<void> {
    const record = this.options.store.recordCodexThreadLink;
    if (record === undefined) {
      throw new Error("local console store does not provide Codex thread link persistence");
    }
    await this.storeCall("local-console-store-record-codex-thread-link", () =>
      record.call(this.options.store, input));
  }

  private sessionFactStore(): SessionFactWritingStore {
    const store = this.options.store as Partial<SessionFactWritingStore> & LocalConsoleStore;
    if (
      typeof store.createChildSession !== "function" ||
      typeof store.recordChildSessionCard !== "function" ||
      typeof store.recordWorkspaceDiff !== "function" ||
      typeof store.recordProgressEvent !== "function" ||
      typeof store.getSessionFactLogPath !== "function"
    ) {
      throw new Error("local console store does not provide the session fact write funnel");
    }
    return store as SessionFactWritingStore;
  }

  private runLifecycleFactStore(): LocalRunLifecycleFactStore | null {
    const store = this.options.store as Partial<LocalRunLifecycleFactStore> & LocalConsoleStore;
    if (
      typeof store.nextRunAttempt !== "function"
      || typeof store.getRunTiming !== "function"
      || typeof store.recordRunLifecycleEvent !== "function"
      || typeof store.recordRunActivityEvent !== "function"
    ) {
      return null;
    }
    return store as LocalRunLifecycleFactStore;
  }

  private codexRecoveryFactStore(): CodexRecoveryFactStore | null {
    const store = this.options.store as Partial<CodexRecoveryFactStore> & LocalConsoleStore;
    if (
      typeof store.getSessionFactLogPath !== "function" ||
      typeof store.recordCodexResumeIntent !== "function" ||
      typeof store.recordCodexResumeConsumed !== "function" ||
      typeof store.recordCodexRunUsage !== "function" ||
      typeof store.recordAgentSessionLink !== "function" ||
      typeof store.recordProviderSessionObserved !== "function" ||
      typeof store.recordAgentTimelineCursor !== "function" ||
      typeof store.recordProviderInvocation !== "function"
    ) {
      return null;
    }
    return store as CodexRecoveryFactStore;
  }

  private requireCodexRecoveryFactStore(): CodexRecoveryFactStore {
    const store = this.codexRecoveryFactStore();
    if (store === null) {
      throw new Error("local console store does not provide Codex recovery fact persistence");
    }
    return store;
  }

  private nowIso(): string {
    return this.now().toISOString();
  }
}

async function defaultCodexThreadAvailability(threadId: string): Promise<boolean> {
  return (await resolveCodexRollout(threadId)).status === "available";
}

function runTimingStatusForFailedResult(
  result: Extract<CodexRunResult, { ok: false }>,
): "failed" | "interrupted" | "stuck" | "paused" {
  if (executionInterruptionCauseForResult(result) === "runtime-closing") return "paused";
  if (executionTimeoutKind(result) !== null) return "stuck";
  return isInterruptedCodexRunResult(result) ? "interrupted" : "failed";
}
