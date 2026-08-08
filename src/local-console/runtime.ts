import { log } from "../log.js";
import { LOCAL_CONSOLE_DEFAULT_SESSION_ID } from "./types.js";
import {
  createLocalExecutionRunner,
  type LocalExecutionRunner,
} from "./execution-driver.js";
import { LocalConversationWorkspaceRuntime } from "./conversation-workspace-runtime.js";
import { LocalSessionContinuationRuntime } from "./session-continuation-runtime.js";
import { LocalSessionPresentationRuntime } from "./session-presentation-runtime.js";
import { LocalRunFailureRuntime } from "./run-failure-runtime.js";
import { LocalRunLifecycleRuntime } from "./run-lifecycle-runtime.js";
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
import {
  LocalWorkerDispatchRuntime,
} from "./worker-dispatch-runtime.js";
export type { LocalConsoleAgentFile } from "./agent-file.js";
import { LocalActiveRunRegistry } from "./active-run-registry.js";
import { LocalWorkerPreparationRuntime } from "./worker-preparation-runtime.js";
import { LocalWorkerProviderRuntime } from "./worker-provider-runtime.js";
import { LocalWorkerTerminalRuntime } from "./worker-terminal-runtime.js";
import { LocalWorkerExecutionRuntime } from "./worker-execution-runtime.js";
import { createLocalRuntimeWiringContext } from "./runtime-wiring-context.js";
import { createLocalRuntimeFoundationWiring } from "./runtime-foundation-wiring.js";
import { createLocalRuntimeAdapters } from "./runtime-adapters.js";
import { createLocalRuntimeRunWiring } from "./runtime-run-wiring.js";
import { createLocalRuntimeSessionWiring } from "./runtime-session-wiring.js";
import { createLocalRuntimeLifecycleWiring } from "./runtime-lifecycle-wiring.js";
import { LocalRuntimeShutdownRuntime } from "./runtime-shutdown-runtime.js";
import { LocalPrimaryPreparationRuntime } from "./primary-preparation-runtime.js";
import { LocalPrimaryProviderRuntime } from "./primary-provider-runtime.js";
import { LocalPrimaryAnalysisRuntime } from "./primary-analysis-runtime.js";
import { LocalPrimaryTerminalRuntime } from "./primary-terminal-runtime.js";
import { LocalPrimaryDispatchRuntime } from "./primary-dispatch-runtime.js";
import { LocalPrimaryExecutionRuntime } from "./primary-execution-runtime.js";
import { LocalPendingProcessingRuntime } from "./pending-processing-runtime.js";
import { formatLocalError } from "./runtime-domain.js";
import { LocalConsoleStorePorts } from "./runtime-store-ports.js";
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

  getRunningTaskCount(): number { return [...this.activeRunRegistry.keys()].length + (this.options.getManagedProcessRunningCount?.() ?? 0); }

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
      runCodex: options.runCodex, runPi: options.runPi, createManagedProcessMcp: options.createManagedProcessMcp,
    });
    const adapters = createLocalRuntimeAdapters({
      options,
      storePorts: this.storePorts,
      storeTimeoutMs: this.storeTimeoutMs,
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
      ...adapters,
      getSessionFactLogPath: (sessionId) => this.getSessionFactLogPath(sessionId),
      hasScheduledWorker: (sessionId) => this.workerDispatchRuntime.hasScheduledWorker(sessionId), scheduleReprocess: (sessionId) => this.pendingProcessingRuntime.schedule(sessionId),
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
    const runWiring = createLocalRuntimeRunWiring({
      context: runtimeContext,
      options,
      adapters,
      executionRunner: this.executionRunner,
      activeRuns: this.activeRunRegistry,
      lifecycle: this.runLifecycleRuntime,
      idleTimeoutMs: this.codexIdleTimeoutMs,
      toolTimeoutMs: this.toolInFlightTimeoutMs,
      routeTimeoutMs: this.routeTimeoutMs,
      recovery: this.runRecoveryRuntime,
      continuation: this.sessionContinuationRuntime,
      pendingContext: this.pendingSessionContextRuntime,
      failure: this.runFailureRuntime,
      workspace: this.conversationWorkspaceRuntime,
      scheduleRun: (input) => this.workerExecutionRuntime.run(input),
      processPending: (sessionId) => { void this.processPending(sessionId); },
      workerReport: (event, sessionId, role, error) =>
        log({ event, sessionId, ...(role === null ? {} : { role }), error }),
      executeWorkerChildSession: (input, _runDir, result) => this.sessionMetadataRuntime.executeChildOrchestration({
        sessionId: input.sessionId,
        runId: input.runId,
        runDir: result.runDir,
        finalText: result.finalText,
        availableAgentNames: input.agentFiles.map((agent) => agent.name),
      }),
      executePrimaryChildSession: (run, result) => this.sessionMetadataRuntime.executeChildOrchestration({
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
      primaryReport: (event, error) => log({ event, error }),
    });
    this.workerDispatchRuntime = new LocalWorkerDispatchRuntime(runWiring.worker.dispatch);
    this.workerPreparationRuntime = new LocalWorkerPreparationRuntime(runWiring.worker.preparation);
    this.workerProviderRuntime = new LocalWorkerProviderRuntime(runWiring.worker.provider);
    this.workerTerminalRuntime = new LocalWorkerTerminalRuntime(runWiring.worker.terminal);
    this.workerExecutionRuntime = new LocalWorkerExecutionRuntime(runWiring.worker.execution({
      preparation: this.workerPreparationRuntime,
      provider: this.workerProviderRuntime,
      terminal: this.workerTerminalRuntime,
    }));
    this.primaryPreparationRuntime = new LocalPrimaryPreparationRuntime(runWiring.primary.preparation);
    this.primaryProviderRuntime = new LocalPrimaryProviderRuntime(runWiring.primary.provider);
    this.primaryAnalysisRuntime = new LocalPrimaryAnalysisRuntime(runWiring.primary.analysis);
    this.primaryTerminalRuntime = new LocalPrimaryTerminalRuntime(runWiring.primary.terminal);
    this.primaryDispatchRuntime = new LocalPrimaryDispatchRuntime(runWiring.primary.dispatch);
    this.primaryExecutionRuntime = new LocalPrimaryExecutionRuntime(runWiring.primary.execution({
      dispatch: this.primaryDispatchRuntime,
      preparation: this.primaryPreparationRuntime,
      provider: this.primaryProviderRuntime,
      analysis: this.primaryAnalysisRuntime,
      terminal: this.primaryTerminalRuntime,
    }));
    const sessionWiring = createLocalRuntimeSessionWiring({
      context: runtimeContext,
      options,
      adapters,
      activeRuns: this.activeRunRegistry,
      lifecycle: this.runLifecycleRuntime,
      continuation: this.sessionContinuationRuntime,
      presentation: this.sessionPresentationRuntime,
      conversationWorkspace: this.conversationWorkspaceRuntime,
      defaultSessionId: this.sessionId,
      inactiveSessions: this.inactiveSessions,
      baselineCommits: this.conversationBaselineCommits,
      lastError: () => this.lastError,
      scheduleWorkerWake: (sessionId) => this.workerDispatchRuntime.scheduleWake(sessionId),
      processPending: (sessionId) => { void this.processPending(sessionId); },
      schedulePendingProcessing: (sessionId) => this.pendingProcessingRuntime.schedule(sessionId),
      runRetryAfterCurrent: (sessionId, action) => this.pendingProcessingRuntime.runRetryAfterCurrent(sessionId, action),
      repairStale: async (sessionId) => { await this.repairStaleRunning(sessionId); },
      applyPendingContext: (sessionId) => this.pendingSessionContextRuntime.applyWhenIdle(sessionId),
      continuableWorkspace: (sessionId) => this.sessionContinuationRuntime.continuableSessionWorkspace(sessionId),
      dispatchWorkers: (sessionId, workspace) => this.workerDispatchRuntime.dispatch(sessionId, workspace),
      executePrimary: (sessionId, workspace) => this.primaryExecutionRuntime.run(sessionId, workspace),
      loadCeoScripts: adapters.loadCeoScripts,
    });
    this.pendingProcessingRuntime = new LocalPendingProcessingRuntime(sessionWiring.pending);
    this.projectCommandRuntime = new LocalProjectCommandRuntime(sessionWiring.command.project);
    this.sessionCreationRuntime = new LocalSessionCreationRuntime(sessionWiring.command.creation);
    this.sessionSettingsRuntime = new LocalSessionSettingsRuntime(sessionWiring.command.settings);
    this.sessionReferenceRuntime = new LocalSessionReferenceRuntime(sessionWiring.command.reference);
    this.stateQueryRuntime = new LocalConsoleStateQueryRuntime(sessionWiring.read.state);
    this.runOutputRuntime = new LocalConsoleRunOutputRuntime(sessionWiring.read.output);
    this.workspaceQueryRuntime = new LocalConsoleWorkspaceQueryRuntime(sessionWiring.read.workspace);
    this.sessionMetadataRuntime = new LocalConsoleSessionMetadataRuntime(sessionWiring.metadata);
    this.messageCommandRuntime = new LocalConsoleMessageCommandRuntime(sessionWiring.messageRetry.message);
    this.runRetryRuntime = new LocalConsoleRunRetryRuntime(sessionWiring.messageRetry.retry);
    const lifecycleWiring = createLocalRuntimeLifecycleWiring({
      context: runtimeContext,
      options,
      adapters,
      activeRuns: this.activeRunRegistry,
      defaultSessionId: this.sessionId,
      idleTimeoutMs: this.codexIdleTimeoutMs,
      maxDurationMs: this.codexMaxDurationMs,
      staleGraceMs: this.staleRunningGraceMs,
      timeoutMs: this.storeTimeoutMs,
      isClosing: () => this.closing,
      beginClosing: () => {
        this.closing = true;
        this.pendingProcessingRuntime.beginClosing();
      },
      pendingWork: () => this.pendingProcessingRuntime.hasOutstandingWork(),
      workerWork: () => this.workerDispatchRuntime.hasOutstandingWork(),
    });
    const legacyHandoffRecoveryRuntime = new LocalLegacyHandoffRecoveryRuntime(lifecycleWiring.startup.legacy());
    this.startupRecoveryRuntime = new LocalStartupRecoveryRuntime(
      lifecycleWiring.startup.startup(legacyHandoffRecoveryRuntime),
    );
    this.shutdownRuntime = new LocalRuntimeShutdownRuntime(lifecycleWiring.shutdown);
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

}
