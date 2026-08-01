import { describe, expect, it } from "vitest";
import {
  decidePrimaryAnalysisContract,
  decidePrimaryInactive,
  decidePrimaryLifecycleCreation,
  decidePrimaryPreparation,
  planPrimaryProfile,
} from "../src/local-console/primary-runtime-plan.js";

describe("primary runtime plan", () => {
  it("applies the read-only proposal contract only to the primary role", () => {
    expect(decidePrimaryAnalysisContract({
      analysisGateEnabled: true,
      role: "dev-manager",
      primaryAgent: "dev-manager",
    })).toEqual({ kind: "include" });
    expect(decidePrimaryAnalysisContract({
      analysisGateEnabled: true,
      role: "dev",
      primaryAgent: "dev-manager",
    })).toEqual({ kind: "omit" });
    expect(planPrimaryProfile(undefined)).toBeNull();
  });

  it("stops unavailable preparation and records lifecycle creation only for a fresh attempt", () => {
    expect(decidePrimaryInactive(true)).toEqual({ kind: "stop" });
    expect(decidePrimaryInactive(false)).toEqual({ kind: "continue" });
    expect(decidePrimaryPreparation({ kind: "settled-unavailable" })).toEqual({ kind: "settled" });
    expect(decidePrimaryPreparation({ kind: "ready", value: 1 })).toEqual({
      kind: "ready",
      preparation: { kind: "ready", value: 1 },
    });
    expect(decidePrimaryLifecycleCreation(false)).toEqual({ kind: "record" });
    expect(decidePrimaryLifecycleCreation(true)).toEqual({ kind: "skip" });
  });
});
