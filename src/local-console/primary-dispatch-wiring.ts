import type { LocalCodexRecoveryFacts } from "./codex-resume.js";
import { selectSourceRetryIntent } from "./control-dispatch.js";
import { maybeRouteLocalNoMentionMessage } from "./route-bus.js";
import type { LocalConsoleRuntimeOptions } from "./runtime-contracts.js";
import { formatLocalError } from "./runtime-domain.js";
import type { LocalConsoleStorePorts } from "./runtime-store-ports.js";
import type { LocalPrimaryDispatchRuntime } from "./primary-dispatch-runtime.js";
import type { LocalRouteJudgment, LocalNoMentionRouteInput } from "./route-bus.js";
import { LocalHandoffDispatchRuntime } from "./handoff-dispatch-runtime.js";
import {
  decidePrimaryAgentFileSource,
  decidePrimaryRecoveryFactSource,
  planPrimarySnapshotAgents,
} from "./primary-runtime-plan.js";

type PrimaryDispatchPorts = ConstructorParameters<typeof LocalPrimaryDispatchRuntime>[0];

export function createLocalPrimaryDispatchPorts(input: {
  options: Pick<LocalConsoleRuntimeOptions,
    "store" | "listAgentFiles" | "runCodex"
  >;
  routeJudgment: LocalRouteJudgment;
  validateRouteAppend: LocalNoMentionRouteInput["validateAppend"];
  storePorts: Pick<LocalConsoleStorePorts, "call" | "recoveryFacts">;
  agentsDir: string;
  routeTimeoutMs: number | undefined;
  now(): Date;
  nowIso: PrimaryDispatchPorts["nowIso"];
  inactive: PrimaryDispatchPorts["inactive"];
  gracefulResumeTargets: PrimaryDispatchPorts["gracefulResumeTargets"];
  sessionSummary: PrimaryDispatchPorts["sessionSummary"];
  readRecoveryFacts(logPath: string, sessionId: string): Promise<LocalCodexRecoveryFacts>;
  recordTerminalFailure: PrimaryDispatchPorts["recordTerminalFailure"];
  setError: PrimaryDispatchPorts["setError"];
  scheduleWorker: PrimaryDispatchPorts["scheduleWorker"];
}): PrimaryDispatchPorts {
  const { options, storePorts } = input;
  return {
    store: options.store,
    storeCall: (label, operation) => storePorts.call(label, operation),
    nowIso: input.nowIso,
    nextRunId: () => `local-${input.now().toISOString()}-${Math.random().toString(36).slice(2, 10)}`,
    inactive: input.inactive,
    gracefulResumeTargets: input.gracefulResumeTargets,
    loadAgentFiles: async (sessionId) => {
      const source = decidePrimaryAgentFileSource(
        await options.store.listSessionAgentTeamSnapshot?.(sessionId),
      );
      if (source.kind === "fallback") return await options.listAgentFiles(sessionId);
      return planPrimarySnapshotAgents(source.snapshot.members);
    },
    sessionSummary: input.sessionSummary,
    loadRetryIntent: async (sessionId, sourceMessageId) => {
      const source = decidePrimaryRecoveryFactSource(storePorts.recoveryFacts());
      if (source.kind === "skip") return null;
      const recoveryFacts = await input.readRecoveryFacts(
        source.store.getSessionFactLogPath(sessionId),
        sessionId,
      );
      return selectSourceRetryIntent({
        sourceMessageId,
        intents: recoveryFacts.intents,
        consumedIntentIds: recoveryFacts.consumedIntentIds,
      });
    },
    routeWithoutPrimary: (routeInput) => maybeRouteLocalNoMentionMessage({
      store: options.store,
      message: routeInput.message,
      sessionId: routeInput.sessionId,
      timeline: routeInput.timeline,
      availableAgentNames: routeInput.availableAgentNames,
      runId: routeInput.runId,
      runDir: routeInput.runDir,
      agentsDir: input.agentsDir,
      now: input.nowIso(),
      routeJudgment: input.routeJudgment,
      validateAppend: input.validateRouteAppend,
      timeoutMs: input.routeTimeoutMs,
      runCodex: options.runCodex,
    }),
    recordTerminalFailure: input.recordTerminalFailure,
    formatError: (error) => formatLocalError(error),
    setError: input.setError,
    scheduleWorker: input.scheduleWorker,
    handoffGeneration: new LocalHandoffDispatchRuntime({
      store: options.store,
      storeCall: (label, operation) => storePorts.call(label, operation),
    }),
  };
}
