import type { LocalRunActivity } from "./run-activity.js";
import type { ClaudeTuiNativePromptDecision } from "../claude.js";
import type {
  LocalConsoleExecutionEngine,
  LocalConsoleExecutionProfile,
  LocalConsoleRunTiming,
} from "./types.js";

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
  activitySteps: LocalRunActivity[];
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
  engine: LocalConsoleExecutionEngine;
  profile: LocalConsoleExecutionProfile | null;
  nativePromptDecision: ClaudeTuiNativePromptDecision | null;
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
    engine: LocalConsoleExecutionEngine;
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

export interface LocalRunLifecyclePorts {
  activeRun(runId: string): LocalRunLifecycleActiveRun | undefined;
  touchActiveRun(runId: string): void;
  activeRuns(): Iterable<LocalRunLifecycleActiveRun>;
  lifecycleStore(): LocalRunLifecycleFactStore | null;
  storeCall<T>(label: string, operation: () => Promise<T>): Promise<T>;
  now(): Date;
  nowIso(): string;
  recordError(error: unknown): void;
  readOutputTail(runDir: string | null): Promise<{
    stdoutTail: string | null;
    stderrTail: string | null;
    lastOutputSummary: string;
    tailDiagnostic: string | null;
  }>;
  longRunReportMs: number;
}
