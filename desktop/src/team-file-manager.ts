import { constants } from "node:fs";
import fs from "node:fs/promises";

import type { AgentTeamFileManagerRequest } from "./team-file-manager-contract.js";
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
    const location = request.ownership === "system"
      ? resolveTeamLocation({ dataRoot: input.dataRoot, teamId: request.teamId, ownership: "system" })
      : await resolveRecordedTeamLocation(input.dataRoot, request.teamId);
    const targetPath = request.memberSlug === undefined
      ? location.directory
      : getMemberDirectory(location, request.memberSlug);

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

function parseFileManagerRequest(value: unknown): AgentTeamFileManagerRequest {
  if (!isPlainObject(value)) {
    throw new Error("An Agent team location request is required.");
  }
  if (typeof value.teamId !== "string" || value.teamId.trim().length === 0) {
    throw new Error("An Agent team id is required.");
  }
  if (value.ownership !== "system" && value.ownership !== "user") {
    throw new Error("A valid Agent team ownership is required.");
  }
  if (
    value.memberSlug !== undefined
    && (typeof value.memberSlug !== "string" || value.memberSlug.trim().length === 0)
  ) {
    throw new Error("A valid Agent slug is required.");
  }
  return {
    teamId: value.teamId,
    ownership: value.ownership,
    ...(value.memberSlug === undefined ? {} : { memberSlug: value.memberSlug }),
  };
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export class AgentTeamFileManagerError extends Error {
  readonly code = "AGENT_TEAM_FILE_MANAGER_OPEN_FAILED";

  constructor() {
    super("暂时无法打开这个位置。请确认相关文件仍然存在，并检查访问权限后重试。");
    this.name = "AgentTeamFileManagerError";
  }
}
