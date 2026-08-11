import type { IpcMain, OpenDialogOptions } from "electron";
import fs from "node:fs/promises";

import { TEAM_CONVERSATION_PREFERENCE_IPC_CHANNELS } from "./team-conversation-preference-contract.js";
import { TEAM_EXTERNAL_CHANGE_IPC_CHANNEL } from "./team-external-change-contract.js";
import { TEAM_FILE_MANAGER_IPC_CHANNEL } from "./team-file-manager-contract.js";
import { TEAM_IPC_CHANNELS } from "./team-ipc-contract.js";
import { TEAM_REPAIR_IPC_CHANNELS } from "./team-repair-contract.js";
import type { AgentTeamService } from "./team-ipc.js";
import type { AgentRevisionService } from "./agent-revision-service.js";
import { parseMemberRequest } from "./team-service-plan.js";
import { getMemberAgentPath, resolveTeamLocation } from "./team-store.js";
import { resolveRecordedTeamLocation } from "./team-record-store.js";
import type { AgentTeamMemberRequest } from "./team-ipc-contract.js";

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
  revisions?: {
    listMemberRevisions(request: unknown): Promise<unknown>;
    restoreMemberRevision(request: unknown): Promise<unknown>;
    getDefaultAgent(): Promise<unknown>;
    saveDefaultAgent(request: unknown): Promise<unknown>;
  };
  /** Records a durable revision after every successful in-app AGENT.md write. */
  revisionService?: AgentRevisionService;
}

/**
 * Best-effort read of the member's current AGENT.md on disk, used as the
 * first-revision comparison baseline before an in-app write. Missing files
 * (a brand-new member) or read failures yield `null` — the caller then falls
 * back to "first revision owns everything".
 */
async function readMemberAgentMarkdownBeforeWrite(
  dataRoot: string,
  member: AgentTeamMemberRequest,
): Promise<string | null> {
  try {
    const location = member.ownership === "system"
      ? resolveTeamLocation({ dataRoot, teamId: member.teamId, ownership: "system" })
      : await resolveRecordedTeamLocation(dataRoot, member.teamId);
    return await fs.readFile(getMemberAgentPath(location, member.memberSlug), "utf8");
  } catch {
    return null;
  }
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
  ipcMain.handle(TEAM_IPC_CHANNELS.writeMember, async (_event, request: unknown) => {
    const member = parseMemberRequest(request);
    // First-revision baseline: the persisted content BEFORE this write. Reading
    // it here keeps the renderer's (possibly stale) draft out of the picture —
    // markers and the mechanical summary must reflect only what this save
    // actually changed, not the whole document (product-review blocker 1).
    const baselineContent = await readMemberAgentMarkdownBeforeWrite(options.dataRoot, member);
    const document = await service.writeAgentTeamMember(options.dataRoot, request);
    if (options.revisionService !== undefined) {
      await options.revisionService.recordMemberRevision({
        teamStableId: member.teamId,
        memberSlug: member.memberSlug,
        content: document.agentMarkdown,
        authorKind: "user",
        authorLabel: null,
        now: new Date().toISOString(),
        baselineContent,
      });
    }
    return document;
  });
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
  ipcMain.handle(TEAM_IPC_CHANNELS.replaceUnavailableExecutionProfiles, async (_event, request: unknown) =>
    await service.replaceUnavailableAgentTeamExecutionProfiles(options.dataRoot, request));
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
  if (options.revisions !== undefined) {
    ipcMain.handle(TEAM_IPC_CHANNELS.memberRevisionsList, async (_event, request: unknown) =>
      await options.revisions!.listMemberRevisions(request));
    ipcMain.handle(TEAM_IPC_CHANNELS.memberRevisionRestore, async (_event, request: unknown) =>
      await options.revisions!.restoreMemberRevision(request));
    ipcMain.handle(TEAM_IPC_CHANNELS.defaultAgentGet, async () =>
      await options.revisions!.getDefaultAgent());
    ipcMain.handle(TEAM_IPC_CHANNELS.defaultAgentSave, async (_event, request: unknown) =>
      await options.revisions!.saveDefaultAgent(request));
  }
}
