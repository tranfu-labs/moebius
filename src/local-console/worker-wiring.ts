import path from "node:path";
import type { LocalActiveRunRegistry } from "./active-run-registry.js";
import type { ActiveLocalRun } from "./active-run.js";
import type { LocalConversationWorkspaceRuntime } from "./conversation-workspace-runtime.js";
import type { LocalDetachedRunFailureRuntime } from "./detached-run-failure-runtime.js";
import type { LocalExecutionRunner } from "./execution-driver.js";
import type { LocalPendingSessionContextRuntime } from "./pending-session-context-runtime.js";
import type { LocalRunFailureRuntime } from "./run-failure-runtime.js";
import type { LocalRunLifecycleRuntime } from "./run-lifecycle-runtime.js";
import type { LocalRunRecoveryRuntime } from "./run-recovery-runtime.js";
import type { LocalConsoleRuntimeOptions } from "./runtime-contracts.js";
import type { LocalRuntimeWiringContext } from "./runtime-wiring-context.js";
import type { LocalConsoleStorePorts } from "./runtime-store-ports.js";
import type { LocalSessionContinuationRuntime } from "./session-continuation-runtime.js";
import { formatLocalError } from "./runtime-domain.js";
import { decideWorkerClaimRelease } from "./worker-runtime-plan.js";
import type { LocalWorkerExecutionRuntime } from "./worker-execution-runtime.js";
import type { LocalClaudeTerminalTraceStore } from "./claude-terminal-trace-store.js";
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
  context: LocalRuntimeWiringContext;
  options: LocalConsoleRuntimeOptions;
  storePorts: LocalConsoleStorePorts;
  executionRunner: LocalExecutionRunner;
  activeRuns: LocalActiveRunRegistry;
  lifecycle: LocalRunLifecycleRuntime;
  idleTimeoutMs: number | undefined;
  toolTimeoutMs: number | undefined;
  now(): Date;
  nowIso(): string;
  recovery: LocalRunRecoveryRuntime;
  continuation: LocalSessionContinuationRuntime;
  pendingContext: LocalPendingSessionContextRuntime;
  failure: LocalRunFailureRuntime;
  detachedFailure: LocalDetachedRunFailureRuntime;
  workspace: LocalConversationWorkspaceRuntime;
  scheduleRun: DispatchInput["scheduleRun"];
  processPending: DispatchInput["processPending"];
  report: DispatchInput["report"];
  resolveWorkspace: PreparationInput["resolveWorkspace"];
  readAgentFile: PreparationInput["readAgentFile"];
  loadRecoverySnapshot: PreparationInput["loadRecoverySnapshot"];
  isCodexThreadAvailable: PreparationInput["isCodexThreadAvailable"];
  settleUnavailable: PreparationInput["settleUnavailable"];
  classifyFailure: TerminalInput["classifyFailure"];
  executeChildSession: TerminalInput["executeChildSession"];
  invalidateWorkspace: ExecutionInput["invalidateWorkspace"];
  traceStore: LocalClaudeTerminalTraceStore;
}) {
  const { context } = input;
  const releaseClaim: PreparationInput["releaseClaim"] = async (message, sessionId) => {
    const decision = decideWorkerClaimRelease(context.stopping(sessionId));
    if (decision.kind === "keep") return;
    await context.storePorts.call("local-console-store-release-stopped-worker-claim", () =>
      input.options.store.releaseMessageForRetry({
        userMessageId: message.id,
        sessionId,
        now: context.nowIso(),
      }));
  };
  return {
    dispatch: createLocalWorkerDispatchPorts({
      options: input.options,
      storePorts: context.storePorts,
      activeRunForRole: (sessionId, role) =>
        input.lifecycle.runForRole(sessionId, role) as ActiveLocalRun | undefined,
      stopping: context.stopping,
      nextRunId: (sessionId, messageId) => input.recovery.targetForMessage(sessionId, messageId),
      recordMissingAgent: (message, sessionId, runId, role) =>
        input.failure.recordStartFailure(message, sessionId, runId, null, `Agent not found: ${role}`, role),
      nowIso: context.nowIso,
      nowRunId: () => `local-${context.now().toISOString()}-${Math.random().toString(36).slice(2, 10)}`,
      scheduleRun: input.scheduleRun,
      continuableWorkspace: (sessionId) => input.continuation.continuableSessionWorkspace(sessionId),
      applyPendingContext: (sessionId) => input.pendingContext.applyWhenIdle(sessionId),
      processPending: input.processPending,
      setError: context.formatAndSetError,
      report: input.report,
    }),
    preparation: createLocalWorkerPreparationPorts({
      options: input.options,
      storePorts: context.storePorts,
      nowIso: context.nowIso,
      stopping: context.stopping,
      releaseClaim,
      sessionSummary: (sessionId) => input.continuation.sessionSummary(sessionId),
      makeRunDir: (messageCount) => path.resolve(input.options.makeRunDir(messageCount, context.now())),
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
      storePorts: context.storePorts,
      executionRunner: input.executionRunner,
      traceStore: input.traceStore,
      idleTimeoutMs: input.idleTimeoutMs,
      toolTimeoutMs: input.toolTimeoutMs,
      stopping: context.stopping,
      releaseClaim: (workerInput) => releaseClaim(workerInput.sourceMessage, workerInput.sessionId),
      finishLifecycle: (runId) => input.lifecycle.finish(runId, "interrupted"),
      activeRun: (runId) => input.activeRuns.get(runId),
      touchActiveRun: (runId) => input.activeRuns.touch(runId),
      nowIso: context.nowIso,
      onProcessStarted: (runId) => input.lifecycle.markStarted(runId),
      updateAgentProgress: (runId, text) => input.lifecycle.updateAgentProgress(runId, text),
      onStructuredActivity: (runId, event) => input.lifecycle.updateStructuredActivity(runId, event),
      onExecutionProgress: (runId, event) => input.lifecycle.updateExecutionProgress(runId, event),
    }),
    terminal: createLocalWorkerTerminalPorts({
      store: input.options.store,
      storePorts: context.storePorts,
      nowIso: context.nowIso,
      activeRun: (runId) => input.activeRuns.get(runId),
      classifyFailure: input.classifyFailure,
      pauseLifecycle: (runId) => input.lifecycle.pause(runId),
      finishLifecycle: (runId, status) => input.lifecycle.finish(runId, status),
      recordDirectFailure: (workerInput, result, processSteps) =>
        input.failure.recordDirect(
          workerInput.sourceMessage,
          workerInput.sessionId,
          workerInput.runId,
          result,
          null,
          workerInput.role,
          processSteps,
        ),
      recordDetachedFailure: (workerInput, result, processSteps) =>
        input.detachedFailure.recordDetached(workerInput.sessionId, workerInput.runId, result, workerInput.role, processSteps),
      sourceDirectoryAvailable: (sessionId) => input.continuation.sessionProjectDirectoryAvailable(sessionId),
      executeChildSession: input.executeChildSession,
      recordWorkspaceDiff: (workerInput, preparation, result) =>
        input.workspace.recordGeneratedDiffIfNeeded({
          sessionId: workerInput.sessionId,
          runId: workerInput.runId,
          runDir: preparation.runDir,
          workspace: preparation.workspace,
          finalText: result.finalText,
          signal: preparation.controller.signal,
        }),
    }),
    execution(runtimes: {
      preparation: LocalWorkerPreparationRuntime;
      provider: LocalWorkerProviderRuntime;
      terminal: LocalWorkerTerminalRuntime;
    }): ConstructorParameters<typeof LocalWorkerExecutionRuntime>[0] {
      return createLocalWorkerExecutionPorts({
        ...runtimes,
        stopping: context.stopping,
        releaseClaim: (workerInput) => releaseClaim(workerInput.sourceMessage, workerInput.sessionId),
        formatError: (error) => formatLocalError(error),
        setError: context.setError,
        recordDirectFailure: (workerInput, runDir, error) =>
          input.failure.recordStartFailure(
            workerInput.sourceMessage,
            workerInput.sessionId,
            workerInput.runId,
            runDir,
            error,
            workerInput.role,
          ),
        recordDetachedFailure: (workerInput, runDir, error) =>
          input.detachedFailure.recordDetachedStartFailure({
            sessionId: workerInput.sessionId,
            runId: workerInput.runId,
            runDir,
            error,
            role: workerInput.role,
          }),
        activeRuns: input.activeRuns,
        lifecycle: input.lifecycle,
        invalidateWorkspace: input.invalidateWorkspace,
      });
    },
  };
}
