import type { OperatorSession } from "@moebius/console-ui";

export interface SearchedSessionPort {
  restore(apiBase: string, sessionId: string): Promise<OperatorSession>;
}
