import { describe, expect, it } from "vitest";
import {
  decideRunAttemptSource,
  planExecutionProgressActivity,
  planRunLifecycleRecord,
  planRunStartedPhase,
} from "../src/local-console/run-lifecycle-plan.js";

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
});
