import type { IpcMain, OpenDialogOptions } from "electron";

import { TEAM_CONVERSATION_PREFERENCE_IPC_CHANNELS } from "./team-conversation-preference-contract.js";
import { TEAM_EXTERNAL_CHANGE_IPC_CHANNEL } from "./team-external-change-contract.js";
import { TEAM_FILE_MANAGER_IPC_CHANNEL } from "./team-file-manager-contract.js";
import { TEAM_IPC_CHANNELS } from "./team-ipc-contract.js";
import { TEAM_REPAIR_IPC_CHANNELS } from "./team-repair-contract.js";
import type { AgentTeamService } from "./team-ipc.js";

export interface TeamIpcRegistrationOptions {
  ipcMain: Pick<IpcMain, "handle">;
  dataRoot: string;
  seedPending(): boolean;
  list(input: { dataRoot: string; seedPending: boolean }): Promise<unknown>;
  resolveSeedConflict(): Promise<unknown>;
  showSeedConflictLocation(): void;
  selectRelocationFolder(options: OpenDialogOptions): Promise<string | null>;
  relocate(request: unknown): Promise<unknown>;
  removeRecord(request: unknown): Promise<void>;
  openFileManager(request: unknown): Promise<void>;
  externalChange(request: unknown): Promise<unknown>;
  readPreference(): Promise<unknown>;
  recordPreference(request: unknown): Promise<unknown>;
  service: AgentTeamService;
  moveToTrash(targetPath: string): Promise<void>;
  relocationDialogOptions(): OpenDialogOptions;
}

export function registerTeamIpc(options: TeamIpcRegistrationOptions): void {
  const { ipcMain, service } = options;
  ipcMain.handle(TEAM_IPC_CHANNELS.list, async () => service.listAgentTeams({
    dataRoot: options.dataRoot,
    seedPending: options.seedPending(),
  }));
  ipcMain.handle(TEAM_IPC_CHANNELS.resolveSeedConflict, async () => await options.resolveSeedConflict());
  ipcMain.handle(TEAM_IPC_CHANNELS.showSeedConflictLocation, async () => options.showSeedConflictLocation());
  ipcMain.handle(TEAM_IPC_CHANNELS.create, async (_event, request: unknown) =>
    await service.createAgentTeam(options.dataRoot, request));
  ipcMain.handle(TEAM_IPC_CHANNELS.readMember, async (_event, request: unknown) =>
    await service.readAgentTeamMember(options.dataRoot, request));
  ipcMain.handle(TEAM_IPC_CHANNELS.writeMember, async (_event, request: unknown) =>
    await service.writeAgentTeamMember(options.dataRoot, request));
  ipcMain.handle(TEAM_IPC_CHANNELS.addMember, async (_event, request: unknown) =>
    await service.addAgentTeamMember(options.dataRoot, request));
  ipcMain.handle(TEAM_IPC_CHANNELS.updateInformation, async (_event, request: unknown) =>
    await service.updateAgentTeamInformation(options.dataRoot, request));
  ipcMain.handle(TEAM_IPC_CHANNELS.setPrimaryAgent, async (_event, request: unknown) =>
    await service.setAgentTeamPrimaryAgent(options.dataRoot, request));
  ipcMain.handle(TEAM_IPC_CHANNELS.duplicateBuiltIn, async (_event, request: unknown) =>
    await service.duplicateBuiltInAgentTeam(options.dataRoot, request));
  ipcMain.handle(TEAM_IPC_CHANNELS.duplicateUser, async (_event, request: unknown) =>
    await service.duplicateUserAgentTeam(options.dataRoot, request));
  ipcMain.handle(TEAM_IPC_CHANNELS.duplicateMember, async (_event, request: unknown) =>
    await service.duplicateAgentTeamMember(options.dataRoot, request));
  ipcMain.handle(TEAM_IPC_CHANNELS.readExecutionProfile, async (_event, request: unknown) =>
    await service.readAgentTeamExecutionProfile(options.dataRoot, request));
  ipcMain.handle(TEAM_IPC_CHANNELS.saveExecutionProfile, async (_event, request: unknown) =>
    await service.saveAgentTeamExecutionProfile(options.dataRoot, request));
  ipcMain.handle(TEAM_IPC_CHANNELS.restoreRecommendedProfile, async (_event, request: unknown) =>
    await service.restoreAgentTeamRecommendedProfile(options.dataRoot, request));
  ipcMain.handle(TEAM_IPC_CHANNELS.prepareOfficialUpdate, async (_event, request: unknown) =>
    await service.prepareAgentTeamOfficialUpdate(options.dataRoot, request));
  ipcMain.handle(TEAM_IPC_CHANNELS.applyOfficialUpdate, async (_event, request: unknown) =>
    await service.applyAgentTeamOfficialUpdate(options.dataRoot, request));
  ipcMain.handle(TEAM_IPC_CHANNELS.trashMember, async (_event, request: unknown) =>
    await service.trashAgentTeamMember!(options.dataRoot, request, options.moveToTrash));
  ipcMain.handle(TEAM_IPC_CHANNELS.trashUserTeam, async (_event, request: unknown) =>
    await service.trashUserAgentTeam!(options.dataRoot, request, options.moveToTrash));
  ipcMain.handle(TEAM_REPAIR_IPC_CHANNELS.selectRelocationFolder, async () =>
    await options.selectRelocationFolder(options.relocationDialogOptions()));
  ipcMain.handle(TEAM_REPAIR_IPC_CHANNELS.relocate, async (_event, request: unknown) =>
    await options.relocate(request));
  ipcMain.handle(TEAM_REPAIR_IPC_CHANNELS.removeRecord, async (_event, request: unknown) =>
    await options.removeRecord(request));
  ipcMain.handle(TEAM_FILE_MANAGER_IPC_CHANNEL, async (_event, request: unknown) =>
    await options.openFileManager(request));
  ipcMain.handle(TEAM_EXTERNAL_CHANGE_IPC_CHANNEL, async (_event, request: unknown) =>
    await options.externalChange(request));
  ipcMain.handle(TEAM_CONVERSATION_PREFERENCE_IPC_CHANNELS.readLastUsed, async () =>
    await options.readPreference());
  ipcMain.handle(TEAM_CONVERSATION_PREFERENCE_IPC_CHANNELS.recordSuccessful, async (_event, request: unknown) =>
    await options.recordPreference(request));
}
