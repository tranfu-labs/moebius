export interface ConsoleSelection {
  projectId: string;
  sessionId: string;
}

export interface SessionViewTransitionTicket {
  readonly generation: number;
  readonly completion: Promise<void>;
}

export class SessionViewTransitionQueue {
  private tail: Promise<void> = Promise.resolve();
  private latestGeneration = 0;
  private latestSettledGeneration = 0;

  enqueue(task: () => Promise<void>): SessionViewTransitionTicket {
    const generation = ++this.latestGeneration;
    const execution = this.tail.then(task);
    this.tail = execution.catch(() => undefined);
    const completion = execution.finally(() => {
      this.latestSettledGeneration = Math.max(this.latestSettledGeneration, generation);
    });
    return { generation, completion };
  }

  get isPending(): boolean {
    return this.latestSettledGeneration < this.latestGeneration;
  }

  isLatest(generation: number): boolean {
    return generation === this.latestGeneration;
  }
}

export class ProcessInvocationRequestCoordinator {
  private readonly controllers = new Map<string, AbortController>();

  begin(key: string): AbortController {
    this.controllers.get(key)?.abort();
    const controller = new AbortController();
    this.controllers.set(key, controller);
    return controller;
  }

  isCurrent(key: string, controller: AbortController): boolean {
    return !controller.signal.aborted && this.controllers.get(key) === controller;
  }

  finish(key: string, controller: AbortController): boolean {
    if (!this.isCurrent(key, controller)) return false;
    this.controllers.delete(key);
    return true;
  }

  abortAll(): void {
    for (const controller of this.controllers.values()) controller.abort();
    this.controllers.clear();
  }
}

export type SelectionMutationKind =
  | "create-session"
  | "open-project"
  | "rebind-session"
  | "archive-session"
  | "analyze-conversation";

export interface SelectionMutationToken {
  readonly id: number;
  readonly kind: SelectionMutationKind;
}

export interface RefreshLease {
  readonly generation: number;
  readonly controller: AbortController;
  readonly mutationOwner: SelectionMutationToken | null;
}

export class ConsoleStateCoordinator {
  private generation = 0;
  private refreshLease: RefreshLease | null = null;
  private mutationToken: SelectionMutationToken | null = null;
  private nextMutationId = 1;
  private sendPending = false;

  beginRefresh(mutationOwner: SelectionMutationToken | null = null): RefreshLease | null {
    if (mutationOwner !== null && this.mutationToken !== mutationOwner) return null;
    if (this.refreshLease !== null) {
      if (mutationOwner === null || this.refreshLease.mutationOwner === mutationOwner) return null;
      this.invalidateRefresh();
    }
    this.generation += 1;
    const lease = {
      generation: this.generation,
      controller: new AbortController(),
      mutationOwner,
    };
    this.refreshLease = lease;
    return lease;
  }

  canCommitRefresh(lease: RefreshLease): boolean {
    return this.refreshLease === lease
      && lease.generation === this.generation
      && lease.mutationOwner === this.mutationToken
      && !lease.controller.signal.aborted;
  }

  completeRefresh(lease: RefreshLease): void {
    if (this.refreshLease === lease) this.refreshLease = null;
  }

  invalidateRefresh(): void {
    this.generation += 1;
    this.refreshLease?.controller.abort("superseded");
    this.refreshLease = null;
  }

  beginSelectionMutation(kind: SelectionMutationKind): SelectionMutationToken | null {
    if (this.mutationToken !== null || this.sendPending) return null;
    this.invalidateRefresh();
    const token = { id: this.nextMutationId, kind };
    this.nextMutationId += 1;
    this.mutationToken = token;
    return token;
  }

  endSelectionMutation(token: SelectionMutationToken): boolean {
    if (this.mutationToken !== token) return false;
    this.mutationToken = null;
    return true;
  }

  get mutationKind(): SelectionMutationKind | null {
    return this.mutationToken?.kind ?? null;
  }

  get isSelectionMutationPending(): boolean {
    return this.mutationToken !== null;
  }

  beginSend(): boolean {
    if (this.sendPending || this.mutationToken !== null) return false;
    this.sendPending = true;
    return true;
  }

  endSend(): void {
    this.sendPending = false;
  }

  get isSendPending(): boolean {
    return this.sendPending;
  }
}
