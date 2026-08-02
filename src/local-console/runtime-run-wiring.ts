import type { LocalActiveRunRegistry } from "./active-run-registry.js";
import type { LocalConversationWorkspaceRuntime } from "./conversation-workspace-runtime.js";
import type { LocalExecutionRunner } from "./execution-driver.js";
import type { LocalPendingSessionContextRuntime } from "./pending-session-context-runtime.js";
import type { createLocalPrimaryWiring } from "./primary-wiring.js";
import { createLocalPrimaryWiring as createPrimaryWiring } from "./primary-wiring.js";
import type { LocalRunFailureRuntime } from "./run-failure-runtime.js";
import type { LocalRunLifecycleRuntime } from "./run-lifecycle-runtime.js";
import type { LocalRunRecoveryRuntime } from "./run-recovery-runtime.js";
import { planLocalRunFailureStatus } from "./run-terminal-plan.js";
import type { LocalRuntimeAdapters } from "./runtime-adapters.js";
import type { LocalConsoleRuntimeOptions } from "./runtime-contracts.js";
import type { LocalRuntimeWiringContext } from "./runtime-wiring-context.js";
import { planRuntimeFallback } from "./runtime-domain.js";
import type { LocalSessionContinuationRuntime } from "./session-continuation-runtime.js";
import { createLocalSharedRunPorts } from "./shared-run-wiring.js";
import type { createLocalWorkerWiring } from "./worker-wiring.js";
import { createLocalWorkerWiring as createWorkerWiring } from "./worker-wiring.js";

type WorkerInput = Parameters<typeof createLocalWorkerWiring>[0];
type PrimaryInput = Parameters<typeof createLocalPrimaryWiring>[0];

export function createLocalRuntimeRunWiring(input: {
  context: LocalRuntimeWiringContext;
  options: LocalConsoleRuntimeOptions;
  adapters: LocalRuntimeAdapters;
  executionRunner: LocalExecutionRunner;
  activeRuns: LocalActiveRunRegistry;
  lifecycle: LocalRunLifecycleRuntime;
  idleTimeoutMs: number | undefined;
  toolTimeoutMs: number | undefined;
  routeTimeoutMs: number | undefined;
  recovery: LocalRunRecoveryRuntime;
  continuation: LocalSessionContinuationRuntime;
  pendingContext: LocalPendingSessionContextRuntime;
  failure: LocalRunFailureRuntime;
  workspace: LocalConversationWorkspaceRuntime;
  scheduleRun: WorkerInput["scheduleRun"];
  processPending: WorkerInput["processPending"];
  workerReport: WorkerInput["report"];
  executeWorkerChildSession: WorkerInput["executeChildSession"];
  executePrimaryChildSession: PrimaryInput["executeChildSession"];
  recordChildSessionCardError: PrimaryInput["recordChildSessionCardError"];
  scheduleWorker: PrimaryInput["scheduleWorker"];
  primaryReport: PrimaryInput["report"];
}) {
  const shared = createLocalSharedRunPorts({
    storePorts: input.context.storePorts,
    executionRunner: input.executionRunner,
    activeRuns: input.activeRuns,
    lifecycle: input.lifecycle,
    idleTimeoutMs: input.idleTimeoutMs,
    toolTimeoutMs: input.toolTimeoutMs,
    now: input.context.now,
    nowIso: input.context.nowIso,
    resolveWorkspace: (sessionId, source, signal) => input.workspace.resolveSource(sessionId, source, signal),
    ...input.adapters,
    settleUnavailable: ({ sessionId, runId, sourceMessage, role, runDir, unavailable }) =>
      input.recovery.settleUnavailable({
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
  const classifyFailure: WorkerInput["classifyFailure"] = (result) => ({
    runtimeClosing: input.adapters.interruptionCause(result) === "runtime-closing",
    failureStatus: planLocalRunFailureStatus({
      runtimeClosing: input.adapters.interruptionCause(result) === "runtime-closing",
      timedOut: input.adapters.timeoutKind(result) !== null,
      interrupted: input.adapters.interrupted(result),
    }),
  });
  return {
    worker: createWorkerWiring({
      context: input.context,
      options: input.options,
      ...shared,
      recovery: input.recovery,
      continuation: input.continuation,
      pendingContext: input.pendingContext,
      failure: input.failure,
      workspace: input.workspace,
      scheduleRun: input.scheduleRun,
      processPending: input.processPending,
      report: input.workerReport,
      classifyFailure,
      executeChildSession: input.executeWorkerChildSession,
      invalidateWorkspace: input.adapters.invalidateWorkspace,
    }),
    primary: createPrimaryWiring({
      context: input.context,
      options: input.options,
      ...shared,
      routeTimeoutMs: input.routeTimeoutMs,
      recovery: input.recovery,
      continuation: input.continuation,
      pendingContext: input.pendingContext,
      failure: input.failure,
      workspace: input.workspace,
      readRecoveryFacts: input.adapters.readRecoveryFacts,
      routeJudgment: planRuntimeFallback(
        input.options.routeJudgment,
        input.adapters.defaultLocalRouteJudgment,
      ),
      validateRouteAppend: input.adapters.validateLocalRouteAppend,
      classifyFailure,
      executeChildSession: input.executePrimaryChildSession,
      recordChildSessionCardError: input.recordChildSessionCardError,
      scheduleWorker: input.scheduleWorker,
      report: input.primaryReport,
      invalidateWorkspace: input.adapters.invalidateWorkspace,
    }),
  };
}
