import type {
  LocalRunLifecycleActiveRun,
  LocalRunLifecyclePorts,
} from "./run-lifecycle-contracts.js";
import {
  decideLifecycleStore,
  decideResumeTimingLookup,
  decideReusableRunTiming,
  decideRunAttemptSource,
  decideRunStart,
  decideRunTerminal,
  planRunElapsedMs,
  planRunLifecycleRecord,
  planRunStartedPhase,
} from "./run-lifecycle-plan.js";
import type { LocalConsoleRunTiming } from "./types.js";

export class LocalRunLifecycleRecordRuntime {
  constructor(private readonly input: LocalRunLifecyclePorts) {}

  async markStarted(runId: string): Promise<void> {
    const plan = decideRunStart(this.input.activeRun(runId));
    if (plan.kind === "skip") return;
    const startedAt = this.input.nowIso();
    plan.active.segmentStartedAt = startedAt;
    plan.active.startedAt ??= startedAt;
    await this.record(plan.active, planRunStartedPhase(plan.active.resuming), "running");
  }

  async finish(runId: string, status: LocalConsoleRunTiming["status"]): Promise<void> {
    const plan = decideRunTerminal(this.input.activeRun(runId));
    if (plan.kind === "skip") return;
    plan.active.terminalRecorded = true;
    await plan.active.activityFactTail;
    await this.record(plan.active, "terminal", status);
  }

  async pause(runId: string): Promise<void> {
    const plan = decideRunTerminal(this.input.activeRun(runId));
    if (plan.kind === "skip") return;
    plan.active.terminalRecorded = true;
    await plan.active.activityFactTail;
    await this.record(plan.active, "paused", "paused");
  }

  async record(
    active: LocalRunLifecycleActiveRun,
    phase: "created" | "started" | "paused" | "resumed" | "terminal",
    status: LocalConsoleRunTiming["status"],
  ): Promise<void> {
    const persistence = decideLifecycleStore(this.input.lifecycleStore());
    if (persistence.kind === "skip") return;
    const recordedAt = this.input.nowIso();
    const plan = planRunLifecycleRecord({
      phase,
      status,
      startedAt: active.startedAt,
      elapsedMs: planRunElapsedMs(active, this.input.now().getTime()),
      recordedAt,
    });
    await this.input.storeCall("local-console-store-record-run-lifecycle", () =>
      persistence.store.recordRunLifecycleEvent({
        sessionId: active.sessionId,
        runId: active.runId,
        stepId: active.stepId,
        attempt: active.attempt,
        phase,
        role: active.role,
        engine: active.engine,
        processOutputAvailable: active.processOutputAvailable,
        createdAt: active.createdAt,
        startedAt: active.startedAt,
        elapsedMs: plan.elapsedMs,
        completedAt: plan.completedAt,
        status,
        recordedAt,
      }));
  }

  async prepare(input: {
    sessionId: string;
    runId: string;
    stepId: string;
    resumeExisting: boolean;
  }): Promise<{ attempt: number; createdAt: string; startedAt: string | null; accumulatedMs: number; resuming: boolean }> {
    const persistence = this.input.lifecycleStore();
    const lookup = decideResumeTimingLookup(input.resumeExisting, persistence);
    if (lookup.kind === "lookup") {
      const timing = await this.input.storeCall("local-console-store-get-run-timing", () =>
        lookup.store.getRunTiming({ sessionId: input.sessionId, runId: input.runId }));
      const reuse = decideReusableRunTiming(timing, input.stepId);
      if (reuse.kind === "reuse") {
        return {
          attempt: reuse.timing.attempt,
          createdAt: reuse.timing.createdAt,
          startedAt: reuse.timing.startedAt,
          accumulatedMs: reuse.timing.elapsedMs ?? 0,
          resuming: true,
        };
      }
    }
    const attemptSource = decideRunAttemptSource(persistence !== null);
    const attempt = attemptSource.kind === "fallback"
      ? attemptSource.attempt
      : await this.input.storeCall("local-console-store-next-run-attempt", () =>
          persistence!.nextRunAttempt({ sessionId: input.sessionId, stepId: input.stepId }));
    return {
      attempt,
      createdAt: this.input.nowIso(),
      startedAt: null,
      accumulatedMs: 0,
      resuming: false,
    };
  }
}
