import {
  decidePendingAdmission,
  decidePendingFollowUp,
  decidePendingIteration,
  decidePendingPrimaryClaim,
  decidePendingWait,
  decidePendingWorkspace,
  planPendingSessionIds,
} from "./pending-processing-plan.js";
import type { LocalConsoleSessionSummary, LocalConsoleSessionWorkspaceSource } from "./types.js";

export class LocalPendingProcessingRuntime {
  private readonly processingSessions = new Set<string>();
  private readonly pendingProcessSessions = new Set<string>();

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
      processing: this.processingSessions.has(sessionId),
    });
    if (admission.kind === "stop") return;
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
    }
  }

  async processAll(): Promise<void> {
    const sessionIds = planPendingSessionIds(await this.input.listSessions());
    for (const sessionId of sessionIds) await this.process(sessionId);
  }

  async processAfterCurrent(sessionId: string): Promise<void> {
    while (decidePendingWait({
      stopping: this.input.stopping(sessionId),
      processing: this.processingSessions.has(sessionId),
    }).kind === "wait") {
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    const ready = decidePendingWait({
      stopping: this.input.stopping(sessionId),
      processing: this.processingSessions.has(sessionId),
    });
    if (ready.kind === "ready") await this.process(sessionId);
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
