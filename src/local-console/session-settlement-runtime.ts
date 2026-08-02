import type { LocalActiveRunRegistry } from "./active-run-registry.js";
import type { LocalPendingProcessingRuntime } from "./pending-processing-runtime.js";
import { decideSessionSettlement } from "./runtime-domain.js";
import type { LocalWorkerDispatchRuntime } from "./worker-dispatch-runtime.js";

export class LocalSessionSettlementRuntime {
  constructor(private readonly input: {
    pending: Pick<LocalPendingProcessingRuntime, "waitForSessionIdle" | "hasSessionWork">;
    workers: Pick<LocalWorkerDispatchRuntime, "waitForSessionIdle" | "hasOutstandingWorkForSession">;
    activeRuns: Pick<LocalActiveRunRegistry, "waitForSessionEmpty" | "hasSession">;
  }) {}

  /**
   * Settled is deliberately event-driven instead of polling: each terminal edge notifies its
   * waiter, so readers never infer persistence from a deadline. The signal means all three
   * quiescence edges hold: pending processing is idle, worker dispatch is idle, and the active
   * run registry is empty for this session. Only the pending edge currently has a production
   * consumer (`processAfterCurrent`); worker idle and active-run empty are test observations
   * through the facade. They remain part of the signal because omitting either would make
   * settlement resolve too early and invalidate its definition. This wait intentionally has no
   * deadline, so a provider that never settles currently falls through to Vitest's generic
   * timeout without runtime-state diagnostics; that is a known follow-up tradeoff.
   */
  async waitForSessionSettled(sessionId: string): Promise<void> {
    for (;;) {
      await this.input.pending.waitForSessionIdle(sessionId);
      await this.input.workers.waitForSessionIdle(sessionId);
      await this.input.activeRuns.waitForSessionEmpty(sessionId);
      const settlement = decideSessionSettlement({
        pending: this.input.pending.hasSessionWork(sessionId),
        workers: this.input.workers.hasOutstandingWorkForSession(sessionId),
        activeRuns: this.input.activeRuns.hasSession(sessionId),
      });
      if (settlement.kind === "settled") return;
    }
  }
}
