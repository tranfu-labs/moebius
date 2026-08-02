import type { OperatorSubSessionViewState } from "@moebius/console-ui";

export type ConversationView = Extract<OperatorSubSessionViewState, { status: "ready" }>["view"];

export interface ConversationViewSyncPort {
  load(input: {
    apiBase: string;
    sessionId: string;
    signal?: AbortSignal;
  }): Promise<ConversationView>;
}
