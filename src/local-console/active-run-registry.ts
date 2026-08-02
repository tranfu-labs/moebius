import type { ActiveLocalRun } from "./active-run.js";

export class LocalActiveRunRegistry {
  private readonly runs = new Map<string, ActiveLocalRun>();
  private readonly sessionEmptyWaiters = new Map<string, Set<() => void>>();

  get(runId: string): ActiveLocalRun | undefined {
    return this.runs.get(runId);
  }

  set(runId: string, active: ActiveLocalRun): void {
    this.runs.set(runId, active);
  }

  delete(runId: string): void {
    const active = this.runs.get(runId);
    this.runs.delete(runId);
    if (active !== undefined) this.resolveSessionEmpty(active.sessionId);
  }

  hasSession(sessionId: string): boolean {
    return [...this.runs.values()].some((active) => active.sessionId === sessionId);
  }

  async waitForSessionEmpty(sessionId: string): Promise<void> {
    if (!this.hasSession(sessionId)) return;
    await new Promise<void>((resolve) => {
      const waiters = this.sessionEmptyWaiters.get(sessionId) ?? new Set<() => void>();
      waiters.add(resolve);
      this.sessionEmptyWaiters.set(sessionId, waiters);
    });
  }

  keys(): IterableIterator<string> {
    return this.runs.keys();
  }

  values(): IterableIterator<ActiveLocalRun> {
    return this.runs.values();
  }

  private resolveSessionEmpty(sessionId: string): void {
    if (this.hasSession(sessionId)) return;
    const waiters = this.sessionEmptyWaiters.get(sessionId);
    if (waiters === undefined) return;
    this.sessionEmptyWaiters.delete(sessionId);
    for (const resolve of waiters) resolve();
  }
}
