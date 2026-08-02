import { fetchFromBrowser } from "./browser-fetch.js";
import { submitSessionMessage, retrySessionRun } from "./console-api-client.js";
import { interruptLocalConsoleRun } from "./interrupt.js";
import type { SessionRunPort } from "./session-run-contract.js";

export const browserSessionRunPort: SessionRunPort = {
  async interrupt(apiBase, sessionId, runId, refresh) {
    return interruptLocalConsoleRun({ apiBase, sessionId, runId, fetch: fetchFromBrowser, refresh });
  },
  async submitMessage(apiBase, sessionId, body, attachmentIds) {
    await submitSessionMessage({ apiBase, sessionId, body, attachmentIds, fetch: fetchFromBrowser });
  },
  async retryRun(apiBase, sessionId, runId, executionOverride) {
    await retrySessionRun({ apiBase, sessionId, runId, executionOverride, fetch: fetchFromBrowser });
  },
};
