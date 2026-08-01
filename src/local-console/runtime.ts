import fs from "node:fs/promises";
import crypto from "node:crypto";
import path from "node:path";
import { loadCeoScripts } from "../ceo-scripts.js";
import {
  type CodexRunOptions,
  type CodexRunResult,
  executionInterruptionCauseForResult,
  executionTimeoutKind,
  isInterruptedCodexRunResult,
} from "../codex.js";
import { log } from "../log.js";
import { listLocalChildSessionSummaries } from "./child-session-summary-reader.js";
import type { LocalAttachmentManager } from "./attachments.js";
import { deriveSessionTitle } from "./title.js";
import {
  LOCAL_CONSOLE_DEFAULT_SESSION_ID,
  LOCAL_CONSOLE_PROJECT_ID,
  LocalConsoleProjectFolderError,
  type LocalConsoleFileContent,
  type LocalConsoleProjectFiles,
  type LocalConsoleProjectSummary,
  type LocalConsoleProjectRemovalResult,
  LocalConsoleProjectRunningError,
  type LocalConsoleSessionArchiveResult,
  LocalConsoleSessionRunningError,
  LocalConsoleSessionWorkspaceLockedError,
  type LocalConsoleRunOutput,
  type LocalConsoleSessionSearchResult,
  type LocalConsoleSessionReferenceText,
  type LocalConsoleSessionReferenceScope,
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
import { createLocalSessionCommandWiring } from "./session-command-wiring.js";
import { LocalConsoleStateQueryRuntime } from "./state-query-runtime.js";
import { LocalConsoleRunOutputRuntime } from "./run-output-runtime.js";
import { LocalConsoleWorkspaceQueryRuntime } from "./workspace-query-runtime.js";
import { createLocalSessionReadWiring } from "./session-read-wiring.js";
import { LocalConsoleSessionMetadataRuntime } from "./session-metadata-runtime.js";
import { createLocalSessionMetadataWiring } from "./session-metadata-wiring.js";
import { LocalConsoleMessageCommandRuntime } from "./message-command-runtime.js";
import { createLocalMessageRetryWiring } from "./message-retry-wiring.js";
import { LocalConsoleRunRetryRuntime } from "./run-retry-runtime.js";
import {
  LocalWorkerDispatchRuntime,
} from "./worker-dispatch-runtime.js";
import type { LocalConsoleAgentFile } from "./agent-file.js";
export type { LocalConsoleAgentFile } from "./agent-file.js";
import { LocalActiveRunRegistry } from "./active-run-registry.js";
import { LocalWorkerPreparationRuntime } from "./worker-preparation-runtime.js";
import { LocalWorkerProviderRuntime } from "./worker-provider-runtime.js";
import { LocalWorkerTerminalRuntime } from "./worker-terminal-runtime.js";
import { LocalWorkerExecutionRuntime } from "./worker-execution-runtime.js";
import { createLocalWorkerWiring } from "./worker-wiring.js";
import { createLocalSharedRunPorts } from "./shared-run-wiring.js";
import { createLocalRuntimeWiringContext } from "./runtime-wiring-context.js";
import { createLocalRuntimeFoundationWiring } from "./runtime-foundation-wiring.js";
import { LocalRuntimeShutdownRuntime } from "./runtime-shutdown-runtime.js";
import { LocalPrimaryPreparationRuntime } from "./primary-preparation-runtime.js";
import { LocalPrimaryProviderRuntime } from "./primary-provider-runtime.js";
import { LocalPrimaryAnalysisRuntime } from "./primary-analysis-runtime.js";
import { LocalPrimaryTerminalRuntime } from "./primary-terminal-runtime.js";
import { LocalPrimaryDispatchRuntime } from "./primary-dispatch-runtime.js";
import { LocalPrimaryExecutionRuntime } from "./primary-execution-runtime.js";
import { createLocalPrimaryWiring } from "./primary-wiring.js";
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
  private readonly shutdownRuntime: LocalRuntimeShutdownRuntime;
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
    const runtimeContext = createLocalRuntimeWiringContext({
      storePorts: this.storePorts,
      now: () => this.now(),
      stopping: (sessionId) => this.closing || this.inactiveSessions.has(sessionId),
      setError: (error) => { this.lastError = error; },
    });
    const foundationWiring = createLocalRuntimeFoundationWiring({
      context: runtimeContext,
      options,
      activeRuns: this.activeRunRegistry,
      baselineCommits: this.conversationBaselineCommits,
      worktreePath: localSessionWorktreePath,
      readWorkspaceDiff: readLocalConversationWorkspaceDiff,
      readGitStatus: readLocalGitStatus,
      generateWorkspaceDiff: generateLocalWorkspaceDiff,
      resolveWorkspaceSource: resolveLocalWorkspaceSource,
      directoryAvailable,
      fileAvailable,
      readWorkspaceFacts: async (folderPath) => await readCachedLocalWorkspaceFacts({
        folderPath,
        gitTimeoutMs: options.workspaceGitTimeoutMs,
      }),
      readRecoveryFacts: readLocalCodexRecoveryFacts,
      timeoutKind: executionTimeoutKind,
      interrupted: isInterruptedCodexRunResult,
      interruptionCause: executionInterruptionCauseForResult,
      getSessionFactLogPath: (sessionId) => this.getSessionFactLogPath(sessionId),
      hasScheduledWorker: (sessionId) => this.workerDispatchRuntime.hasScheduledWorker(sessionId),
      report: (input) => log(input),
    });
    this.conversationWorkspaceRuntime = new LocalConversationWorkspaceRuntime(foundationWiring.conversation);
    this.sessionContinuationRuntime = new LocalSessionContinuationRuntime(foundationWiring.continuation);
    this.runFailureRuntime = new LocalRunFailureRuntime(foundationWiring.failure);
    this.runLifecycleRuntime = new LocalRunLifecycleRuntime(foundationWiring.lifecycle);
    this.sessionPresentationRuntime = new LocalSessionPresentationRuntime(
      foundationWiring.presentation(this.sessionContinuationRuntime, this.runLifecycleRuntime),
    );
    this.pendingSessionContextRuntime = new LocalPendingSessionContextRuntime(
      foundationWiring.pendingContext(this.runLifecycleRuntime),
    );
    this.runRecoveryRuntime = new LocalRunRecoveryRuntime(foundationWiring.recovery);
    const sharedRunPorts = createLocalSharedRunPorts({
      storePorts: this.storePorts,
      executionRunner: this.executionRunner,
      activeRuns: this.activeRunRegistry,
      lifecycle: this.runLifecycleRuntime,
      idleTimeoutMs: this.codexIdleTimeoutMs,
      toolTimeoutMs: this.toolInFlightTimeoutMs,
      now: () => this.now(),
      nowIso: () => this.nowIso(),
      resolveWorkspace: (sessionId, source, signal) =>
        this.conversationWorkspaceRuntime.resolveSource(sessionId, source, signal),
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
    });
    const workerWiring = createLocalWorkerWiring({
      context: runtimeContext,
      options,
      ...sharedRunPorts,
      recovery: this.runRecoveryRuntime,
      continuation: this.sessionContinuationRuntime,
      pendingContext: this.pendingSessionContextRuntime,
      failure: this.runFailureRuntime,
      workspace: this.conversationWorkspaceRuntime,
      scheduleRun: (input) => this.workerExecutionRuntime.run(input),
      processPending: (sessionId) => { void this.processPending(sessionId); },
      report: (event, sessionId, role, error) =>
        log({ event, sessionId, ...(role === null ? {} : { role }), error }),
      classifyFailure: (result) => ({
        runtimeClosing: executionInterruptionCauseForResult(result) === "runtime-closing",
        failureStatus: runTimingStatusForFailedResult(result),
      }),
      executeChildSession: (input, _runDir, result) => this.sessionMetadataRuntime.executeChildOrchestration({
        sessionId: input.sessionId,
        runId: input.runId,
        runDir: result.runDir,
        finalText: result.finalText,
        availableAgentNames: input.agentFiles.map((agent) => agent.name),
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
    const primaryWiring = createLocalPrimaryWiring({
      context: runtimeContext,
      options,
      ...sharedRunPorts,
      routeTimeoutMs: this.routeTimeoutMs,
      recovery: this.runRecoveryRuntime,
      continuation: this.sessionContinuationRuntime,
      pendingContext: this.pendingSessionContextRuntime,
      failure: this.runFailureRuntime,
      workspace: this.conversationWorkspaceRuntime,
      readRecoveryFacts: readLocalCodexRecoveryFacts,
      classifyFailure: (result) => ({
        runtimeClosing: executionInterruptionCauseForResult(result) === "runtime-closing",
        failureStatus: runTimingStatusForFailedResult(result),
      }),
      executeChildSession: (run, result) => this.sessionMetadataRuntime.executeChildOrchestration({
        sessionId: run.sessionId,
        runId: run.runId,
        runDir: result.runDir,
        finalText: result.finalText,
        availableAgentNames: run.agentFiles.map((agent) => agent.name),
      }),
      recordChildSessionCardError: async (sessionId, error) => {
        const reason = formatLocalError(error);
        this.lastError = reason;
        await this.sessionMetadataRuntime.recordVisibleChildFailure(sessionId, reason);
      },
      scheduleWorker: (input) => this.workerDispatchRuntime.schedule(input),
      report: (event, error) => log({ event, error }),
      invalidateWorkspace: (cwd) => invalidateLocalWorkspaceFacts(cwd),
    });
    this.primaryPreparationRuntime = new LocalPrimaryPreparationRuntime(primaryWiring.preparation);
    this.primaryProviderRuntime = new LocalPrimaryProviderRuntime(primaryWiring.provider);
    this.primaryAnalysisRuntime = new LocalPrimaryAnalysisRuntime(primaryWiring.analysis);
    this.primaryTerminalRuntime = new LocalPrimaryTerminalRuntime(primaryWiring.terminal);
    this.primaryDispatchRuntime = new LocalPrimaryDispatchRuntime(primaryWiring.dispatch);
    this.primaryExecutionRuntime = new LocalPrimaryExecutionRuntime(primaryWiring.execution({
      dispatch: this.primaryDispatchRuntime,
      preparation: this.primaryPreparationRuntime,
      provider: this.primaryProviderRuntime,
      analysis: this.primaryAnalysisRuntime,
      terminal: this.primaryTerminalRuntime,
    }));
    const messageRetryWiring = createLocalMessageRetryWiring({
      context: runtimeContext,
      options,
      defaultSessionId: this.sessionId,
      lifecycle: this.runLifecycleRuntime,
      continuation: this.sessionContinuationRuntime,
      randomId: () => crypto.randomUUID(),
      scheduleWorkerWake: (sessionId) => this.workerDispatchRuntime.scheduleWake(sessionId),
      processPending: (sessionId) => { void this.processPending(sessionId); },
      schedulePendingProcessing: (sessionId) => this.pendingProcessingRuntime.schedule(sessionId),
      processAfterCurrent: (sessionId) => { void this.pendingProcessingRuntime.processAfterCurrent(sessionId); },
      readExecutionSessionLinks,
      readCodexThreadLinks,
      readRunExecutionContexts,
      readRecoveryFacts: readLocalCodexRecoveryFacts,
    });
    this.pendingProcessingRuntime = new LocalPendingProcessingRuntime({
      stopping: (sessionId) => this.closing || this.inactiveSessions.has(sessionId),
      repairStale: async (sessionId) => { await this.repairStaleRunning(sessionId); },
      applyPendingContext: (sessionId) => this.pendingSessionContextRuntime.applyWhenIdle(sessionId),
      continuableWorkspace: (sessionId) => this.sessionContinuationRuntime.continuableSessionWorkspace(sessionId),
      dispatchWorkers: (sessionId, workspace) => this.workerDispatchRuntime.dispatch(sessionId, workspace),
      hasPersistedPrimary: messageRetryWiring.hasPersistedPrimary,
      executePrimary: (sessionId, workspace) => this.primaryExecutionRuntime.run(sessionId, workspace),
      listSessions: () => this.storePorts.call("local-console-store-list-sessions", () => options.store.listSessions()),
      formatError: (error) => formatLocalError(error),
      setError: (error) => { this.lastError = error; },
      report: (event, error) => log({ event, error }),
    });
    const sessionCommandWiring = createLocalSessionCommandWiring({
      options,
      context: runtimeContext,
      activeRuns: this.activeRunRegistry,
      lifecycle: this.runLifecycleRuntime,
      continuation: this.sessionContinuationRuntime,
      inactiveSessions: this.inactiveSessions,
      baselineCommits: this.conversationBaselineCommits,
      processPending: (sessionId) => { void this.processPending(sessionId); },
      directoryAvailable,
      readWorkspaceFacts: async (folderPath) => await readCachedLocalWorkspaceFacts({
        folderPath,
        gitTimeoutMs: options.workspaceGitTimeoutMs,
      }),
      readBaselineCommit: async (folderPath) => await readLocalConversationBaselineCommit({
        folderPath,
        gitTimeoutMs: options.workspaceGitTimeoutMs,
      }),
      invalidateWorkspaceFacts: invalidateLocalWorkspaceFacts,
      randomId: () => crypto.randomUUID(),
      logBaselineUnavailable: ({ projectId, error }) => log({
        event: "local-console-conversation-baseline-unavailable",
        projectId,
        error,
      }),
    });
    this.projectCommandRuntime = new LocalProjectCommandRuntime(sessionCommandWiring.project);
    this.sessionCreationRuntime = new LocalSessionCreationRuntime(sessionCommandWiring.creation);
    this.sessionSettingsRuntime = new LocalSessionSettingsRuntime(sessionCommandWiring.settings);
    this.sessionReferenceRuntime = new LocalSessionReferenceRuntime(sessionCommandWiring.reference);

    const sessionReadWiring = createLocalSessionReadWiring({
      options,
      context: runtimeContext,
      activeRuns: this.activeRunRegistry,
      lifecycle: this.runLifecycleRuntime,
      continuation: this.sessionContinuationRuntime,
      presentation: this.sessionPresentationRuntime,
      conversationWorkspace: this.conversationWorkspaceRuntime,
      defaultSessionId: this.sessionId,
      lastError: () => this.lastError,
      listChildSessions: (parentSessionId) => this.storePorts.call("local-console-store-list-child-sessions", () =>
        listLocalChildSessionSummaries({
          sqlitePath: options.store.sqlitePath,
          timeoutMs: this.storeTimeoutMs,
        }, parentSessionId)),
      output: {
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
      },
      workspace: {
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
      },
    });
    this.stateQueryRuntime = new LocalConsoleStateQueryRuntime(sessionReadWiring.state);
    this.runOutputRuntime = new LocalConsoleRunOutputRuntime(sessionReadWiring.output);
    this.workspaceQueryRuntime = new LocalConsoleWorkspaceQueryRuntime(sessionReadWiring.workspace);

    this.sessionMetadataRuntime = new LocalConsoleSessionMetadataRuntime(createLocalSessionMetadataWiring({
      context: runtimeContext,
      options,
      activeRuns: this.activeRunRegistry,
      continuation: this.sessionContinuationRuntime,
      loadCeoScripts: () => loadCeoScripts({ agentsDir: path.join(options.projectRoot, "agents"), required: false }),
      processPending: (sessionId) => { void this.processPending(sessionId); },
      reportError: (event, error, originalError) => log({ event, error, originalError }),
    }));
    this.messageCommandRuntime = new LocalConsoleMessageCommandRuntime(messageRetryWiring.message);
    this.runRetryRuntime = new LocalConsoleRunRetryRuntime(messageRetryWiring.retry);
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
    this.shutdownRuntime = new LocalRuntimeShutdownRuntime({
      context: runtimeContext,
      store: options.store,
      activeRuns: this.activeRunRegistry,
      timeoutMs: this.storeTimeoutMs,
      isClosing: () => this.closing,
      beginClosing: () => {
        this.closing = true;
        this.pendingProcessingRuntime.beginClosing();
      },
      pendingWork: () => this.pendingProcessingRuntime.hasOutstandingWork(),
      workerWork: () => this.workerDispatchRuntime.hasOutstandingWork(),
      randomId: () => crypto.randomUUID(),
      reportFailure: (sessionId, runId, error) =>
        log({ event: "local-console-prepare-graceful-resume-failed", sessionId, runId, error }),
    });
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
    await this.shutdownRuntime.close();
  }

  async processPending(sessionId = this.sessionId): Promise<void> {
    await this.pendingProcessingRuntime.process(sessionId);
  }

  async processAllPending(): Promise<void> {
    await this.pendingProcessingRuntime.processAll();
  }

  async repairStaleRunning(sessionId = this.sessionId): Promise<number> {
    return await this.startupRecoveryRuntime.repairStaleRunning(sessionId);
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
