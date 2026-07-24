import type { TeamOwnership } from "./team-model.js";
import type { AgentTeamMemberDocument } from "./team-ipc-contract.js";

export const TEAM_EXTERNAL_CHANGE_IPC_CHANNEL = "agent-teams:check-member-agent-external-change";

export interface AgentTeamExternalChangeRequest {
  teamId: string;
  ownership: TeamOwnership;
  memberSlug: string;
  knownAgentMarkdown: string;
}

export type AgentTeamExternalChangeResponse =
  | { status: "ignored" }
  | { status: "unchanged" }
  | { status: "changed"; document: AgentTeamMemberDocument };
