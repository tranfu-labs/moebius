import type { LocalActiveRunRegistry } from "./active-run-registry.js";
import type { ActiveLocalRun } from "./active-run.js";
import type { LocalExecutionRunner } from "./execution-driver.js";
import type { LocalRunLifecycleRuntime } from "./run-lifecycle-runtime.js";
import type { LocalConsoleRuntimeOptions } from "./runtime-contracts.js";
import type { LocalConsoleStorePorts } from "./runtime-store-ports.js";
import type { LocalWorkerExecutionRuntime } from "./worker-execution-runtime.js";
import { createLocalWorkerExecutionPorts } from "./worker-execution-wiring.js";
import type { LocalWorkerPreparationRuntime } from "./worker-preparation-runtime.js";
import { createLocalWorkerPreparationPorts } from "./worker-preparation-wiring.js";
import type { LocalWorkerProviderRuntime } from "./worker-provider-runtime.js";
import { createLocalWorkerProviderPorts } from "./worker-provider-wiring.js";
import type { LocalWorkerTerminalRuntime } from "./worker-terminal-runtime.js";
import { createLocalWorkerTerminalPorts } from "./worker-terminal-wiring.js";
import { createLocalWorkerDispatchPorts } from "./worker-dispatch-wiring.js";

type DispatchInput = Parameters<typeof createLocalWorkerDispatchPorts>[0];
type PreparationInput = Parameters<typeof createLocalWorkerPreparationPorts>[0];
type ProviderInput = Parameters<typeof createLocalWorkerProviderPorts>[0];
type TerminalInput = Parameters<typeof createLocalWorkerTerminalPorts>[0];
type ExecutionInput = Parameters<typeof createLocalWorkerExecutionPorts>[0];

export function createLocalWorkerWiring(input: {
  options: LocalConsoleRuntimeOptions;
  storePorts: LocalConsoleStorePorts;
  executionRunner: LocalExecutionRunner;
  activeRuns: LocalActiveRunRegistry;
  lifecycle: LocalRunLifecycleRuntime;
  idleTimeoutMs: number | undefined;
  toolTimeoutMs: number | undefined;
  stopping: DispatchInput["stopping"];
  now(): Date;
  nowIso: DispatchInput["nowIso"];
  nextRunId: DispatchInput["nextRunId"];
  recordMissingAgent: DispatchInput["recordMissingAgent"];
  scheduleRun: DispatchInput["scheduleRun"];
  continuableWorkspace: DispatchInput["continuableWorkspace"];
  applyPendingContext: DispatchInput["applyPendingContext"];
  processPending: DispatchInput["processPending"];
  recordError: DispatchInput["setError"];
  report: DispatchInput["report"];
  releaseClaim: PreparationInput["releaseClaim"];
  sessionSummary: PreparationInput["sessionSummary"];
  makeRunDir: PreparationInput["makeRunDir"];
  resolveWorkspace: PreparationInput["resolveWorkspace"];
  readAgentFile: PreparationInput["readAgentFile"];
  loadRecoverySnapshot: PreparationInput["loadRecoverySnapshot"];
  isCodexThreadAvailable: PreparationInput["isCodexThreadAvailable"];
  settleUnavailable: PreparationInput["settleUnavailable"];
  classifyFailure: TerminalInput["classifyFailure"];
  recordDirectFailure: TerminalInput["recordDirectFailure"];
  recordDetachedFailure: TerminalInput["recordDetachedFailure"];
  sourceDirectoryAvailable: TerminalInput["sourceDirectoryAvailable"];
  executeChildSession: TerminalInput["executeChildSession"];
  recordWorkspaceDiff: TerminalInput["recordWorkspaceDiff"];
  formatError: ExecutionInput["formatError"];
  setError: ExecutionInput["setError"];
  recordDirectStartFailure: ExecutionInput["recordDirectFailure"];
  recordDetachedStartFailure: ExecutionInput["recordDetachedFailure"];
  invalidateWorkspace: ExecutionInput["invalidateWorkspace"];
}) {
  return {
    dispatch: createLocalWorkerDispatchPorts({
      options: input.options,
      storePorts: input.storePorts,
      activeRunForRole: (sessionId, role) =>
        input.lifecycle.runForRole(sessionId, role) as ActiveLocalRun | undefined,
      stopping: input.stopping,
      nextRunId: input.nextRunId,
      recordMissingAgent: input.recordMissingAgent,
      nowIso: input.nowIso,
      nowRunId: () => `local-${input.now().toISOString()}-${Math.random().toString(36).slice(2, 10)}`,
      scheduleRun: input.scheduleRun,
      continuableWorkspace: input.continuableWorkspace,
      applyPendingContext: input.applyPendingContext,
      processPending: input.processPending,
      setError: input.recordError,
      report: input.report,
    }),
    preparation: createLocalWorkerPreparationPorts({
      options: input.options,
      storePorts: input.storePorts,
      nowIso: input.nowIso,
      stopping: input.stopping,
      releaseClaim: input.releaseClaim,
      sessionSummary: input.sessionSummary,
      makeRunDir: input.makeRunDir,
      resolveWorkspace: input.resolveWorkspace,
      readAgentFile: input.readAgentFile,
      loadRecoverySnapshot: input.loadRecoverySnapshot,
      isCodexThreadAvailable: input.isCodexThreadAvailable,
      settleUnavailable: input.settleUnavailable,
      prepareLifecycle: (workerInput) => input.lifecycle.prepare(workerInput),
      setActiveRun: (runId, active) => { input.activeRuns.set(runId, active); },
      recordLifecycle: (active) => input.lifecycle.record(active, "created", "created"),
    }),
    provider: createLocalWorkerProviderPorts({
      storePorts: input.storePorts,
      executionRunner: input.executionRunner,
      idleTimeoutMs: input.idleTimeoutMs,
      toolTimeoutMs: input.toolTimeoutMs,
      stopping: input.stopping,
      releaseClaim: (workerInput) => input.releaseClaim(workerInput.sourceMessage, workerInput.sessionId),
      finishLifecycle: (runId) => input.lifecycle.finish(runId, "interrupted"),
      activeRun: (runId) => input.activeRuns.get(runId),
      nowIso: input.nowIso,
      onProcessStarted: (runId) => input.lifecycle.markStarted(runId),
      updateAgentProgress: (runId, text) => input.lifecycle.updateAgentProgress(runId, text),
      onStructuredActivity: (runId, event) => input.lifecycle.updateStructuredActivity(runId, event),
      onExecutionProgress: (runId, event) => input.lifecycle.updateExecutionProgress(runId, event),
    }),
    terminal: createLocalWorkerTerminalPorts({
      store: input.options.store,
      storePorts: input.storePorts,
      nowIso: input.nowIso,
      activeRun: (runId) => input.activeRuns.get(runId),
      classifyFailure: input.classifyFailure,
      pauseLifecycle: (runId) => input.lifecycle.pause(runId),
      finishLifecycle: (runId, status) => input.lifecycle.finish(runId, status),
      recordDirectFailure: input.recordDirectFailure,
      recordDetachedFailure: input.recordDetachedFailure,
      sourceDirectoryAvailable: input.sourceDirectoryAvailable,
      executeChildSession: input.executeChildSession,
      recordWorkspaceDiff: input.recordWorkspaceDiff,
    }),
    execution(runtimes: {
      preparation: LocalWorkerPreparationRuntime;
      provider: LocalWorkerProviderRuntime;
      terminal: LocalWorkerTerminalRuntime;
    }): ConstructorParameters<typeof LocalWorkerExecutionRuntime>[0] {
      return createLocalWorkerExecutionPorts({
        ...runtimes,
        stopping: input.stopping,
        releaseClaim: (workerInput) => input.releaseClaim(workerInput.sourceMessage, workerInput.sessionId),
        formatError: input.formatError,
        setError: input.setError,
        recordDirectFailure: input.recordDirectStartFailure,
        recordDetachedFailure: input.recordDetachedStartFailure,
        activeRuns: input.activeRuns,
        lifecycle: input.lifecycle,
        invalidateWorkspace: input.invalidateWorkspace,
      });
    },
  };
}
