import type { LastUsedAgentTeam } from "./team-conversation-preference-contract.js";
import {
  parseSuccessfulConversationRequest,
  selectConversationAgentTeam,
  type LastUsedAgentTeamDocument,
} from "./team-conversation-preference-plan.js";
import type { AgentTeamListResponse } from "./team-ipc-contract.js";

export interface TeamConversationPreferencePorts {
  read(dataRoot: string): Promise<LastUsedAgentTeam | null>;
  write(dataRoot: string, document: LastUsedAgentTeamDocument): Promise<void>;
  list(input: { dataRoot: string; seedPending: boolean }): Promise<AgentTeamListResponse>;
}

export function createTeamConversationPreferenceService(ports: TeamConversationPreferencePorts) {
  return {
    readLastUsedAgentTeam: async (dataRoot: string): Promise<LastUsedAgentTeam | null> =>
      await ports.read(dataRoot),
    recordSuccessfulConversationAgentTeam: async (
      dataRoot: string,
      rawRequest: unknown,
      sessionExists: (sessionId: string) => Promise<boolean>,
    ): Promise<LastUsedAgentTeam> => {
      const request = parseSuccessfulConversationRequest(rawRequest);
      const selectedTeam = selectConversationAgentTeam({
        sessionExists: await sessionExists(request.sessionId),
        listed: await ports.list({ dataRoot, seedPending: false }),
        request,
      });
      const document: LastUsedAgentTeamDocument = {
        version: 1,
        teamId: selectedTeam.id,
        ownership: selectedTeam.ownership,
      };
      await ports.write(dataRoot, document);
      return { teamId: document.teamId, ownership: document.ownership };
    },
  };
}

export type TeamConversationPreferenceService = ReturnType<
  typeof createTeamConversationPreferenceService
>;
