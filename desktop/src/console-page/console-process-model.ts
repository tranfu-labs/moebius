import type {
  OperatorProcessAppendOutput,
  OperatorProcessDebugInvocation,
  OperatorProcessOutput,
  OperatorProcessOutputState,
  OperatorProcessInvocationState,
  OperatorProcessTimelineEvent,
} from "@moebius/console-ui";

import { parseProcessOutputSourceKey } from "./process-output-locator.js";

export type ProcessOutputUpdate =
  | { kind: "append"; append: OperatorProcessAppendOutput }
  | {
      kind: "reload";
      reason: "settled" | "cursor-invalid";
      output: OperatorProcessOutput;
    };

export function mergeSettledProcessOutput(
  current: OperatorProcessOutput,
  incoming: OperatorProcessOutput,
): OperatorProcessOutput {
  const replacements = new Map(incoming.events.map((event) => [event.key, event]));
  const seen = new Set<string>();
  const events = [
    ...current.events.map((event) => replacements.get(event.key) ?? event),
    ...incoming.events,
  ].filter((event) => {
    if (seen.has(event.key)) return false;
    seen.add(event.key);
    return true;
  });
  return { ...incoming, events, previousCursor: current.previousCursor };
}

export class ProcessOutputRequestError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string | null,
  ) {
    super(message);
    this.name = "ProcessOutputRequestError";
  }
}

export function subSessionIdFromSourceKey(sourceKey: string | null): string | null {
  if (sourceKey === null) return null;
  const prefix = "sub-session:";
  const sessionId = sourceKey.startsWith(prefix) ? sourceKey.slice(prefix.length) : "";
  return sessionId === "" ? null : sessionId;
}

export function processOutputRunId(sourceKey: string | null, sessionId: string): string | null {
  const locator = processOutputLocator(sourceKey, sessionId);
  return locator?.sessionId === sessionId ? locator.runId : null;
}

export function processOutputLocator(
  sourceKey: string | null,
  legacySessionId?: string,
): { sessionId: string; runId: string } | null {
  return parseProcessOutputSourceKey(sourceKey, legacySessionId);
}

export function mergeRefreshedProcessOutput(
  current: OperatorProcessOutput,
  incoming: OperatorProcessOutput,
): OperatorProcessOutput {
  if (
    current.status === "unavailable"
    || incoming.status === "unavailable"
    || incoming.attempts.length <= current.attempts.length
  ) return incoming;
  return {
    ...incoming,
    events: mergeProcessEvents(current.events, incoming.events),
    previousCursor: current.previousCursor,
  };
}

export function mergeProcessEvents(
  before: readonly OperatorProcessTimelineEvent[],
  after: readonly OperatorProcessTimelineEvent[],
): OperatorProcessTimelineEvent[] {
  const seen = new Set<string>();
  return [...before, ...after].filter((event) => {
    if (seen.has(event.key)) return false;
    seen.add(event.key);
    return true;
  });
}

export function planProcessOutputPolling(
  apiBase: string | null,
  sourceKey: string | null,
  fallbackSessionId: string,
):
  | { kind: "skip" }
  | { kind: "poll"; apiBase: string; sourceKey: string; sessionId: string; runId: string } {
  if (apiBase === null || sourceKey === null) return { kind: "skip" };
  const locator = processOutputLocator(sourceKey, fallbackSessionId);
  return locator === null
    ? { kind: "skip" }
    : { kind: "poll", apiBase, sourceKey, ...locator };
}

export function planProcessOutputRequest(current: OperatorProcessOutputState | undefined):
  | { kind: "load" }
  | { kind: "update"; appendCursor: string; currentStatus: "running" | "settled" } {
  return current?.status === "ready"
    && current.output.status !== "unavailable"
    && current.output.appendCursor !== null
    ? {
        kind: "update",
        appendCursor: current.output.appendCursor,
        currentStatus: current.output.status,
      }
    : { kind: "load" };
}

export function planProcessOutputLoadingState(
  current: OperatorProcessOutputState | undefined,
): OperatorProcessOutputState {
  return current?.status === "ready" ? current : { status: "loading" };
}

export function planProcessOutputUpdateState(
  current: OperatorProcessOutputState | undefined,
  update: ProcessOutputUpdate,
): OperatorProcessOutputState | undefined {
  if (current?.status !== "ready") return current;
  const output = update.kind === "append"
    ? {
        ...current.output,
        events: mergeProcessEvents(current.output.events, update.append.events),
        appendCursor: update.append.appendCursor,
        atLatest: update.append.atLatest,
        status: update.append.status,
      }
    : update.reason === "settled"
      ? mergeSettledProcessOutput(current.output, update.output)
      : mergeRefreshedProcessOutput(current.output, update.output);
  return { ...current, output };
}

export function planLoadedProcessOutputState(
  current: OperatorProcessOutputState | undefined,
  output: OperatorProcessOutput,
): OperatorProcessOutputState {
  return {
    status: "ready",
    output: current?.status === "ready"
      ? mergeRefreshedProcessOutput(current.output, output)
      : output,
  };
}

export function planProcessOutputErrorState(
  current: OperatorProcessOutputState | undefined,
  message: string,
): OperatorProcessOutputState {
  return current?.status === "ready" ? current : { status: "error", message };
}

export function planProcessInvocationRequest(
  apiBase: string | null,
  sessionId: string,
  runId: string,
  current: OperatorProcessInvocationState | undefined,
):
  | { kind: "skip" }
  | { kind: "load"; apiBase: string; sessionId: string; runId: string } {
  return apiBase === null || current?.status === "loading" || current?.status === "ready"
    ? { kind: "skip" }
    : { kind: "load", apiBase, sessionId, runId };
}

export function decideProcessInvocationCommit(current: boolean): "commit" | "ignore" {
  return current ? "commit" : "ignore";
}

export function planProcessInvocationReady(
  invocation: OperatorProcessDebugInvocation,
): OperatorProcessInvocationState {
  return { status: "ready", invocation };
}

export function planPreviousProcessOutputRequest(
  apiBase: string | null,
  sourceKey: string,
  selectedSessionId: string,
  current: OperatorProcessOutputState | undefined,
):
  | { kind: "skip" }
  | { kind: "load"; apiBase: string; sourceKey: string; sessionId: string; runId: string } {
  const locator = processOutputLocator(sourceKey, selectedSessionId);
  return apiBase === null
    || locator === null
    || current?.status !== "ready"
    || current.loadingPrevious === true
    ? { kind: "skip" }
    : { kind: "load", apiBase, sourceKey, ...locator };
}

export function decidePreviousProcessOutputCommit(
  currentSelectionId: string,
  requestSelectionId: string,
): "commit" | "ignore" {
  return currentSelectionId === requestSelectionId ? "commit" : "ignore";
}

export function planPreviousProcessOutputLoading(
  current: OperatorProcessOutputState | undefined,
): OperatorProcessOutputState {
  return current?.status === "ready"
    ? { ...current, loadingPrevious: true }
    : current ?? { status: "idle" };
}

export function planPreviousProcessOutputLoaded(
  current: OperatorProcessOutputState | undefined,
  page: OperatorProcessOutput,
): OperatorProcessOutputState | undefined {
  if (current?.status !== "ready") return current;
  return {
    status: "ready",
    loadingPrevious: false,
    output: {
      ...current.output,
      attempts: page.attempts,
      events: mergeProcessEvents(page.events, current.output.events),
      previousCursor: page.previousCursor,
    },
  };
}

export function planPreviousProcessOutputFailed(
  current: OperatorProcessOutputState | undefined,
): OperatorProcessOutputState | undefined {
  return current?.status === "ready"
    ? { ...current, loadingPrevious: false }
    : current;
}
