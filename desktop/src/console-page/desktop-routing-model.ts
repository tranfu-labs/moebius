export type DesktopRoutePlan = "loading" | "onboarding" | "console";

export function planDesktopRoute(onboardingCompleted: boolean | null): DesktopRoutePlan {
  if (onboardingCompleted === null) return "loading";
  return onboardingCompleted ? "console" : "onboarding";
}

export function planOnboardingStatusRead(hasReader: boolean): "read" | "assume-complete" {
  return hasReader ? "read" : "assume-complete";
}

export function planOnboardingCompletion(completed: boolean | undefined): "continue" | "reject" {
  return completed === true ? "continue" : "reject";
}

export function planActiveRouteCommit(active: boolean): boolean {
  return active;
}

export function planPendingAgentTeamKey(value: unknown): string | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const key = (value as { pendingAgentTeamKey?: unknown }).pendingAgentTeamKey;
  return typeof key === "string" && key.trim() !== "" ? key : null;
}

export function planReplayPresentation(replaying: boolean): "show-onboarding" | "show-console" {
  return replaying ? "show-onboarding" : "show-console";
}

export function planReplayReturnFocus<T>(isFocusable: boolean, candidate: T): T | null {
  return isFocusable ? candidate : null;
}
