import {
  decideExistingOverrideRetry,
  decideRetryRequest,
  decidePendingRetryAdmission,
  decideRetryAdmissionRelease,
  planRetryAcceptance,
  planRetryAdmission,
  planRetryAdmissionKey,
  planRetryIdempotencyPreflight,
  type RetryAdmission,
  type RetryExecutionOverride,
  type RetryRecoveryBundle,
} from "./run-retry-plan.js";
import { LocalConsoleBusyError, type LocalConsoleMessage } from "./types.js";

export class LocalConsoleRunRetryRuntime {
  private readonly pendingAdmissions = new Map<string, Promise<boolean>>();

  constructor(private readonly input: {
    nowIso(): string;
    randomId(): string;
    assertSessionCanContinue(sessionId: string): Promise<void>;
    listMessages(sessionId: string): Promise<LocalConsoleMessage[]>;
    loadRecoveryBundle(sessionId: string): Promise<RetryRecoveryBundle>;
    activeRunForRole(sessionId: string, role: string): boolean;
    recordRetryIntent(input: {
      sessionId: string;
      intentId: string;
      targetRunId: string;
      sourceMessageId: number;
      role: string;
      reason: "retry";
      executionOverride?: RetryExecutionOverride;
      createdAt: string;
    }): Promise<void>;
    releaseMessageForRetry(input: { userMessageId: number; sessionId: string; now: string }): Promise<void>;
    processAfterCurrent(sessionId: string): void;
    storeCall<T>(label: string, operation: () => Promise<T>): Promise<T>;
  }) {}

  async retry(input: {
    sessionId: string;
    runId: string;
    executionOverride?: RetryExecutionOverride;
  }): Promise<boolean> {
    const request = decideRetryRequest(input.executionOverride);
    if (request.kind === "invalid") return false;
    const preflight = planRetryIdempotencyPreflight(input.executionOverride);
    if (preflight.kind === "check") {
      const existing = decideExistingOverrideRetry({
        runId: input.runId,
        executionOverride: preflight.executionOverride,
        bundle: await this.input.loadRecoveryBundle(input.sessionId),
      });
      if (existing.kind === "already-accepted") return true;
    }
    await this.input.assertSessionCanContinue(input.sessionId);
    const messages = await this.input.listMessages(input.sessionId);
    const admission = planRetryAdmission({
      sessionId: input.sessionId,
      runId: input.runId,
      messages,
      bundle: await this.input.loadRecoveryBundle(input.sessionId),
      executionOverride: input.executionOverride,
    });
    if (admission === null) return false;
    const key = planRetryAdmissionKey(admission);
    const pending = decidePendingRetryAdmission(this.pendingAdmissions.get(key));
    if (pending.kind === "join") return await pending.pending;
    const accepted = this.accept(admission);
    this.pendingAdmissions.set(key, accepted);
    try {
      return await accepted;
    } finally {
      const release = decideRetryAdmissionRelease(this.pendingAdmissions.get(key), accepted);
      if (release.kind === "release") this.pendingAdmissions.delete(key);
    }
  }

  private async accept(admission: RetryAdmission): Promise<boolean> {
    const acceptance = planRetryAcceptance(admission);
    if (acceptance.alreadyAccepted) return true;
    if (admission.role !== null && this.input.activeRunForRole(admission.sessionId, admission.role)) {
      throw new LocalConsoleBusyError();
    }
    if (acceptance.shouldRecordIntent) {
      await this.input.storeCall("local-console-store-record-user-retry", () =>
        this.input.recordRetryIntent({
          sessionId: admission.sessionId,
          intentId: this.input.randomId(),
          targetRunId: admission.targetRunId,
          sourceMessageId: admission.source.id,
          role: admission.role!,
          reason: "retry",
          executionOverride: admission.executionOverride,
          createdAt: this.input.nowIso(),
        }));
    }
    await this.input.storeCall("local-console-store-release-user-retry", () =>
      this.input.releaseMessageForRetry({
        userMessageId: admission.source.id,
        sessionId: admission.sessionId,
        now: this.input.nowIso(),
      }));
    this.input.processAfterCurrent(admission.sessionId);
    return true;
  }
}
