import { loadSessionReferenceText } from "./console-api-client.js";
import type { ConversationAnalysisReferencePort } from "./conversation-analysis-contract.js";
import { fetchFromBrowser } from "./browser-fetch.js";

export const browserConversationAnalysisReferencePort: ConversationAnalysisReferencePort = {
  load: (input) => loadSessionReferenceText({ ...input, fetch: fetchFromBrowser }),
};
