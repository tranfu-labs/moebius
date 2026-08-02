import {
  loadProcessDebugInvocation,
  loadProcessOutput,
  loadProcessOutputUpdate,
} from "./console-api-client.js";
import { fetchFromBrowser } from "./browser-fetch.js";
import type { ProcessDataSyncPort } from "./process-data-sync-contract.js";

export const browserProcessDataSyncPort: ProcessDataSyncPort = {
  loadOutput: async (input) => await loadProcessOutput({ ...input, fetch: fetchFromBrowser }),
  loadUpdate: async (input) => await loadProcessOutputUpdate({ ...input, fetch: fetchFromBrowser }),
  loadInvocation: async (input) => await loadProcessDebugInvocation({ ...input, fetch: fetchFromBrowser }),
};
