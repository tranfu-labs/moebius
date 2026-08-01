import { buildLocalConsoleTimeline } from "./timeline.js";
import type { LocalConsoleRuntimeOptions } from "./runtime-contracts.js";
import type { LocalConsoleStorePorts } from "./runtime-store-ports.js";
import type { LocalWorkerDispatchRuntime } from "./worker-dispatch-runtime.js";
import {
  decideWorkerAgentFileSource,
  planWorkerSnapshotAgents,
  planWorkerTimelineMessages,
} from "./worker-runtime-plan.js";

type WorkerDispatchPorts = ConstructorParameters<typeof LocalWorkerDispatchRuntime>[0];

export function createLocalWorkerDispatchPorts(input: {
  options: Pick<LocalConsoleRuntimeOptions, "store" | "listAgentFiles">;
  storePorts: Pick<LocalConsoleStorePorts, "call">;
  activeRunForRole: WorkerDispatchPorts["activeRunForRole"];
  stopping: WorkerDispatchPorts["stopping"];
  nextRunId: WorkerDispatchPorts["nextRunId"];
  recordMissingAgent: WorkerDispatchPorts["recordMissingAgent"];
  nowIso(): string;
  nowRunId: WorkerDispatchPorts["nowRunId"];
  scheduleRun: WorkerDispatchPorts["scheduleRun"];
  continuableWorkspace: WorkerDispatchPorts["continuableWorkspace"];
  applyPendingContext: WorkerDispatchPorts["applyPendingContext"];
  processPending: WorkerDispatchPorts["processPending"];
  setError: WorkerDispatchPorts["setError"];
  report: WorkerDispatchPorts["log"];
}): WorkerDispatchPorts {
  const { options, storePorts } = input;
  return {
    hasClaimCapability: () => options.store.claimNextPendingWorkerMessage !== undefined,
    listMessages: (sessionId, label) => storePorts.call(label, () => options.store.listMessages(sessionId)),
    activeRunForRole: input.activeRunForRole,
    listAgentFiles: async (sessionId) => {
      const source = decideWorkerAgentFileSource(
        await options.store.listSessionAgentTeamSnapshot?.(sessionId),
      );
      if (source.kind === "fallback") return await options.listAgentFiles(sessionId);
      return planWorkerSnapshotAgents(source.snapshot.members);
    },
    stopping: input.stopping,
    nextRunId: input.nextRunId,
    claim: (sessionId, role, runId) => storePorts.call("local-console-store-claim-worker", () =>
      options.store.claimNextPendingWorkerMessage!.call(options.store, {
        sessionId,
        role,
        runId,
        now: input.nowIso(),
      })),
    release: (message, sessionId) => storePorts.call("local-console-store-release-stopped-worker-claim", () =>
      options.store.releaseMessageForRetry({
        userMessageId: message.id,
        sessionId,
        now: input.nowIso(),
      })),
    recordMissingAgent: input.recordMissingAgent,
    prepareTimeline: (messages, agents) => {
      const timelineMessages = planWorkerTimelineMessages(messages);
      return {
        timelineMessages,
        timeline: buildLocalConsoleTimeline(timelineMessages, agents.map((agent) => agent.name)),
      };
    },
    nowRunId: input.nowRunId,
    scheduleRun: input.scheduleRun,
    continuableWorkspace: input.continuableWorkspace,
    applyPendingContext: input.applyPendingContext,
    processPending: input.processPending,
    setError: input.setError,
    log: input.report,
  };
}
