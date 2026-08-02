import { fetchFromBrowser } from "./browser-fetch.js";
import { createSidebarConversationSession } from "./console-api-client.js";
import type { SidebarDraftPort } from "./sidebar-draft-contract.js";

export const browserSidebarDraftPort: SidebarDraftPort = {
  async createConversation({ apiBase, draft, team, attachmentIds }) {
    return createSidebarConversationSession({
      apiBase,
      projectId: draft.context.projectId!,
      initialMessage: draft.body,
      agentTeam: { ownership: team.ownership, id: team.id },
      workspaceMode: draft.context.workspaceMode,
      attachmentIds,
      attachmentDraftKey: draft.attachmentDraftKey,
      originSessionId: draft.originSessionId,
      analysisParentSessionId: draft.hostSessionId,
      entryTemplate: draft.entryTemplate,
      writePolicy: draft.writePolicy,
      textFragments: draft.textFragments,
      fetch: fetchFromBrowser,
    });
  },
  async recordSuccessfulTeam(transport, team, sessionId) {
    if (transport?.recordSuccessfulConversationAgentTeam === undefined) return "unavailable";
    await transport.recordSuccessfulConversationAgentTeam({
      ownership: team.ownership,
      teamId: team.id,
      sessionId,
    });
    return "recorded";
  },
};
