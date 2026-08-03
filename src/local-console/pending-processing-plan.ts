import { hasPendingStartupControlWork } from "./runtime-domain.js";
import type { LocalConsoleSessionSummary } from "./types.js";

export function decidePendingAdmission(input: {
  stopping: boolean;
  processing: boolean;
}): { kind: "stop" } | { kind: "queue" } | { kind: "run" } {
  if (input.stopping) return { kind: "stop" };
  return input.processing ? { kind: "queue" } : { kind: "run" };
}

export function decidePendingProcessingAdmission(input: {
  stopping: boolean;
  processing: boolean;
  retryReserved: boolean;
}): { kind: "stop" } | { kind: "queue" } | { kind: "run" } {
  if (input.stopping) return { kind: "stop" };
  return input.processing || input.retryReserved ? { kind: "queue" } : { kind: "run" };
}

export function decidePendingProcessingFollowUp(input: {
  stopping: boolean;
  requested: boolean;
  retryReserved: boolean;
}): { kind: "hold" } | { kind: "rerun" } | { kind: "clear" } | { kind: "none" } {
  if (input.retryReserved) return { kind: "hold" };
  return decidePendingFollowUp({ stopping: input.stopping, requested: input.requested });
}

export function decideRetryAfterCurrentAttempt(stopping: boolean): { kind: "stop" } | { kind: "run" } {
  return stopping ? { kind: "stop" } : { kind: "run" };
}

export function decideRetryDrainRequest(input: {
  succeeded: boolean;
  requested: boolean;
}): boolean {
  return input.succeeded || input.requested;
}

export function decideRetryOperationResult(input: {
  scheduled: boolean;
  succeeded: boolean;
}): boolean {
  return input.scheduled && input.succeeded;
}

export function decideRetryAfterCurrentFinish(input: {
  reservations: number;
  succeeded: boolean;
  stopping: boolean;
  retryDrainRequested: boolean;
  pendingProcess: boolean;
}):
  | { kind: "retain"; remaining: number; accepted: true }
  | { kind: "release"; shouldSchedule: boolean; accepted: boolean } {
  if (input.reservations > 1) {
    return { kind: "retain", remaining: input.reservations - 1, accepted: true };
  }
  const shouldSchedule = input.retryDrainRequested || input.pendingProcess;
  return {
    kind: "release",
    shouldSchedule: shouldSchedule && !input.stopping,
    accepted: input.succeeded ? shouldSchedule && !input.stopping : true,
  };
}

export function decideRetryTailCleanup(input: {
  currentTail: boolean;
}): "cleanup" | "keep" {
  return input.currentTail ? "cleanup" : "keep";
}

export function decideRetryTailSource(hasTail: boolean): { kind: "empty" } | { kind: "existing" } {
  return hasTail ? { kind: "existing" } : { kind: "empty" };
}

export function planRetryReservationCount(reservations: number | undefined): number {
  return reservations === undefined ? 0 : reservations;
}

export function decidePendingCompletion(input: {
  hasCompletion: boolean;
}): "wait" | "ready" {
  return input.hasCompletion ? "wait" : "ready";
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

export function planHasPendingControlWork(input: {
  activeMessage: boolean;
  hasMessageAfterCursor: boolean;
}): boolean {
  return input.activeMessage || input.hasMessageAfterCursor;
}

export function decidePendingControlWorkInspection(input: {
  hasRunningMessage: boolean;
  hasQueuedControlMessage: boolean;
}): "pending" | "inspect-cursor" {
  return input.hasRunningMessage || input.hasQueuedControlMessage ? "pending" : "inspect-cursor";
}
