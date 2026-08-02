export type ConsoleErrorSourceFamily =
  | "analysis"
  | "attachment"
  | "conversation"
  | "desktop-shell"
  | "edit-resend"
  | "new-conversation"
  | "process-data"
  | "project"
  | "result-acknowledgement"
  | "search-navigation"
  | "session-run"
  | "sidebar-draft"
  | "sidebar-message"
  | "state-refresh";

export interface ConsoleErrorSource {
  family: ConsoleErrorSourceFamily;
  scope?: string;
}

export interface ConsoleErrorOperation {
  sourceKey: string;
  generation: number;
}

interface ConsoleErrorEntry {
  operation: ConsoleErrorOperation;
  message: string;
  publishedSequence: number;
}

export interface ConsoleErrorState {
  unresolvedBySource: Readonly<Record<string, ConsoleErrorEntry>>;
  latestGenerationBySource: Readonly<Record<string, number>>;
  nextPublishedSequence: number;
}

export interface BegunConsoleErrorOperation {
  state: ConsoleErrorState;
  operation: ConsoleErrorOperation;
}

export function createConsoleErrorState(): ConsoleErrorState {
  return {
    unresolvedBySource: {},
    latestGenerationBySource: {},
    nextPublishedSequence: 1,
  };
}

export function beginConsoleErrorOperation(
  state: ConsoleErrorState,
  source: ConsoleErrorSource,
): BegunConsoleErrorOperation {
  const sourceKey = consoleErrorSourceKey(source);
  const operation = {
    sourceKey,
    generation: (state.latestGenerationBySource[sourceKey] ?? 0) + 1,
  };
  return {
    operation,
    state: {
      ...state,
      latestGenerationBySource: {
        ...state.latestGenerationBySource,
        [sourceKey]: operation.generation,
      },
    },
  };
}

export function failConsoleErrorOperation(
  state: ConsoleErrorState,
  operation: ConsoleErrorOperation,
  message: string,
): ConsoleErrorState {
  if (!isLatestConsoleErrorOperation(state, operation)) return state;
  return {
    ...state,
    unresolvedBySource: {
      ...state.unresolvedBySource,
      [operation.sourceKey]: {
        operation,
        message,
        publishedSequence: state.nextPublishedSequence,
      },
    },
    nextPublishedSequence: state.nextPublishedSequence + 1,
  };
}

export function succeedConsoleErrorOperation(
  state: ConsoleErrorState,
  operation: ConsoleErrorOperation,
): ConsoleErrorState {
  if (!isLatestConsoleErrorOperation(state, operation)) return state;
  if (state.unresolvedBySource[operation.sourceKey] === undefined) return state;
  const unresolvedBySource = { ...state.unresolvedBySource };
  delete unresolvedBySource[operation.sourceKey];
  return { ...state, unresolvedBySource };
}

export function selectVisibleConsoleError(state: ConsoleErrorState): string | null {
  let latest: ConsoleErrorEntry | undefined;
  for (const entry of Object.values(state.unresolvedBySource)) {
    if (latest === undefined || entry.publishedSequence > latest.publishedSequence) latest = entry;
  }
  return latest?.message ?? null;
}

function consoleErrorSourceKey(source: ConsoleErrorSource): string {
  return source.scope === undefined ? source.family : `${source.family}\u0000${source.scope}`;
}

function isLatestConsoleErrorOperation(
  state: ConsoleErrorState,
  operation: ConsoleErrorOperation,
): boolean {
  return state.latestGenerationBySource[operation.sourceKey] === operation.generation;
}
