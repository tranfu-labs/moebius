import { useCallback, useMemo, useRef, useState } from "react";

import {
  IDLE_CONVERSATION_SEARCH_STATE,
  planConversationSearchAvailability,
  planConversationSearchCommit,
  planConversationSearchFailure,
  planConversationSearchItems,
  planConversationSearchReady,
  planConversationSearchResult,
  planConversationSearchResume,
  planConversationSearchStart,
  planConversationSearchSuspended,
  type ConversationSearchInput,
  type SessionSearchResult,
} from "./conversation-search-model.js";
import { planConsoleErrorMessage } from "./console-state-plan.js";

export interface ConversationSearchPort {
  search(input: ConversationSearchInput & {
    apiBase: string;
    signal: AbortSignal;
  }): Promise<SessionSearchResult[]>;
}

export function useConversationSearch(input: {
  apiBase: string | null;
  port: ConversationSearchPort;
}) {
  const inputRef = useRef(input);
  inputRef.current = input;
  const [searchState, setSearchState] = useState(IDLE_CONVERSATION_SEARCH_STATE);
  const stateRef = useRef(searchState);
  stateRef.current = searchState;
  const requestRef = useRef<AbortController | null>(null);
  const searchInputRef = useRef<ConversationSearchInput | null>(null);
  const executeSearch = useCallback((searchInput: ConversationSearchInput) => {
    const runtime = inputRef.current;
    if (planConversationSearchAvailability(runtime.apiBase) === "unavailable") return;
    searchInputRef.current = searchInput;
    requestRef.current?.abort("search-condition-changed");
    const controller = new AbortController();
    requestRef.current = controller;
    const started = planConversationSearchStart(searchInput);
    setSearchState(started);
    void runtime.port.search({
      ...searchInput,
      apiBase: runtime.apiBase!,
      signal: controller.signal,
    }).then((results) => {
      if (planConversationSearchCommit(
        requestRef.current === controller,
        controller.signal.aborted,
      ) === "ignore") return;
      setSearchState(planConversationSearchReady(started.conditionKey!, results));
    }).catch((error: unknown) => {
      if (planConversationSearchCommit(
        requestRef.current === controller,
        controller.signal.aborted,
      ) === "ignore") return;
      setSearchState(planConversationSearchFailure(started.conditionKey!, planConsoleErrorMessage(error)));
    });
  }, []);
  const closeSearch = useCallback(() => {
    requestRef.current?.abort("search-closed");
    requestRef.current = null;
    searchInputRef.current = null;
    setSearchState(IDLE_CONVERSATION_SEARCH_STATE);
  }, []);
  const suspendForMutation = useCallback(() => {
    const suspendedInput = searchInputRef.current;
    requestRef.current?.abort("conversation-title-mutation-started");
    requestRef.current = null;
    setSearchState((current) => planConversationSearchSuspended(current));
    return () => {
      const resumed = planConversationSearchResume(suspendedInput);
      if (resumed !== null) executeSearch(resumed);
    };
  }, [executeSearch]);
  const resolveResult = useCallback((sessionId: string) =>
    planConversationSearchResult(stateRef.current.results, sessionId), []);
  const searchResults = useMemo(() => planConversationSearchItems(searchState.results), [searchState.results]);
  return useMemo(() => ({
    searchState,
    searchResults,
    executeSearch,
    closeSearch,
    suspendForMutation,
    resolveResult,
  }), [closeSearch, executeSearch, resolveResult, searchResults, searchState, suspendForMutation]);
}
