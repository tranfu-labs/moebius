import {
  decideWorkerDispatchCheckpoint,
  decideWorkerClaim,
  planPendingWorkerDispatches,
  planPendingWorkerRoles,
  planWorkerAgentSelection,
} from "./control-dispatch.js";
import type { LocalConsoleMessage } from "./types.js";

export interface LocalWorkerDispatchAgent {
  name: string;
}

export interface LocalWorkerDispatchPreparedRun<Agent extends LocalWorkerDispatchAgent, Timeline> {
  selectedAgent: Agent;
  timeline: Timeline;
  timelineMessages: LocalConsoleMessage[];
}

export interface LocalWorkerDispatchFlowPorts<Agent extends LocalWorkerDispatchAgent, Timeline> {
  listPending(): Promise<LocalConsoleMessage[]>;
  activeRoles(referencedRoles: ReadonlySet<string>): ReadonlySet<string>;
  queuedRoles(referencedRoles: ReadonlySet<string>): ReadonlySet<string>;
  loadAgents(): Promise<Agent[]>;
  isStopping(): boolean;
  nextRunId(messageId: number): Promise<string>;
  claim(role: string, runId: string): Promise<LocalConsoleMessage | null>;
  releaseIfStopping(message: LocalConsoleMessage): Promise<boolean>;
  recordMissingAgent(message: LocalConsoleMessage, runId: string, role: string): Promise<void>;
  prepareRun(message: LocalConsoleMessage, agent: Agent, agents: Agent[]): Promise<LocalWorkerDispatchPreparedRun<Agent, Timeline>>;
  schedule(input: {
    runId: string;
    sourceMessage: LocalConsoleMessage;
    role: string;
    agents: Agent[];
    prepared: LocalWorkerDispatchPreparedRun<Agent, Timeline>;
  }): void;
}

export async function executePendingWorkerDispatchFlow<Agent extends LocalWorkerDispatchAgent, Timeline>(
  ports: LocalWorkerDispatchFlowPorts<Agent, Timeline>,
): Promise<void> {
  const pendingMessages = await ports.listPending();
  const referencedRoles = planPendingWorkerRoles(pendingMessages);
  const candidates = planPendingWorkerDispatches({
    messages: pendingMessages,
    activeRoles: ports.activeRoles(referencedRoles),
    queuedRoles: ports.queuedRoles(referencedRoles),
  });
  if (candidates.length === 0) return;

  const agents = await ports.loadAgents();
  for (const candidate of candidates) {
    const beforeRunId = decideWorkerDispatchCheckpoint(ports.isStopping());
    if (beforeRunId.kind === "stop") return;
    const runId = await ports.nextRunId(candidate.message.id);
    const beforeClaim = decideWorkerDispatchCheckpoint(ports.isStopping());
    if (beforeClaim.kind === "stop") return;
    const claim = decideWorkerClaim(await ports.claim(candidate.role, runId));
    if (claim.kind === "empty") continue;
    const sourceMessage = claim.message;
    const stoppedAfterClaim = decideWorkerDispatchCheckpoint(
      await ports.releaseIfStopping(sourceMessage),
    );
    if (stoppedAfterClaim.kind === "stop") return;

    const selection = planWorkerAgentSelection(agents.map((agent) => agent.name), candidate.role);
    if (selection.kind === "missing") {
      await ports.recordMissingAgent(sourceMessage, runId, selection.role);
      continue;
    }
    const prepared = await ports.prepareRun(sourceMessage, agents[selection.index]!, agents);
    const stoppedBeforeSchedule = decideWorkerDispatchCheckpoint(
      await ports.releaseIfStopping(sourceMessage),
    );
    if (stoppedBeforeSchedule.kind === "stop") return;
    ports.schedule({
      runId,
      sourceMessage,
      role: candidate.role,
      agents,
      prepared,
    });
  }
}
