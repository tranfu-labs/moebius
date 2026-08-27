import type { LocalActiveRunRegistry } from "./active-run-registry.js";
import type { LocalRunLifecycleRuntime } from "./run-lifecycle-runtime.js";
import type { LocalPrimaryExecutionRuntime } from "./primary-execution-runtime.js";
import { decidePrimaryRunLookup } from "./primary-runtime-plan.js";

type PrimaryExecutionPorts = ConstructorParameters<typeof LocalPrimaryExecutionRuntime>[0];

export function createLocalPrimaryExecutionPorts(input: {
  dispatch: PrimaryExecutionPorts["dispatch"];
  preparation: PrimaryExecutionPorts["preparation"];
  provider: PrimaryExecutionPorts["provider"];
  analysis: PrimaryExecutionPorts["analysis"];
  terminal: PrimaryExecutionPorts["terminal"];
  activeRuns: LocalActiveRunRegistry;
  lifecycle: LocalRunLifecycleRuntime;
  formatError: PrimaryExecutionPorts["formatError"];
  setError: PrimaryExecutionPorts["setError"];
  report: PrimaryExecutionPorts["report"];
  recordFailure: PrimaryExecutionPorts["recordFailure"];
  recordCompletionFailure: PrimaryExecutionPorts["recordCompletionFailure"];
  applyPendingContext: PrimaryExecutionPorts["applyPendingContext"];
  invalidateWorkspace: PrimaryExecutionPorts["invalidateWorkspace"];
  flushWorkspaceCleanup: PrimaryExecutionPorts["flushWorkspaceCleanup"];
}): PrimaryExecutionPorts {
  return {
    dispatch: input.dispatch,
    preparation: input.preparation,
    provider: input.provider,
    analysis: input.analysis,
    terminal: input.terminal,
    formatError: input.formatError,
    setError: input.setError,
    report: input.report,
    recordFailure: input.recordFailure,
    recordCompletionFailure: input.recordCompletionFailure,
    activeRun: (runId) => {
      const decision = decidePrimaryRunLookup(runId);
      return decision.kind === "skip" ? undefined : input.activeRuns.get(decision.runId);
    },
    pauseLifecycle: (runId) => input.lifecycle.pause(runId),
    failLifecycle: (runId) => input.lifecycle.finish(runId, "failed"),
    deleteActiveRun: (runId) => { input.activeRuns.delete(runId); },
    applyPendingContext: input.applyPendingContext,
    invalidateWorkspace: input.invalidateWorkspace,
    flushWorkspaceCleanup: input.flushWorkspaceCleanup,
  };
}
