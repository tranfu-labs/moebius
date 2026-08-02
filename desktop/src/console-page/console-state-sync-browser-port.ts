import { acknowledgeDisplayedResult } from "./console-api-client.js";
import { fetchFromBrowser } from "./browser-fetch.js";
import type { ConsoleStateSyncPort } from "./console-state-sync-contract.js";

export const browserConsoleStateSyncPort: ConsoleStateSyncPort = {
  fetch: fetchFromBrowser,
  acknowledgeDisplayedResult: async (input) => {
    await acknowledgeDisplayedResult({ ...input, fetch: fetchFromBrowser });
  },
};
