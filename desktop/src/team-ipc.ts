import { isValidPathSegment } from "./team-model.js";
import type {
  TeamDefinition,
  TeamInformation,
} from "./team-model.js";
import type {
  AgentTeamDuplicateBuiltInRequest,
  AgentTeamDuplicateUserRequest,
  AgentTeamListItem,
  AgentTeamListResponse,
  AgentTeamMemberAddRequest,
  AgentTeamMemberAddResponse,
  AgentTeamMemberDocument,
  AgentTeamMemberRequest,
  AgentTeamMemberWriteRequest,
  AgentTeamExecutionProfileDocument,
  AgentTeamExecutionProfileSaveRequest,
  AgentTeamOfficialUpdateCommitRequest,
  AgentTeamPrimaryAgentWriteRequest,
} from "./team-ipc-contract.js";
import {
  readOfficialTeamStateDocument,
  readTeamExecutionBindings,
  removeTeamExecutionBindings,
  replaceTeamExecutionBindings,
  saveTeamExecutionBinding,
} from "./team-management-store.js";
import {
  DEFAULT_TEAM_EXECUTION_PROFILE,
  materializeExplicitBindings,
  normalizeExecutionProfile,
  resolveEffectiveExecutionProfile,
  type ExecutionProfileBinding,
} from "./team-execution-profile.js";
import {
  commitOfficialTeamUpdate,
  inspectOfficialTeamUpdate,
  prepareOfficialTeamUpdate,
  type PreparedOfficialTeamUpdate,
} from "./team-official-update.js";
import { readTeamOnboardingOrchestration } from "./team-onboarding-orchestration.js";
import {
  forgetTrashedUserTeamRecord,
  listRecordedUserTeamSnapshots,
  registerUserTeamSnapshot,
  resolveRecordedTeamLocation,
} from "./team-record-store.js";
import {
  addTeamMember,
  createUserTeam,
  duplicateBuiltInTeamDirectory,
  duplicateTeamMemberDirectory,
  duplicateUserTeamDirectory,
  listTeamLocations,
  readTeamSnapshot,
  resolveTeamLocation,
  setTeamPrimaryAgent,
  trashTeamMemberDirectory,
  trashUserTeamDirectory,
  updateTeamInformation,
  writeMemberAgentMarkdown,
  type MovePathToTrash,
  type TeamMemberSnapshot,
  type TeamSnapshot,
} from "./team-store.js";

export * from "./team-ipc-contract.js";

export async function listAgentTeams(input: {
  dataRoot: string;
  seedPending: boolean;
}): Promise<AgentTeamListResponse> {
  if (input.seedPending) {
    return { status: "loading" };
  }

  const systemLocations = (await listTeamLocations(input.dataRoot))
    .filter((location) => location.ownership === "system");
  const [systemSnapshots, recordedUserTeams] = await Promise.all([
    Promise.all(systemLocations.map((location) => readTeamSnapshot(location))),
    listRecordedUserTeamSnapshots(input.dataRoot),
  ]);
  const hasReadableBuiltInTeam = systemSnapshots.some(
    (snapshot) => snapshot.location.ownership === "system" && snapshot.status === "usable",
  );

  if (!hasReadableBuiltInTeam) {
    return { status: "configuration-error" };
  }

  return {
    status: "ready",
    teams: await Promise.all([
      ...systemSnapshots.map((snapshot) => toManagedListItemWithOnboardingOrchestration(snapshot)),
      ...recordedUserTeams.map(({ record, snapshot }) =>
        toManagedListItemWithOnboardingOrchestration(snapshot, {
          definition: record.lastKnownDefinition,
        })),
    ]),
  };
}

export async function createAgentTeam(dataRoot: string, rawRequest: unknown): Promise<AgentTeamListItem> {
  const request = parseTeamInformation(rawRequest);
  const snapshot = await createUserTeam(dataRoot, request);
  await initializeExplicitBindings(snapshot);
  await registerUserTeamSnapshot(snapshot);
  return toManagedListItemWithOnboardingOrchestration(snapshot);
}

export async function readAgentTeamMember(dataRoot: string, rawRequest: unknown): Promise<AgentTeamMemberDocument> {
  const request = parseMemberRequest(rawRequest);
  const location = await resolveAgentTeamLocation(dataRoot, request);
  const snapshot = await readTeamSnapshot(location);
  return toMemberDocument(findMember(snapshot, request.memberSlug));
}

export async function writeAgentTeamMember(dataRoot: string, rawRequest: unknown): Promise<AgentTeamMemberDocument> {
  const request = parseMemberWriteRequest(rawRequest);
  const location = await resolveAgentTeamLocation(dataRoot, request);

  // The store remains the single authority for built-in ownership and write rejection.
  await writeMemberAgentMarkdown(location, request.memberSlug, request.agentMarkdown);
  const snapshot = await readTeamSnapshot(location);
  await refreshUserTeamRecord(snapshot);
  return toMemberDocument(findMember(snapshot, request.memberSlug));
}

export async function addAgentTeamMember(
  dataRoot: string,
  rawRequest: unknown,
): Promise<AgentTeamMemberAddResponse> {
  const request = parseTeamRequest(rawRequest);
  const location = await resolveAgentTeamLocation(dataRoot, request);
  const result = await addTeamMember(location);
  await saveTeamExecutionBinding({
    dataRoot,
    ownership: location.ownership,
    teamId: location.id,
    memberSlug: result.member.slug,
    binding: { source: "explicit", profile: DEFAULT_TEAM_EXECUTION_PROFILE },
  });
  await refreshUserTeamRecord(result.team);
  return {
    team: await toManagedListItemWithOnboardingOrchestration(result.team),
    member: toMemberDocument(result.member),
  };
}

export async function updateAgentTeamInformation(
  dataRoot: string,
  rawRequest: unknown,
): Promise<AgentTeamListItem> {
  const request = parseTeamRequest(rawRequest);
  if (!isPlainObject(rawRequest)) {
    throw new AgentTeamIpcRequestError("Team information is required.");
  }
  const information = parseTeamInformation(rawRequest);
  const location = await resolveAgentTeamLocation(dataRoot, request);
  const snapshot = await updateTeamInformation(location, information);
  await refreshUserTeamRecord(snapshot);
  return toManagedListItemWithOnboardingOrchestration(snapshot);
}

export async function setAgentTeamPrimaryAgent(
  dataRoot: string,
  rawRequest: unknown,
): Promise<AgentTeamListItem> {
  const request = parsePrimaryAgentWriteRequest(rawRequest);
  const location = await resolveAgentTeamLocation(dataRoot, request);

  // The store validates both write ownership and membership validity.
  const snapshot = await setTeamPrimaryAgent(location, request.primaryAgentSlug);
  await refreshUserTeamRecord(snapshot);
  return toManagedListItemWithOnboardingOrchestration(snapshot);
}

export async function duplicateBuiltInAgentTeam(dataRoot: string, rawRequest: unknown): Promise<AgentTeamListItem> {
  const request = parseDuplicateBuiltInRequest(rawRequest);
  const source = resolveTeamLocation({
    dataRoot,
    teamId: request.teamId,
    ownership: request.ownership,
  });
  const destination = await duplicateBuiltInTeamDirectory(source);
  const snapshot = await readTeamSnapshot(destination);
  await copyTeamBindingsAsExplicit({ dataRoot, source, destination, snapshot });
  await registerUserTeamSnapshot(snapshot);
  return toManagedListItemWithOnboardingOrchestration(snapshot);
}

export async function duplicateUserAgentTeam(dataRoot: string, rawRequest: unknown): Promise<AgentTeamListItem> {
  const request = parseUserTeamRequest(rawRequest, "Only a user team can be copied by this operation.");
  const source = await resolveAgentTeamLocation(dataRoot, request);
  const destination = await duplicateUserTeamDirectory(source);
  const snapshot = await readTeamSnapshot(destination);
  await copyTeamBindingsAsExplicit({ dataRoot, source, destination, snapshot });
  await registerUserTeamSnapshot(snapshot);
  return toManagedListItemWithOnboardingOrchestration(snapshot);
}

export async function duplicateAgentTeamMember(
  dataRoot: string,
  rawRequest: unknown,
): Promise<AgentTeamMemberAddResponse> {
  const request = parseMemberRequest(rawRequest);
  const location = await resolveAgentTeamLocation(dataRoot, request);
  const sourceProfile = await resolveStoredMemberProfile({
    dataRoot,
    teamId: request.teamId,
    ownership: request.ownership,
    memberSlug: request.memberSlug,
  });
  const result = await duplicateTeamMemberDirectory(location, request.memberSlug);
  await saveTeamExecutionBinding({
    dataRoot,
    ownership: location.ownership,
    teamId: location.id,
    memberSlug: result.member.slug,
    binding: { source: "explicit", profile: sourceProfile.effectiveProfile },
  });
  await refreshUserTeamRecord(result.team);
  return {
    team: await toManagedListItemWithOnboardingOrchestration(result.team),
    member: toMemberDocument(result.member),
  };
}

export async function trashAgentTeamMember(
  dataRoot: string,
  rawRequest: unknown,
  moveToTrash: MovePathToTrash,
): Promise<AgentTeamListItem> {
  const request = parseMemberRequest(rawRequest);
  const location = await resolveAgentTeamLocation(dataRoot, request);
  const snapshot = await trashTeamMemberDirectory(location, request.memberSlug, moveToTrash);
  const bindings = await readTeamExecutionBindings({
    dataRoot,
    ownership: request.ownership,
    teamId: request.teamId,
  });
  delete bindings[request.memberSlug];
  await replaceTeamExecutionBindings({
    dataRoot,
    ownership: request.ownership,
    teamId: request.teamId,
    bindings,
  });
  await refreshUserTeamRecord(snapshot);
  return toManagedListItemWithOnboardingOrchestration(snapshot);
}

export async function trashUserAgentTeam(
  dataRoot: string,
  rawRequest: unknown,
  moveToTrash: MovePathToTrash,
): Promise<void> {
  const request = parseUserTeamRequest(rawRequest, "Only a user team can be moved to the trash.");
  const location = await resolveAgentTeamLocation(dataRoot, request);
  await trashUserTeamDirectory(location, moveToTrash);
  await removeTeamExecutionBindings({
    dataRoot,
    ownership: "user",
    teamId: request.teamId,
  });
  await forgetTrashedUserTeamRecord({ dataRoot, teamId: request.teamId });
}

export async function readAgentTeamExecutionProfile(
  dataRoot: string,
  rawRequest: unknown,
): Promise<AgentTeamExecutionProfileDocument> {
  const request = parseMemberRequest(rawRequest);
  await resolveAgentTeamLocation(dataRoot, request);
  const resolved = await resolveStoredMemberProfile({ dataRoot, ...request });
  return {
    ...request,
    ...resolved,
  };
}

export async function saveAgentTeamExecutionProfile(
  dataRoot: string,
  rawRequest: unknown,
): Promise<AgentTeamExecutionProfileDocument> {
  const request = parseExecutionProfileSaveRequest(rawRequest);
  await resolveAgentTeamLocation(dataRoot, request);
  const official = request.ownership === "system"
    ? (await readOfficialTeamStateDocument(dataRoot)).teams[request.teamId]
    : undefined;
  const source = official !== undefined
    && Object.hasOwn(official.appliedRecommendations, request.memberSlug)
    ? "override"
    : "explicit";
  await saveTeamExecutionBinding({
    dataRoot,
    ownership: request.ownership,
    teamId: request.teamId,
    memberSlug: request.memberSlug,
    binding: { source, profile: request.profile },
  });
  return readAgentTeamExecutionProfile(dataRoot, request);
}

export async function restoreAgentTeamRecommendedProfile(
  dataRoot: string,
  rawRequest: unknown,
): Promise<AgentTeamExecutionProfileDocument> {
  const request = parseMemberRequest(rawRequest);
  if (request.ownership !== "system") {
    throw new AgentTeamIpcRequestError("只有官方成员可以恢复推荐配置。");
  }
  const official = (await readOfficialTeamStateDocument(dataRoot)).teams[request.teamId];
  if (official === undefined || !Object.hasOwn(official.appliedRecommendations, request.memberSlug)) {
    throw new AgentTeamIpcRequestError("这个 Agent 没有当前官方版本的推荐配置。");
  }
  await saveTeamExecutionBinding({
    dataRoot,
    ownership: "system",
    teamId: request.teamId,
    memberSlug: request.memberSlug,
    binding: { source: "recommended" },
  });
  return readAgentTeamExecutionProfile(dataRoot, request);
}

export async function prepareAgentTeamOfficialUpdate(
  dataRoot: string,
  rawRequest: unknown,
): Promise<PreparedOfficialTeamUpdate> {
  const request = parseOfficialTeamRequest(rawRequest);
  return prepareOfficialTeamUpdate({ dataRoot, teamId: request.teamId });
}

export async function applyAgentTeamOfficialUpdate(
  dataRoot: string,
  rawRequest: unknown,
): Promise<Awaited<ReturnType<typeof commitOfficialTeamUpdate>> & {
  copiedTeam: AgentTeamListItem | null;
}> {
  const request = parseOfficialUpdateCommitRequest(rawRequest);
  const result = await commitOfficialTeamUpdate({ dataRoot, plan: request.plan });
  const copiedTeam = result.copiedTeamId === null
    ? null
    : await toManagedListItemWithOnboardingOrchestration(await readTeamSnapshot(resolveTeamLocation({
        dataRoot,
        teamId: result.copiedTeamId,
        ownership: "user",
      })));
  return { ...result, copiedTeam };
}

export function toListItem(
  snapshot: TeamSnapshot,
  fallback?: { definition: TeamDefinition | null },
  onboardingOrchestration?: AgentTeamListItem["onboardingOrchestration"],
): AgentTeamListItem {
  const definition = snapshot.definition ?? fallback?.definition ?? null;
  const orderedSlugs = definition?.memberOrder.filter(
    (slug): slug is string => typeof slug === "string" && isValidPathSegment(slug) && slug.trim() === slug,
  ) ?? [];
  const memberSlugs = [...new Set([
    ...orderedSlugs,
    ...snapshot.members.map((member) => member.slug),
  ])];
  const readableMembers = new Map(snapshot.members.map((member) => [member.slug, member]));
  return {
    id: snapshot.location.id,
    ownership: snapshot.location.ownership,
    definition,
    members: snapshot.status === "needs-repair" ? [] : memberSlugs.map((slug) => {
      const current = readableMembers.get(slug);
      return {
        slug,
        displayName: current?.displayName ?? "",
        description: current?.description ?? "",
        available: current !== undefined,
      };
    }),
    status: snapshot.status,
    canCreateConversation: snapshot.canCreateConversation,
    capabilities: {
      canEditContent: true,
      canDeleteTeam: snapshot.location.ownership === "user",
    },
    issues: snapshot.issues.map(({ code, slug }) => ({ code, ...(slug === undefined ? {} : { slug }) })),
    ...(onboardingOrchestration === undefined ? {} : { onboardingOrchestration }),
  };
}

async function toListItemWithOnboardingOrchestration(
  snapshot: TeamSnapshot,
  fallback?: { definition: TeamDefinition | null },
): Promise<AgentTeamListItem> {
  const definition = snapshot.definition ?? fallback?.definition ?? null;
  if (definition === null) {
    return toListItem(snapshot, fallback, { status: "unavailable" });
  }
  const orchestration = await readTeamOnboardingOrchestration({
    directory: snapshot.location.directory,
    memberOrder: definition.memberOrder,
  });
  return toListItem(snapshot, fallback, orchestration.status === "ready"
    ? {
        status: "ready",
        relayBeats: orchestration.orchestration.relayBeats.map((beat) => ({ ...beat })),
      }
    : { status: "unavailable" });
}

async function toManagedListItemWithOnboardingOrchestration(
  snapshot: TeamSnapshot,
  fallback?: { definition: TeamDefinition | null },
): Promise<AgentTeamListItem> {
  const item = await toListItemWithOnboardingOrchestration(snapshot, fallback);
  const bindings = await readTeamExecutionBindings({
    dataRoot: snapshot.location.dataRoot,
    ownership: snapshot.location.ownership,
    teamId: snapshot.location.id,
  });
  const official = snapshot.location.ownership === "system"
    ? (await readOfficialTeamStateDocument(snapshot.location.dataRoot)).teams[snapshot.location.id]
    : undefined;
  item.members = item.members.map((member) => {
    const recommendation = official?.appliedRecommendations[member.slug] ?? null;
    let binding = bindings[member.slug];
    if (binding === undefined) {
      binding = recommendation === null
        ? { source: "explicit", profile: DEFAULT_TEAM_EXECUTION_PROFILE }
        : { source: "recommended" };
    }
    return {
      ...member,
      executionProfile: {
        binding,
        recommendation,
        effectiveProfile: resolveEffectiveExecutionProfile({
          binding,
          recommendation: recommendation ?? undefined,
        }),
      },
    };
  });
  if (snapshot.location.ownership === "system" && official !== undefined) {
    item.officialManagement = await inspectOfficialTeamUpdate({
      dataRoot: snapshot.location.dataRoot,
      teamId: snapshot.location.id,
    });
  }
  return item;
}

async function resolveAgentTeamLocation(
  dataRoot: string,
  request: Pick<AgentTeamMemberAddRequest, "teamId" | "ownership">,
) {
  return request.ownership === "system"
    ? resolveTeamLocation({ dataRoot, teamId: request.teamId, ownership: "system" })
    : resolveRecordedTeamLocation(dataRoot, request.teamId);
}

function toMemberDocument(member: TeamMemberSnapshot): AgentTeamMemberDocument {
  return {
    slug: member.slug,
    displayName: member.displayName,
    description: member.description,
    available: true,
    agentMarkdown: member.agentMarkdown,
  };
}

async function refreshUserTeamRecord(snapshot: TeamSnapshot): Promise<void> {
  if (snapshot.location.ownership === "user") {
    await registerUserTeamSnapshot(snapshot);
  }
}

async function initializeExplicitBindings(snapshot: TeamSnapshot): Promise<void> {
  await replaceTeamExecutionBindings({
    dataRoot: snapshot.location.dataRoot,
    ownership: snapshot.location.ownership,
    teamId: snapshot.location.id,
    bindings: Object.fromEntries(snapshot.members.map((member) => [
      member.slug,
      { source: "explicit", profile: DEFAULT_TEAM_EXECUTION_PROFILE },
    ])),
  });
}

async function copyTeamBindingsAsExplicit(input: {
  dataRoot: string;
  source: { id: string; ownership: "system" | "user" };
  destination: { id: string; ownership: "system" | "user" };
  snapshot: TeamSnapshot;
}): Promise<void> {
  const bindings = await readTeamExecutionBindings({
    dataRoot: input.dataRoot,
    ownership: input.source.ownership,
    teamId: input.source.id,
  });
  const official = input.source.ownership === "system"
    ? (await readOfficialTeamStateDocument(input.dataRoot)).teams[input.source.id]
    : undefined;
  const memberSlugs = input.snapshot.definition?.memberOrder
    ?? input.snapshot.members.map((member) => member.slug);
  const completeBindings = Object.fromEntries(memberSlugs.map((slug) => [
    slug,
    bindings[slug] ?? (
      official?.appliedRecommendations[slug] === undefined
        ? { source: "explicit" as const, profile: DEFAULT_TEAM_EXECUTION_PROFILE }
        : { source: "recommended" as const }
    ),
  ]));
  await replaceTeamExecutionBindings({
    dataRoot: input.dataRoot,
    ownership: "user",
    teamId: input.destination.id,
    bindings: materializeExplicitBindings({
      memberSlugs,
      bindings: completeBindings,
      recommendations: official?.appliedRecommendations ?? {},
    }),
  });
}

async function resolveStoredMemberProfile(input: {
  dataRoot: string;
  teamId: string;
  ownership: "system" | "user";
  memberSlug: string;
}): Promise<Pick<
  AgentTeamExecutionProfileDocument,
  "binding" | "recommendation" | "effectiveProfile"
>> {
  const bindings = await readTeamExecutionBindings(input);
  let binding = bindings[input.memberSlug];
  const official = input.ownership === "system"
    ? (await readOfficialTeamStateDocument(input.dataRoot)).teams[input.teamId]
    : undefined;
  const recommendation = official?.appliedRecommendations[input.memberSlug] ?? null;
  if (binding === undefined) {
    binding = recommendation === null
      ? { source: "explicit", profile: DEFAULT_TEAM_EXECUTION_PROFILE }
      : { source: "recommended" };
    await saveTeamExecutionBinding({
      ...input,
      binding,
    });
  }
  return {
    binding,
    recommendation,
    effectiveProfile: resolveEffectiveExecutionProfile({
      binding,
      recommendation: recommendation ?? undefined,
    }),
  };
}

function findMember(snapshot: TeamSnapshot, memberSlug: string): TeamMemberSnapshot {
  const member = snapshot.members.find((candidate) => candidate.slug === memberSlug);
  if (member === undefined) {
    throw new AgentTeamIpcRequestError("The requested Agent is not available in this team.");
  }
  return member;
}

function parseMemberRequest(value: unknown): AgentTeamMemberRequest {
  const team = parseTeamRequest(value);
  if (!isPlainObject(value)) {
    throw new AgentTeamIpcRequestError("A team member request is required.");
  }
  if (typeof value.memberSlug !== "string" || value.memberSlug.trim().length === 0) {
    throw new AgentTeamIpcRequestError("An Agent slug is required.");
  }
  return {
    ...team,
    memberSlug: value.memberSlug,
  };
}

function parseMemberWriteRequest(value: unknown): AgentTeamMemberWriteRequest {
  const request = parseMemberRequest(value);
  if (!isPlainObject(value) || typeof value.agentMarkdown !== "string") {
    throw new AgentTeamIpcRequestError("AGENT.md content is required.");
  }
  return { ...request, agentMarkdown: value.agentMarkdown };
}

function parsePrimaryAgentWriteRequest(value: unknown): AgentTeamPrimaryAgentWriteRequest {
  const team = parseTeamRequest(value);
  if (!isPlainObject(value)) {
    throw new AgentTeamIpcRequestError("A primary Agent request is required.");
  }
  if (typeof value.primaryAgentSlug !== "string" || value.primaryAgentSlug.trim().length === 0) {
    throw new AgentTeamIpcRequestError("A primary Agent slug is required.");
  }
  return {
    ...team,
    primaryAgentSlug: value.primaryAgentSlug,
  };
}

function parseExecutionProfileSaveRequest(value: unknown): AgentTeamExecutionProfileSaveRequest {
  const member = parseMemberRequest(value);
  if (!isPlainObject(value)) {
    throw new AgentTeamIpcRequestError("保存运行配置需要有效的配置内容。");
  }
  return {
    ...member,
    profile: normalizeExecutionProfile(value.profile),
  };
}

function parseOfficialTeamRequest(value: unknown): { teamId: string; ownership: "system" } {
  const request = parseTeamRequest(value);
  if (request.ownership !== "system") {
    throw new AgentTeamIpcRequestError("只有官方来源团队可以检查官方更新。");
  }
  return { teamId: request.teamId, ownership: "system" };
}

function parseOfficialUpdateCommitRequest(value: unknown): AgentTeamOfficialUpdateCommitRequest {
  if (!isPlainObject(value) || !isPlainObject(value.plan)) {
    throw new AgentTeamIpcRequestError("需要有效的官方团队更新计划。");
  }
  const plan = value.plan;
  if (
    plan.schemaVersion !== 1
    || typeof plan.planId !== "string"
    || typeof plan.teamId !== "string"
    || typeof plan.inputFingerprint !== "string"
    || !isPlainObject(plan.state)
    || (plan.copyTeamId !== null && typeof plan.copyTeamId !== "string")
  ) {
    throw new AgentTeamIpcRequestError("官方团队更新计划无效。");
  }
  return { plan: plan as unknown as PreparedOfficialTeamUpdate };
}

function parseTeamRequest(value: unknown): AgentTeamMemberAddRequest {
  if (!isPlainObject(value)) {
    throw new AgentTeamIpcRequestError("A team request is required.");
  }
  if (typeof value.teamId !== "string" || value.teamId.trim().length === 0) {
    throw new AgentTeamIpcRequestError("A team id is required.");
  }
  if (value.ownership !== "system" && value.ownership !== "user") {
    throw new AgentTeamIpcRequestError("A valid team ownership is required.");
  }
  return { teamId: value.teamId, ownership: value.ownership };
}

function parseTeamInformation(value: unknown): TeamInformation {
  if (!isPlainObject(value)) {
    throw new AgentTeamIpcRequestError("Team information is required.");
  }
  if (typeof value.name !== "string" || value.name.trim().length === 0) {
    throw new AgentTeamIpcRequestError("A team name is required.");
  }
  if (typeof value.description !== "string" || value.description.trim().length === 0) {
    throw new AgentTeamIpcRequestError("A one-line team description is required.");
  }
  if (/\r|\n/u.test(value.name) || /\r|\n/u.test(value.description)) {
    throw new AgentTeamIpcRequestError("Team information must fit on one line.");
  }
  return { name: value.name, description: value.description };
}

function parseDuplicateBuiltInRequest(value: unknown): AgentTeamDuplicateBuiltInRequest {
  if (!isPlainObject(value) || typeof value.teamId !== "string" || value.teamId.trim().length === 0) {
    throw new AgentTeamIpcRequestError("A built-in team id is required.");
  }
  if (value.ownership !== "system") {
    throw new AgentTeamIpcRequestError("Only a built-in team can be copied by this operation.");
  }
  return { teamId: value.teamId, ownership: "system" };
}

function parseUserTeamRequest(value: unknown, ownershipError: string): AgentTeamDuplicateUserRequest {
  const request = parseTeamRequest(value);
  if (request.ownership !== "user") {
    throw new AgentTeamIpcRequestError(ownershipError);
  }
  return { teamId: request.teamId, ownership: "user" };
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export class AgentTeamIpcRequestError extends Error {
  constructor(
    message: string,
    readonly code:
      | "AGENT_TEAM_IPC_REQUEST_INVALID"
      | "CAPABILITY_SNAPSHOT_STALE"
      | "EXECUTION_PROFILE_UNAVAILABLE" = "AGENT_TEAM_IPC_REQUEST_INVALID",
  ) {
    super(message);
    this.name = "AgentTeamIpcRequestError";
  }
}
