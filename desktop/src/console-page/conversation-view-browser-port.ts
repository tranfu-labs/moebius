import { loadSubSessionView } from "./console-api-client.js";
import { fetchFromBrowser } from "./browser-fetch.js";
import type { ConversationViewSyncPort } from "./conversation-view-sync-contract.js";

export const browserConversationViewSyncPort: ConversationViewSyncPort = {
  load: async (input) => await loadSubSessionView({ ...input, fetch: fetchFromBrowser }),
};
