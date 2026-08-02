import type { TeamOwnership } from "./team-model.js";

export type UserTeamRecordLocation =
  | { kind: "managed"; directoryName: string }
  | { kind: "external"; absolutePath: string };

export function assertUserTeamRecordOwnership(ownership: TeamOwnership): void {
  if (ownership !== "user") {
    throw new TeamRecordError("只有用户团队需要应用记录。");
  }
}

export function classifyUserTeamRecordLocation(input: {
  isManagedDirectory: boolean;
  directoryName: string;
  absolutePath: string;
}): UserTeamRecordLocation {
  return input.isManagedDirectory
    ? { kind: "managed", directoryName: input.directoryName }
    : { kind: "external", absolutePath: input.absolutePath };
}

export class TeamRecordError extends Error {
  readonly code = "TEAM_RECORD_INVALID";

  constructor(message: string) {
    super(message);
    this.name = "TeamRecordError";
  }
}
