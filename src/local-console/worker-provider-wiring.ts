import type { ActiveLocalRun } from "./active-run.js";
import type { LocalExecutionRunner } from "./execution-driver.js";
import type { LocalConsoleStorePorts } from "./runtime-store-ports.js";
import type { LocalWorkerProviderRuntime } from "./worker-provider-runtime.js";
import {
  decideLocalActiveRunTarget,
  planLocalProviderExecutionOptions,
} from "./provider-invocation-plan.js";
import {
  decideWorkerStopHandling,
} from "./worker-runtime-plan.js";

type WorkerProviderPorts = ConstructorParameters<typeof LocalWorkerProviderRuntime>[0];

export function createLocalWorkerProviderPorts(input: {
  storePorts: Pick<LocalConsoleStorePorts,
    | "call"
    | "sessionFacts"
    | "recordProviderInvocation"
    | "recordProviderSessionObserved"
    | "recordAgentSessionLink"
    | "recordExecutionSessionLink"
    | "recordCodexThreadLink"
  >;
  executionRunner: LocalExecutionRunner;
  idleTimeoutMs: number | undefined;
  toolTimeoutMs: number | undefined;
  stopping(sessionId: string): boolean;
  releaseClaim(input: Parameters<WorkerProviderPorts["releaseIfStopping"]>[0]): Promise<void>;
  finishLifecycle(runId: string): Promise<void>;
  activeRun(runId: string): ActiveLocalRun | undefined;
  nowIso: WorkerProviderPorts["nowIso"];
  onProcessStarted: WorkerProviderPorts["onProcessStarted"];
  updateAgentProgress(runId: string, text: string): void;
  onStructuredActivity: WorkerProviderPorts["onStructuredActivity"];
  onExecutionProgress: WorkerProviderPorts["onExecutionProgress"];
}): WorkerProviderPorts {
  const { storePorts } = input;
  return {
    nowIso: input.nowIso,
    releaseIfStopping: async (workerInput) => {
      const stop = decideWorkerStopHandling({
        stopping: input.stopping(workerInput.sessionId),
        origin: workerInput.origin,
      });
      if (stop.kind !== "release-and-stop") return false;
      await input.releaseClaim(workerInput);
      await input.finishLifecycle(workerInput.runId);
      return true;
    },
    recordProviderInvocation: (fact) => storePorts.recordProviderInvocation(fact),
    runProvider: (preparation, callbacks) => input.executionRunner({
      prompt: preparation.prompt,
      runDir: preparation.runDir,
      cwd: preparation.workspace.cwd,
      profile: preparation.executionContext.profile,
      mode: preparation.invocationPlan.providerMode,
      signal: preparation.controller.signal,
      ...planLocalProviderExecutionOptions({
        idleTimeoutMs: input.idleTimeoutMs,
        toolTimeoutMs: input.toolTimeoutMs,
        imagePaths: preparation.preparedAttachments.imagePaths,
      }),
      workspaceAccess: preparation.invocationPlan.workspaceAccess,
      managedProcess: { sessionId: preparation.activeRun.sessionId, providerRunId: preparation.activeRun.runId },
      ...callbacks,
    }),
    onVisibleAgentMarkdown: (workerInput, text) => {
      const target = decideLocalActiveRunTarget(input.activeRun(workerInput.runId), workerInput.sessionId);
      if (target.kind === "skip") return async () => undefined;
      target.active.liveMarkdown = text;
      input.updateAgentProgress(workerInput.runId, text);
      const recordedAt = input.nowIso();
      return () => storePorts.call("local-console-store-record-worker-progress", () =>
        storePorts.sessionFacts().recordProgressEvent({
          sessionId: workerInput.sessionId,
          runId: workerInput.runId,
          role: workerInput.role,
          body: text,
          now: recordedAt,
        }));
    },
    onProcessStarted: input.onProcessStarted,
    onStructuredActivity: input.onStructuredActivity,
    onExecutionProgress: input.onExecutionProgress,
    setActiveExternalSessionId: (sessionId, runId, externalSessionId) => {
      const target = decideLocalActiveRunTarget(input.activeRun(runId), sessionId);
      if (target.kind === "update") target.active.threadId = externalSessionId;
    },
    recordProviderSessionObserved: (fact) => storePorts.recordProviderSessionObserved(fact),
    recordAgentSessionLink: (fact) => storePorts.recordAgentSessionLink(fact),
    recordExecutionSessionLink: (fact) => storePorts.recordExecutionSessionLink(fact),
    recordCodexThreadLink: (fact) => storePorts.recordCodexThreadLink(fact),
  };
}
