import type { OperatorSubSessionView } from "@moebius/console-ui";

export interface SidebarMessagePort {
  submitMessage(
    apiBase: string,
    sessionId: string,
    body: string,
    attachmentIds: readonly string[],
  ): Promise<void>;
  loadView(apiBase: string, sessionId: string): Promise<OperatorSubSessionView>;
  retryPending(apiBase: string, sessionId: string, messageId: number): Promise<void>;
  updatePending(apiBase: string, sessionId: string, messageId: number, body: string): Promise<void>;
  removePending(apiBase: string, sessionId: string, messageId: number): Promise<void>;
}
