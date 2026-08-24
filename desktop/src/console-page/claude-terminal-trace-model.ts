import type {
  OperatorClaudeTerminalTrace,
  OperatorClaudeTerminalTracePage,
  OperatorClaudeTerminalTraceState,
  OperatorClaudeTerminalTraces,
  OperatorProcessOutput,
  OperatorRunSnapshot,
  OperatorSubSessionViewState,
} from "@moebius/console-ui";

export interface ClaudeTerminalTraceTarget {
  sessionId: string;
  runId: string;
  key: string;
  follow: boolean;
}

export type ClaudeTerminalTraceStates = Readonly<Record<string, OperatorClaudeTerminalTraceState>>;

export interface ClaudeTerminalTracePort {
  load(input: {
    apiBase: string;
    sessionId: string;
    runId: string;
    cursor: number;
    signal: AbortSignal;
  }): Promise<OperatorClaudeTerminalTracePage>;
}

/** Includes primary and ready sub-session runs while preserving exact identity. */
export function planVisibleClaudeTerminalTraceRuns(
  activeRuns: readonly OperatorRunSnapshot[],
  subSessionViews: Readonly<Record<string, OperatorSubSessionViewState>>,
): readonly OperatorRunSnapshot[] {
  const runs = new Map<string, OperatorRunSnapshot>();
  for (const run of activeRuns) runs.set(`${run.sessionId}/${run.runId}`, run);
  for (const subSession of Object.values(subSessionViews)) {
    if (subSession.status !== "ready") continue;
    for (const run of subSession.view.activeRuns ?? (subSession.view.activeRun === null ? [] : [subSession.view.activeRun])) {
      runs.set(`${run.sessionId}/${run.runId}`, run);
    }
  }
  return [...runs.values()];
}

/** Selects exact Claude attempts without making the view own a transport key. */
export function planClaudeTerminalTraceTargets(
  activeRuns: readonly OperatorRunSnapshot[],
  processOutputs: readonly OperatorProcessOutput[] = [],
): readonly ClaudeTerminalTraceTarget[] {
  const targets = new Map<string, ClaudeTerminalTraceTarget>();
  const addTarget = (sessionId: string, runId: string, follow: boolean): void => {
    const key = terminalTraceTransportKey(sessionId, runId);
    const current = targets.get(key);
    targets.set(key, {
      sessionId,
      runId,
      key,
      follow: current?.follow === true || follow,
    });
  };
  for (const run of activeRuns) {
    if (run.engine === "claude") addTarget(run.sessionId, run.runId, true);
  }
  for (const output of processOutputs) {
    for (const attempt of output.attempts) {
      if (attempt.engine === "claude") {
        addTarget(output.sessionId, attempt.runId, attempt.status === "running");
      }
    }
  }
  return [...targets.values()].sort((left, right) => left.key.localeCompare(right.key));
}

/** Stable effect dependency: only a Claude run's exact identity changes its trace source. */
export function planClaudeTerminalTraceTargetSignature(
  activeRuns: readonly OperatorRunSnapshot[],
  processOutputs: readonly OperatorProcessOutput[] = [],
): string {
  return JSON.stringify(planClaudeTerminalTraceTargets(activeRuns, processOutputs)
    .map((target) => `${target.key}:${target.follow ? "follow" : "settled"}`));
}

/** Seeds/removes active view state and decides whether loopback polling may begin. */
export function planClaudeTerminalTracePolling(input: {
  apiBase: string | null;
  targets: readonly ClaudeTerminalTraceTarget[];
  current: ClaudeTerminalTraceStates;
}):
  | { kind: "skip"; states: ClaudeTerminalTraceStates }
  | { kind: "poll"; apiBase: string; targets: readonly ClaudeTerminalTraceTarget[]; states: ClaudeTerminalTraceStates } {
  const states = planClaudeTerminalTraceStates(input.apiBase, input.targets, input.current);
  return input.apiBase === null || input.targets.length === 0
    ? { kind: "skip", states }
    : { kind: "poll", apiBase: input.apiBase, targets: input.targets, states };
}

export function decideClaudeTerminalTraceRequest(
  inFlight: boolean,
  target: ClaudeTerminalTraceTarget,
  current: OperatorClaudeTerminalTraceState | undefined,
): "request" | "wait" | "skip" {
  if (inFlight) return "wait";
  if (!target.follow && (current?.status === "ready" || current?.status === "unavailable")) return "skip";
  return "request";
}

export function planClaudeTerminalTraceRequestTargets(input: {
  inFlight: boolean;
  targets: readonly ClaudeTerminalTraceTarget[];
  states: ClaudeTerminalTraceStates;
}):
  | { kind: "wait" }
  | { kind: "idle" }
  | { kind: "request"; targets: readonly ClaudeTerminalTraceTarget[] } {
  if (input.inFlight) return { kind: "wait" };
  const targets = input.targets.filter((target) =>
    decideClaudeTerminalTraceRequest(false, target, input.states[target.key]) === "request");
  return targets.length === 0 ? { kind: "idle" } : { kind: "request", targets };
}

export function decideClaudeTerminalTraceReschedule(
  targets: readonly ClaudeTerminalTraceTarget[],
  states: ClaudeTerminalTraceStates,
): "schedule" | "stop" {
  return targets.some((target) => target.follow
    || states[target.key]?.status === "connecting"
    || states[target.key]?.status === "reconnecting")
    ? "schedule"
    : "stop";
}

export function planClaudeTerminalTraceCursor(
  current: OperatorClaudeTerminalTraceState | undefined,
): number {
  return current?.nextCursor ?? 0;
}

export function decideClaudeTerminalTracePageCommit(input: {
  aborted: boolean;
  target: ClaudeTerminalTraceTarget;
  page: OperatorClaudeTerminalTracePage;
}): "commit" | "discard" {
  return !input.aborted
    && input.page.sessionId === input.target.sessionId
    && input.page.runId === input.target.runId
    ? "commit"
    : "discard";
}

export function isClaudeTerminalTraceUnavailableError(error: unknown): boolean {
  return typeof error === "object"
    && error !== null
    && "code" in error
    && (error as { code?: unknown }).code === "CLAUDE_TERMINAL_TRACE_UNAVAILABLE";
}

export function planClaudeTerminalTracePageState(
  current: OperatorClaudeTerminalTraceState | undefined,
  page: OperatorClaudeTerminalTracePage,
): OperatorClaudeTerminalTraceState {
  const chunksByCursor = new Map<number, OperatorClaudeTerminalTraceState["chunks"][number]>();
  for (const chunk of current?.chunks ?? []) chunksByCursor.set(chunk.cursor, chunk);
  for (const chunk of page.chunks) chunksByCursor.set(chunk.cursor, chunk);
  const chunks = [...chunksByCursor.values()].sort((left, right) => left.cursor - right.cursor);
  const nextState: OperatorClaudeTerminalTraceState = {
    status: "ready",
    chunks,
    nextCursor: page.nextCursor,
    bytesObserved: page.bytesObserved,
    bytesRetained: page.bytesRetained,
    incomplete: page.incomplete || current?.incomplete === true,
  };
  return current?.status === "ready"
    && current.nextCursor === page.nextCursor
    && current.bytesObserved === nextState.bytesObserved
    && current.bytesRetained === nextState.bytesRetained
    && current.incomplete === nextState.incomplete
    && current.chunks.length === chunks.length
    && current.chunks.every((chunk, index) => chunk === chunks[index])
    ? current
    : nextState;
}

export function planClaudeTerminalTraceFailureState(
  current: OperatorClaudeTerminalTraceState | undefined,
  unavailable: boolean,
): OperatorClaudeTerminalTraceState {
  return {
    status: unavailable ? "unavailable" : "reconnecting",
    chunks: current?.chunks ?? [],
    nextCursor: current?.nextCursor ?? 0,
    bytesObserved: current?.bytesObserved ?? 0,
    bytesRetained: current?.bytesRetained ?? 0,
    incomplete: current?.incomplete ?? false,
  };
}

export function planClaudeTerminalTraceViews(
  targets: readonly ClaudeTerminalTraceTarget[],
  states: ClaudeTerminalTraceStates,
): OperatorClaudeTerminalTraces {
  const traces: OperatorClaudeTerminalTrace[] = [];
  for (const target of targets) {
    traces.push({
      sessionId: target.sessionId,
      runId: target.runId,
      state: states[target.key] ?? emptyClaudeTerminalTraceState("connecting"),
    });
  }
  return traces;
}

function planClaudeTerminalTraceStates(
  apiBase: string | null,
  targets: readonly ClaudeTerminalTraceTarget[],
  current: ClaudeTerminalTraceStates,
): ClaudeTerminalTraceStates {
  const next: Record<string, OperatorClaudeTerminalTraceState> = {};
  for (const target of targets) {
    next[target.key] = current[target.key]
      ?? emptyClaudeTerminalTraceState(apiBase === null ? "unavailable" : "connecting");
  }
  const currentKeys = Object.keys(current);
  return currentKeys.length === Object.keys(next).length
    && currentKeys.every((key) => next[key] === current[key])
    ? current
    : next;
}

function emptyClaudeTerminalTraceState(
  status: OperatorClaudeTerminalTraceState["status"],
): OperatorClaudeTerminalTraceState {
  return {
    status,
    chunks: [],
    nextCursor: 0,
    bytesObserved: 0,
    bytesRetained: 0,
    incomplete: false,
  };
}

function terminalTraceTransportKey(sessionId: string, runId: string): string {
  return `${encodeURIComponent(sessionId)}:${encodeURIComponent(runId)}`;
}
