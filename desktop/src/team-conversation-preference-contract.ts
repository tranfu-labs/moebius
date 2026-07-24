import type { TeamOwnership } from "./team-model.js";

export const TEAM_CONVERSATION_PREFERENCE_IPC_CHANNELS = {
  readLastUsed: "agent-teams:read-last-used",
  recordSuccessful: "agent-teams:record-successful-conversation",
} as const;

export interface LastUsedAgentTeam {
  teamId: string;
  ownership: TeamOwnership;
}

export interface SuccessfulConversationAgentTeamRequest extends LastUsedAgentTeam {
  sessionId: string;
}
