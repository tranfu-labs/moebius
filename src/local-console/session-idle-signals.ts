import {
  decideSessionIdleBucket,
  decideSessionIdleCleanup,
  decideSessionIdleRemoval,
  decideSessionIdleWait,
} from "./runtime-domain.js";

/**
 * Small event-driven bookkeeping seam shared by session runtimes. A waiter is released
 * only when tracked work is removed and the owning runtime confirms its other work is idle;
 * it never guesses quiescence from a polling deadline.
 */
export class LocalSessionIdleSignals<T> {
  private readonly tasks = new Map<string, Set<T>>();
  private readonly waiters = new Map<string, Set<() => void>>();
  private readonly resultWaiters = new Map<string, Set<(result: unknown) => void>>();

  add(sessionId: string, task: T): void {
    const bucket = decideSessionIdleBucket(this.tasks.has(sessionId));
    const tasks = bucket.kind === "create" ? new Set<T>() : this.tasks.get(sessionId)!;
    tasks.add(task);
    this.tasks.set(sessionId, tasks);
  }

  remove(sessionId: string, task: T, otherWork = false): void {
    const removal = decideSessionIdleRemoval(this.tasks.has(sessionId));
    if (removal.kind === "ignore") return;
    const tasks = this.tasks.get(sessionId)!;
    tasks.delete(task);
    const cleanup = decideSessionIdleCleanup(tasks.size === 0);
    if (cleanup.kind === "delete") this.tasks.delete(sessionId);
    this.notifyIfIdle(sessionId, otherWork);
  }

  has(sessionId: string): boolean {
    return this.tasks.has(sessionId);
  }

  count(): number {
    let count = 0;
    for (const tasks of this.tasks.values()) count += tasks.size;
    return count;
  }

  cancelAll(cancel: (task: T) => void): string[] {
    const affectedSessions = [...this.tasks.keys()];
    for (const tasks of this.tasks.values()) for (const task of tasks) cancel(task);
    this.tasks.clear();
    return affectedSessions;
  }

  async waitForIdle(sessionId: string, otherWork = false): Promise<void> {
    const wait = decideSessionIdleWait({ tracked: this.has(sessionId), otherWork });
    if (wait.kind === "return") return;
    await new Promise<void>((resolve) => {
      const bucket = decideSessionIdleBucket(this.waiters.has(sessionId));
      const waiters = bucket.kind === "create" ? new Set<() => void>() : this.waiters.get(sessionId)!;
      waiters.add(resolve);
      this.waiters.set(sessionId, waiters);
    });
  }

  async waitForResult<R>(sessionId: string): Promise<R> {
    return await new Promise<R>((resolve) => {
      const bucket = decideSessionIdleBucket(this.resultWaiters.has(sessionId));
      const waiters = bucket.kind === "create"
        ? new Set<(result: unknown) => void>()
        : this.resultWaiters.get(sessionId)!;
      waiters.add(resolve as (result: unknown) => void);
      this.resultWaiters.set(sessionId, waiters);
    });
  }

  resolveResult<R>(sessionId: string, result: R): void {
    const presence = decideSessionIdleRemoval(this.resultWaiters.has(sessionId));
    if (presence.kind === "ignore") return;
    const waiters = this.resultWaiters.get(sessionId)!;
    this.resultWaiters.delete(sessionId);
    for (const resolve of waiters) resolve(result);
  }

  resolveAllResults<R>(result: R): void {
    for (const sessionId of this.resultWaiters.keys()) this.resolveResult(sessionId, result);
  }

  notifyIfIdle(sessionId: string, otherWork = false): void {
    const wait = decideSessionIdleWait({ tracked: this.has(sessionId), otherWork });
    if (wait.kind === "wait") return;
    const presence = decideSessionIdleRemoval(this.waiters.has(sessionId));
    if (presence.kind === "ignore") return;
    const waiters = this.waiters.get(sessionId)!;
    this.waiters.delete(sessionId);
    for (const resolve of waiters) resolve();
  }
}
