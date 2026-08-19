import { constants, readFileSync } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import {
  parseAgentMarkdownFrontmatter,
  serializeAgentMarkdownFrontmatter,
} from "../../src/agent-frontmatter.js";
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
  tryReadLegacyAgentMarkdownPortrait,
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
} from "./team-onboarding-orchestration-store.js";
import {
  assertBuiltInTeamOwnership,
  assertDirectUserTeamDirectory as assertDirectUserTeamDirectoryPlan,
  assertLocationLayout,
  assertMatchingTeamOwnership,
  assertMemberIsNotPrimary,
  assertUserTeamOwnership,
  assertValidMemberSlug,
  assertValidTeamId,
  BuiltInTeamReadOnlyError,
  classifyTeamOwnership,
  normalizeSystemTeamLocationOverrides,
  selectMemberDirectory,
  selectPrimaryAgentSlug,
  selectTeamDirectoryName,
  shouldIncludeCanonicalSystemTeam,
  TeamPathError,
  TeamPrimaryAgentError,
} from "./team-location-plan.js";

export {
  BuiltInTeamReadOnlyError,
  TeamPathError,
  TeamPrimaryAgentError,
} from "./team-location-plan.js";

export const TEAMS_DIRECTORY = "teams";
export const SYSTEM_TEAMS_DIRECTORY = ".system";
export const SYSTEM_TEAM_LOCATION_OVERRIDES_FILE = path.join(
  ".state",
  "agent-teams",
  "system-location-overrides-v1.json",
);

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
  /**
   * The effective chosen face: the app record (team.json `memberPortraits`) first, then the
   * legacy `portrait_id` still carried by pre-migration AGENT.md files. Absent or null keeps the
   * slug-derived default.
   */
  portraitId?: string | null;
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
  assertValidMemberSlug(slug);
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
  const override = readSystemTeamLocationOverrides(dataRoot)[input.teamId];
  const directoryPlan = selectTeamDirectoryName({
    ownership: input.ownership,
    override,
    teamId: input.teamId,
    systemRoot: getSystemTeamsRoot(dataRoot),
    userRoot: getTeamsRoot(dataRoot),
  });
  const directory = path.join(directoryPlan.rootDirectory, directoryPlan.directoryName);

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
  return classifyTeamOwnership(topLevelSegment);
}

export async function listTeamLocations(dataRoot: string): Promise<TeamLocation[]> {
  const resolvedDataRoot = path.resolve(dataRoot);
  const teamsRoot = getTeamsRoot(resolvedDataRoot);
  const [systemIds, userIds] = await Promise.all([
    listDirectoryNames(getSystemTeamsRoot(resolvedDataRoot)),
    listDirectoryNames(teamsRoot, { exclude: new Set([SYSTEM_TEAMS_DIRECTORY]) }),
  ]);

  const overrides = readSystemTeamLocationOverrides(resolvedDataRoot);
  const overriddenDirectoryNames = new Set(
    Object.values(overrides).filter((value): value is string => value !== null),
  );
  const excludedCanonicalIds = new Set(
    Object.entries(overrides).filter(([, value]) => value === null).map(([teamId]) => teamId),
  );
  const defaultSystemIds = systemIds.filter(
    (teamId) => shouldIncludeCanonicalSystemTeam({
      teamId,
      overriddenDirectoryNames,
      excludedCanonicalIds,
    }),
  );
  return [
    ...defaultSystemIds.map((teamId) =>
      resolveTeamLocation({ dataRoot: resolvedDataRoot, teamId, ownership: "system" })),
    ...Object.entries(overrides).flatMap(([teamId, directoryName]) =>
      directoryName === null
        ? []
        : [resolveTeamLocation({ dataRoot: resolvedDataRoot, teamId, ownership: "system" })]),
    ...userIds.map((teamId) => resolveTeamLocation({ dataRoot: resolvedDataRoot, teamId, ownership: "user" })),
  ];
}

export async function writeSystemTeamLocationOverrides(
  dataRoot: string,
  overrides: Record<string, string | null>,
): Promise<void> {
  const target = path.join(path.resolve(dataRoot), SYSTEM_TEAM_LOCATION_OVERRIDES_FILE);
  const normalized = normalizeSystemTeamLocationOverrides(overrides);
  const temporary = `${target}.${process.pid}.${randomUUID()}.tmp`;
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.writeFile(temporary, `${JSON.stringify({ version: 1, teams: normalized }, null, 2)}\n`, "utf8");
  await fs.rename(temporary, target);
}

export function readSystemTeamLocationOverrides(
  dataRoot: string,
): Record<string, string | null> {
  try {
    const parsed = JSON.parse(
      readFileSync(path.join(path.resolve(dataRoot), SYSTEM_TEAM_LOCATION_OVERRIDES_FILE), "utf8"),
    ) as unknown;
    if (
      typeof parsed !== "object"
      || parsed === null
      || (parsed as { version?: unknown }).version !== 1
      || typeof (parsed as { teams?: unknown }).teams !== "object"
      || (parsed as { teams?: unknown }).teams === null
    ) {
      return {};
    }
    return normalizeSystemTeamLocationOverrides(
      (parsed as { teams: Record<string, unknown> }).teams,
    );
  } catch {
    return {};
  }
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
      const identity = parseAgentMarkdownIdentity(agentRead.content);
      members.push({
        slug,
        directory: memberDirectory,
        agentFile,
        agentMarkdown: agentRead.content,
        ...identity,
        portraitId: definition.memberPortraits?.[slug]
          ?? tryReadLegacyAgentMarkdownPortrait(agentRead.content)
          ?? null,
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
  // Portrait entries for members that no longer exist are stale presentation data; drop them so
  // the manifest stays the single source of truth for who the team has.
  const memberPortraits = definition.memberPortraits === undefined
    ? undefined
    : Object.fromEntries(
        Object.entries(definition.memberPortraits)
          .filter(([slug]) => definition.memberOrder.includes(slug)),
      );
  const normalizedDefinition = parseTeamDefinitionJson(serializeTeamDefinition({
    ...definition,
    ...(memberPortraits === undefined || Object.keys(memberPortraits).length === 0
      ? {}
      : { memberPortraits }),
  }));
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

/**
 * Persists a portrait choice into the team's app record (`team.json` `memberPortraits`), the
 * same file that already owns `memberOrder` and `primaryAgentSlug`. The file on disk is the
 * single source of truth, so the write is a read-modify-write of the current manifest rather
 * than a patch of whatever the renderer holds. `null` removes the explicit choice so the member
 * falls back to its slug-derived default face.
 *
 * Teams written before the migration carry `portrait_id` in the member's AGENT.md frontmatter.
 * The read path still falls back to that legacy location; writing a portrait here also strips
 * the stale frontmatter field (best effort — the authoritative value is already safe in
 * team.json by then, so a failed strip never loses the portrait).
 */
export async function writeMemberTeamPortrait(
  location: TeamLocation,
  slug: string,
  portraitId: string | null,
): Promise<void> {
  assertTeamWritable(location);
  const snapshot = await readTeamSnapshot(location);
  if (snapshot.definition === null) {
    throw new TeamMutationError("团队信息当前不可用，无法设置画像。");
  }
  if (!snapshot.definition.memberOrder.includes(slug)) {
    throw new TeamMutationError("只能为当前团队中的成员设置画像。");
  }
  const memberPortraits = { ...(snapshot.definition.memberPortraits ?? {}) };
  if (portraitId === null) {
    delete memberPortraits[slug];
  } else {
    memberPortraits[slug] = portraitId;
  }
  await writeTeamDefinition(location, {
    ...snapshot.definition,
    memberPortraits,
  });
  await stripLegacyAgentMarkdownPortrait(getMemberAgentPath(location, slug));
}

async function stripLegacyAgentMarkdownPortrait(agentFile: string): Promise<void> {
  try {
    const source = await fs.readFile(agentFile, "utf8");
    const parsed = parseAgentMarkdownFrontmatter(source);
    const frontmatter = { ...(parsed.frontmatter ?? {}) };
    if (!Object.hasOwn(frontmatter, "portrait_id")) {
      return;
    }
    delete frontmatter.portrait_id;
    await fs.writeFile(agentFile, serializeAgentMarkdownFrontmatter(frontmatter, parsed.body), "utf8");
  } catch {
    // Best effort: the authoritative portrait already lives in team.json.
  }
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
      primaryAgentSlug: selectPrimaryAgentSlug(snapshot.definition.primaryAgentSlug, slug),
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

/**
 * Applies a new member order from the drag-and-drop strip. The strip's contract is that first
 * place *is* the primary appointment, so the primary Agent follows the new first entry — this
 * keeps `memberOrder[0]` and `primaryAgentSlug` the same fact, with no path for them to diverge.
 * The member set itself must not change: reordering moves existing members, adding or dropping
 * one is a different operation and fails loudly instead of silently rewriting the team.
 */
export async function reorderTeamMembers(
  location: TeamLocation,
  memberOrder: string[],
): Promise<TeamSnapshot> {
  assertTeamWritable(location);
  const snapshot = await readTeamSnapshot(location);
  if (snapshot.definition === null) {
    throw new TeamMutationError("团队信息当前不可用，无法调整成员顺序。");
  }
  const current = new Set(snapshot.definition.memberOrder);
  const next = new Set(memberOrder);
  const sameMembers = current.size === next.size
    && [...current].every((slug) => next.has(slug))
    && [...next].every((slug) => current.has(slug));
  if (!sameMembers) {
    throw new TeamMutationError("成员排序只能调整现有成员的先后，不能增删成员。");
  }
  if ([...next].some((slug) => !isValidPathSegment(slug))) {
    throw new TeamMutationError("成员排序包含无效的成员标识。");
  }

  await writeTeamDefinition(location, {
    ...snapshot.definition,
    memberOrder,
    primaryAgentSlug: memberOrder[0] ?? null,
  });
  return readTeamSnapshot(location);
}

export async function duplicateBuiltInTeamDirectory(source: TeamLocation): Promise<TeamLocation> {
  assertLocationMatchesLayout(source);
  const actualOwnership = determineTeamOwnership(source.dataRoot, source.directory);
  assertBuiltInTeamOwnership(source.ownership, actualOwnership, source.directory);

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
  assertMemberIsNotPrimary(snapshot.definition.primaryAgentSlug, memberSlug);
  const member = snapshot.members.find((candidate) => candidate.slug === memberSlug);
  if (member === undefined && !snapshot.definition.memberOrder.includes(memberSlug)) {
    throw new TeamMutationError("要删除的 Agent 当前不可用。");
  }
  const memberDirectory = selectMemberDirectory(
    member?.directory,
    getMemberDirectory(location, memberSlug),
  );

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
  assertUserTeamOwnership(location.ownership, location.id);
  const sourceStats = await fs.stat(location.directory);
  if (!sourceStats.isDirectory()) {
    throw new TeamPathError(`User team path is not a directory: ${location.directory}`);
  }
  await moveToTrash(location.directory);
}

async function duplicateTeamDirectoryAsUserTeam(source: TeamLocation): Promise<TeamLocation> {
  assertLocationMatchesLayout(source);
  const actualOwnership = determineTeamOwnership(source.dataRoot, source.directory);
  assertMatchingTeamOwnership({
    declared: source.ownership,
    actual: actualOwnership,
    directory: source.directory,
  });

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
  assertMatchingTeamOwnership({
    declared: location.ownership,
    actual: actualOwnership,
    directory: location.directory,
  });
}

/**
 * Kept for source compatibility with older callers. Official teams are editable
 * now, so current mutation paths no longer throw this error.
 */
export class TeamMutationError extends Error {
  readonly code = "TEAM_MUTATION_INVALID";

  constructor(message: string) {
    super(message);
    this.name = "TeamMutationError";
  }
}

function assertTeamId(teamId: string): void {
  assertValidTeamId(teamId);
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
  const expected = resolveTeamLocation({
    dataRoot: location.dataRoot,
    teamId: location.id,
    ownership: "system",
  });
  assertLocationLayout({
    ownership: location.ownership,
    teamId: location.id,
    directory: location.directory,
    resolvedDirectory: path.resolve(location.directory),
    expectedSystemDirectory: expected.directory,
    userPathIsAbsolute: path.isAbsolute(location.directory),
  });
}

function assertDirectUserTeamDirectory(dataRoot: string, directory: string): void {
  const resolvedDirectory = path.resolve(directory);
  const teamsRoot = getTeamsRoot(dataRoot);
  assertDirectUserTeamDirectoryPlan({
    parentDirectory: path.dirname(resolvedDirectory),
    teamsRoot,
    directoryName: path.basename(resolvedDirectory),
  });
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
      // Dot-prefixed directories are application-internal (e.g. a crash-left
      // GitHub install staging directory); they are never teams.
      .filter((entry) => entry.isDirectory()
        && !entry.name.startsWith(".")
        && !options?.exclude?.has(entry.name))
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
