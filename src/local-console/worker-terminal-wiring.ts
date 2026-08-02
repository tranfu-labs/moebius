import type { ActiveLocalRun } from "./active-run.js";
import type { LocalConsoleStorePorts } from "./runtime-store-ports.js";
import type { LocalWorkerTerminalRuntime } from "./worker-terminal-runtime.js";
import type { LocalConsoleStore } from "./types.js";

type WorkerTerminalPorts = ConstructorParameters<typeof LocalWorkerTerminalRuntime>[0];

export function createLocalWorkerTerminalPorts(input: {
  store: LocalConsoleStore;
  storePorts: Pick<LocalConsoleStorePorts,
    | "call"
    | "recoveryFacts"
    | "sessionFacts"
    | "recordProviderInvocation"
    | "recordAgentTimelineCursor"
  >;
  nowIso: WorkerTerminalPorts["nowIso"];
  activeRun(runId: string): ActiveLocalRun | undefined;
  classifyFailure: WorkerTerminalPorts["classifyFailure"];
  pauseLifecycle: WorkerTerminalPorts["pauseLifecycle"];
  finishLifecycle: WorkerTerminalPorts["finishLifecycle"];
  recordDirectFailure: WorkerTerminalPorts["recordDirectFailure"];
  recordDetachedFailure: WorkerTerminalPorts["recordDetachedFailure"];
  sourceDirectoryAvailable: WorkerTerminalPorts["sourceDirectoryAvailable"];
  executeChildSession: WorkerTerminalPorts["executeChildSession"];
  recordWorkspaceDiff: WorkerTerminalPorts["recordWorkspaceDiff"];
}): WorkerTerminalPorts {
  const { storePorts } = input;
  return {
    store: input.store,
    storeCall: (label, operation) => storePorts.call(label, operation),
    nowIso: input.nowIso,
    activeRun: input.activeRun,
    recoveryStore: () => storePorts.recoveryFacts(),
    recordProviderInvocation: (fact) => storePorts.recordProviderInvocation(fact),
    classifyFailure: input.classifyFailure,
    pauseLifecycle: input.pauseLifecycle,
    finishLifecycle: input.finishLifecycle,
    recordDirectFailure: input.recordDirectFailure,
    recordDetachedFailure: input.recordDetachedFailure,
    sourceDirectoryAvailable: input.sourceDirectoryAvailable,
    executeChildSession: input.executeChildSession,
    recordWorkspaceDiff: input.recordWorkspaceDiff,
    recordTimelineCursor: (workerInput, agentIdentityFingerprint, lastSeenIndex) =>
      storePorts.recordAgentTimelineCursor({
        sessionId: workerInput.sessionId,
        runId: workerInput.runId,
        role: workerInput.role,
        agentIdentityFingerprint,
        lastSeenIndex,
        recordedAt: input.nowIso(),
      }),
    recordChildSessionCard: (workerInput, card, result) =>
      storePorts.call("local-console-store-worker-child-session-card", () =>
        storePorts.sessionFacts().recordChildSessionCard({
          parentSessionId: workerInput.sessionId,
          sourceId: card.sourceId,
          childSessionIds: card.childSessionIds,
          runId: workerInput.runId,
          runDir: result.runDir,
          now: input.nowIso(),
        })),
  };
}
