import type { ExecutionProgressEvent } from "../execution-contract.js";
import {
  projectAgentProgressActivity,
  projectStructuredRunActivity,
  type LocalRunActivity,
  foldRunActivityStep,
} from "./run-activity.js";
import type {
  LocalRunLifecycleActiveRun,
  LocalRunLifecyclePorts,
} from "./run-lifecycle-contracts.js";
import {
  decideActiveRun,
  decideLifecycleStore,
  decideProjectedActivity,
  planActivityChange,
  planExecutionProgressActivity,
  planLongRunActivity,
  planRunSnapshotElapsedMs,
  planRunForLane,
  planRunForRole,
  planRunsForSession,
} from "./run-lifecycle-plan.js";
import type { LocalConsoleRunSnapshot } from "./types.js";

export class LocalRunLifecycleActivityRuntime {
  constructor(private readonly input: LocalRunLifecyclePorts) {}

  runsForSession(sessionId: string): LocalRunLifecycleActiveRun[] {
    return planRunsForSession(this.input.activeRuns(), sessionId);
  }

  runForLane(sessionId: string, lane: LocalRunLifecycleActiveRun["lane"]): LocalRunLifecycleActiveRun | undefined {
    return planRunForLane(this.runsForSession(sessionId), lane);
  }

  runForRole(sessionId: string, role: string): LocalRunLifecycleActiveRun | undefined {
    return planRunForRole(this.runsForSession(sessionId), role);
  }

  async snapshots(sessionId: string): Promise<LocalConsoleRunSnapshot[]> {
    return await Promise.all(this.runsForSession(sessionId).map(async (active) => await this.snapshot(active)));
  }

  async snapshot(active: LocalRunLifecycleActiveRun): Promise<LocalConsoleRunSnapshot> {
    const tail = await this.input.readOutputTail(active.runDir);
    const elapsedMs = planRunSnapshotElapsedMs(active, this.input.now().getTime());
    const longRun = planLongRunActivity({
      reported: active.longRunReported,
      elapsedMs,
      reportMs: this.input.longRunReportMs,
      cursor: active.activitySequence + 1,
      previousActivity: active.activity,
      occurredAt: this.input.nowIso(),
    });
    if (longRun.kind === "record") {
      active.longRunReported = true;
      active.activitySequence = longRun.activity.cursor;
      this.input.touchActiveRun(active.runId);
      this.acceptActivity(active, longRun.activity);
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
      activitySteps: active.activitySteps,
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

  updateStructuredActivity(runId: string, event: unknown): void {
    const run = decideActiveRun(this.input.activeRun(runId));
    if (run.kind === "skip") return;
    const projection = decideProjectedActivity(
      projectStructuredRunActivity(event, ++run.active.activitySequence, this.input.nowIso()),
    );
    this.input.touchActiveRun(runId);
    if (projection.kind === "use") this.acceptActivity(run.active, projection.activity);
  }

  updateExecutionProgress(runId: string, event: ExecutionProgressEvent): void {
    const plan = planExecutionProgressActivity(event);
    if (plan.kind === "skip") return;
    const run = decideActiveRun(this.input.activeRun(runId));
    if (run.kind === "skip") return;
    this.acceptActivity(run.active, {
      cursor: ++run.active.activitySequence,
      kind: "progress",
      phase: "running",
      action: plan.action,
      object: null,
      occurredAt: this.input.nowIso(),
    });
    this.input.touchActiveRun(runId);
  }

  updateAgentProgress(runId: string, markdown: string): void {
    const run = decideActiveRun(this.input.activeRun(runId));
    if (run.kind === "skip") return;
    const projection = decideProjectedActivity(
      projectAgentProgressActivity(markdown, ++run.active.activitySequence, this.input.nowIso()),
    );
    this.input.touchActiveRun(runId);
    if (projection.kind === "use") this.acceptActivity(run.active, projection.activity);
  }

  private acceptActivity(active: LocalRunLifecycleActiveRun, activity: LocalRunActivity): void {
    const change = planActivityChange(active.activity, activity);
    if (change.kind === "skip") return;
    active.activity = change.activity;
    active.activitySteps = [...foldRunActivityStep(active.activitySteps, change.activity)];
    this.input.touchActiveRun(active.runId);
    const persistence = decideLifecycleStore(this.input.lifecycleStore());
    if (persistence.kind === "skip") return;
    active.activityFactTail = active.activityFactTail.then(() =>
      this.input.storeCall("local-console-store-record-run-activity", () =>
        persistence.store.recordRunActivityEvent({
          sessionId: active.sessionId,
          runId: active.runId,
          activity: change.activity,
        })),
    ).catch((error: unknown) => this.input.recordError(error));
  }
}
