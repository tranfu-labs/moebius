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

export function decidePrimaryAnalysisHandling<T extends {
  analysisGateEnabled: boolean;
  role: string;
  primaryAgent: string | null;
  result: { ok: boolean; completionKind?: string };
}>(input: T): { kind: "skip" } | { kind: "apply"; result: T["result"] } {
  return input.analysisGateEnabled
    && input.role === input.primaryAgent
    && input.result.ok
    && input.result.completionKind !== "terminal-tool-result"
    ? { kind: "apply", result: input.result }
    : { kind: "skip" };
}

export function decidePrimaryAnalysisControl(
  control: { action: "proposal" | "confirm"; version: string } | null | undefined,
):
  | { kind: "proposal"; version: string }
  | { kind: "confirm"; version: string }
  | { kind: "skip" } {
  if (control?.action === "proposal") return { kind: "proposal", version: control.version };
  if (control?.action === "confirm") return { kind: "confirm", version: control.version };
  return { kind: "skip" };
}

export function decidePrimaryAnalysisConfirmation(input: {
  currentVersion: string | null;
  confirmedVersion: string;
  observedExternalSessionId: string | null;
  resultExternalSessionId: string | null;
}): { kind: "reject" } | { kind: "execute"; externalSessionId: string } {
  const externalSessionId = input.observedExternalSessionId ?? input.resultExternalSessionId;
  return input.currentVersion === input.confirmedVersion && externalSessionId !== null
    ? { kind: "execute", externalSessionId }
    : { kind: "reject" };
}
