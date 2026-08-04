export type ManagedProcessSelection =
  | { kind: "unavailable" }
  | { kind: "ready"; apiBase: string; sessionId: string };

export function planManagedProcessSelection(apiBase: string | null, sessionId: string | null): ManagedProcessSelection {
  return apiBase === null || sessionId === null ? { kind: "unavailable" } : { kind: "ready", apiBase, sessionId };
}

export function managedProcessSelectionKey(selection: ManagedProcessSelection): string | null {
  return selection.kind === "ready" ? `${selection.apiBase}\u0000${selection.sessionId}` : null;
}

export function planManagedProcessVisibleState<T>(input: {
  selectionKey: string | null;
  committedSelectionKey: string | null;
  state: T;
  loading: T;
}): T {
  return input.selectionKey === input.committedSelectionKey ? input.state : input.loading;
}

export function planManagedProcessCommandFailure<T extends object>(input: {
  requestRevision: number;
  currentRevision: number;
  state: T;
  message: string;
}): T | (T & { message: string }) {
  return decideManagedProcessRequestCommit(input.requestRevision, input.currentRevision, false) === "commit"
    ? { ...input.state, message: input.message }
    : input.state;
}

export function decideManagedProcessRequestCommit(requestRevision: number, currentRevision: number, aborted: boolean): "commit" | "discard" {
  return requestRevision === currentRevision && !aborted ? "commit" : "discard";
}

export function decideManagedProcessCommand(selection: ManagedProcessSelection, alreadyPending: boolean): "skip" | "run" {
  return selection.kind === "ready" && !alreadyPending ? "run" : "skip";
}

export function decideManagedProcessSelection(selection: ManagedProcessSelection):
  | { kind: "clear" }
  | { kind: "load"; target: Extract<ManagedProcessSelection, { kind: "ready" }> } {
  return selection.kind === "ready" ? { kind: "load", target: selection } : { kind: "clear" };
}

export function managedProcessErrorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

export function planManagedProcessCommandTarget(
  selection: ManagedProcessSelection,
  id: string,
  command: "stop" | "acknowledge-exited",
): { kind: "unavailable" } | { kind: "request"; input: { apiBase: string; sessionId: string; id?: string; command: "stop" | "acknowledge-exited" } } {
  if (selection.kind === "unavailable") return { kind: "unavailable" };
  return {
    kind: "request",
    input: {
      apiBase: selection.apiBase,
      sessionId: selection.sessionId,
      ...(command === "stop" ? { id } : {}),
      command,
    },
  };
}

export function planManagedProcessLogLoading<T extends { status: string; message?: string }>(previous: T | undefined): T | { status: "loading" } {
  return previous?.status === "ready" ? { ...previous, message: undefined } : { status: "loading" };
}

export function planManagedProcessLogFailure<T extends { status: string }>(previous: T | undefined, message: string): T & { message: string } | { status: "failed"; message: string } {
  return previous?.status === "ready" ? { ...previous, message } : { status: "failed", message };
}

export function planManagedProcessLogCursor(previous: { status: string; cursor?: string } | undefined): string | undefined {
  return previous?.status === "ready" ? previous.cursor : undefined;
}

export function planManagedProcessLogCommit<
  TPrevious extends { status: string; cursor?: string; message?: string },
  TResult extends { status: "ready"; cursor?: string; unchanged?: boolean },
>(previous: TPrevious | undefined, result: TResult): TPrevious | TResult {
  return result.unchanged === true && previous?.status === "ready"
    ? { ...previous, cursor: result.cursor, message: undefined }
    : result;
}

export function decideManagedProcessLogPolling(panelOpen: boolean): "poll" | "skip" {
  return panelOpen ? "poll" : "skip";
}
