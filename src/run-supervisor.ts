import {
  isTrueExecutionProgress,
  type ExecutionProgressEvent,
} from "./execution-contract.js";

export interface RunSupervisorState {
  lastProgressAt: number;
  lastSequence: number;
  busySince: number | null;
  busyAttempt: number | null;
  activeToolIds: ReadonlySet<string>;
}

export type RunSupervisorDecision =
  | { kind: "none"; state: RunSupervisorState }
  | { kind: "progress-observed"; state: RunSupervisorState }
  | { kind: "busy-retry-observed"; attempt: number | null; state: RunSupervisorState };

export function createRunSupervisorState(now: number): RunSupervisorState {
  return {
    lastProgressAt: now,
    lastSequence: 0,
    busySince: null,
    busyAttempt: null,
    activeToolIds: new Set(),
  };
}

/**
 * A provider-level terminal event can close the invocation even when a bounded
 * live stream dropped the matching tool-finished item. This only settles the
 * temporary tool set; it is not a progress observation or a run terminal.
 */
export function settleRunSupervisorTools(previous: RunSupervisorState): RunSupervisorState {
  if (previous.activeToolIds.size === 0) return previous;
  return {
    ...previous,
    activeToolIds: new Set(),
  };
}

export function observeRunProgress(
  previous: RunSupervisorState,
  event: ExecutionProgressEvent,
  now: number,
): RunSupervisorDecision {
  if (event.sequence <= previous.lastSequence) {
    return { kind: "none", state: previous };
  }
  const sequenced = { ...previous, lastSequence: event.sequence };
  if (event.kind === "provider-retry") {
    const state = {
      ...sequenced,
      busySince: sequenced.busySince ?? now,
      busyAttempt: event.attempt ?? sequenced.busyAttempt,
    };
    return { kind: "busy-retry-observed", attempt: state.busyAttempt, state };
  }
  if (!isTrueExecutionProgress(event)) {
    return { kind: "none", state: sequenced };
  }
  if (event.kind === "tool-started" || event.kind === "tool-finished") {
    const activeToolIds = new Set(sequenced.activeToolIds);
    if (event.kind === "tool-started") {
      if (activeToolIds.has(event.toolId)) {
        return { kind: "none", state: sequenced };
      }
      activeToolIds.add(event.toolId);
    } else {
      if (!activeToolIds.has(event.toolId)) {
        return { kind: "none", state: sequenced };
      }
      activeToolIds.delete(event.toolId);
    }
    return {
      kind: "progress-observed",
      state: {
        ...sequenced,
        lastProgressAt: now,
        busySince: null,
        busyAttempt: null,
        activeToolIds,
      },
    };
  }
  return {
    kind: "progress-observed",
    state: {
      ...sequenced,
      lastProgressAt: now,
      busySince: null,
      busyAttempt: null,
    },
  };
}
