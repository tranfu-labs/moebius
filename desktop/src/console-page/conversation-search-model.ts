import type { ConversationSearchResultItem, OperatorSession } from "@moebius/console-ui";

export interface SessionSearchResult {
  session: OperatorSession;
  project: { projectId: string; title: string };
  archived: boolean;
  originAvailable: boolean;
}

export interface ConversationSearchInput {
  query: string;
  includeArchived: boolean;
}

export interface ConversationSearchState {
  status: "idle" | "loading" | "ready" | "error";
  results: SessionSearchResult[];
  error: string | null;
  conditionKey: string | null;
}

export const IDLE_CONVERSATION_SEARCH_STATE: ConversationSearchState = {
  status: "idle",
  results: [],
  error: null,
  conditionKey: null,
};

export function planConversationSearchAvailability(apiBase: string | null): "search" | "unavailable" {
  return apiBase === null ? "unavailable" : "search";
}

export function planConversationSearchStart(input: ConversationSearchInput): ConversationSearchState {
  return {
    status: "loading",
    results: [],
    error: null,
    conditionKey: `${input.query.trim().normalize("NFKC").toLowerCase()}\u0000${String(input.includeArchived)}`,
  };
}

export function planConversationSearchReady(
  conditionKey: string,
  results: SessionSearchResult[],
): ConversationSearchState {
  return { status: "ready", results, error: null, conditionKey };
}

export function planConversationSearchFailure(conditionKey: string, error: string): ConversationSearchState {
  return { status: "error", results: [], error, conditionKey };
}

export function planConversationSearchSuspended(state: ConversationSearchState): ConversationSearchState {
  return {
    ...state,
    status: state.conditionKey === null ? "idle" : "loading",
    results: [],
    error: null,
  };
}

export function planConversationSearchCommit(active: boolean, aborted: boolean): "commit" | "ignore" {
  return active && !aborted ? "commit" : "ignore";
}

export function planConversationSearchResume(
  input: ConversationSearchInput | null,
): ConversationSearchInput | null {
  return input;
}

export function planConversationSearchItems(
  results: readonly SessionSearchResult[],
): ConversationSearchResultItem[] {
  return results.map((result) => ({
    sessionId: result.session.sessionId,
    projectId: result.project.projectId,
    projectTitle: result.project.title,
    title: result.session.title,
    archived: result.archived,
  }));
}

export function planConversationSearchResult(
  results: readonly SessionSearchResult[],
  sessionId: string,
): SessionSearchResult | undefined {
  return results.find((result) => result.session.sessionId === sessionId);
}
