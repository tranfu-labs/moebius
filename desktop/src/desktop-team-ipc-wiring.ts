import path from "node:path";
import type { OpenDialogOptions } from "electron";

import type { AgentTeamFileManagerShell } from "./team-file-manager.js";
import { openAgentTeamLocationInFileManager } from "./team-file-manager.js";
import { checkAgentTeamMemberExternalChange } from "./team-external-change.js";
import type { AgentTeamService } from "./team-ipc.js";
import type { TeamIpcRegistrationOptions } from "./team-ipc-register.js";
import {
  relocateAgentTeamRecord,
  removeAgentTeamRecord,
} from "./team-repair-ipc.js";
import { seedBuiltInTeams } from "./team-seed.js";
import { getSystemTeamsRoot, getTeamsRoot } from "./team-store.js";
import type { TeamConversationPreferenceService } from "./team-conversation-preference.js";

type DesktopTeamShell = AgentTeamFileManagerShell & {
  showItemInFolder(path: string): void;
  trashItem(path: string): Promise<void>;
};

export function createDesktopTeamIpcOptions(input: {
  ipcMain: TeamIpcRegistrationOptions["ipcMain"];
  dataRoot: string;
  seedTeamsRoot: string;
  seedPending(): boolean;
  service: AgentTeamService;
  preference: TeamConversationPreferenceService;
  shell: DesktopTeamShell;
  selectDirectory(options: OpenDialogOptions): Promise<string | null>;
  relocationTitle(): string;
  sessionExists(sessionId: string): Promise<boolean>;
}): TeamIpcRegistrationOptions {
  return {
    ipcMain: input.ipcMain,
    dataRoot: input.dataRoot,
    seedPending: input.seedPending,
    list: input.service.listAgentTeams,
    resolveSeedConflict: async () => {
      await seedBuiltInTeams({
        seedTeamsRoot: input.seedTeamsRoot,
        dataRoot: input.dataRoot,
        preserveGeneralAssistantConflicts: true,
      });
      return input.service.listAgentTeams({ dataRoot: input.dataRoot, seedPending: false });
    },
    showSeedConflictLocation: () => input.shell.showItemInFolder(path.join(
      getSystemTeamsRoot(input.dataRoot),
      "general-assistant",
    )),
    selectRelocationFolder: input.selectDirectory,
    relocationDialogOptions: () => ({
      properties: ["openDirectory"],
      title: input.relocationTitle(),
      defaultPath: getTeamsRoot(input.dataRoot),
    }),
    relocate: (request) => relocateAgentTeamRecord(input.dataRoot, request),
    removeRecord: (request) => removeAgentTeamRecord(input.dataRoot, request),
    openFileManager: (request) => openAgentTeamLocationInFileManager({
      dataRoot: input.dataRoot,
      request,
      shell: input.shell,
    }),
    externalChange: (request) => checkAgentTeamMemberExternalChange(input.dataRoot, request),
    readPreference: () => input.preference.readLastUsedAgentTeam(input.dataRoot),
    recordPreference: (request) => input.preference.recordSuccessfulConversationAgentTeam(
      input.dataRoot,
      request,
      input.sessionExists,
    ),
    service: input.service,
    moveToTrash: (targetPath) => input.shell.trashItem(targetPath),
  };
}
