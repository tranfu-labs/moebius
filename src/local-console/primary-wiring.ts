import path from "node:path";
import type { LocalConversationWorkspaceRuntime } from "./conversation-workspace-runtime.js";
import type { LocalPendingSessionContextRuntime } from "./pending-session-context-runtime.js";
import type { LocalPrimaryAnalysisRuntime } from "./primary-analysis-runtime.js";
import { createLocalPrimaryAnalysisPorts } from "./primary-analysis-wiring.js";
import type { LocalPrimaryDispatchRuntime } from "./primary-dispatch-runtime.js";
import { createLocalPrimaryDispatchPorts } from "./primary-dispatch-wiring.js";
import type { LocalPrimaryExecutionRuntime } from "./primary-execution-runtime.js";
import { createLocalPrimaryExecutionPorts } from "./primary-execution-wiring.js";
import type { LocalPrimaryPreparationRuntime } from "./primary-preparation-runtime.js";
import { createLocalPrimaryPreparationPorts } from "./primary-preparation-wiring.js";
import type { LocalPrimaryProviderRuntime } from "./primary-provider-runtime.js";
import { createLocalPrimaryProviderPorts } from "./primary-provider-wiring.js";
import type { LocalPrimaryTerminalRuntime } from "./primary-terminal-runtime.js";
import { createLocalPrimaryTerminalPorts } from "./primary-terminal-wiring.js";
import { planConcurrentPrimaryRecoveryWorkspace } from "./primary-runtime-plan.js";
import type { LocalRunFailureRuntime } from "./run-failure-runtime.js";
import type { LocalRunRecoveryRuntime } from "./run-recovery-runtime.js";
import type { LocalConsoleRuntimeOptions } from "./runtime-contracts.js";
import type { LocalRuntimeWiringContext } from "./runtime-wiring-context.js";
import { decideRuntimeCapability, formatLocalError } from "./runtime-domain.js";
import type { LocalSessionContinuationRuntime } from "./session-continuation-runtime.js";
import { buildSessionAnalysisReadOnlyContract } from "./session-analysis-gate.js";
import type { SharedRunPorts } from "./shared-run-wiring.js";

type PreparationInput = Parameters<typeof createLocalPrimaryPreparationPorts>[0];
type TerminalInput = Parameters<typeof createLocalPrimaryTerminalPorts>[0];
type DispatchInput = Parameters<typeof createLocalPrimaryDispatchPorts>[0];
type ExecutionInput = Parameters<typeof createLocalPrimaryExecutionPorts>[0];

export function createLocalPrimaryWiring(input: SharedRunPorts & {
  context: LocalRuntimeWiringContext;
  options: LocalConsoleRuntimeOptions;
  routeTimeoutMs: number | undefined;
  recovery: LocalRunRecoveryRuntime;
  continuation: LocalSessionContinuationRuntime;
  pendingContext: LocalPendingSessionContextRuntime;
  failure: LocalRunFailureRuntime;
  workspace: LocalConversationWorkspaceRuntime;
  readRecoveryFacts: DispatchInput["readRecoveryFacts"];
  classifyFailure: TerminalInput["classifyFailure"];
  executeChildSession: TerminalInput["executeChildSession"];
  recordChildSessionCardError: TerminalInput["recordChildSessionCardError"];
  scheduleWorker: DispatchInput["scheduleWorker"];
  report: ExecutionInput["report"];
  invalidateWorkspace: ExecutionInput["invalidateWorkspace"];
}) {
  const { context } = input;
  return {
    preparation: createLocalPrimaryPreparationPorts({
      options: input.options,
      storePorts: context.storePorts,
      activeRuns: input.activeRuns,
      lifecycle: input.lifecycle,
      nowIso: context.nowIso,
      inactive: (sessionId) => input.context.stopping(sessionId),
      readAgentFile: input.readAgentFile,
      makeRunDir: (messageCount) => {
        const providerRunDir = input.options.makeRunDir(messageCount, context.now());
        return { providerRunDir, resolvedRunDir: path.resolve(providerRunDir) };
      },
      resolveWorkspace: input.resolveWorkspace,
      concurrentRecoveryWorkspace: (sessionId) =>
        planConcurrentPrimaryRecoveryWorkspace([...input.activeRuns.values()], sessionId),
      buildAnalysisContract: buildSessionAnalysisReadOnlyContract,
      loadRecoverySnapshot: input.loadRecoverySnapshot,
      isCodexThreadAvailable: input.isCodexThreadAvailable,
      settleUnavailable: input.settleUnavailable as PreparationInput["settleUnavailable"],
    }),
    provider: createLocalPrimaryProviderPorts(input),
    analysis: createLocalPrimaryAnalysisPorts({
      ...input,
      updateGate: async (gateInput) => {
        const capability = decideRuntimeCapability(input.options.store.updateSessionAnalysisGate);
        if (capability.kind === "unavailable") {
          throw new Error("local console analysis gate persistence unavailable");
        }
        await context.storePorts.call("local-console-store-update-analysis-gate", () =>
          capability.capability.call(input.options.store, { ...gateInput, now: context.nowIso() }));
      },
    }),
    terminal: createLocalPrimaryTerminalPorts({
      store: input.options.store,
      ...input,
      storePorts: context.storePorts,
      nowIso: context.nowIso,
      classifyFailure: input.classifyFailure,
      recordFailure: (run, result) =>
        input.failure.recordDirect(run.sourceMessage, run.sessionId, run.runId, result),
      sourceDirectoryAvailable: (sessionId) => input.continuation.sessionProjectDirectoryAvailable(sessionId),
      executeChildSession: input.executeChildSession,
      recordWorkspaceDiff: (run, preparation, result) =>
        input.workspace.recordGeneratedDiffIfNeeded({
          sessionId: run.sessionId,
          runId: run.runId,
          runDir: preparation.resolvedRunDir,
          workspace: preparation.workspace,
          finalText: result.finalText,
          signal: preparation.controller.signal,
        }),
      recordChildSessionCardError: input.recordChildSessionCardError,
    }),
    dispatch: createLocalPrimaryDispatchPorts({
      options: input.options,
      storePorts: context.storePorts,
      agentsDir: path.join(input.options.projectRoot, "agents"),
      routeTimeoutMs: input.routeTimeoutMs,
      now: context.now,
      nowIso: context.nowIso,
      inactive: context.stopping,
      gracefulResumeTargets: (sessionId) => input.recovery.targetsForClaim(sessionId),
      sessionSummary: (sessionId) => input.continuation.sessionSummary(sessionId),
      readRecoveryFacts: input.readRecoveryFacts,
      recordTerminalFailure: (message, sessionId, runId, runDir, reason) =>
        input.failure.recordStartFailure(message, sessionId, runId, runDir, reason),
      setError: context.setError,
      scheduleWorker: input.scheduleWorker,
    }),
    execution(runtimes: {
      dispatch: LocalPrimaryDispatchRuntime;
      preparation: LocalPrimaryPreparationRuntime;
      provider: LocalPrimaryProviderRuntime;
      analysis: LocalPrimaryAnalysisRuntime;
      terminal: LocalPrimaryTerminalRuntime;
    }): ConstructorParameters<typeof LocalPrimaryExecutionRuntime>[0] {
      return createLocalPrimaryExecutionPorts({
        ...runtimes,
        activeRuns: input.activeRuns,
        lifecycle: input.lifecycle,
        formatError: (error) => formatLocalError(error),
        setError: context.setError,
        report: input.report,
        recordFailure: (message, sessionId, runId, runDir, error) =>
          input.failure.recordStartFailure(message, sessionId, runId, runDir, error),
        applyPendingContext: (sessionId) => input.pendingContext.applyWhenIdle(sessionId),
        invalidateWorkspace: input.invalidateWorkspace,
      });
    },
  };
}
