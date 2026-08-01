import {
  readLocalCodexRecoveryFacts,
  type LocalCodexResumeConsumedFact,
  type LocalCodexResumeIntentFact,
} from "./codex-resume.js";
import type { LocalRunLifecycleFactStore } from "./run-lifecycle-runtime.js";
import type { LocalConsoleMessage, LocalConsoleStore } from "./types.js";

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
  }) {}

  async targetsForClaim(sessionId: string): Promise<Array<{ sourceMessageId: number; targetRunId: string }>> {
    const store = this.input.recoveryStore();
    if (store === null) return [];
    const facts = await readLocalCodexRecoveryFacts(store.getSessionFactLogPath(sessionId), sessionId);
    const bySource = new Map<number, Set<string>>();
    for (const intent of facts.intents) {
      if (intent.reason !== "graceful-shutdown" || facts.consumedIntentIds.has(intent.intentId)) continue;
      const targets = bySource.get(intent.sourceMessageId) ?? new Set<string>();
      targets.add(intent.targetRunId);
      bySource.set(intent.sourceMessageId, targets);
    }
    return [...bySource.entries()]
      .filter(([, targetRunIds]) => targetRunIds.size === 1)
      .map(([sourceMessageId, targetRunIds]) => ({
        sourceMessageId,
        targetRunId: [...targetRunIds][0]!,
      }));
  }

  async targetForMessage(
    sessionId: string,
    sourceMessageId: number,
    knownFacts?: Awaited<ReturnType<typeof readLocalCodexRecoveryFacts>>,
  ): Promise<string | null> {
    const store = this.input.recoveryStore();
    if (store === null) return null;
    const facts = knownFacts
      ?? await readLocalCodexRecoveryFacts(store.getSessionFactLogPath(sessionId), sessionId);
    const intent = [...facts.intents].reverse().find((candidate) =>
      candidate.reason === "graceful-shutdown"
      && candidate.sourceMessageId === sourceMessageId
      && !facts.consumedIntentIds.has(candidate.intentId));
    return intent?.targetRunId ?? null;
  }

  async settleUnavailable(input: {
    sessionId: string;
    runId: string;
    sourceMessage: LocalConsoleMessage;
    intent: LocalCodexResumeIntentFact | null;
    role: string;
    engine: "codex" | "claude" | "kimi";
    reason: string;
    runDir: string | null;
  }): Promise<void> {
    if (input.intent !== null) {
      const store = this.input.requireRecoveryStore();
      await this.input.storeCall("local-console-store-consume-unavailable-resume", () =>
        store.recordCodexResumeConsumed({
          sessionId: input.sessionId,
          intentId: input.intent!.intentId,
          resumedByRunId: input.runId,
          mode: "unavailable",
          reason: input.reason,
          consumedAt: this.input.nowIso(),
        }));
    }
    const lifecycleStore = this.input.lifecycleStore();
    if (lifecycleStore !== null) {
      const timing = await this.input.storeCall("local-console-store-read-unavailable-resume-timing", () =>
        lifecycleStore.getRunTiming({ sessionId: input.sessionId, runId: input.runId }));
      if (timing !== null) {
        const completedAt = this.input.nowIso();
        await this.input.storeCall("local-console-store-record-unavailable-resume-terminal", () =>
          lifecycleStore.recordRunLifecycleEvent({
            sessionId: input.sessionId,
            runId: input.runId,
            stepId: timing.stepId,
            attempt: timing.attempt,
            phase: "terminal",
            role: input.role,
            engine: input.engine,
            processOutputAvailable: timing.processOutputAvailable,
            createdAt: timing.createdAt,
            startedAt: timing.startedAt,
            elapsedMs: timing.elapsedMs,
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
        now: this.input.nowIso(),
      }));
  }
}
