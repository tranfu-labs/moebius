import type { TimelineMessage } from "../conversation.js";
import type { LocalConsoleAgentFile } from "./agent-file.js";
import { executePendingWorkerDispatchFlow } from "./worker-dispatch-flow.js";
import {
  decideWorkerClaimCapability,
  decideWorkerClaimRelease,
  decideWorkerContextFailureReport,
  decideWorkerOutstandingWork,
  decideWorkerQueuedDispatch,
  decideWorkerRunId,
  decideWorkerRedirectAbort,
  decideWorkerTaskRelease,
  decideWorkerWakeCheckpoint,
  planPreviousWorkerTask,
  planWorkerActiveLane,
  planWorkerDispatchSequence,
} from "./worker-runtime-plan.js";
import type { LocalConsoleMessage, LocalConsoleSessionWorkspaceSource } from "./types.js";

export interface LocalWorkerRunInput {
  origin: "primary-redirect" | "user-direct";
  sessionId: string;
  runId: string;
  sourceMessage: LocalConsoleMessage;
  role: string;
  selectedAgent: LocalConsoleAgentFile;
  agentFiles: LocalConsoleAgentFile[];
  timeline: TimelineMessage[];
  timelineMessages: LocalConsoleMessage[];
  workspaceSource: LocalConsoleSessionWorkspaceSource;
}

export class LocalWorkerDispatchRuntime {
  private readonly wakeTasks = new Set<Promise<void>>();
  private readonly laneTails = new Map<string, Promise<void>>();
  /** 每个 (session, role) lane 的派工序号：主 Agent 新派工会覆盖尚未启动的旧派工。 */
  private readonly laneSequences = new Map<string, number>();

  constructor(private readonly input: {
    hasClaimCapability(): boolean;
    listMessages(sessionId: string, label: string): Promise<LocalConsoleMessage[]>;
    activeRunForRole(sessionId: string, role: string): { lane: "primary" | "worker"; controller: AbortController } | undefined;
    listAgentFiles(sessionId: string): Promise<LocalConsoleAgentFile[]>;
    stopping(sessionId: string): boolean;
    nextRunId(sessionId: string, messageId: number): Promise<string | null>;
    claim(sessionId: string, role: string, runId: string): Promise<LocalConsoleMessage | null>;
    release(sourceMessage: LocalConsoleMessage, sessionId: string): Promise<void>;
    recordMissingAgent(message: LocalConsoleMessage, sessionId: string, runId: string, role: string): Promise<void>;
    prepareTimeline(messages: LocalConsoleMessage[], agents: LocalConsoleAgentFile[]): {
      timelineMessages: LocalConsoleMessage[];
      timeline: TimelineMessage[];
    };
    nowRunId(): string;
    scheduleRun(input: LocalWorkerRunInput): Promise<void>;
    continuableWorkspace(sessionId: string): Promise<LocalConsoleSessionWorkspaceSource | null>;
    applyPendingContext(sessionId: string): Promise<void>;
    processPending(sessionId: string): void;
    setError(error: unknown): string;
    log(event: string, sessionId: string, role: string | null, error: string): void;
  }) {}

  hasScheduledWorker(sessionId: string): boolean {
    return [...this.laneTails.keys()].some((key) => key.startsWith(`${sessionId}\u0000`));
  }

  hasOutstandingWork(): boolean {
    return decideWorkerOutstandingWork(this.wakeTasks.size, this.laneTails.size).kind === "pending";
  }

  async dispatch(sessionId: string, workspaceSource: LocalConsoleSessionWorkspaceSource): Promise<void> {
    const capability = decideWorkerClaimCapability(this.input.hasClaimCapability());
    if (capability.kind === "skip") return;
    await executePendingWorkerDispatchFlow({
      listPending: () => this.input.listMessages(sessionId, "local-console-store-list-worker-pending"),
      activeRoles: (roles) => new Set([...roles].filter((role) => this.input.activeRunForRole(sessionId, role) !== undefined)),
      queuedRoles: (roles) => new Set([...roles].filter((role) => this.laneTails.has(this.laneKey(sessionId, role)))),
      loadAgents: () => this.input.listAgentFiles(sessionId),
      isStopping: () => this.input.stopping(sessionId),
      nextRunId: (messageId) => this.nextRunId(sessionId, messageId),
      claim: (role, runId) => this.input.claim(sessionId, role, runId),
      releaseIfStopping: (message) => this.releaseIfStopping(message, sessionId),
      recordMissingAgent: (message, runId, role) => this.input.recordMissingAgent(message, sessionId, runId, role),
      prepareRun: async (_message, selectedAgent, agentFiles) => {
        const messages = await this.input.listMessages(sessionId, "local-console-store-list-worker-timeline");
        const prepared = this.input.prepareTimeline(messages, agentFiles);
        return {
          selectedAgent,
          timelineMessages: prepared.timelineMessages,
          timeline: prepared.timeline,
        };
      },
      schedule: ({ runId, sourceMessage, role, agents, prepared }) => this.schedule({
        origin: "user-direct",
        sessionId,
        runId,
        sourceMessage,
        role,
        selectedAgent: prepared.selectedAgent,
        agentFiles: agents,
        timeline: prepared.timeline,
        timelineMessages: prepared.timelineMessages,
        workspaceSource,
      }),
    });
  }

  scheduleWake(sessionId: string): void {
    const task = this.wake(sessionId).finally(() => this.wakeTasks.delete(task));
    this.wakeTasks.add(task);
  }

  schedule(input: LocalWorkerRunInput): void {
    const key = this.laneKey(input.sessionId, input.role);
    const active = this.input.activeRunForRole(input.sessionId, input.role);
    const abort = decideWorkerRedirectAbort({ origin: input.origin, activeLane: planWorkerActiveLane(active?.lane) });
    if (abort.kind === "abort") active!.controller.abort("primary-redirected-active-agent");
    const sequence = planWorkerDispatchSequence(this.laneSequences.get(key), input.origin);
    if (sequence !== null) this.laneSequences.set(key, sequence);
    const previous = planPreviousWorkerTask(this.laneTails.get(key), Promise.resolve());
    const task = previous.catch(() => undefined)
      .then(() => this.runScheduled(input, key, sequence))
      .catch((error: unknown) => this.reportRunFailure(input, error))
      .finally(() => this.finishScheduledRun(input, key, task));
    this.laneTails.set(key, task);
  }

  /** 排队中的旧派工被更新的主 Agent 派工覆盖时，不再启动 provider run。 */
  private async runScheduled(input: LocalWorkerRunInput, key: string, sequence: number | null): Promise<void> {
    const queued = decideWorkerQueuedDispatch(this.laneSequences.get(key), sequence);
    if (queued.kind === "superseded") return;
    await this.input.scheduleRun(input);
  }

  private async wake(sessionId: string): Promise<void> {
    const start = decideWorkerWakeCheckpoint({ stopping: this.input.stopping(sessionId) });
    if (start.kind === "stop") return;
    try {
      const workspaceSource = await this.input.continuableWorkspace(sessionId);
      const workspace = decideWorkerWakeCheckpoint({ stopping: false, workspaceAvailable: workspaceSource !== null });
      if (workspace.kind === "stop") return;
      await this.dispatch(sessionId, workspaceSource!);
    } catch (error) {
      const reason = this.input.setError(error);
      this.input.log("local-console-worker-dispatch-failed", sessionId, null, reason);
    }
  }

  private async releaseIfStopping(sourceMessage: LocalConsoleMessage, sessionId: string): Promise<boolean> {
    const release = decideWorkerClaimRelease(this.input.stopping(sessionId));
    if (release.kind === "keep") return false;
    await this.input.release(sourceMessage, sessionId);
    return true;
  }

  private async nextRunId(sessionId: string, messageId: number): Promise<string> {
    const plan = decideWorkerRunId(await this.input.nextRunId(sessionId, messageId));
    return plan.kind === "resume" ? plan.runId : this.input.nowRunId();
  }

  private reportRunFailure(input: LocalWorkerRunInput, error: unknown): void {
    const reason = this.input.setError(error);
    this.input.log("local-console-worker-run-failed", input.sessionId, input.role, reason);
  }

  private finishScheduledRun(input: LocalWorkerRunInput, key: string, task: Promise<void>): void {
    const release = decideWorkerTaskRelease(this.laneTails.get(key), task);
    if (release.kind === "release") this.laneTails.delete(key);
    void this.input.applyPendingContext(input.sessionId).catch((error: unknown) => {
      const report = decideWorkerContextFailureReport(this.input.stopping(input.sessionId));
      if (report.kind === "report") {
        const reason = this.input.setError(error);
        this.input.log("local-console-apply-pending-context-failed", input.sessionId, null, reason);
      }
    });
    this.input.processPending(input.sessionId);
  }

  private laneKey(sessionId: string, role: string): string {
    return `${sessionId}\u0000${role}`;
  }
}
