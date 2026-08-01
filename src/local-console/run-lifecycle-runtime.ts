import { LOCAL_LONG_RUN_REPORT_MS } from "../config.js";
import type { ExecutionProgressEvent } from "../execution-contract.js";
import { readLocalConsoleOutputTail } from "./output-tail.js";
import {
  chooseLatestRunActivity,
  projectAgentProgressActivity,
  projectStructuredRunActivity,
  type LocalRunActivity,
} from "./run-activity.js";
import type {
  LocalConsoleExecutionProfile,
  LocalConsoleRunSnapshot,
  LocalConsoleRunTiming,
} from "./types.js";
import {
  decideRunAttemptSource,
  planExecutionProgressActivity,
  planRunLifecycleRecord,
  planRunStartedPhase,
} from "./run-lifecycle-plan.js";

export interface LocalRunLifecycleActiveRun {
  sessionId: string;
  runId: string;
  role: string | null;
  lane: "primary" | "worker";
  runDir: string | null;
  cwd: string | null;
  workspaceMode: "direct" | "worktree" | null;
  worktreeUnavailableReason: string | null;
  branchName: string | null;
  baseRef: string | null;
  liveMarkdown: string | null;
  activity: LocalRunActivity | null;
  activitySequence: number;
  activityFactTail: Promise<void>;
  longRunReported: boolean;
  createdAt: string;
  startedAt: string | null;
  segmentStartedAt: string | null;
  accumulatedMs: number;
  resuming: boolean;
  stepId: string;
  attempt: number;
  engine: "codex" | "claude" | "kimi";
  profile: LocalConsoleExecutionProfile | null;
  processOutputAvailable: boolean;
  terminalRecorded: boolean;
}

export interface LocalRunLifecycleFactStore {
  nextRunAttempt(input: { sessionId: string; stepId: string }): Promise<number>;
  getRunTiming(input: { sessionId: string; runId: string }): Promise<LocalConsoleRunTiming | null>;
  recordRunLifecycleEvent(input: {
    sessionId: string;
    runId: string;
    stepId: string;
    attempt: number;
    phase: "created" | "started" | "paused" | "resumed" | "terminal";
    role: string | null;
    engine: "codex" | "claude" | "kimi";
    processOutputAvailable: boolean;
    createdAt: string;
    startedAt: string | null;
    elapsedMs: number | null;
    completedAt: string | null;
    status: LocalConsoleRunTiming["status"];
    recordedAt: string;
  }): Promise<void>;
  recordRunActivityEvent(input: {
    sessionId: string;
    runId: string;
    activity: LocalRunActivity;
  }): Promise<void>;
}

export class LocalRunLifecycleRuntime {
  constructor(private readonly input: {
    activeRun(runId: string): LocalRunLifecycleActiveRun | undefined;
    activeRuns(): Iterable<LocalRunLifecycleActiveRun>;
    lifecycleStore(): LocalRunLifecycleFactStore | null;
    storeCall<T>(label: string, operation: () => Promise<T>): Promise<T>;
    now(): Date;
    nowIso(): string;
    recordError(error: unknown): void;
  }) {}

  runsForSession(sessionId: string): LocalRunLifecycleActiveRun[] {
    return [...this.input.activeRuns()]
      .filter((active) => active.sessionId === sessionId)
      .sort((left, right) => left.createdAt.localeCompare(right.createdAt) || left.runId.localeCompare(right.runId));
  }

  runForLane(sessionId: string, lane: LocalRunLifecycleActiveRun["lane"]): LocalRunLifecycleActiveRun | undefined {
    return this.runsForSession(sessionId).find((active) => active.lane === lane);
  }

  runForRole(sessionId: string, role: string): LocalRunLifecycleActiveRun | undefined {
    return this.runsForSession(sessionId).find((active) => active.role === role);
  }

  async snapshots(sessionId: string): Promise<LocalConsoleRunSnapshot[]> {
    return await Promise.all(this.runsForSession(sessionId).map(async (active) => await this.snapshot(active)));
  }

  async snapshot(active: LocalRunLifecycleActiveRun): Promise<LocalConsoleRunSnapshot> {
    const tail = await readLocalConsoleOutputTail(active.runDir);
    const elapsedMs = active.startedAt === null ? null : this.elapsedMs(active);
    if (!active.longRunReported && elapsedMs !== null && elapsedMs >= LOCAL_LONG_RUN_REPORT_MS) {
      active.longRunReported = true;
      const cursor = ++active.activitySequence;
      const elapsedMinutes = Math.max(1, Math.floor(elapsedMs / 60_000));
      const previousActivity = active.activity;
      this.acceptActivity(active, {
        cursor,
        kind: "progress",
        phase: "running",
        action: `已经运行 ${String(elapsedMinutes)} 分钟，${previousActivity?.action ?? "仍在继续"}`,
        object: previousActivity?.object ?? null,
        occurredAt: this.input.nowIso(),
      });
    }
    return {
      sessionId: active.sessionId,
      runId: active.runId,
      role: active.role,
      status: "running",
      createdAt: active.createdAt,
      startedAt: active.startedAt,
      elapsedMs,
      stepId: active.stepId,
      attempt: active.attempt,
      engine: active.engine,
      processOutputAvailable: active.processOutputAvailable,
      activity: active.activity,
      runDir: active.runDir,
      cwd: active.cwd,
      workspaceMode: active.workspaceMode,
      worktreeUnavailableReason: active.worktreeUnavailableReason,
      branchName: active.branchName,
      baseRef: active.baseRef,
      stdoutTail: tail.stdoutTail,
      stderrTail: tail.stderrTail,
      liveMarkdown: active.liveMarkdown,
      lastOutputSummary: tail.lastOutputSummary,
      tailDiagnostic: tail.tailDiagnostic,
      interruptible: true,
    };
  }

  async markStarted(runId: string): Promise<void> {
    const active = this.input.activeRun(runId);
    if (active === undefined || active.segmentStartedAt !== null) return;
    const startedAt = this.input.nowIso();
    active.segmentStartedAt = startedAt;
    active.startedAt ??= startedAt;
    await this.record(active, planRunStartedPhase(active.resuming), "running");
  }

  updateStructuredActivity(runId: string, event: unknown): void {
    const active = this.input.activeRun(runId);
    if (active === undefined) return;
    const activity = projectStructuredRunActivity(event, ++active.activitySequence, this.input.nowIso());
    if (activity !== null) this.acceptActivity(active, activity);
  }

  updateExecutionProgress(runId: string, event: ExecutionProgressEvent): void {
    const plan = planExecutionProgressActivity(event);
    if (plan.kind === "skip") return;
    const active = this.input.activeRun(runId);
    if (active === undefined) return;
    this.acceptActivity(active, {
      cursor: ++active.activitySequence,
      kind: "progress",
      phase: "running",
      action: plan.action,
      object: null,
      occurredAt: this.input.nowIso(),
    });
  }

  updateAgentProgress(runId: string, markdown: string): void {
    const active = this.input.activeRun(runId);
    if (active === undefined) return;
    const activity = projectAgentProgressActivity(markdown, ++active.activitySequence, this.input.nowIso());
    if (activity !== null) this.acceptActivity(active, activity);
  }

  async finish(runId: string, status: LocalConsoleRunTiming["status"]): Promise<void> {
    const active = this.input.activeRun(runId);
    if (active === undefined || active.terminalRecorded) return;
    active.terminalRecorded = true;
    await active.activityFactTail;
    await this.record(active, "terminal", status);
  }

  async pause(runId: string): Promise<void> {
    const active = this.input.activeRun(runId);
    if (active === undefined || active.terminalRecorded) return;
    active.terminalRecorded = true;
    await active.activityFactTail;
    await this.record(active, "paused", "paused");
  }

  async record(
    active: LocalRunLifecycleActiveRun,
    phase: "created" | "started" | "paused" | "resumed" | "terminal",
    status: LocalConsoleRunTiming["status"],
  ): Promise<void> {
    const store = this.input.lifecycleStore();
    if (store === null) return;
    const recordedAt = this.input.nowIso();
    const plan = planRunLifecycleRecord({
      phase,
      status,
      startedAt: active.startedAt,
      elapsedMs: this.elapsedMs(active),
      recordedAt,
    });
    await this.input.storeCall("local-console-store-record-run-lifecycle", () =>
      store.recordRunLifecycleEvent({
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
    const store = this.input.lifecycleStore();
    if (input.resumeExisting && store !== null) {
      const timing = await this.input.storeCall("local-console-store-get-run-timing", () =>
        store.getRunTiming({ sessionId: input.sessionId, runId: input.runId }));
      if (timing !== null && timing.stepId === input.stepId) {
        return {
          attempt: timing.attempt,
          createdAt: timing.createdAt,
          startedAt: timing.startedAt,
          accumulatedMs: timing.elapsedMs ?? 0,
          resuming: true,
        };
      }
    }
    const attemptSource = decideRunAttemptSource(store !== null);
    const attempt = attemptSource.kind === "fallback"
      ? attemptSource.attempt
      : await this.input.storeCall("local-console-store-next-run-attempt", () =>
          store!.nextRunAttempt({ sessionId: input.sessionId, stepId: input.stepId }));
    return {
      attempt,
      createdAt: this.input.nowIso(),
      startedAt: null,
      accumulatedMs: 0,
      resuming: false,
    };
  }

  private acceptActivity(active: LocalRunLifecycleActiveRun, activity: LocalRunActivity): void {
    const next = chooseLatestRunActivity(active.activity, activity);
    if (next === active.activity) return;
    active.activity = next;
    const store = this.input.lifecycleStore();
    if (store === null) return;
    active.activityFactTail = active.activityFactTail.then(() =>
      this.input.storeCall("local-console-store-record-run-activity", () =>
        store.recordRunActivityEvent({ sessionId: active.sessionId, runId: active.runId, activity: next })),
    ).catch((error: unknown) => this.input.recordError(error));
  }

  private elapsedMs(active: LocalRunLifecycleActiveRun): number {
    const segmentElapsedMs = active.segmentStartedAt === null
      ? 0
      : Math.max(0, this.input.now().getTime() - Date.parse(active.segmentStartedAt));
    return active.accumulatedMs + segmentElapsedMs;
  }
}
