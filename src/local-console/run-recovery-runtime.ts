import type {
  LocalCodexResumeConsumedFact,
  LocalCodexResumeIntentFact,
} from "./codex-resume.js";
import {
  decideLifecycleStoreUse,
  decideRecoveryFactSource,
  decideUnavailableIntentPersistence,
  decideUnavailableTimingPersistence,
  planGracefulResumeTarget,
  planGracefulResumeTargets,
} from "./run-recovery-plan.js";
import type { LocalRunLifecycleFactStore } from "./run-lifecycle-runtime.js";
import type { LocalConsoleExecutionEngine, LocalConsoleMessage, LocalConsoleStore } from "./types.js";

interface LocalRunRecoveryFactStore {
  getSessionFactLogPath(sessionId: string): string;
  recordCodexResumeConsumed(input: LocalCodexResumeConsumedFact): Promise<void>;
}

export class LocalRunRecoveryRuntime {
  constructor(private readonly input: {
    store: LocalConsoleStore;
    storeCall<T>(label: string, operation: () => Promise<T>): Promise<T>;
    nowIso(): string;
    recoveryStore(): LocalRunRecoveryFactStore | null;
    requireRecoveryStore(): LocalRunRecoveryFactStore;
    lifecycleStore(): LocalRunLifecycleFactStore | null;
    readRecoveryFacts(path: string, sessionId: string): Promise<{
      intents: LocalCodexResumeIntentFact[];
      consumedIntentIds: Set<string>;
    }>;
  }) {}

  async targetsForClaim(sessionId: string): Promise<Array<{ sourceMessageId: number; targetRunId: string }>> {
    const store = this.input.recoveryStore();
    const source = decideRecoveryFactSource({ known: false, storeAvailable: store !== null });
    if (source.kind === "unavailable") return [];
    const facts = await this.input.readRecoveryFacts(store!.getSessionFactLogPath(sessionId), sessionId);
    return planGracefulResumeTargets(facts);
  }

  async targetForMessage(
    sessionId: string,
    sourceMessageId: number,
    knownFacts?: { intents: LocalCodexResumeIntentFact[]; consumedIntentIds: Set<string> },
  ): Promise<string | null> {
    const store = this.input.recoveryStore();
    const source = decideRecoveryFactSource({ known: knownFacts !== undefined, storeAvailable: store !== null });
    if (source.kind === "unavailable") return null;
    const facts = source.kind === "known"
      ? knownFacts!
      : await this.input.readRecoveryFacts(store!.getSessionFactLogPath(sessionId), sessionId);
    return planGracefulResumeTarget(facts, sourceMessageId);
  }

  async settleUnavailable(input: {
    sessionId: string;
    runId: string;
    sourceMessage: LocalConsoleMessage;
    intent: LocalCodexResumeIntentFact | null;
    role: string;
    engine: LocalConsoleExecutionEngine;
    reason: string;
    runDir: string | null;
  }): Promise<void> {
    const intentPlan = decideUnavailableIntentPersistence(input.intent);
    if (intentPlan.kind === "record") {
      const store = this.input.requireRecoveryStore();
      await this.input.storeCall("local-console-store-consume-unavailable-resume", () =>
        store.recordCodexResumeConsumed({
          sessionId: input.sessionId,
          intentId: intentPlan.intent.intentId,
          resumedByRunId: input.runId,
          mode: "unavailable",
          reason: input.reason,
          consumedAt: this.input.nowIso(),
        }));
    }
    const lifecycleStore = this.input.lifecycleStore();
    const lifecyclePlan = decideLifecycleStoreUse(lifecycleStore !== null);
    if (lifecyclePlan.kind === "use") {
      const timing = await this.input.storeCall("local-console-store-read-unavailable-resume-timing", () =>
        lifecycleStore!.getRunTiming({ sessionId: input.sessionId, runId: input.runId }));
      const timingPlan = decideUnavailableTimingPersistence(timing);
      if (timingPlan.kind === "record") {
        const persistedTiming = timingPlan.timing;
        const completedAt = this.input.nowIso();
        await this.input.storeCall("local-console-store-record-unavailable-resume-terminal", () =>
          lifecycleStore!.recordRunLifecycleEvent({
            sessionId: input.sessionId,
            runId: input.runId,
            stepId: persistedTiming.stepId,
            attempt: persistedTiming.attempt,
            phase: "terminal",
            role: input.role,
            engine: input.engine,
            processOutputAvailable: persistedTiming.processOutputAvailable,
            createdAt: persistedTiming.createdAt,
            startedAt: persistedTiming.startedAt,
            elapsedMs: persistedTiming.elapsedMs,
            completedAt,
            status: "failed",
            recordedAt: completedAt,
          }));
      }
    }
    await this.input.storeCall("local-console-store-record-unavailable-resume", () =>
      this.input.store.recordFailure({
        userMessageId: input.sourceMessage.id,
        sessionId: input.sessionId,
        error: `resume-unavailable:${input.reason}`,
        runId: input.runId,
        runDir: input.runDir,
        body: "原执行已经无法继续。你可以重新运行，或直接说话、换一个成员接手。",
        systemEventKind: "other",
        role: input.role,
        processSteps: [],
        now: this.input.nowIso(),
      }));
  }
}
