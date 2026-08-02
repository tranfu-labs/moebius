import type {
  OperatorProcessAppendOutput,
  OperatorProcessOutput,
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
