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
import { listLocalChildSessionSummaries } from "./child-session-summary-reader.js";
import type { LocalAttachmentManager } from "./attachments.js";
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
} from "./execution-context.js";
import {
  readExecutionSessionLinks,
  readRunExecutionContexts,
} from "./execution-context-reader.js";
import { projectLocalConsoleMemberIdentities } from "./member-identity.js";
import { resolveLocalUserMessageDispatch } from "./user-message-routing.js";
import { readLocalRunRecoverySnapshot } from "./run-recovery-reader.js";
import { LocalConversationWorkspaceRuntime } from "./conversation-workspace-runtime.js";
import { LocalSessionContinuationRuntime } from "./session-continuation-runtime.js";
import { LocalSessionPresentationRuntime } from "./session-presentation-runtime.js";
import { LocalRunFailureRuntime } from "./run-failure-runtime.js";
import { LocalRunLifecycleRuntime } from "./run-lifecycle-runtime.js";
import { LocalPendingSessionContextRuntime } from "./pending-session-context-runtime.js";
import { LocalRunRecoveryRuntime } from "./run-recovery-runtime.js";
import { LocalLegacyHandoffRecoveryRuntime } from "./legacy-handoff-recovery-runtime.js";
import { LocalStartupRecoveryRuntime } from "./startup-recovery-runtime.js";
import { LocalStartupRecoveryWiring } from "./startup-recovery-wiring.js";
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
import { LocalActiveRunRegistry } from "./active-run-registry.js";
import { LocalWorkerPreparationRuntime } from "./worker-preparation-runtime.js";
import { LocalWorkerProviderRuntime } from "./worker-provider-runtime.js";
import { LocalWorkerTerminalRuntime } from "./worker-terminal-runtime.js";
import { LocalWorkerExecutionRuntime } from "./worker-execution-runtime.js";
import { createLocalWorkerWiring } from "./worker-wiring.js";
import { LocalPrimaryPreparationRuntime } from "./primary-preparation-runtime.js";
import { createLocalPrimaryPreparationPorts } from "./primary-preparation-wiring.js";
import { LocalPrimaryProviderRuntime } from "./primary-provider-runtime.js";
import { createLocalPrimaryProviderPorts } from "./primary-provider-wiring.js";
import { LocalPrimaryAnalysisRuntime } from "./primary-analysis-runtime.js";
import { createLocalPrimaryAnalysisPorts } from "./primary-analysis-wiring.js";
import { LocalPrimaryTerminalRuntime } from "./primary-terminal-runtime.js";
import { createLocalPrimaryTerminalPorts } from "./primary-terminal-wiring.js";
import { LocalPrimaryDispatchRuntime } from "./primary-dispatch-runtime.js";
import { createLocalPrimaryDispatchPorts } from "./primary-dispatch-wiring.js";
import { LocalPrimaryExecutionRuntime } from "./primary-execution-runtime.js";
import { createLocalPrimaryExecutionPorts } from "./primary-execution-wiring.js";
import { LocalPendingProcessingRuntime } from "./pending-processing-runtime.js";
import {
  assertTextFragments,
  buildFallbackProjectSummary,
  formatLocalError,
  isPendingDispatchMessage,
  isPendingPrimaryMessage,
  isVisibleTimelineMessage,
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
import {
  LocalConsoleStorePorts,
  type LocalSessionFactWritingStore,
} from "./runtime-store-ports.js";
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
  type LocalCodexResumeIntentFact,
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
  buildSessionAnalysisReadOnlyContract,
} from "./session-analysis-gate.js";
import { LocalConsoleRuntimeFacade } from "./runtime-facade.js";
import type { LocalConsoleRuntimeOptions } from "./runtime-contracts.js";
export type { LocalConsoleRuntimeOptions } from "./runtime-contracts.js";

export class LocalConsoleRuntime extends LocalConsoleRuntimeFacade {
  private readonly sessionId: string;
  private readonly storeTimeoutMs: number;
  private readonly codexIdleTimeoutMs?: number;
  private readonly toolInFlightTimeoutMs?: number;
  private readonly codexMaxDurationMs?: number;
  private readonly routeTimeoutMs?: number;
  private readonly staleRunningGraceMs: number;
  private readonly now: () => Date;
  private readonly executionRunner: LocalExecutionRunner;
  private readonly storePorts: LocalConsoleStorePorts;
  private readonly activeRunRegistry = new LocalActiveRunRegistry();
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
  private readonly primaryDispatchRuntime: LocalPrimaryDispatchRuntime;
  private readonly primaryExecutionRuntime: LocalPrimaryExecutionRuntime;
  private readonly pendingProcessingRuntime: LocalPendingProcessingRuntime;
  private closing = false;
  private lastError: string | null = null;

  constructor(private readonly options: LocalConsoleRuntimeOptions) {
    super();
    this.sessionId = options.sessionId ?? LOCAL_CONSOLE_DEFAULT_SESSION_ID;
    this.storeTimeoutMs = options.storeTimeoutMs ?? 2_000;
    this.codexIdleTimeoutMs = options.codexIdleTimeoutMs;
    this.toolInFlightTimeoutMs = options.toolInFlightTimeoutMs;
    this.codexMaxDurationMs = options.codexMaxDurationMs;
    this.routeTimeoutMs = options.routeTimeoutMs;
    this.staleRunningGraceMs = options.staleRunningGraceMs ?? 5_000;
    this.now = options.now ?? (() => new Date());
    this.storePorts = new LocalConsoleStorePorts(options.store, this.storeTimeoutMs);
    this.executionRunner = options.runExecution ?? createLocalExecutionRunner({
      dataRoot: options.dataRoot ?? options.projectRoot,
      runCodex: options.runCodex,
    });
    this.conversationWorkspaceRuntime = new LocalConversationWorkspaceRuntime({
      store: options.store,
      storeCall: (label, operation) => this.storePorts.call(label, operation),
      baselineCommits: this.conversationBaselineCommits,
      workdirRoot: options.workdirRoot,
      ...(options.workspaceGitTimeoutMs === undefined ? {} : { gitTimeoutMs: options.workspaceGitTimeoutMs }),
      worktreePath: localSessionWorktreePath,
      readWorkspaceDiff: readLocalConversationWorkspaceDiff,
    });
    this.sessionContinuationRuntime = new LocalSessionContinuationRuntime({
      store: options.store,
      storeCall: (label, operation) => this.storePorts.call(label, operation),
      directoryAvailable,
      ...(options.resolveAgentTeamHealth === undefined
        ? {}
        : { resolveAgentTeamHealth: options.resolveAgentTeamHealth }),
    });
    this.sessionPresentationRuntime = new LocalSessionPresentationRuntime({
      store: options.store,
      storeCall: (label, operation) => this.storePorts.call(label, operation),
      nowIso: () => this.nowIso(),
      withAgentTeamHealth: (session) => this.sessionContinuationRuntime.withAgentTeamHealth(session),
      activeRuns: () => this.activeRunRegistry.values(),
      activeRunCount: (sessionId) => this.runLifecycleRuntime.runsForSession(sessionId).length,
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
      storeCall: (label, operation) => this.storePorts.call(label, operation),
      nowIso: () => this.nowIso(),
      timeoutKind: executionTimeoutKind,
      interrupted: isInterruptedCodexRunResult,
      interruptionCause: executionInterruptionCauseForResult,
      logTimeout: (input) => log(input),
      activeRun: (runId) => this.activeRunRegistry.get(runId),
      recordStuck: (message, sessionId, runId, runDir, reason, terminal) =>
        this.recordStuckBestEffort(message, sessionId, runId, runDir, reason, terminal),
      recordInterrupted: (message, sessionId, runId, runDir, reason, cause, terminal) =>
        this.recordInterruptedBestEffort(message, sessionId, runId, runDir, reason, cause, terminal),
      recordFailure: (message, sessionId, runId, runDir, reason, body, terminal) =>
        this.recordTerminalFailureBestEffort(message, sessionId, runId, runDir, reason, body, terminal),
      recordDetached: (input) => this.recordDetachedRunTerminal(input),
    });
    this.runLifecycleRuntime = new LocalRunLifecycleRuntime({
      activeRun: (runId) => this.activeRunRegistry.get(runId),
      activeRuns: () => this.activeRunRegistry.values(),
      lifecycleStore: () => this.storePorts.lifecycleFacts(),
      storeCall: (label, operation) => this.storePorts.call(label, operation),
      now: () => this.now(),
      nowIso: () => this.nowIso(),
      recordError: (error) => {
        this.lastError = formatLocalError(error);
      },
    });
    const workerWiring = createLocalWorkerWiring({
      options,
      storePorts: this.storePorts,
      executionRunner: this.executionRunner,
      activeRuns: this.activeRunRegistry,
      lifecycle: this.runLifecycleRuntime,
      idleTimeoutMs: this.codexIdleTimeoutMs,
      toolTimeoutMs: this.toolInFlightTimeoutMs,
      stopping: (sessionId) => this.closing || this.inactiveSessions.has(sessionId),
      now: () => this.now(),
      nowIso: () => this.nowIso(),
      nextRunId: (sessionId, messageId) => this.runRecoveryRuntime.targetForMessage(sessionId, messageId),
      recordMissingAgent: (message, sessionId, runId, role) =>
        this.recordTerminalFailureBestEffort(message, sessionId, runId, null, `Agent not found: ${role}`),
      scheduleRun: (input) => this.workerExecutionRuntime.run(input),
      continuableWorkspace: (sessionId) => this.sessionContinuationRuntime.continuableSessionWorkspace(sessionId),
      applyPendingContext: (sessionId) => this.pendingSessionContextRuntime.applyWhenIdle(sessionId),
      processPending: (sessionId) => { void this.processPending(sessionId); },
      recordError: (error) => {
        this.lastError = formatLocalError(error);
        return this.lastError;
      },
      report: (event, sessionId, role, error) =>
        log({ event, sessionId, ...(role === null ? {} : { role }), error }),
      releaseClaim: (message, sessionId) =>
        this.releaseClaimedUserDirectMessageWhenStopping(message, sessionId).then(() => undefined),
      sessionSummary: (sessionId) => this.sessionContinuationRuntime.sessionSummary(sessionId),
      makeRunDir: (messageCount) => path.resolve(options.makeRunDir(messageCount, this.now())),
      resolveWorkspace: (sessionId, source, signal) => this.resolveWorkspace(sessionId, source, signal),
      readAgentFile: (agent) => fs.readFile(requireAgentFilePath(agent), "utf8"),
      loadRecoverySnapshot: (sessionId) => readLocalRunRecoverySnapshot({
        factLogPath: this.storePorts.recoveryFacts()?.getSessionFactLogPath(sessionId) ?? null,
        sessionId,
      }),
      isCodexThreadAvailable: options.isCodexThreadAvailable ?? defaultCodexThreadAvailability,
      settleUnavailable: ({ sessionId, runId, sourceMessage, role, runDir, unavailable }) =>
        this.runRecoveryRuntime.settleUnavailable({
          sessionId,
          runId,
          sourceMessage,
          intent: unavailable.intent,
          role,
          engine: unavailable.context.engine,
          reason: unavailable.reason,
          runDir,
        }),
      classifyFailure: (result) => ({
        runtimeClosing: executionInterruptionCauseForResult(result) === "runtime-closing",
        failureStatus: runTimingStatusForFailedResult(result),
      }),
      recordDirectFailure: (input, result) =>
        this.runFailureRuntime.recordDirect(input.sourceMessage, input.sessionId, input.runId, result),
      recordDetachedFailure: (input, result) =>
        this.runFailureRuntime.recordDetached(input.sessionId, input.runId, result),
      sourceDirectoryAvailable: (sessionId) =>
        this.sessionContinuationRuntime.sessionProjectDirectoryAvailable(sessionId),
      executeChildSession: (input, _runDir, result) => this.executeLocalCeoChildSessionOrchestrationIfNeeded({
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
      formatError: (error) => formatLocalError(error),
      setError: (error) => { this.lastError = error; },
      recordDirectStartFailure: (input, runDir, error) =>
        this.recordTerminalFailureBestEffort(input.sourceMessage, input.sessionId, input.runId, runDir, error),
      recordDetachedStartFailure: (input, runDir, error) => this.recordDetachedRunTerminal({
        sessionId: input.sessionId,
        body: "这一步没跑起来。你可以直接告诉主理人下一步怎么处理。",
        systemEventKind: "run-not-started",
        runId: input.runId,
        runDir,
        error,
        status: "failed",
      }),
      invalidateWorkspace: (cwd) => invalidateLocalWorkspaceFacts(cwd),
    });
    this.workerDispatchRuntime = new LocalWorkerDispatchRuntime(workerWiring.dispatch);
    this.workerPreparationRuntime = new LocalWorkerPreparationRuntime(workerWiring.preparation);
    this.workerProviderRuntime = new LocalWorkerProviderRuntime(workerWiring.provider);
    this.workerTerminalRuntime = new LocalWorkerTerminalRuntime(workerWiring.terminal);
    this.workerExecutionRuntime = new LocalWorkerExecutionRuntime(workerWiring.execution({
      preparation: this.workerPreparationRuntime,
      provider: this.workerProviderRuntime,
      terminal: this.workerTerminalRuntime,
    }));
    this.primaryPreparationRuntime = new LocalPrimaryPreparationRuntime(createLocalPrimaryPreparationPorts({
      options,
      storePorts: this.storePorts,
      activeRuns: this.activeRunRegistry,
      lifecycle: this.runLifecycleRuntime,
      nowIso: () => this.nowIso(),
      inactive: (sessionId) => this.inactiveSessions.has(sessionId),
      readAgentFile: (agent) => fs.readFile(requireAgentFilePath(agent), "utf8"),
      makeRunDir: (messageCount) => {
        const providerRunDir = options.makeRunDir(messageCount, this.now());
        return { providerRunDir, resolvedRunDir: path.resolve(providerRunDir) };
      },
      resolveWorkspace: (sessionId, source, signal) => this.resolveWorkspace(sessionId, source, signal),
      concurrentRecoveryWorkspace: (sessionId) => this.concurrentAgentHandoffRecoveryWorkspace(sessionId),
      buildAnalysisContract: (proposalVersion) => buildSessionAnalysisReadOnlyContract(proposalVersion),
      loadRecoverySnapshot: (sessionId) => readLocalRunRecoverySnapshot({
        factLogPath: this.storePorts.recoveryFacts()?.getSessionFactLogPath(sessionId) ?? null,
        sessionId,
      }),
      isCodexThreadAvailable: options.isCodexThreadAvailable ?? defaultCodexThreadAvailability,
      settleUnavailable: ({ sessionId, runId, sourceMessage, role, runDir, unavailable }) =>
        this.runRecoveryRuntime.settleUnavailable({
          sessionId,
          runId,
          sourceMessage,
          intent: unavailable.intent,
          role,
          engine: unavailable.context.engine,
          reason: unavailable.reason,
          runDir,
        }),
    }));
    this.primaryProviderRuntime = new LocalPrimaryProviderRuntime(createLocalPrimaryProviderPorts({
      storePorts: this.storePorts,
      executionRunner: this.executionRunner,
      activeRuns: this.activeRunRegistry,
      lifecycle: this.runLifecycleRuntime,
      idleTimeoutMs: this.codexIdleTimeoutMs,
      toolTimeoutMs: this.toolInFlightTimeoutMs,
      nowIso: () => this.nowIso(),
    }));
    this.primaryAnalysisRuntime = new LocalPrimaryAnalysisRuntime(createLocalPrimaryAnalysisPorts({
      executionRunner: this.executionRunner,
      activeRuns: this.activeRunRegistry,
      lifecycle: this.runLifecycleRuntime,
      idleTimeoutMs: this.codexIdleTimeoutMs,
      toolTimeoutMs: this.toolInFlightTimeoutMs,
      updateGate: async (input) => { await this.updateSessionAnalysisGate(input); },
    }));
    this.primaryTerminalRuntime = new LocalPrimaryTerminalRuntime(createLocalPrimaryTerminalPorts({
      store: options.store,
      storePorts: this.storePorts,
      activeRuns: this.activeRunRegistry,
      lifecycle: this.runLifecycleRuntime,
      nowIso: () => this.nowIso(),
      classifyFailure: (result) => ({
        runtimeClosing: executionInterruptionCauseForResult(result) === "runtime-closing",
        failureStatus: runTimingStatusForFailedResult(result),
      }),
      recordFailure: (run, result) =>
        this.runFailureRuntime.recordDirect(run.sourceMessage, run.sessionId, run.runId, result),
      sourceDirectoryAvailable: (sessionId) => this.sessionContinuationRuntime.sessionProjectDirectoryAvailable(sessionId),
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
      recordChildSessionCardError: async (sessionId, error) => {
        const reason = formatLocalError(error);
        this.lastError = reason;
        await this.recordVisibleChildSessionFailureBestEffort(sessionId, reason);
      },
    }));
    this.primaryDispatchRuntime = new LocalPrimaryDispatchRuntime(createLocalPrimaryDispatchPorts({
      options,
      storePorts: this.storePorts,
      agentsDir: path.join(options.projectRoot, "agents"),
      routeTimeoutMs: this.routeTimeoutMs,
      now: () => this.now(),
      nowIso: () => this.nowIso(),
      inactive: (sessionId) => this.inactiveSessions.has(sessionId),
      gracefulResumeTargets: (sessionId) => this.runRecoveryRuntime.targetsForClaim(sessionId),
      sessionSummary: (sessionId) => this.sessionContinuationRuntime.sessionSummary(sessionId),
      readRecoveryFacts: readLocalCodexRecoveryFacts,
      recordTerminalFailure: (message, sessionId, runId, runDir, reason) =>
        this.recordTerminalFailureBestEffort(message, sessionId, runId, runDir, reason),
      setError: (error) => { this.lastError = error; },
      scheduleWorker: (input) => this.workerDispatchRuntime.schedule(input),
    }));
    this.primaryExecutionRuntime = new LocalPrimaryExecutionRuntime(createLocalPrimaryExecutionPorts({
      dispatch: this.primaryDispatchRuntime,
      preparation: this.primaryPreparationRuntime,
      provider: this.primaryProviderRuntime,
      analysis: this.primaryAnalysisRuntime,
      terminal: this.primaryTerminalRuntime,
      activeRuns: this.activeRunRegistry,
      lifecycle: this.runLifecycleRuntime,
      formatError: (error) => formatLocalError(error),
      setError: (error) => { this.lastError = error; },
      report: (event, error) => log({ event, error }),
      recordFailure: (message, sessionId, runId, runDir, error) =>
        this.recordTerminalFailureBestEffort(message, sessionId, runId, runDir, error),
      applyPendingContext: (sessionId) => this.pendingSessionContextRuntime.applyWhenIdle(sessionId),
      invalidateWorkspace: (cwd) => invalidateLocalWorkspaceFacts(cwd),
    }));
    this.pendingProcessingRuntime = new LocalPendingProcessingRuntime({
      stopping: (sessionId) => this.closing || this.inactiveSessions.has(sessionId),
      repairStale: async (sessionId) => { await this.repairStaleRunning(sessionId); },
      applyPendingContext: (sessionId) => this.pendingSessionContextRuntime.applyWhenIdle(sessionId),
      continuableWorkspace: (sessionId) => this.sessionContinuationRuntime.continuableSessionWorkspace(sessionId),
      dispatchWorkers: (sessionId, workspace) => this.workerDispatchRuntime.dispatch(sessionId, workspace),
      hasPersistedPrimary: (sessionId) => this.hasPersistedPrimaryRun(sessionId),
      executePrimary: (sessionId, workspace) => this.primaryExecutionRuntime.run(sessionId, workspace),
      listSessions: () => this.storePorts.call("local-console-store-list-sessions", () => options.store.listSessions()),
      formatError: (error) => formatLocalError(error),
      setError: (error) => { this.lastError = error; },
      report: (event, error) => log({ event, error }),
    });
    this.pendingSessionContextRuntime = new LocalPendingSessionContextRuntime({
      store: options.store,
      storeCall: (label, operation) => this.storePorts.call(label, operation),
      nowIso: () => this.nowIso(),
      hasActiveRun: (sessionId) => this.runLifecycleRuntime.runsForSession(sessionId).length > 0,
      hasScheduledWorker: (sessionId) => this.workerDispatchRuntime.hasScheduledWorker(sessionId),
      listAgentNames: async (sessionId) =>
        (await options.listAgentFiles(sessionId)).map((agent) => agent.name),
    });
    this.runRecoveryRuntime = new LocalRunRecoveryRuntime({
      store: options.store,
      storeCall: (label, operation) => this.storePorts.call(label, operation),
      nowIso: () => this.nowIso(),
      recoveryStore: () => this.storePorts.recoveryFacts(),
      requireRecoveryStore: () => this.storePorts.requireRecoveryFacts(),
      lifecycleStore: () => this.storePorts.lifecycleFacts(),
      readRecoveryFacts: readLocalCodexRecoveryFacts,
    });
    this.projectCommandRuntime = new LocalProjectCommandRuntime({
      store: options.store,
      storeCall: (label, operation) => this.storePorts.call(label, operation),
      nowIso: () => this.nowIso(),
      assertDirectoryAvailable: (projectId) => this.sessionContinuationRuntime.assertProjectDirectoryAvailable(projectId),
      withDirectoryAvailability: (project, knownAvailable) =>
        this.sessionContinuationRuntime.withDirectoryAvailability(project, knownAvailable),
      processPending: (sessionId) => void this.processPending(sessionId),
      activeRunsForSession: (sessionId) =>
        this.runLifecycleRuntime.runsForSession(sessionId) as ActiveLocalRun[],
      inactiveSessions: this.inactiveSessions,
      resolvePath: path.resolve,
      directoryAvailable,
    });
    this.sessionCreationRuntime = new LocalSessionCreationRuntime({
      store: options.store,
      storeCall: (label, operation) => this.storePorts.call(label, operation),
      createSessionId: () => `local:${this.now().toISOString()}-${Math.random().toString(36).slice(2, 8)}`,
      nowIso: () => this.nowIso(),
      resolveProjectId: async (projectId) => projectId ?? (await this.sessionContinuationRuntime.defaultProjectId()),
      assertProjectDirectoryAvailable: (projectId) => this.sessionContinuationRuntime.assertProjectDirectoryAvailable(projectId),
      storedProject: (projectId) => this.sessionContinuationRuntime.storedProject(projectId),
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
      storeCall: (label, operation) => this.storePorts.call(label, operation),
      nowIso: () => this.nowIso(),
      ...(options.loadAgentTeamSnapshot === undefined
        ? {}
        : { loadAgentTeamSnapshot: options.loadAgentTeamSnapshot }),
      ...(options.workspaceGitTimeoutMs === undefined ? {} : { workspaceGitTimeoutMs: options.workspaceGitTimeoutMs }),
      hasActiveRun: (sessionId) => this.runLifecycleRuntime.runsForSession(sessionId).length > 0,
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
      storeCall: (label, operation) => this.storePorts.call(label, operation),
      randomId: () => crypto.randomUUID(),
    });
    this.stateQueryRuntime = new LocalConsoleStateQueryRuntime({
      store: options.store,
      storeCall: (label, operation) => this.storePorts.call(label, operation),
      defaultSessionId: this.sessionId,
      projectRoot: options.projectRoot,
      lastError: () => this.lastError,
      withDirectoryAvailability: (project) => this.sessionContinuationRuntime.withDirectoryAvailability(project),
      withSessionWorkspaceContext: (project) => this.sessionPresentationRuntime.withSessionWorkspaceContext(project),
      withRuntimeActivity: (project) => this.sessionPresentationRuntime.withRuntimeActivity(project),
      synchronizeNonContinuableRecords: (projects) => this.sessionPresentationRuntime.synchronizeNonContinuableRecords(projects),
      stopUnsafeRunsWithUnavailableContext: (projects) => this.sessionPresentationRuntime.stopUnsafeRunsWithUnavailableContext(projects),
      primaryRunId: (sessionId) => this.runLifecycleRuntime.runForLane(sessionId, "primary")?.runId ?? null,
      activeRunSnapshots: (sessionId) => this.runLifecycleRuntime.snapshots(sessionId),
      listChildSessions: (parentSessionId) => this.storePorts.call("local-console-store-list-child-sessions", () =>
        listLocalChildSessionSummaries({
          sqlitePath: options.store.sqlitePath,
          timeoutMs: this.storeTimeoutMs,
        }, parentSessionId)),
      readWorkspaceDiff: (sessionId) => this.conversationWorkspaceRuntime.readDiff(sessionId),
      loadTeamSnapshot: (sessionId) =>
        options.store.listSessionAgentTeamSnapshot?.(sessionId) ?? Promise.resolve(null),
    });
    this.runOutputRuntime = new LocalConsoleRunOutputRuntime({
      store: options.store,
      storeCall: (label, operation) => this.storePorts.call(label, operation),
      activeRun: (runId) => this.activeRunRegistry.get(runId),
      activeRunIds: (sessionId) => new Set(this.runLifecycleRuntime.runsForSession(sessionId).map((run) => run.runId)),
      readOptionalTextFile,
      sessionFactLogPath: (sessionId) => {
        const store = options.store as LocalConsoleStore
          & Partial<Pick<LocalSessionFactWritingStore, "getSessionFactLogPath">>;
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
      readContext: (sessionId) => this.conversationWorkspaceRuntime.readContext(sessionId),
      readWorkspaceMode: (sessionId) => this.conversationWorkspaceRuntime.readModeBestEffort(sessionId),
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
      storeCall: (label, operation) => this.storePorts.call(label, operation),
      assertProjectDirectoryAvailable: (projectId) => this.sessionContinuationRuntime.assertProjectDirectoryAvailable(projectId),
      createChildSession: (input) => this.storePorts.sessionFacts().createChildSession(input),
      recordVisibleChildFailure: (parentSessionId, reason) =>
        this.recordVisibleChildSessionFailureBestEffort(parentSessionId, reason),
      setLastError: (error) => { this.lastError = error; },
      sessionFactLogPath: (sessionId) => {
        const store = options.store as LocalConsoleStore
          & Partial<Pick<LocalSessionFactWritingStore, "getSessionFactLogPath">>;
        const getSessionFactLogPath = store.getSessionFactLogPath;
        if (getSessionFactLogPath === undefined) {
          throw new Error("local console store does not provide the session fact log path");
        }
        return getSessionFactLogPath.call(store, sessionId);
      },
      interruptRun: ({ sessionId, runId }) => {
        const active = this.activeRunRegistry.get(runId);
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
      assertSessionCanContinue: (sessionId) => this.sessionContinuationRuntime.assertSessionCanContinue(sessionId),
      hasActivePrimary: (sessionId) => this.runLifecycleRuntime.runForLane(sessionId, "primary") !== undefined,
      hasPersistedPrimary: (sessionId) => this.hasPersistedPrimaryRun(sessionId),
      sessionSummary: (sessionId) => this.sessionContinuationRuntime.sessionSummary(sessionId),
      resolveDispatch: (sessionId, body) => this.resolveUserMessageDispatch(sessionId, body),
      appendUserMessage: (input) => options.store.appendUserMessage({ ...input, textFragments: [] }),
      resolveResumeLink: async (sessionId, runId) => {
        const recoveryStore = this.storePorts.recoveryFacts();
        if (recoveryStore === null) return undefined;
        const factLogPath = recoveryStore.getSessionFactLogPath(sessionId);
        const [executionLinks, codexLinks] = await Promise.all([
          readExecutionSessionLinks(factLogPath, sessionId),
          readCodexThreadLinks(factLogPath, sessionId),
        ]);
        return executionLinks.find((candidate) => candidate.runId === runId)
          ?? codexLinks.find((candidate) => candidate.runId === runId);
      },
      recordEditResume: (input) => this.storePorts.requireRecoveryFacts().recordCodexResumeIntent({
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
      storeCall: (label, operation) => this.storePorts.call(label, operation),
      setLastError: (error) => { this.lastError = error; },
      schedulePendingProcessing: (sessionId) => this.pendingProcessingRuntime.schedule(sessionId),
    });
    this.runRetryRuntime = new LocalConsoleRunRetryRuntime({
      nowIso: () => this.nowIso(),
      randomId: () => crypto.randomUUID(),
      assertSessionCanContinue: (sessionId) => this.sessionContinuationRuntime.assertSessionCanContinue(sessionId),
      listMessages: (sessionId) => this.storePorts.call("local-console-store-list-retry-source", () =>
        options.store.listMessages(sessionId)),
      loadRecoveryBundle: async (sessionId) => {
        const recoveryStore = this.storePorts.recoveryFacts();
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
      activeRunForRole: (sessionId, role) => this.runLifecycleRuntime.runForRole(sessionId, role) !== undefined,
      recordRetryIntent: (input) => this.storePorts.requireRecoveryFacts().recordCodexResumeIntent(input),
      releaseMessageForRetry: (input) => options.store.releaseMessageForRetry(input),
      processAfterCurrent: (sessionId) => { void this.pendingProcessingRuntime.processAfterCurrent(sessionId); },
      storeCall: (label, operation) => this.storePorts.call(label, operation),
    });
    const startupRecoveryWiring = new LocalStartupRecoveryWiring({
      store: options.store,
      defaultSessionId: this.sessionId,
      storeCall: (label, operation) => this.storePorts.call(label, operation),
      now: () => this.now(),
      nowIso: () => this.nowIso(),
      idleTimeoutMs: this.codexIdleTimeoutMs,
      maxDurationMs: this.codexMaxDurationMs,
      staleGraceMs: this.staleRunningGraceMs,
      recoveryStore: () => this.storePorts.recoveryFacts(),
      readRecoveryFacts: readLocalCodexRecoveryFacts,
      readRunContexts: readRunExecutionContexts,
      activeRunIds: () => new Set(this.activeRunRegistry.keys()),
      activeSessionIds: () => new Set([...this.activeRunRegistry.values()].map((active) => active.sessionId)),
      recordError: (error) => {
        const formatted = formatLocalError(error);
        this.lastError = formatted;
        return formatted;
      },
      report: (input) => log(input),
    });
    const legacyHandoffRecoveryRuntime = new LocalLegacyHandoffRecoveryRuntime(startupRecoveryWiring.legacy());
    this.startupRecoveryRuntime = new LocalStartupRecoveryRuntime(
      startupRecoveryWiring.startup(legacyHandoffRecoveryRuntime),
    );
    this.bindFacade({
      defaultSessionId: () => this.sessionId,
      projects: this.projectCommandRuntime,
      sessions: this.sessionCreationRuntime,
      settings: this.sessionSettingsRuntime,
      references: this.sessionReferenceRuntime,
      metadata: this.sessionMetadataRuntime,
      messages: this.messageCommandRuntime,
      retries: this.runRetryRuntime,
      state: this.stateQueryRuntime,
      output: this.runOutputRuntime,
      workspace: this.workspaceQueryRuntime,
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
    this.pendingProcessingRuntime.beginClosing();
    for (const active of [...this.activeRunRegistry.values()]) {
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
            const recoveryStore = this.storePorts.requireRecoveryFacts();
            await this.storePorts.call("local-console-store-record-graceful-resume", () =>
              recoveryStore.recordCodexResumeIntent(intent));
            const releaseMessageForResume = this.options.store.releaseMessageForResume;
            if (releaseMessageForResume === undefined) {
              throw new Error("local console graceful resume persistence capability unavailable");
            }
            await this.storePorts.call("local-console-store-release-graceful-resume", () =>
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
        this.pendingProcessingRuntime.hasOutstandingWork()
        || this.workerDispatchRuntime.hasOutstandingWork()
      )
      && Date.now() < processingDeadline
    ) {
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    await this.options.store.close();
  }

  async processPending(sessionId = this.sessionId): Promise<void> {
    await this.pendingProcessingRuntime.process(sessionId);
  }

  async processAllPending(): Promise<void> {
    await this.pendingProcessingRuntime.processAll();
  }

  private async updateSessionAnalysisGate(input: {
    sessionId: string;
    proposalVersion: string | null;
    writeLeaseVersion: string | null;
  }): Promise<LocalConsoleSessionSummary> {
    if (this.options.store.updateSessionAnalysisGate === undefined) {
      throw new Error("local console analysis gate persistence unavailable");
    }
    return await this.storePorts.call("local-console-store-update-analysis-gate", () =>
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
    await this.storePorts.call("local-console-store-release-stopped-worker-claim", () =>
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
    const messages = await this.storePorts.call("local-console-store-list-primary-running", () =>
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
    await this.storePorts.call("local-console-store-record-workspace", () =>
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
    const candidates = [...this.activeRunRegistry.values()].filter((active) =>
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

  private async recordNoTrigger(message: LocalConsoleMessage, sessionId: string, runId: string): Promise<void> {
    if (message.speaker === "agent") {
      await this.storePorts.call("local-console-store-no-trigger-agent", () =>
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
    await this.storePorts.call("local-console-store-no-trigger", () =>
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
      await this.storePorts.call("local-console-store-release-retry", () =>
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
      await this.storePorts.call("local-console-store-record-failure", () =>
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
      await this.storePorts.call("local-console-store-record-interrupted", () =>
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
      await this.storePorts.call("local-console-store-record-stuck", () =>
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
      await this.storePorts.call("local-console-store-child-session-failure", () =>
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

    const workspace = await this.storePorts.call("local-console-store-session-workspace", () => this.options.store.getSessionWorkspace(input.sessionId));
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
      await this.storePorts.call("local-console-store-record-workspace-diff", () =>
        this.storePorts.sessionFacts().recordWorkspaceDiff({
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
      await this.storePorts.sessionFacts().recordWorkspaceDiff({
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
