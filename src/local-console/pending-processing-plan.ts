import { hasPendingStartupControlWork } from "./runtime-domain.js";
import type { LocalConsoleSessionSummary } from "./types.js";

export function decidePendingAdmission(input: {
  stopping: boolean;
  processing: boolean;
}): { kind: "stop" } | { kind: "queue" } | { kind: "run" } {
  if (input.stopping) return { kind: "stop" };
  return input.processing ? { kind: "queue" } : { kind: "run" };
}

export function decidePendingWorkspace(input: {
  stopping: boolean;
  workspaceAvailable: boolean;
}): { kind: "stop" } | { kind: "run" } {
  return input.stopping || !input.workspaceAvailable ? { kind: "stop" } : { kind: "run" };
}

export function decidePendingPrimaryClaim(persistedPrimary: boolean): { kind: "stop" } | { kind: "claim" } {
  return persistedPrimary ? { kind: "stop" } : { kind: "claim" };
}

export function decidePendingIteration(outcome: "continue" | "stop"): { kind: "continue" } | { kind: "stop" } {
  return outcome === "continue" ? { kind: "continue" } : { kind: "stop" };
}

export function decidePendingFollowUp(input: {
  stopping: boolean;
  requested: boolean;
}): { kind: "rerun" } | { kind: "clear" } | { kind: "none" } {
  if (input.stopping) return input.requested ? { kind: "clear" } : { kind: "none" };
  return input.requested ? { kind: "rerun" } : { kind: "none" };
}

export function decidePendingWait(input: {
  stopping: boolean;
  processing: boolean;
}): { kind: "wait" } | { kind: "ready" } | { kind: "stop" } {
  if (input.stopping) return { kind: "stop" };
  return input.processing ? { kind: "wait" } : { kind: "ready" };
}

export function planPendingSessionIds(sessions: readonly LocalConsoleSessionSummary[]): string[] {
  return sessions.filter(hasPendingStartupControlWork).map((session) => session.sessionId);
}
