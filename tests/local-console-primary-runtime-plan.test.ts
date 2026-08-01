import { describe, expect, it } from "vitest";
import {
  decidePrimaryAnalysisContract,
  decidePrimaryAnalysisConfirmation,
  decidePrimaryAnalysisControl,
  decidePrimaryAnalysisHandling,
  decidePrimaryInactive,
  decidePrimaryLifecycleCreation,
  decidePrimaryPreparation,
  decidePrimaryProviderInvocation,
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
    expect(decidePrimaryProviderInvocation({ kind: "stopped" })).toEqual({ kind: "invalid-stop" });
    expect(decidePrimaryProviderInvocation({ kind: "completed", value: 1 })).toEqual({
      kind: "completed",
      invocation: { kind: "completed", value: 1 },
    });
  });

  it("opens a write lease only for an exact primary confirmation", () => {
    expect(decidePrimaryAnalysisHandling({
      analysisGateEnabled: true,
      role: "dev-manager",
      primaryAgent: "dev-manager",
      result: { ok: true, completionKind: "response" },
    })).toEqual({ kind: "apply", result: { ok: true, completionKind: "response" } });
    expect(decidePrimaryAnalysisHandling({
      analysisGateEnabled: true,
      role: "dev-manager",
      primaryAgent: "dev-manager",
      result: { ok: true, completionKind: "terminal-tool-result" },
    })).toEqual({ kind: "skip" });
    expect(decidePrimaryAnalysisControl({ action: "confirm", version: "plan-v2" }))
      .toEqual({ kind: "confirm", version: "plan-v2" });
    expect(decidePrimaryAnalysisConfirmation({
      currentVersion: "plan-v2",
      confirmedVersion: "plan-v2",
      observedExternalSessionId: "thread-1",
      resultExternalSessionId: null,
    })).toEqual({ kind: "execute", externalSessionId: "thread-1" });
    expect(decidePrimaryAnalysisConfirmation({
      currentVersion: "plan-v1",
      confirmedVersion: "plan-v2",
      observedExternalSessionId: "thread-1",
      resultExternalSessionId: null,
    })).toEqual({ kind: "reject" });
  });
});
