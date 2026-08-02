import type { ExecutionProgressEvent } from "../execution-contract.js";
import { LocalRunLifecycleActivityRuntime } from "./run-lifecycle-activity-runtime.js";
import type {
  LocalRunLifecycleActiveRun,
  LocalRunLifecyclePorts,
} from "./run-lifecycle-contracts.js";
import { LocalRunLifecycleRecordRuntime } from "./run-lifecycle-record-runtime.js";
import type {
  LocalConsoleRunSnapshot,
  LocalConsoleRunTiming,
} from "./types.js";

export type {
  LocalRunLifecycleActiveRun,
  LocalRunLifecycleFactStore,
} from "./run-lifecycle-contracts.js";

export class LocalRunLifecycleRuntime {
  private readonly activity: LocalRunLifecycleActivityRuntime;
  private readonly records: LocalRunLifecycleRecordRuntime;

  constructor(input: LocalRunLifecyclePorts) {
    this.activity = new LocalRunLifecycleActivityRuntime(input);
    this.records = new LocalRunLifecycleRecordRuntime(input);
  }

  runsForSession(sessionId: string): LocalRunLifecycleActiveRun[] {
    return this.activity.runsForSession(sessionId);
  }

  runForLane(sessionId: string, lane: LocalRunLifecycleActiveRun["lane"]): LocalRunLifecycleActiveRun | undefined {
    return this.activity.runForLane(sessionId, lane);
  }

  runForRole(sessionId: string, role: string): LocalRunLifecycleActiveRun | undefined {
    return this.activity.runForRole(sessionId, role);
  }

  async snapshots(sessionId: string): Promise<LocalConsoleRunSnapshot[]> {
    return await this.activity.snapshots(sessionId);
  }

  async snapshot(active: LocalRunLifecycleActiveRun): Promise<LocalConsoleRunSnapshot> {
    return await this.activity.snapshot(active);
  }

  async markStarted(runId: string): Promise<void> {
    await this.records.markStarted(runId);
  }

  updateStructuredActivity(runId: string, event: unknown): void {
    this.activity.updateStructuredActivity(runId, event);
  }

  updateExecutionProgress(runId: string, event: ExecutionProgressEvent): void {
    this.activity.updateExecutionProgress(runId, event);
  }

  updateAgentProgress(runId: string, markdown: string): void {
    this.activity.updateAgentProgress(runId, markdown);
  }

  async finish(runId: string, status: LocalConsoleRunTiming["status"]): Promise<void> {
    await this.records.finish(runId, status);
  }

  async pause(runId: string): Promise<void> {
    await this.records.pause(runId);
  }

  async record(
    active: LocalRunLifecycleActiveRun,
    phase: "created" | "started" | "paused" | "resumed" | "terminal",
    status: LocalConsoleRunTiming["status"],
  ): Promise<void> {
    await this.records.record(active, phase, status);
  }

  async prepare(input: {
    sessionId: string;
    runId: string;
    stepId: string;
    resumeExisting: boolean;
  }): Promise<{ attempt: number; createdAt: string; startedAt: string | null; accumulatedMs: number; resuming: boolean }> {
    return await this.records.prepare(input);
  }
}
