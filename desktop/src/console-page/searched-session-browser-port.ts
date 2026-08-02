import { fetchFromBrowser } from "./browser-fetch.js";
import { restoreConsoleSession } from "./console-api-client.js";
import type { SearchedSessionPort } from "./searched-session-contract.js";

export const browserSearchedSessionPort: SearchedSessionPort = {
  async restore(apiBase, sessionId) {
    return restoreConsoleSession({ apiBase, sessionId, fetch: fetchFromBrowser });
  },
};
