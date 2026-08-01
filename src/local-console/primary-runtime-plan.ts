export function planPrimaryProfile<T>(profile: T | null | undefined): T | null {
  return profile ?? null;
}

export function decidePrimaryAnalysisContract(input: {
  analysisGateEnabled: boolean;
  role: string;
  primaryAgent: string | null;
}): { kind: "include" } | { kind: "omit" } {
  return input.analysisGateEnabled && input.role === input.primaryAgent ? { kind: "include" } : { kind: "omit" };
}

export function decidePrimaryPreparation<T extends { kind: "settled-unavailable" | "ready" }>(
  preparation: T,
): { kind: "settled" } | { kind: "ready"; preparation: Extract<T, { kind: "ready" }> } {
  return preparation.kind === "settled-unavailable"
    ? { kind: "settled" }
    : { kind: "ready", preparation: preparation as Extract<T, { kind: "ready" }> };
}

export function decidePrimaryLifecycleCreation(resuming: boolean): { kind: "record" } | { kind: "skip" } {
  return resuming ? { kind: "skip" } : { kind: "record" };
}

export function decidePrimaryInactive(inactive: boolean): { kind: "stop" } | { kind: "continue" } {
  return inactive ? { kind: "stop" } : { kind: "continue" };
}

export function decidePrimaryProviderInvocation<T extends { kind: "stopped" | "completed" }>(
  invocation: T,
): { kind: "invalid-stop" } | { kind: "completed"; invocation: Extract<T, { kind: "completed" }> } {
  return invocation.kind === "stopped"
    ? { kind: "invalid-stop" }
    : { kind: "completed", invocation: invocation as Extract<T, { kind: "completed" }> };
}
