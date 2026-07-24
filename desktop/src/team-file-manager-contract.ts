import type { TeamOwnership } from "./team-model.js";

export const TEAM_FILE_MANAGER_IPC_CHANNEL = "agent-teams:open-in-file-manager";

export interface AgentTeamFileManagerRequest {
  teamId: string;
  ownership: TeamOwnership;
  memberSlug?: string;
}

export function getAgentTeamFileManagerLabel(platform: NodeJS.Platform): string {
  if (platform === "darwin") {
    return "在 Finder 中打开";
  }
  if (platform === "win32") {
    return "在文件资源管理器中显示";
  }
  return "在文件管理器中打开";
}
