import type { OperatorAgentTeam } from "@moebius/console-ui";

import type { SidebarConversationDraft } from "./sidebar-conversation-drafts.js";

export interface SidebarDraftPreferenceTransport {
  recordSuccessfulConversationAgentTeam?: (request: {
    ownership: "system" | "user";
    teamId: string;
    sessionId: string;
  }) => Promise<unknown>;
}

export interface SidebarDraftPort {
  createConversation(input: {
    apiBase: string;
    draft: SidebarConversationDraft;
    team: OperatorAgentTeam;
    attachmentIds: readonly string[];
  }): Promise<{ sessionId: string; title?: string }>;
  recordSuccessfulTeam(
    transport: SidebarDraftPreferenceTransport | undefined,
    team: OperatorAgentTeam,
    sessionId: string,
  ): Promise<"recorded" | "unavailable">;
}
