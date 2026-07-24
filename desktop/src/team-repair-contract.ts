export const TEAM_REPAIR_IPC_CHANNELS = {
  selectRelocationFolder: "agent-teams:repair:select-relocation-folder",
  relocate: "agent-teams:repair:relocate",
  removeRecord: "agent-teams:repair:remove-record",
} as const;

export interface AgentTeamRepairRequest {
  teamId: string;
  ownership: "user";
}

export interface AgentTeamRelocateRequest extends AgentTeamRepairRequest {
  directory: string;
}
