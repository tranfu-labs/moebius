import { describe, expect, it } from "vitest";

import {
  decidePendingControlWorkInspection,
  decidePendingAdmission,
  decidePendingCompletion,
  decidePendingProcessingAdmission,
  decidePendingProcessingFollowUp,
  decidePendingFollowUp,
  decidePendingWait,
  decideRetryAfterCurrentAttempt,
  decideRetryAfterCurrentFinish,
  decideRetryDrainRequest,
  decideRetryOperationResult,
  decideRetryTailCleanup,
  decideRetryTailSource,
  planRetryReservationCount,
  decidePendingWorkspace,
  planHasPendingControlWork,
} from "../src/local-console/pending-processing-plan.js";

describe("local console pending processing plan", () => {
  it("combines persisted running, queued, active, and post-cursor work", () => {
    expect(planHasPendingControlWork({
      activeMessage: true,
      hasMessageAfterCursor: false,
    })).toBe(true);
    expect(planHasPendingControlWork({
      activeMessage: false,
      hasMessageAfterCursor: false,
    })).toBe(false);
    expect(decidePendingControlWorkInspection({ hasRunningMessage: true, hasQueuedControlMessage: false }))
      .toBe("pending");
    expect(decidePendingControlWorkInspection({ hasRunningMessage: false, hasQueuedControlMessage: false }))
      .toBe("inspect-cursor");
  });

  it("queues only a live duplicate drain and reruns one requested pass", () => {
    expect(decidePendingAdmission({ stopping: true, processing: false })).toEqual({ kind: "stop" });
    expect(decidePendingAdmission({ stopping: false, processing: true })).toEqual({ kind: "queue" });
    expect(decidePendingAdmission({ stopping: false, processing: false })).toEqual({ kind: "run" });
    expect(decidePendingFollowUp({ stopping: false, requested: true })).toEqual({ kind: "rerun" });
    expect(decidePendingFollowUp({ stopping: true, requested: true })).toEqual({ kind: "clear" });
    expect(decidePendingProcessingAdmission({
      stopping: false,
      processing: false,
      retryReserved: true,
    })).toEqual({ kind: "queue" });
    expect(decidePendingProcessingFollowUp({
      stopping: false,
      requested: true,
      retryReserved: true,
    })).toEqual({ kind: "hold" });
  });

  it("stops before claim when shutdown or workspace loss is visible", () => {
    expect(decidePendingWorkspace({ stopping: false, workspaceAvailable: true })).toEqual({ kind: "run" });
    expect(decidePendingWorkspace({ stopping: false, workspaceAvailable: false })).toEqual({ kind: "stop" });
    expect(decidePendingWait({ stopping: false, processing: true })).toEqual({ kind: "wait" });
    expect(decidePendingWait({ stopping: true, processing: true })).toEqual({ kind: "stop" });
    expect(decidePendingCompletion({ hasCompletion: true })).toBe("wait");
    expect(decidePendingCompletion({ hasCompletion: false })).toBe("ready");
    expect(decideRetryAfterCurrentAttempt(false)).toEqual({ kind: "run" });
    expect(decideRetryAfterCurrentAttempt(true)).toEqual({ kind: "stop" });
    expect(decideRetryDrainRequest({ succeeded: true, requested: false })).toBe(true);
    expect(decideRetryDrainRequest({ succeeded: false, requested: false })).toBe(false);
    expect(decideRetryOperationResult({ scheduled: true, succeeded: true })).toBe(true);
    expect(decideRetryOperationResult({ scheduled: false, succeeded: true })).toBe(false);
    expect(decideRetryTailCleanup({ currentTail: true })).toBe("cleanup");
    expect(decideRetryTailSource(false)).toEqual({ kind: "empty" });
    expect(decideRetryTailSource(true)).toEqual({ kind: "existing" });
    expect(planRetryReservationCount(undefined)).toBe(0);
    expect(planRetryReservationCount(2)).toBe(2);
    expect(decideRetryAfterCurrentFinish({
      reservations: 2,
      succeeded: true,
      stopping: false,
      retryDrainRequested: true,
      pendingProcess: false,
    })).toEqual({ kind: "retain", remaining: 1, accepted: true });
    expect(decideRetryAfterCurrentFinish({
      reservations: 1,
      succeeded: true,
      stopping: false,
      retryDrainRequested: true,
      pendingProcess: false,
    })).toEqual({ kind: "release", shouldSchedule: true, accepted: true });
  });
});
