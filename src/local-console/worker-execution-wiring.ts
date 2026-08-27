import type { LocalActiveRunRegistry } from "./active-run-registry.js";
import type { LocalRunLifecycleRuntime } from "./run-lifecycle-runtime.js";
import type { LocalWorkerExecutionRuntime } from "./worker-execution-runtime.js";

type WorkerExecutionPorts = ConstructorParameters<typeof LocalWorkerExecutionRuntime>[0];

export function createLocalWorkerExecutionPorts(input: {
  preparation: WorkerExecutionPorts["preparation"];
  provider: WorkerExecutionPorts["provider"];
  terminal: WorkerExecutionPorts["terminal"];
  stopping: WorkerExecutionPorts["stopping"];
  releaseClaim: WorkerExecutionPorts["releaseClaim"];
  formatError: WorkerExecutionPorts["formatError"];
  setError: WorkerExecutionPorts["setError"];
  recordDirectFailure: WorkerExecutionPorts["recordDirectFailure"];
  recordDetachedFailure: WorkerExecutionPorts["recordDetachedFailure"];
  activeRuns: Pick<LocalActiveRunRegistry, "get" | "delete">;
  lifecycle: Pick<LocalRunLifecycleRuntime, "pause" | "finish">;
  invalidateWorkspace: WorkerExecutionPorts["invalidateWorkspace"];
  flushWorkspaceCleanup: WorkerExecutionPorts["flushWorkspaceCleanup"];
}): WorkerExecutionPorts {
  return {
    preparation: input.preparation,
    provider: input.provider,
    terminal: input.terminal,
    stopping: input.stopping,
    releaseClaim: input.releaseClaim,
    formatError: input.formatError,
    setError: input.setError,
    recordDirectFailure: input.recordDirectFailure,
    recordDetachedFailure: input.recordDetachedFailure,
    activeRun: (runId) => input.activeRuns.get(runId),
    pauseLifecycle: (runId) => input.lifecycle.pause(runId),
    failLifecycle: (runId) => input.lifecycle.finish(runId, "failed"),
    deleteActiveRun: (runId) => { input.activeRuns.delete(runId); },
    invalidateWorkspace: input.invalidateWorkspace,
    flushWorkspaceCleanup: input.flushWorkspaceCleanup,
  };
}
