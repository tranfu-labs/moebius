import { fetchFromBrowser } from "./browser-fetch.js";
import {
  loadSubSessionView,
  removePendingSessionMessage,
  retryPendingSessionMessage,
  submitSessionMessage,
  updatePendingSessionMessage,
} from "./console-api-client.js";
import type { SidebarMessagePort } from "./sidebar-message-contract.js";

export const browserSidebarMessagePort: SidebarMessagePort = {
  async submitMessage(apiBase, sessionId, body, attachmentIds) {
    await submitSessionMessage({ apiBase, sessionId, body, attachmentIds, fetch: fetchFromBrowser });
  },
  async loadView(apiBase, sessionId) {
    return loadSubSessionView({ apiBase, sessionId, fetch: fetchFromBrowser });
  },
  async retryPending(apiBase, sessionId, messageId) {
    await retryPendingSessionMessage({ apiBase, sessionId, messageId, fetch: fetchFromBrowser });
  },
  async updatePending(apiBase, sessionId, messageId, body) {
    await updatePendingSessionMessage({ apiBase, sessionId, messageId, body, fetch: fetchFromBrowser });
  },
  async removePending(apiBase, sessionId, messageId) {
    await removePendingSessionMessage({ apiBase, sessionId, messageId, fetch: fetchFromBrowser });
  },
};
