import { constants } from "node:fs";
import fs from "node:fs/promises";

import {
  parseFileManagerRequest,
  planFileManagerTarget,
} from "./team-desktop-action-plan.js";
import { resolveRecordedTeamLocation } from "./team-record-store.js";
import { getMemberDirectory, resolveTeamLocation } from "./team-store.js";

export * from "./team-file-manager-contract.js";

export interface AgentTeamFileManagerShell {
  openPath(targetPath: string): Promise<string>;
}

export async function openAgentTeamLocationInFileManager(input: {
  dataRoot: string;
  request: unknown;
  shell: AgentTeamFileManagerShell;
}): Promise<void> {
  try {
    const request = parseFileManagerRequest(input.request);
    const locationLoaders = {
      system: async () => resolveTeamLocation({
        dataRoot: input.dataRoot,
        teamId: request.teamId,
        ownership: "system" as const,
      }),
      user: async () => await resolveRecordedTeamLocation(input.dataRoot, request.teamId),
    };
    const location = await locationLoaders[request.ownership]();
    const targetPaths = {
      team: () => location.directory,
      member: () => getMemberDirectory(location, request.memberSlug!),
    };
    const targetPath = targetPaths[planFileManagerTarget(request.memberSlug)]();

    const stats = await fs.stat(targetPath);
    if (!stats.isDirectory()) {
      throw new Error("The requested location is not a directory.");
    }
    await fs.access(targetPath, constants.R_OK | constants.X_OK);

    const openError = await input.shell.openPath(targetPath);
    if (openError.trim().length > 0) {
      throw new Error(openError);
    }
  } catch {
    throw new AgentTeamFileManagerError();
  }
}

export class AgentTeamFileManagerError extends Error {
  readonly code = "AGENT_TEAM_FILE_MANAGER_OPEN_FAILED";

  constructor() {
    super("Unable to open the requested Agent team location.");
    this.name = "AgentTeamFileManagerError";
  }
}
