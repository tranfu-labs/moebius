import type { TeamOwnership } from "./team-model.js";

export const TEAM_FILE_MANAGER_IPC_CHANNEL = "agent-teams:open-in-file-manager";

export interface AgentTeamFileManagerRequest {
  teamId: string;
  ownership: TeamOwnership;
  memberSlug?: string;
}

export type AgentTeamFileManagerKind = "finder" | "windows-explorer" | "file-manager";

export function getAgentTeamFileManagerKind(platform: NodeJS.Platform): AgentTeamFileManagerKind {
  if (platform === "darwin") {
    return "finder";
  }
  if (platform === "win32") {
    return "windows-explorer";
  }
  return "file-manager";
}
