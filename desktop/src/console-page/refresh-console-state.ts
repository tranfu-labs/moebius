import type { ConsoleSelection, SelectionMutationToken } from "./console-state-coordinator.js";
import { ConsoleStateCoordinator } from "./console-state-coordinator.js";
import {
  decideRefreshCommit,
  decideRefreshLease,
  planConsoleEndpoint,
  planConsoleErrorMessage,
  planRefreshResponse,
} from "./console-state-plan.js";

type FetchLike = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

export interface RefreshConsoleStateOptions<TState> {
  apiBase: string;
  selection: ConsoleSelection;
  coordinator: ConsoleStateCoordinator;
  fetch: FetchLike;
  readSelection(state: TState): ConsoleSelection;
  commitState(state: TState): void;
  commitSelection(selection: ConsoleSelection): void;
  setError(error: string | null): void;
  mutationOwner?: SelectionMutationToken;
}

export async function refreshConsoleState<TState>(options: RefreshConsoleStateOptions<TState>): Promise<boolean> {
  const leaseDecision = decideRefreshLease(
    options.coordinator.beginRefresh(options.mutationOwner),
  );
  if (leaseDecision.kind === "skip") {
    return false;
  }
  const lease = leaseDecision.lease;
  try {
    const url = planConsoleEndpoint(options.apiBase, "/api/local-console/state");
    url.searchParams.set("sessionId", options.selection.sessionId);
    url.searchParams.set("projectId", options.selection.projectId);
    const fetch = options.fetch;
    const response = await fetch(url, { signal: lease.controller.signal });
    const body = await response.json() as TState | { error?: string };
    const responsePlan = planRefreshResponse<TState>(response.ok, body);
    if (responsePlan.kind === "rejected") {
      throw new Error(responsePlan.message);
    }
    const commitDecision = decideRefreshCommit(options.coordinator.canCommitRefresh(lease));
    if (commitDecision === "ignore") {
      return false;
    }
    const nextState = responsePlan.state;
    options.commitState(nextState);
    options.commitSelection(options.readSelection(nextState));
    options.setError(null);
    return true;
  } catch (error) {
    const errorDecision = decideRefreshCommit(options.coordinator.canCommitRefresh(lease));
    if (errorDecision === "commit") {
      options.setError(planConsoleErrorMessage(error));
    }
    return false;
  } finally {
    options.coordinator.completeRefresh(lease);
  }
}
