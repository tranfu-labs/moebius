import {
  decidePendingCompletion,
  decidePendingProcessingAdmission,
  decidePendingProcessingFollowUp,
  decidePendingIteration,
  decidePendingPrimaryClaim,
  decidePendingWait,
  decidePendingWorkspace,
  planPendingSessionIds,
} from "./pending-processing-plan.js";
import { LocalRetryAfterCurrentRuntime } from "./retry-after-current-runtime.js";
import type { LocalConsoleSessionSummary, LocalConsoleSessionWorkspaceSource } from "./types.js";

export class LocalPendingProcessingRuntime {
  private readonly processingSessions = new Set<string>();
  private readonly pendingProcessSessions = new Set<string>();
  private readonly processingCompletions = new Map<string, Promise<void>>();
  private readonly retryAfterCurrentRuntime: LocalRetryAfterCurrentRuntime;

  constructor(private readonly input: {
    stopping(sessionId: string): boolean;
    repairStale(sessionId: string): Promise<void>;
    applyPendingContext(sessionId: string): Promise<void>;
    continuableWorkspace(sessionId: string): Promise<LocalConsoleSessionWorkspaceSource | null>;
    dispatchWorkers(sessionId: string, workspace: LocalConsoleSessionWorkspaceSource): Promise<void>;
    hasPersistedPrimary(sessionId: string): Promise<boolean>;
    executePrimary(sessionId: string, workspace: LocalConsoleSessionWorkspaceSource): Promise<"continue" | "stop">;
    listSessions(): Promise<LocalConsoleSessionSummary[]>;
    formatError(error: unknown): string;
    setError(error: string): void;
    report(event: string, error: string): void;
  }) {
    this.retryAfterCurrentRuntime = new LocalRetryAfterCurrentRuntime({
      stopping: input.stopping,
      waitForCurrent: (sessionId) => this.waitForCurrentProcessing(sessionId),
      hasPendingProcess: (sessionId) => this.pendingProcessSessions.has(sessionId),
      scheduleProcess: (sessionId) => { void this.process(sessionId); },
      formatError: input.formatError,
      setError: input.setError,
      report: input.report,
    });
  }

  async process(sessionId: string): Promise<void> {
    const admission = decidePendingProcessingAdmission({
      stopping: this.input.stopping(sessionId),
      processing: this.processingSessions.has(sessionId),
      retryReserved: this.retryAfterCurrentRuntime.isReserved(sessionId),
    });
    if (admission.kind === "stop") return;
    if (admission.kind === "queue") {
      this.pendingProcessSessions.add(sessionId);
      return;
    }
    await this.runProcessing(sessionId);
  }

  private async runProcessing(sessionId: string): Promise<void> {
    this.processingSessions.add(sessionId);
    let resolveCompletion!: () => void;
    const completion = new Promise<void>((resolve) => {
      resolveCompletion = resolve;
    });
    this.processingCompletions.set(sessionId, completion);
    try {
      await this.input.repairStale(sessionId);
      await this.input.applyPendingContext(sessionId);
      await this.drain(sessionId);
    } catch (error) {
      const reason = this.input.formatError(error);
      this.input.setError(reason);
      this.input.report("local-console-processing-failed", reason);
    } finally {
      this.processingSessions.delete(sessionId);
      this.processingCompletions.delete(sessionId);
      resolveCompletion();
      const followUp = decidePendingProcessingFollowUp({
        stopping: this.input.stopping(sessionId),
        requested: this.pendingProcessSessions.delete(sessionId),
        retryReserved: this.retryAfterCurrentRuntime.isReserved(sessionId),
      });
      if (followUp.kind === "hold") return;
      if (followUp.kind === "rerun") void this.process(sessionId);
      if (followUp.kind === "clear") this.pendingProcessSessions.delete(sessionId);
    }
  }

  async processAll(): Promise<void> {
    const sessionIds = planPendingSessionIds(await this.input.listSessions());
    for (const sessionId of sessionIds) await this.process(sessionId);
  }

  runRetryAfterCurrent(sessionId: string, action: () => Promise<void>): Promise<boolean> {
    return this.retryAfterCurrentRuntime.run(sessionId, action);
  }

  schedule(sessionId: string): void {
    setTimeout(() => {
      const ready = decidePendingWait({ stopping: this.input.stopping(sessionId), processing: false });
      if (ready.kind === "ready") void this.process(sessionId);
    }, 25);
  }

  beginClosing(): void {
    this.pendingProcessSessions.clear();
  }

  hasOutstandingWork(): boolean {
    return this.processingSessions.size > 0;
  }

  private async waitForCurrentProcessing(sessionId: string): Promise<void> {
    for (;;) {
      const wait = decidePendingCompletion({
        hasCompletion: this.processingCompletions.has(sessionId),
      });
      if (wait === "ready") return;
      await this.processingCompletions.get(sessionId)!;
    }
  }

  private async drain(sessionId: string): Promise<void> {
    for (;;) {
      const admission = decidePendingWorkspace({
        stopping: this.input.stopping(sessionId),
        workspaceAvailable: true,
      });
      if (admission.kind === "stop") return;
      const workspace = await this.input.continuableWorkspace(sessionId);
      const workspaceDecision = decidePendingWorkspace({
        stopping: this.input.stopping(sessionId),
        workspaceAvailable: workspace !== null,
      });
      if (workspaceDecision.kind === "stop") return;
      await this.input.dispatchWorkers(sessionId, workspace!);
      const primary = decidePendingPrimaryClaim(await this.input.hasPersistedPrimary(sessionId));
      if (primary.kind === "stop") return;
      const iteration = decidePendingIteration(await this.input.executePrimary(sessionId, workspace!));
      if (iteration.kind === "stop") return;
    }
  }
}
