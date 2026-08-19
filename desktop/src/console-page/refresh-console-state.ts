import type { ConsoleSelection, SelectionMutationToken } from "./console-state-coordinator.js";
import { ConsoleStateCoordinator } from "./console-state-coordinator.js";
import {
  decideRefreshCommit,
  decideRefreshLease,
  decideRefreshResponse,
  decideResponseEtag,
  planConsoleEndpoint,
  planConsoleStateRequestInit,
  planConsoleErrorMessage,
  planRefreshResponse,
} from "./console-state-plan.js";
import type { ConsoleErrorController } from "./use-console-error-state.js";

type FetchLike = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

export interface ConsoleStateEtagStore {
  read(selection: ConsoleSelection): string | undefined;
  write(selection: ConsoleSelection, etag: string): void;
}

export interface RefreshConsoleStateOptions<TState> {
  apiBase: string;
  selection: ConsoleSelection;
  coordinator: ConsoleStateCoordinator;
  fetch: FetchLike;
  readSelection(state: TState): ConsoleSelection;
  commitState(state: TState): void;
  commitSelection(selection: ConsoleSelection): void;
  errors: ConsoleErrorController;
  mutationOwner?: SelectionMutationToken;
  etags?: ConsoleStateEtagStore;
  /** Invoked after a committed state refresh (desktop uses it to refresh the Dock badge). */
  onStateCommitted?: () => void;
}

export async function refreshConsoleState<TState>(options: RefreshConsoleStateOptions<TState>): Promise<boolean> {
  const leaseDecision = decideRefreshLease(
    options.coordinator.beginRefresh(options.mutationOwner),
  );
  if (leaseDecision.kind === "skip") {
    return false;
  }
  const lease = leaseDecision.lease;
  const errorOperation = options.errors.begin({
    family: "state-refresh",
    scope: `${options.selection.projectId}:${options.selection.sessionId}`,
  });
  try {
    const url = planConsoleEndpoint(options.apiBase, "/api/local-console/state");
    url.searchParams.set("sessionId", options.selection.sessionId);
    url.searchParams.set("projectId", options.selection.projectId);
    const fetch = options.fetch;
    const etag = options.etags?.read(options.selection);
    const response = await fetch(url, {
      signal: lease.controller.signal,
      ...planConsoleStateRequestInit(etag),
    });
    const commitDecision = decideRefreshCommit(options.coordinator.canCommitRefresh(lease));
    const responseDecision = decideRefreshResponse(response.status);
    if (responseDecision === "not-modified") {
      if (commitDecision === "ignore") return false;
      options.errors.succeed(errorOperation);
      return true;
    }
    const body = await response.json() as TState | { error?: string };
    const responsePlan = planRefreshResponse<TState>(response.ok, body);
    if (responsePlan.kind === "rejected") {
      throw new Error(responsePlan.message);
    }
    if (commitDecision === "ignore") {
      return false;
    }
    const nextState = responsePlan.state;
    const nextEtag = response.headers.get("etag");
    const etagDecision = decideResponseEtag(nextEtag);
    if (etagDecision.kind === "write") options.etags?.write(options.selection, etagDecision.etag);
    options.commitState(nextState);
    options.commitSelection(options.readSelection(nextState));
    options.errors.succeed(errorOperation);
    options.onStateCommitted?.();
    return true;
  } catch (error) {
    const errorDecision = decideRefreshCommit(options.coordinator.canCommitRefresh(lease));
    if (errorDecision === "commit") {
      options.errors.fail(errorOperation, planConsoleErrorMessage(error));
    }
    return false;
  } finally {
    options.coordinator.completeRefresh(lease);
  }
}
