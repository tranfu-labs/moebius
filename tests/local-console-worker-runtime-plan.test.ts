import { describe, expect, it } from "vitest";
import {
  decideWorkerClaimRelease,
  decideWorkerOutstandingWork,
  decideWorkerLifecycleCreation,
  decideWorkerOriginEffect,
  decideWorkerPreparation,
  decideWorkerRedirectAbort,
  decideWorkerRunId,
  decideWorkerTaskRelease,
  decideWorkerWakeCheckpoint,
  planWorkerSourceDisposition,
} from "../src/local-console/worker-runtime-plan.js";

describe("worker runtime plan", () => {
  it("aborts only an active worker redirected by the primary lane", () => {
    expect(decideWorkerRedirectAbort({ origin: "primary-redirect", activeLane: "worker" }))
      .toEqual({ kind: "abort" });
    expect(decideWorkerRedirectAbort({ origin: "user-direct", activeLane: "worker" }))
      .toEqual({ kind: "keep" });
    expect(decideWorkerRedirectAbort({ origin: "primary-redirect", activeLane: "primary" }))
      .toEqual({ kind: "keep" });
  });

  it("preserves retry run identity and releases only the current lane owner", () => {
    expect(decideWorkerRunId("run-resume")).toEqual({ kind: "resume", runId: "run-resume" });
    expect(decideWorkerRunId(null)).toEqual({ kind: "fresh" });
    const current = Promise.resolve();
    expect(decideWorkerTaskRelease(current, current)).toEqual({ kind: "release" });
    expect(decideWorkerTaskRelease(Promise.resolve(), current)).toEqual({ kind: "keep" });
  });

  it("stops wake and releases claims only while shutdown or session deactivation is active", () => {
    expect(decideWorkerWakeCheckpoint({ stopping: true })).toEqual({ kind: "stop" });
    expect(decideWorkerWakeCheckpoint({ stopping: false, workspaceAvailable: false })).toEqual({ kind: "stop" });
    expect(decideWorkerWakeCheckpoint({ stopping: false, workspaceAvailable: true })).toEqual({ kind: "continue" });
    expect(decideWorkerClaimRelease(true)).toEqual({ kind: "release" });
    expect(decideWorkerOutstandingWork(0, 0)).toEqual({ kind: "idle" });
    expect(decideWorkerOutstandingWork(0, 1)).toEqual({ kind: "pending" });
  });

  it("keeps direct and detached persistence effects distinct across preparation", () => {
    expect(decideWorkerOriginEffect("user-direct")).toEqual({ kind: "direct" });
    expect(decideWorkerOriginEffect("primary-redirect")).toEqual({ kind: "detached" });
    expect(planWorkerSourceDisposition("user-direct")).toBe("user-direct");
    expect(planWorkerSourceDisposition("primary-redirect")).toBe("agent-handoff");
    expect(decideWorkerLifecycleCreation(false)).toEqual({ kind: "record" });
    expect(decideWorkerLifecycleCreation(true)).toEqual({ kind: "skip" });
    expect(decideWorkerPreparation({ kind: "settled-unavailable" })).toEqual({ kind: "settled" });
    expect(decideWorkerPreparation({ kind: "ready", value: 1 })).toEqual({
      kind: "continue",
      preparation: { kind: "ready", value: 1 },
    });
  });
});
