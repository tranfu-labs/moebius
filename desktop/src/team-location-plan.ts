import { isValidPathSegment, type TeamOwnership } from "./team-model.js";

const SYSTEM_TEAMS_DIRECTORY = ".system";

export function selectTeamDirectoryName(input: {
  ownership: TeamOwnership;
  override: string | null | undefined;
  teamId: string;
  systemRoot: string;
  userRoot: string;
}): { rootDirectory: string; directoryName: string } {
  return input.ownership === "system"
    ? { rootDirectory: input.systemRoot, directoryName: input.override ?? input.teamId }
    : { rootDirectory: input.userRoot, directoryName: input.teamId };
}

export function classifyTeamOwnership(topLevelSegment: string | undefined): TeamOwnership {
  return topLevelSegment === SYSTEM_TEAMS_DIRECTORY ? "system" : "user";
}

export function shouldIncludeCanonicalSystemTeam(input: {
  teamId: string;
  overriddenDirectoryNames: ReadonlySet<string>;
  excludedCanonicalIds: ReadonlySet<string>;
}): boolean {
  return !input.overriddenDirectoryNames.has(input.teamId)
    && !input.excludedCanonicalIds.has(input.teamId);
}

export function assertValidTeamId(teamId: string): void {
  if (!isValidPathSegment(teamId) || teamId.trim() !== teamId || teamId === SYSTEM_TEAMS_DIRECTORY) {
    throw new TeamPathError(`Invalid team id: ${teamId}`);
  }
}

export function assertValidMemberSlug(slug: string): void {
  if (!isValidPathSegment(slug) || slug.trim() !== slug) {
    throw new TeamPathError(`Invalid member slug: ${slug}`);
  }
}

export function normalizeSystemTeamLocationOverrides(
  value: Record<string, unknown>,
): Record<string, string | null> {
  const normalized: Record<string, string | null> = {};
  for (const [teamId, rawDirectoryName] of Object.entries(value)) {
    if (!isValidPathSegment(teamId)) continue;
    if (rawDirectoryName === null) {
      normalized[teamId] = null;
      continue;
    }
    if (
      typeof rawDirectoryName === "string"
      && isValidPathSegment(rawDirectoryName)
      && rawDirectoryName !== SYSTEM_TEAMS_DIRECTORY
    ) {
      normalized[teamId] = rawDirectoryName;
    }
  }
  return normalized;
}

export function selectPrimaryAgentSlug(current: string | null, addedSlug: string): string {
  return current ?? addedSlug;
}

export function assertBuiltInTeamOwnership(
  declared: TeamOwnership,
  actual: TeamOwnership,
  directory: string,
): void {
  if (declared !== "system" || actual !== "system") {
    throw new TeamPathError(`Only a built-in team can be copied by this operation: ${directory}`);
  }
}

export function assertMemberIsNotPrimary(primaryAgentSlug: string | null, memberSlug: string): void {
  if (primaryAgentSlug === memberSlug) {
    throw new TeamPrimaryAgentError("删除主 Agent 前，请先指定另一名有效成员作为主 Agent。");
  }
}

export function selectMemberDirectory(existing: string | undefined, fallback: string): string {
  return existing ?? fallback;
}

export function assertUserTeamOwnership(ownership: TeamOwnership, teamId: string): void {
  if (ownership !== "user") {
    throw new BuiltInTeamReadOnlyError(teamId);
  }
}

export function assertMatchingTeamOwnership(input: {
  declared: TeamOwnership;
  actual: TeamOwnership;
  directory: string;
}): void {
  if (input.declared !== input.actual) {
    throw new TeamPathError(`Team ownership does not match its disk location: ${input.directory}`);
  }
}

export function assertLocationLayout(input: {
  ownership: TeamOwnership;
  teamId: string;
  directory: string;
  resolvedDirectory: string;
  expectedSystemDirectory: string;
  userPathIsAbsolute: boolean;
}): void {
  if (input.ownership === "user") {
    assertValidTeamId(input.teamId);
    if (!input.userPathIsAbsolute) {
      throw new TeamPathError(`User team path must be absolute: ${input.directory}`);
    }
    return;
  }
  if (input.resolvedDirectory !== input.expectedSystemDirectory) {
    throw new TeamPathError(`Built-in team path does not match its id: ${input.directory}`);
  }
}

export function assertDirectUserTeamDirectory(input: {
  parentDirectory: string;
  teamsRoot: string;
  directoryName: string;
}): void {
  if (input.parentDirectory !== input.teamsRoot || input.directoryName === SYSTEM_TEAMS_DIRECTORY) {
    throw new TeamPathError("User team folders must be direct children of the Agent teams folder.");
  }
  assertValidTeamId(input.directoryName);
}

export class BuiltInTeamReadOnlyError extends Error {
  readonly code = "BUILT_IN_TEAM_READ_ONLY";

  constructor(teamId: string) {
    super(`Built-in team is read-only: ${teamId}`);
    this.name = "BuiltInTeamReadOnlyError";
  }
}

export class TeamPathError extends Error {
  readonly code = "TEAM_PATH_INVALID";

  constructor(message: string) {
    super(message);
    this.name = "TeamPathError";
  }
}

export class TeamPrimaryAgentError extends Error {
  readonly code = "TEAM_PRIMARY_AGENT_INVALID";

  constructor(message: string) {
    super(message);
    this.name = "TeamPrimaryAgentError";
  }
}
