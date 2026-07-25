import { constants } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import {
  DEFAULT_NEW_AGENT_IDENTITY,
  TEAM_AGENT_FILE,
  TEAM_MANIFEST_FILE,
  TEAM_MEMBERS_DIRECTORY,
  AgentMarkdownMetadataError,
  TeamDefinitionError,
  createInitialAgentMarkdown,
  createUniqueAgentSlug,
  evaluateTeamStatus,
  isValidPathSegment,
  parseAgentMarkdownIdentity,
  parseTeamDefinitionJson,
  serializeTeamDefinition,
  validateTeamStructure,
  type AgentMarkdownIdentity,
  type TeamDefinition,
  type TeamInformation,
  type TeamOwnership,
  type TeamRepairIssue,
  type TeamStatus,
} from "./team-model.js";
import {
  preserveLegacyEmbeddedOnboardingOrchestration,
} from "./team-onboarding-orchestration.js";

export const TEAMS_DIRECTORY = "teams";
export const SYSTEM_TEAMS_DIRECTORY = ".system";

export interface TeamLocation {
  dataRoot: string;
  id: string;
  directory: string;
  ownership: TeamOwnership;
}

export interface TeamMemberSnapshot extends AgentMarkdownIdentity {
  slug: string;
  directory: string;
  agentFile: string;
  agentMarkdown: string;
}

export interface TeamSnapshot {
  location: TeamLocation;
  definition: TeamDefinition | null;
  members: TeamMemberSnapshot[];
  status: TeamStatus;
  canCreateConversation: boolean;
  issues: TeamRepairIssue[];
}

export interface AddedTeamMember {
  team: TeamSnapshot;
  member: TeamMemberSnapshot;
}

export type MovePathToTrash = (targetPath: string) => Promise<void>;

export function getTeamsRoot(dataRoot: string): string {
  return path.join(path.resolve(dataRoot), TEAMS_DIRECTORY);
}

export function getSystemTeamsRoot(dataRoot: string): string {
  return path.join(getTeamsRoot(dataRoot), SYSTEM_TEAMS_DIRECTORY);
}

export function getTeamManifestPath(location: TeamLocation): string {
  return path.join(location.directory, TEAM_MANIFEST_FILE);
}

export function getMemberDirectory(location: TeamLocation, slug: string): string {
  if (!isValidPathSegment(slug) || slug.trim() !== slug) {
    throw new TeamPathError(`Invalid member slug: ${slug}`);
  }
  return path.join(location.directory, TEAM_MEMBERS_DIRECTORY, slug);
}

export function getMemberAgentPath(location: TeamLocation, slug: string): string {
  return path.join(getMemberDirectory(location, slug), TEAM_AGENT_FILE);
}

export function resolveTeamLocation(input: {
  dataRoot: string;
  teamId: string;
  ownership: TeamOwnership;
}): TeamLocation {
  assertTeamId(input.teamId);
  const dataRoot = path.resolve(input.dataRoot);
  const directory =
    input.ownership === "system"
      ? path.join(getSystemTeamsRoot(dataRoot), input.teamId)
      : path.join(getTeamsRoot(dataRoot), input.teamId);

  return {
    dataRoot,
    id: input.teamId,
    directory,
    ownership: input.ownership,
  };
}

export function resolveRelocatedUserTeamLocation(input: {
  dataRoot: string;
  teamId: string;
  directory: string;
}): TeamLocation {
  assertTeamId(input.teamId);
  const dataRoot = path.resolve(input.dataRoot);
  const directory = path.resolve(input.directory);
  return {
    dataRoot,
    id: input.teamId,
    directory,
    ownership: "user",
  };
}

export function determineTeamOwnership(dataRoot: string, targetPath: string): TeamOwnership {
  const teamsRoot = getTeamsRoot(dataRoot);
  const relativePath = path.relative(teamsRoot, path.resolve(targetPath));
  if (relativePath.length === 0 || relativePath.startsWith(`..${path.sep}`) || relativePath === ".." || path.isAbsolute(relativePath)) {
    throw new TeamPathError(`Path is not inside the teams directory: ${targetPath}`);
  }

  const [topLevelSegment] = relativePath.split(path.sep);
  return topLevelSegment === SYSTEM_TEAMS_DIRECTORY ? "system" : "user";
}

export async function listTeamLocations(dataRoot: string): Promise<TeamLocation[]> {
  const resolvedDataRoot = path.resolve(dataRoot);
  const teamsRoot = getTeamsRoot(resolvedDataRoot);
  const [systemIds, userIds] = await Promise.all([
    listDirectoryNames(getSystemTeamsRoot(resolvedDataRoot)),
    listDirectoryNames(teamsRoot, { exclude: new Set([SYSTEM_TEAMS_DIRECTORY]) }),
  ]);

  return [
    ...systemIds.map((teamId) => resolveTeamLocation({ dataRoot: resolvedDataRoot, teamId, ownership: "system" })),
    ...userIds.map((teamId) => resolveTeamLocation({ dataRoot: resolvedDataRoot, teamId, ownership: "user" })),
  ];
}

export async function readTeamSnapshot(location: TeamLocation): Promise<TeamSnapshot> {
  assertLocationMatchesLayout(location);
  const directoryIssue = await inspectTeamDirectory(location.directory);
  if (directoryIssue !== null) {
    return makeSnapshot(location, null, [], [directoryIssue]);
  }

  const manifestPath = getTeamManifestPath(location);
  const manifestRead = await readRequiredTextFile(manifestPath, {
    missing: "team-manifest-missing",
    unreadable: "team-manifest-unreadable",
    label: TEAM_MANIFEST_FILE,
  });
  if (manifestRead.issue !== null) {
    return makeSnapshot(location, null, [], [manifestRead.issue]);
  }

  let definition: TeamDefinition;
  try {
    definition = parseTeamDefinitionJson(manifestRead.content);
  } catch (error) {
    return makeSnapshot(location, null, [], [
      {
        code: "team-manifest-invalid",
        message: error instanceof Error ? error.message : `${TEAM_MANIFEST_FILE} is invalid.`,
      },
    ]);
  }

  const issues: TeamRepairIssue[] = [];
  const members: TeamMemberSnapshot[] = [];
  const slugsToRead = [
    ...new Set(
      definition.memberOrder.filter(
        (candidate): candidate is string =>
          typeof candidate === "string" && isValidPathSegment(candidate) && candidate.trim() === candidate,
      ),
    ),
  ];

  for (const slug of slugsToRead) {
    const memberDirectory = getMemberDirectory(location, slug);
    const agentFile = getMemberAgentPath(location, slug);
    const agentRead = await readRequiredTextFile(agentFile, {
      missing: "member-agent-missing",
      unreadable: "member-agent-unreadable",
      label: `${slug}/${TEAM_AGENT_FILE}`,
      slug,
    });
    if (agentRead.issue !== null) {
      issues.push(agentRead.issue);
      continue;
    }

    try {
      members.push({
        slug,
        directory: memberDirectory,
        agentFile,
        agentMarkdown: agentRead.content,
        ...parseAgentMarkdownIdentity(agentRead.content),
      });
    } catch (error) {
      if (!(error instanceof AgentMarkdownMetadataError)) {
        throw error;
      }
      issues.push({
        code: "member-agent-metadata-invalid",
        slug,
        message: error.message,
      });
    }
  }

  return makeSnapshot(location, definition, members, issues);
}

export async function writeTeamDefinition(location: TeamLocation, definition: TeamDefinition): Promise<void> {
  assertTeamWritable(location);
  const normalizedDefinition = parseTeamDefinitionJson(serializeTeamDefinition(definition));
  const issues = validateTeamStructure(normalizedDefinition);
  if (issues.length > 0) {
    throw new TeamDefinitionError(issues.map((issue) => issue.message).join(" "));
  }

  await fs.mkdir(location.directory, { recursive: true });
  await preserveLegacyEmbeddedOnboardingOrchestration(location.directory);
  const manifestPath = getTeamManifestPath(location);
  const temporaryPath = `${manifestPath}.tmp-${process.pid}-${randomUUID()}`;
  try {
    await fs.writeFile(temporaryPath, serializeTeamDefinition(normalizedDefinition), "utf8");
    await fs.rename(temporaryPath, manifestPath);
  } catch (error) {
    await fs.rm(temporaryPath, { force: true });
    throw error;
  }
}

export async function writeMemberAgentMarkdown(
  location: TeamLocation,
  slug: string,
  agentMarkdown: string,
): Promise<void> {
  assertTeamWritable(location);
  const memberDirectory = getMemberDirectory(location, slug);
  await fs.mkdir(memberDirectory, { recursive: true });
  await fs.writeFile(getMemberAgentPath(location, slug), agentMarkdown, "utf8");
}

export async function createUserTeam(dataRoot: string, information: TeamInformation): Promise<TeamSnapshot> {
  const normalizedInformation = normalizeTeamInformation(information);
  await fs.mkdir(getTeamsRoot(dataRoot), { recursive: true });

  for (;;) {
    const teamId = `team-${randomUUID()}`;
    const location = resolveTeamLocation({ dataRoot, teamId, ownership: "user" });
    try {
      await fs.mkdir(location.directory);
    } catch (error) {
      if (isNodeError(error) && error.code === "EEXIST") {
        continue;
      }
      throw error;
    }

    try {
      await writeTeamDefinition(location, {
        ...normalizedInformation,
        primaryAgentSlug: null,
        memberOrder: [],
      });
      return await readTeamSnapshot(location);
    } catch (error) {
      await fs.rm(location.directory, { recursive: true, force: true });
      throw error;
    }
  }
}

export async function addTeamMember(location: TeamLocation): Promise<AddedTeamMember> {
  assertTeamWritable(location);
  const snapshot = await readTeamSnapshot(location);
  if (snapshot.definition === null || snapshot.status === "needs-repair") {
    throw new TeamMutationError("团队信息当前不可用，无法添加 Agent。");
  }

  const membersRoot = path.join(location.directory, TEAM_MEMBERS_DIRECTORY);
  await fs.mkdir(membersRoot, { recursive: true });
  const occupiedSlugs = new Set(snapshot.definition.memberOrder);
  let slug: string;
  let memberDirectory: string;
  for (;;) {
    slug = createUniqueAgentSlug(DEFAULT_NEW_AGENT_IDENTITY.displayName, occupiedSlugs);
    memberDirectory = getMemberDirectory(location, slug);
    try {
      await fs.mkdir(memberDirectory);
      break;
    } catch (error) {
      if (isNodeError(error) && error.code === "EEXIST") {
        occupiedSlugs.add(slug);
        continue;
      }
      throw error;
    }
  }

  try {
    await fs.writeFile(
      getMemberAgentPath(location, slug),
      createInitialAgentMarkdown(DEFAULT_NEW_AGENT_IDENTITY),
      "utf8",
    );
    await writeTeamDefinition(location, {
      ...snapshot.definition,
      primaryAgentSlug: snapshot.definition.primaryAgentSlug ?? slug,
      memberOrder: [...snapshot.definition.memberOrder, slug],
    });
  } catch (error) {
    await fs.rm(memberDirectory, { recursive: true, force: true });
    throw error;
  }

  const team = await readTeamSnapshot(location);
  const member = team.members.find((candidate) => candidate.slug === slug);
  if (member === undefined) {
    throw new TeamMutationError("Agent 已写入，但暂时无法重新读取。");
  }
  return { team, member };
}

export async function updateTeamInformation(
  location: TeamLocation,
  information: TeamInformation,
): Promise<TeamSnapshot> {
  assertTeamWritable(location);
  const snapshot = await readTeamSnapshot(location);
  if (snapshot.definition === null) {
    throw new TeamMutationError("团队信息当前不可用，无法修改。");
  }
  const normalizedInformation = normalizeTeamInformation(information);
  await writeTeamDefinition(location, {
    ...snapshot.definition,
    ...normalizedInformation,
  });
  return readTeamSnapshot(location);
}

export async function setTeamPrimaryAgent(location: TeamLocation, primaryAgentSlug: string): Promise<TeamSnapshot> {
  assertTeamWritable(location);
  const snapshot = await readTeamSnapshot(location);
  if (snapshot.definition === null) {
    throw new TeamPrimaryAgentError("团队信息当前不可用，无法切换主 Agent。");
  }

  const member = snapshot.members.find((candidate) => candidate.slug === primaryAgentSlug);
  if (member === undefined) {
    throw new TeamPrimaryAgentError("只能选择当前团队中可用的 Agent。");
  }

  await writeTeamDefinition(location, {
    ...snapshot.definition,
    primaryAgentSlug: member.slug,
  });
  return readTeamSnapshot(location);
}

export async function duplicateBuiltInTeamDirectory(source: TeamLocation): Promise<TeamLocation> {
  assertLocationMatchesLayout(source);
  const actualOwnership = determineTeamOwnership(source.dataRoot, source.directory);
  if (source.ownership !== "system" || actualOwnership !== "system") {
    throw new TeamPathError(`Only a built-in team can be copied by this operation: ${source.directory}`);
  }

  return duplicateTeamDirectoryAsUserTeam(source);
}

export async function duplicateUserTeamDirectory(source: TeamLocation): Promise<TeamLocation> {
  assertTeamWritable(source);
  return duplicateTeamDirectoryAsUserTeam(source);
}

export async function duplicateTeamMemberDirectory(
  location: TeamLocation,
  sourceSlug: string,
): Promise<AddedTeamMember> {
  assertTeamWritable(location);
  const snapshot = await readTeamSnapshot(location);
  if (snapshot.definition === null || snapshot.status === "needs-repair") {
    throw new TeamMutationError("团队信息当前不可用，无法复制 Agent。");
  }
  const sourceMember = snapshot.members.find((member) => member.slug === sourceSlug);
  if (sourceMember === undefined) {
    throw new TeamMutationError("要复制的 Agent 当前不可用。");
  }

  const occupiedSlugs = new Set(snapshot.definition.memberOrder);
  let slug: string;
  let memberDirectory: string;
  for (;;) {
    slug = createUniqueAgentSlug(sourceMember.slug, occupiedSlugs);
    memberDirectory = getMemberDirectory(location, slug);
    try {
      await fs.mkdir(memberDirectory);
      break;
    } catch (error) {
      if (isNodeError(error) && error.code === "EEXIST") {
        occupiedSlugs.add(slug);
        continue;
      }
      throw error;
    }
  }

  try {
    await copyDirectoryContents(sourceMember.directory, memberDirectory);
    await writeTeamDefinition(location, {
      ...snapshot.definition,
      memberOrder: [...snapshot.definition.memberOrder, slug],
    });
  } catch (error) {
    await fs.rm(memberDirectory, { recursive: true, force: true });
    throw error;
  }

  const team = await readTeamSnapshot(location);
  const member = team.members.find((candidate) => candidate.slug === slug);
  if (member === undefined) {
    throw new TeamMutationError("Agent 已复制，但暂时无法重新读取。");
  }
  return { team, member };
}

export async function trashTeamMemberDirectory(
  location: TeamLocation,
  memberSlug: string,
  moveToTrash: MovePathToTrash,
): Promise<TeamSnapshot> {
  assertTeamWritable(location);
  const snapshot = await readTeamSnapshot(location);
  if (snapshot.definition === null) {
    throw new TeamMutationError("团队信息当前不可用，无法删除 Agent。");
  }
  if (snapshot.definition.primaryAgentSlug === memberSlug) {
    throw new TeamPrimaryAgentError("删除主 Agent 前，请先指定另一名有效成员作为主 Agent。");
  }
  const member = snapshot.members.find((candidate) => candidate.slug === memberSlug);
  if (member === undefined && !snapshot.definition.memberOrder.includes(memberSlug)) {
    throw new TeamMutationError("要删除的 Agent 当前不可用。");
  }
  const memberDirectory = member?.directory ?? getMemberDirectory(location, memberSlug);

  const previousDefinition = snapshot.definition;
  await writeTeamDefinition(location, {
    ...previousDefinition,
    memberOrder: previousDefinition.memberOrder.filter((slug) => slug !== memberSlug),
  });
  try {
    await moveToTrash(memberDirectory);
  } catch (error) {
    try {
      await writeTeamDefinition(location, previousDefinition);
    } catch (rollbackError) {
      throw new AggregateError(
        [error, rollbackError],
        "Agent 未能移到系统废纸篓，团队成员清单也未能恢复。",
      );
    }
    throw error;
  }

  return readTeamSnapshot(location);
}

export async function trashUserTeamDirectory(
  location: TeamLocation,
  moveToTrash: MovePathToTrash,
): Promise<void> {
  assertTeamWritable(location);
  if (location.ownership !== "user") {
    throw new BuiltInTeamReadOnlyError(location.id);
  }
  const sourceStats = await fs.stat(location.directory);
  if (!sourceStats.isDirectory()) {
    throw new TeamPathError(`User team path is not a directory: ${location.directory}`);
  }
  await moveToTrash(location.directory);
}

async function duplicateTeamDirectoryAsUserTeam(source: TeamLocation): Promise<TeamLocation> {
  assertLocationMatchesLayout(source);
  const actualOwnership = determineTeamOwnership(source.dataRoot, source.directory);
  if (source.ownership !== actualOwnership) {
    throw new TeamPathError(`Team ownership does not match its disk location: ${source.directory}`);
  }

  const sourceStats = await fs.stat(source.directory);
  if (!sourceStats.isDirectory()) {
    throw new TeamPathError(`Team path is not a directory: ${source.directory}`);
  }

  const destination = await reserveUserTeamCopyLocation(source);
  try {
    await copyDirectoryContents(source.directory, destination.directory);
    return destination;
  } catch (error) {
    await fs.rm(destination.directory, { recursive: true, force: true });
    throw error;
  }
}

export function assertTeamWritable(location: TeamLocation): void {
  assertLocationMatchesLayout(location);
  const actualOwnership = determineTeamOwnership(location.dataRoot, location.directory);
  if (location.ownership !== actualOwnership) {
    throw new TeamPathError(`Team ownership does not match its disk location: ${location.directory}`);
  }
}

/**
 * Kept for source compatibility with older callers. Official teams are editable
 * now, so current mutation paths no longer throw this error.
 */
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

export class TeamMutationError extends Error {
  readonly code = "TEAM_MUTATION_INVALID";

  constructor(message: string) {
    super(message);
    this.name = "TeamMutationError";
  }
}

function assertTeamId(teamId: string): void {
  if (!isValidPathSegment(teamId) || teamId.trim() !== teamId || teamId === SYSTEM_TEAMS_DIRECTORY) {
    throw new TeamPathError(`Invalid team id: ${teamId}`);
  }
}

async function reserveUserTeamCopyLocation(source: TeamLocation): Promise<TeamLocation> {
  for (let copyNumber = 1; ; copyNumber += 1) {
    const teamId = `${source.id}-copy${copyNumber === 1 ? "" : `-${copyNumber}`}`;
    const destination = resolveTeamLocation({
      dataRoot: source.dataRoot,
      teamId,
      ownership: "user",
    });
    try {
      await fs.mkdir(destination.directory, { recursive: false });
      return destination;
    } catch (error) {
      if (isNodeError(error) && error.code === "EEXIST") {
        continue;
      }
      throw error;
    }
  }
}

async function copyDirectoryContents(sourceDirectory: string, destinationDirectory: string): Promise<void> {
  const entries = await fs.readdir(sourceDirectory);
  for (const entry of entries) {
    await fs.cp(path.join(sourceDirectory, entry), path.join(destinationDirectory, entry), {
      recursive: true,
      force: false,
      errorOnExist: true,
    });
  }
}

function normalizeTeamInformation(information: TeamInformation): TeamInformation {
  const name = information.name.trim();
  const description = information.description.trim();
  if (name.length === 0 || description.length === 0) {
    throw new TeamMutationError("团队名称和一句话描述都需要填写。");
  }
  if (/\r|\n/u.test(name) || /\r|\n/u.test(description)) {
    throw new TeamMutationError("团队名称和描述都只能填写一行。");
  }
  return { name, description };
}

function assertLocationMatchesLayout(location: TeamLocation): void {
  if (location.ownership === "user") {
    assertTeamId(location.id);
    if (!path.isAbsolute(location.directory)) {
      throw new TeamPathError(`User team path must be absolute: ${location.directory}`);
    }
    return;
  }

  const expected = resolveTeamLocation({ dataRoot: location.dataRoot, teamId: location.id, ownership: "system" });
  if (path.resolve(location.directory) !== expected.directory) {
    throw new TeamPathError(`Built-in team path does not match its id: ${location.directory}`);
  }
}

function assertDirectUserTeamDirectory(dataRoot: string, directory: string): void {
  const resolvedDirectory = path.resolve(directory);
  const teamsRoot = getTeamsRoot(dataRoot);
  if (path.dirname(resolvedDirectory) !== teamsRoot || path.basename(resolvedDirectory) === SYSTEM_TEAMS_DIRECTORY) {
    throw new TeamPathError("User team folders must be direct children of the Agent teams folder.");
  }
  assertTeamId(path.basename(resolvedDirectory));
}

async function inspectTeamDirectory(directory: string): Promise<TeamRepairIssue | null> {
  try {
    const stats = await fs.stat(directory);
    if (!stats.isDirectory()) {
      return { code: "team-directory-unreadable", message: `Team path is not a readable directory: ${directory}` };
    }
    await fs.access(directory, constants.R_OK);
    return null;
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") {
      return { code: "team-directory-missing", message: `Team directory is missing: ${directory}` };
    }
    return { code: "team-directory-unreadable", message: `Team directory is unreadable: ${directory}` };
  }
}

async function readRequiredTextFile(
  filePath: string,
  details: {
    missing: "team-manifest-missing" | "member-agent-missing";
    unreadable: "team-manifest-unreadable" | "member-agent-unreadable";
    label: string;
    slug?: string;
  },
): Promise<{ content: string; issue: null } | { content: ""; issue: TeamRepairIssue }> {
  try {
    return { content: await fs.readFile(filePath, "utf8"), issue: null };
  } catch (error) {
    const missing = isNodeError(error) && (error.code === "ENOENT" || error.code === "ENOTDIR");
    return {
      content: "",
      issue: {
        code: missing ? details.missing : details.unreadable,
        slug: details.slug,
        message: `${details.label} is ${missing ? "missing" : "unreadable"}: ${filePath}`,
      },
    };
  }
}

async function listDirectoryNames(root: string, options?: { exclude?: ReadonlySet<string> }): Promise<string[]> {
  try {
    const entries = await fs.readdir(root, { withFileTypes: true });
    return entries
      .filter((entry) => entry.isDirectory() && !options?.exclude?.has(entry.name))
      .map((entry) => entry.name)
      .sort((left, right) => left.localeCompare(right));
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") {
      return [];
    }
    throw error;
  }
}

function makeSnapshot(
  location: TeamLocation,
  definition: TeamDefinition | null,
  members: TeamMemberSnapshot[],
  issues: TeamRepairIssue[],
): TeamSnapshot {
  const readiness = evaluateTeamStatus({ definition, issues });
  return {
    location,
    definition,
    members,
    status: readiness.status,
    canCreateConversation: readiness.canCreateConversation,
    issues: readiness.issues,
  };
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}
