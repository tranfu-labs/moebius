import { describe, expect, it } from "vitest";

import {
  decidePendingAdmission,
  decidePendingFollowUp,
  decidePendingWait,
  decidePendingWorkspace,
} from "../src/local-console/pending-processing-plan.js";

describe("local console pending processing plan", () => {
  it("queues only a live duplicate drain and reruns one requested pass", () => {
    expect(decidePendingAdmission({ stopping: true, processing: false })).toEqual({ kind: "stop" });
    expect(decidePendingAdmission({ stopping: false, processing: true })).toEqual({ kind: "queue" });
    expect(decidePendingAdmission({ stopping: false, processing: false })).toEqual({ kind: "run" });
    expect(decidePendingFollowUp({ stopping: false, requested: true })).toEqual({ kind: "rerun" });
    expect(decidePendingFollowUp({ stopping: true, requested: true })).toEqual({ kind: "clear" });
  });

  it("stops before claim when shutdown or workspace loss is visible", () => {
    expect(decidePendingWorkspace({ stopping: false, workspaceAvailable: true })).toEqual({ kind: "run" });
    expect(decidePendingWorkspace({ stopping: false, workspaceAvailable: false })).toEqual({ kind: "stop" });
    expect(decidePendingWait({ stopping: false, processing: true })).toEqual({ kind: "wait" });
    expect(decidePendingWait({ stopping: true, processing: true })).toEqual({ kind: "stop" });
  });
});
