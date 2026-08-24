import type { LocalActiveRunRegistry } from "./active-run-registry.js";
import type { LocalRuntimeShutdownRuntime } from "./runtime-shutdown-runtime.js";
import type { LocalRuntimeAdapters } from "./runtime-adapters.js";
import type { LocalConsoleRuntimeOptions } from "./runtime-contracts.js";
import type { LocalRuntimeWiringContext } from "./runtime-wiring-context.js";
import { createLocalStartupRecoveryWiring } from "./startup-recovery-wiring.js";

type ShutdownPorts = ConstructorParameters<typeof LocalRuntimeShutdownRuntime>[0];

export function createLocalRuntimeLifecycleWiring(input: {
  context: LocalRuntimeWiringContext;
  options: LocalConsoleRuntimeOptions;
  adapters: LocalRuntimeAdapters;
  activeRuns: LocalActiveRunRegistry;
  defaultSessionId: string;
  idleTimeoutMs: number | undefined;
  maxDurationMs: number | undefined;
  staleGraceMs: number;
  timeoutMs: number;
  isClosing(): boolean;
  beginClosing(): void;
  pendingWork(): boolean;
  workerWork(): boolean;
}) {
  return {
    startup: createLocalStartupRecoveryWiring({
      store: input.options.store,
      defaultSessionId: input.defaultSessionId,
      storeCall: (label, operation) => input.context.storePorts.call(label, operation),
      now: input.context.now,
      nowIso: input.context.nowIso,
      idleTimeoutMs: input.idleTimeoutMs,
      maxDurationMs: input.maxDurationMs,
      staleGraceMs: input.staleGraceMs,
      recoveryStore: () => input.context.storePorts.recoveryFacts(),
      readRecoveryFacts: input.adapters.readRecoveryFacts,
      readRunContexts: input.adapters.readRunExecutionContexts,
      activeRunIds: () => new Set(input.activeRuns.keys()),
      activeSessionIds: () => new Set([...input.activeRuns.values()].map((active) => active.sessionId)),
      recordError: input.context.formatAndSetError,
      report: input.adapters.report,
    }),
    shutdown: {
      context: input.context,
      store: input.options.store,
      activeRuns: input.activeRuns,
      timeoutMs: input.timeoutMs,
      isClosing: input.isClosing,
      beginClosing: input.beginClosing,
      pendingWork: input.pendingWork,
      workerWork: input.workerWork,
      beforeStoreClose: async () => {
        await input.options.beforeStoreClose?.();
        await input.adapters.traceStore.flushAll();
      },
      randomId: input.adapters.randomId,
      reportFailure: (sessionId, runId, error) => input.adapters.report({
        event: "local-console-prepare-graceful-resume-failed",
        sessionId,
        runId,
        error,
      }),
      getRunningTaskCount: () => [...input.activeRuns.keys()].length
        + (input.options.getManagedProcessRunningCount?.() ?? 0),
    } satisfies ShutdownPorts,
  };
}
