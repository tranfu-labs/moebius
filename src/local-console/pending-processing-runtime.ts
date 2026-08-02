import {
  decidePendingAdmission,
  decidePendingFollowUp,
  decidePendingIteration,
  decidePendingPrimaryClaim,
  decidePendingSessionWork,
  decidePendingTurnResult,
  decidePendingWait,
  decidePendingWorkspace,
  planPendingSessionIds,
} from "./pending-processing-plan.js";
import { LocalPendingProcessingSignals } from "./pending-processing-signals.js";
import type { LocalConsoleSessionSummary, LocalConsoleSessionWorkspaceSource } from "./types.js";

export class LocalPendingProcessingRuntime {
  private readonly processingSessions = new Set<string>();
  private readonly pendingProcessSessions = new Set<string>();
  private readonly sessionSignals = new LocalPendingProcessingSignals();
  private closing = false;

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
  }) {}

  async process(sessionId: string): Promise<void> {
    const admission = decidePendingAdmission({
      stopping: this.input.stopping(sessionId),
      closing: this.closing,
      processing: this.processingSessions.has(sessionId),
    });
    if (admission.kind === "stop") {
      this.resolveProcessingTurn(sessionId, "stopped");
      this.resolveSessionIdle(sessionId);
      return;
    }
    if (admission.kind === "queue") {
      this.pendingProcessSessions.add(sessionId);
      return;
    }
    this.processingSessions.add(sessionId);
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
      const followUp = decidePendingFollowUp({
        stopping: this.input.stopping(sessionId),
        requested: this.pendingProcessSessions.delete(sessionId),
      });
      if (followUp.kind === "rerun") void this.process(sessionId);
      if (followUp.kind === "clear") this.pendingProcessSessions.delete(sessionId);
      this.resolveProcessingTurn(sessionId, decidePendingTurnResult(this.input.stopping(sessionId)));
      this.resolveSessionIdle(sessionId);
    }
  }

  async processAll(): Promise<void> {
    const sessionIds = planPendingSessionIds(await this.input.listSessions());
    for (const sessionId of sessionIds) await this.process(sessionId);
  }

  async processAfterCurrent(sessionId: string): Promise<void> {
    await this.waitForProcessingTurn(sessionId);
    await this.process(sessionId);
  }

  schedule(sessionId: string): void {
    this.sessionSignals.schedule({
      sessionId,
      stopping: () => this.input.stopping(sessionId),
      closing: () => this.closing,
      onReady: () => void this.process(sessionId),
      onStopped: () => this.resolveProcessingTurn(sessionId, "stopped"),
      otherWork: () => this.hasActiveSessionWork(sessionId),
    });
  }

  beginClosing(): void {
    this.closing = true;
    this.pendingProcessSessions.clear();
    const affectedSessions = this.sessionSignals.cancelAll();
    this.sessionSignals.resolveAllResults("stopped");
    for (const sessionId of affectedSessions) this.resolveSessionIdle(sessionId);
  }

  hasOutstandingWork(): boolean {
    return this.processingSessions.size > 0;
  }

  hasSessionWork(sessionId: string): boolean {
    return decidePendingSessionWork({
      processing: this.processingSessions.has(sessionId),
      pending: this.pendingProcessSessions.has(sessionId),
      scheduled: this.sessionSignals.has(sessionId),
    }).kind === "pending";
  }

  /**
   * Event-driven quiescence for pending processing: no current turn, queued follow-up,
   * or scheduled turn remains. The runtime-level settled signal composes this with worker
   * dispatch idle and an empty active-run registry; no polling deadline can observe an
   * intermediate state as complete.
   */
  async waitForSessionIdle(sessionId: string): Promise<void> {
    await this.sessionSignals.waitForIdle(sessionId, this.hasActiveSessionWork(sessionId));
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

  private async waitForProcessingTurn(sessionId: string): Promise<"ready" | "stopped"> {
    const ready = decidePendingWait({
      stopping: this.input.stopping(sessionId),
      closing: this.closing,
      processing: this.processingSessions.has(sessionId),
    });
    if (ready.kind === "stop") return "stopped";
    if (ready.kind === "ready") return "ready";
    return await this.sessionSignals.waitForResult<"ready" | "stopped">(sessionId);
  }

  private resolveProcessingTurn(sessionId: string, result: "ready" | "stopped"): void {
    this.sessionSignals.resolveResult(sessionId, result);
  }

  private resolveSessionIdle(sessionId: string): void {
    this.sessionSignals.notifyIfIdle(sessionId, this.hasActiveSessionWork(sessionId));
  }

  private hasActiveSessionWork(sessionId: string): boolean {
    return decidePendingSessionWork({
      processing: this.processingSessions.has(sessionId),
      pending: this.pendingProcessSessions.has(sessionId),
      scheduled: false,
    }).kind === "pending";
  }
}
