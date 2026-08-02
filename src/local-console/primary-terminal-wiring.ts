import type { LocalActiveRunRegistry } from "./active-run-registry.js";
import type { LocalRunLifecycleRuntime } from "./run-lifecycle-runtime.js";
import type { LocalConsoleStorePorts } from "./runtime-store-ports.js";
import type { LocalPrimaryTerminalRuntime } from "./primary-terminal-runtime.js";
import type { LocalConsoleStore } from "./types.js";

type PrimaryTerminalPorts = ConstructorParameters<typeof LocalPrimaryTerminalRuntime>[0];

export function createLocalPrimaryTerminalPorts(input: {
  store: LocalConsoleStore;
  storePorts: Pick<LocalConsoleStorePorts,
    | "call"
    | "recoveryFacts"
    | "sessionFacts"
    | "recordProviderInvocation"
    | "recordAgentTimelineCursor"
  >;
  activeRuns: LocalActiveRunRegistry;
  lifecycle: LocalRunLifecycleRuntime;
  nowIso: PrimaryTerminalPorts["nowIso"];
  classifyFailure: PrimaryTerminalPorts["classifyFailure"];
  recordFailure: PrimaryTerminalPorts["recordFailure"];
  sourceDirectoryAvailable: PrimaryTerminalPorts["sourceDirectoryAvailable"];
  executeChildSession: PrimaryTerminalPorts["executeChildSession"];
  recordWorkspaceDiff: PrimaryTerminalPorts["recordWorkspaceDiff"];
  recordChildSessionCardError: PrimaryTerminalPorts["recordChildSessionCardError"];
}): PrimaryTerminalPorts {
  const { storePorts } = input;
  return {
    store: input.store,
    storeCall: (label, operation) => storePorts.call(label, operation),
    nowIso: input.nowIso,
    activeRun: (runId) => input.activeRuns.get(runId),
    recoveryStore: () => storePorts.recoveryFacts(),
    recordProviderInvocation: (fact) => storePorts.recordProviderInvocation(fact),
    classifyFailure: input.classifyFailure,
    pauseLifecycle: (runId) => input.lifecycle.pause(runId),
    finishLifecycle: (runId, status) => input.lifecycle.finish(runId, status),
    recordFailure: input.recordFailure,
    sourceDirectoryAvailable: input.sourceDirectoryAvailable,
    executeChildSession: input.executeChildSession,
    recordWorkspaceDiff: input.recordWorkspaceDiff,
    recordTimelineCursor: (run, agentIdentityFingerprint, lastSeenIndex) =>
      storePorts.recordAgentTimelineCursor({
        sessionId: run.sessionId,
        runId: run.runId,
        role: run.role,
        agentIdentityFingerprint,
        lastSeenIndex,
        recordedAt: input.nowIso(),
      }),
    recordChildSessionCard: (run, card, result) =>
      storePorts.call("local-console-store-child-session-card", () =>
        storePorts.sessionFacts().recordChildSessionCard({
          parentSessionId: run.sessionId,
          sourceId: card.sourceId,
          childSessionIds: card.childSessionIds,
          runId: run.runId,
          runDir: result.runDir,
          now: input.nowIso(),
        })),
    recordChildSessionCardError: input.recordChildSessionCardError,
  };
}
