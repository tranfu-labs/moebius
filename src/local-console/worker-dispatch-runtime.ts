import type { TimelineMessage } from "../conversation.js";
import type { LocalConsoleAgentFile } from "./agent-file.js";
import { executePendingWorkerDispatchFlow } from "./worker-dispatch-flow.js";
import {
  decideWorkerClaimCapability,
  decideWorkerClaimRelease,
  decideWorkerContextFailureReport,
  decideWorkerOutstandingWork,
  decideWorkerRunId,
  decideWorkerRedirectAbort,
  decideWorkerSessionOutstandingWork,
  decideWorkerTaskRelease,
  decideWorkerWakeCheckpoint,
  planPreviousWorkerTask,
  planWorkerActiveLane,
} from "./worker-runtime-plan.js";
import { LocalSessionIdleSignals } from "./session-idle-signals.js";
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
  private readonly laneTails = new Map<string, Promise<void>>();
  private readonly sessionSignals = new LocalSessionIdleSignals<Promise<void>>();

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
    return decideWorkerOutstandingWork(
      this.sessionSignals.count(),
      this.laneTails.size,
    ).kind === "pending";
  }

  hasOutstandingWorkForSession(sessionId: string): boolean {
    const laneWork = [...this.laneTails.keys()].some((key) => key.startsWith(`${sessionId}\u0000`));
    return decideWorkerSessionOutstandingWork(laneWork, this.sessionSignals.has(sessionId)).kind === "pending";
  }

  async waitForSessionIdle(sessionId: string): Promise<void> {
    await this.sessionSignals.waitForIdle(sessionId, this.hasScheduledWorker(sessionId));
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
    const task = this.wake(sessionId);
    this.sessionSignals.add(sessionId, task);
    void task.then(
      () => this.finishWakeTask(sessionId, task),
      () => this.finishWakeTask(sessionId, task),
    );
  }

  schedule(input: LocalWorkerRunInput): void {
    const key = this.laneKey(input.sessionId, input.role);
    const active = this.input.activeRunForRole(input.sessionId, input.role);
    const abort = decideWorkerRedirectAbort({ origin: input.origin, activeLane: planWorkerActiveLane(active?.lane) });
    if (abort.kind === "abort") active!.controller.abort("primary-redirected-active-agent");
    const previous = planPreviousWorkerTask(this.laneTails.get(key), Promise.resolve());
    const task = previous.catch(() => undefined).then(() => this.input.scheduleRun(input))
      .catch((error: unknown) => this.reportRunFailure(input, error))
      .finally(() => this.finishScheduledRun(input, key, task));
    this.laneTails.set(key, task);
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
    const contextTask = this.input.applyPendingContext(input.sessionId).catch((error: unknown) => {
      const report = decideWorkerContextFailureReport(this.input.stopping(input.sessionId));
      if (report.kind === "report") {
        const reason = this.input.setError(error);
        this.input.log("local-console-apply-pending-context-failed", input.sessionId, null, reason);
      }
    });
    this.sessionSignals.add(input.sessionId, contextTask);
    void contextTask.then(
      () => this.finishContextTask(input.sessionId, contextTask),
      () => this.finishContextTask(input.sessionId, contextTask),
    );
    this.input.processPending(input.sessionId);
  }

  private laneKey(sessionId: string, role: string): string {
    return `${sessionId}\u0000${role}`;
  }

  private finishContextTask(sessionId: string, task: Promise<void>): void {
    this.sessionSignals.remove(sessionId, task, this.hasScheduledWorker(sessionId));
  }

  private finishWakeTask(sessionId: string, task: Promise<void>): void {
    this.sessionSignals.remove(sessionId, task, this.hasScheduledWorker(sessionId));
  }
}
