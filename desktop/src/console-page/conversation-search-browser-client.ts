import { fetchFromBrowser } from "./browser-fetch.js";
import { searchConsoleSessions } from "./console-api-client.js";
import type { ConversationSearchPort } from "./use-conversation-search.js";

export const browserConversationSearchPort: ConversationSearchPort = {
  search(input) {
    return searchConsoleSessions({ ...input, fetch: fetchFromBrowser });
  },
};
