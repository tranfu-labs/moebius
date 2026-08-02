import { ConversationSearch, type ConversationSearchResultItem } from "@moebius/console-ui";

import type {
  ConversationSearchInput,
  ConversationSearchState,
  SessionSearchResult,
} from "./conversation-search-model.js";

export function ConversationSearchOverlay(props: {
  searchState: ConversationSearchState;
  searchResults: ConversationSearchResultItem[];
  executeSearch(input: ConversationSearchInput): void;
  closeSearch(): void;
  resolveResult(sessionId: string): SessionSearchResult | undefined;
  closeHost(): void;
  onOpen(result: SessionSearchResult, restore: boolean): Promise<boolean>;
}) {
  const close = () => {
    props.closeSearch();
    props.closeHost();
  };
  const open = (item: ConversationSearchResultItem, restore: boolean) => {
    const result = props.resolveResult(item.sessionId);
    if (result === undefined) return;
    void props.onOpen(result, restore).then((opened) => {
      if (opened) close();
    });
  };
  return (
    <ConversationSearch
      results={props.searchResults}
      status={props.searchState.status}
      error={props.searchState.error}
      onSearch={props.executeSearch}
      onClose={close}
      onOpen={(item) => open(item, false)}
      onRestoreAndOpen={(item) => open(item, true)}
    />
  );
}
