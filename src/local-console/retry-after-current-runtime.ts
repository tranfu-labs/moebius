import {
  decideRetryAfterCurrentAttempt,
  decideRetryAfterCurrentFinish,
  decideRetryDrainRequest,
  decideRetryOperationResult,
  decideRetryTailCleanup,
  decideRetryTailSource,
  planRetryReservationCount,
} from "./pending-processing-plan.js";

export class LocalRetryAfterCurrentRuntime {
  private readonly reservations = new Map<string, number>();
  private readonly tails = new Map<string, Promise<void>>();
  private readonly drainRequested = new Set<string>();

  constructor(private readonly input: {
    stopping(sessionId: string): boolean;
    waitForCurrent(sessionId: string): Promise<void>;
    hasPendingProcess(sessionId: string): boolean;
    scheduleProcess(sessionId: string): void;
    formatError(error: unknown): string;
    setError(error: string): void;
    report(event: string, error: string): void;
  }) {}

  isReserved(sessionId: string): boolean {
    return this.reservations.has(sessionId);
  }

  run(sessionId: string, action: () => Promise<void>): Promise<boolean> {
    const attempt = decideRetryAfterCurrentAttempt(this.input.stopping(sessionId));
    if (attempt.kind === "stop") return Promise.resolve(false);
    const reservations = planRetryReservationCount(this.reservations.get(sessionId));
    this.reservations.set(sessionId, reservations + 1);
    const previousTail = this.tails.get(sessionId);
    const previous = decideRetryTailSource(previousTail !== undefined).kind === "existing"
      ? previousTail!
      : Promise.resolve();
    const operation = this.createOperation(sessionId, previous, action);
    const tail = operation.then(() => undefined, () => undefined);
    this.tails.set(sessionId, tail);
    void tail.then(() => {
      if (decideRetryTailCleanup({ currentTail: this.tails.get(sessionId) === tail }) === "cleanup") {
        this.tails.delete(sessionId);
      }
    });
    return operation;
  }

  private createOperation(
    sessionId: string,
    previous: Promise<void>,
    action: () => Promise<void>,
  ): Promise<boolean> {
    let succeeded = false;
    return previous.then(async () => {
      try {
        succeeded = await this.performAction(sessionId, action);
      } catch (error) {
        const reason = this.input.formatError(error);
        this.input.setError(reason);
        this.input.report("local-console-processing-failed", reason);
        throw error;
      } finally {
        succeeded = decideRetryOperationResult({
          scheduled: this.finish(sessionId, succeeded),
          succeeded,
        });
      }
      return succeeded;
    });
  }

  private async performAction(sessionId: string, action: () => Promise<void>): Promise<boolean> {
    await this.input.waitForCurrent(sessionId);
    const attempt = decideRetryAfterCurrentAttempt(this.input.stopping(sessionId));
    if (attempt.kind === "stop") return false;
    await action();
    return true;
  }

  private finish(sessionId: string, succeeded: boolean): boolean {
    const requested = decideRetryDrainRequest({
      succeeded,
      requested: this.drainRequested.has(sessionId),
    });
    if (requested) this.drainRequested.add(sessionId);
    const decision = decideRetryAfterCurrentFinish({
      reservations: planRetryReservationCount(this.reservations.get(sessionId)),
      succeeded,
      stopping: this.input.stopping(sessionId),
      retryDrainRequested: requested,
      pendingProcess: this.input.hasPendingProcess(sessionId),
    });
    if (decision.kind === "retain") {
      this.reservations.set(sessionId, decision.remaining);
      return decision.accepted;
    }
    this.reservations.delete(sessionId);
    this.drainRequested.delete(sessionId);
    if (decision.shouldSchedule) this.input.scheduleProcess(sessionId);
    return decision.accepted;
  }
}
