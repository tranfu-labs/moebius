import { describe, expect, it } from "vitest";
import {
  decideRuntimeShutdownStart,
  decideRunAttemptSource,
  decideShutdownDrain,
  planGracefulShutdownResume,
  planExecutionProgressActivity,
  planRunLifecycleRecord,
  planRunStartedPhase,
} from "../src/local-console/run-lifecycle-plan.js";
import type { ActiveLocalRun } from "../src/local-console/active-run.js";

describe("run lifecycle plan", () => {
  it("maps resumed segments and provider retry progress", () => {
    expect(planRunStartedPhase(false)).toBe("started");
    expect(planRunStartedPhase(true)).toBe("resumed");
    expect(planExecutionProgressActivity({ kind: "provider-retry", retryKind: "service", attempt: 2, sequence: 1 }))
      .toEqual({ kind: "record", action: "对方服务繁忙，正在第 2 次重试" });
  });

  it("records elapsed and completion only for their lifecycle phases", () => {
    expect(planRunLifecycleRecord({
      phase: "started",
      status: "running",
      startedAt: "2026-01-01T00:00:00.000Z",
      elapsedMs: 50,
      recordedAt: "2026-01-01T00:00:01.000Z",
    })).toEqual({ elapsedMs: null, completedAt: null });
    expect(planRunLifecycleRecord({
      phase: "terminal",
      status: "failed",
      startedAt: "2026-01-01T00:00:00.000Z",
      elapsedMs: 50,
      recordedAt: "2026-01-01T00:00:01.000Z",
    })).toEqual({ elapsedMs: 50, completedAt: "2026-01-01T00:00:01.000Z" });
  });

  it("uses attempt one only when lifecycle persistence is unavailable", () => {
    expect(decideRunAttemptSource(false)).toEqual({ kind: "fallback", attempt: 1 });
    expect(decideRunAttemptSource(true)).toEqual({ kind: "persisted" });
  });

  it("plans idempotent shutdown and graceful resume persistence", () => {
    const active = {
      sessionId: "session-1",
      runId: "run-1",
      userMessageId: 7,
      role: "dev",
      threadId: "thread-1",
      sourceDisposition: "primary",
    } as ActiveLocalRun;

    expect(decideRuntimeShutdownStart(true)).toEqual({ kind: "skip" });
    expect(decideShutdownDrain({ pending: true, workers: false, beforeDeadline: true }))
      .toEqual({ kind: "wait" });
    expect(decideShutdownDrain({ pending: true, workers: true, beforeDeadline: false }))
      .toEqual({ kind: "finish" });
    expect(planGracefulShutdownResume({ active, intentId: "intent-1", createdAt: "now" }))
      .toMatchObject({ kind: "record", intent: { role: "dev", targetRunId: "run-1" } });
    expect(planGracefulShutdownResume({
      active: { ...active, threadId: null },
      intentId: "intent-2",
      createdAt: "now",
    })).toEqual({ kind: "skip" });
  });
});
