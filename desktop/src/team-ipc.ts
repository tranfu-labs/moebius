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
  AgentTeamMemberDuplicateRequest,
  AgentTeamMemberRequest,
  AgentTeamMemberWriteRequest,
  AgentTeamPrimaryAgentWriteRequest,
} from "./team-ipc-contract.js";
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
      ...systemSnapshots.map((snapshot) => toListItemWithOnboardingOrchestration(snapshot)),
      ...recordedUserTeams.map(({ record, snapshot }) =>
        toListItemWithOnboardingOrchestration(snapshot, {
          definition: record.lastKnownDefinition,
        })),
    ]),
  };
}

export async function createAgentTeam(dataRoot: string, rawRequest: unknown): Promise<AgentTeamListItem> {
  const request = parseTeamInformation(rawRequest);
  const snapshot = await createUserTeam(dataRoot, request);
  await registerUserTeamSnapshot(snapshot);
  return toListItem(snapshot);
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
  await refreshUserTeamRecord(result.team);
  return {
    team: toListItem(result.team),
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
  return toListItem(snapshot);
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
  return toListItem(snapshot);
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
  await registerUserTeamSnapshot(snapshot);
  return toListItem(snapshot);
}

export async function duplicateUserAgentTeam(dataRoot: string, rawRequest: unknown): Promise<AgentTeamListItem> {
  const request = parseUserTeamRequest(rawRequest, "Only a user team can be copied by this operation.");
  const source = await resolveAgentTeamLocation(dataRoot, request);
  const destination = await duplicateUserTeamDirectory(source);
  const snapshot = await readTeamSnapshot(destination);
  await registerUserTeamSnapshot(snapshot);
  return toListItem(snapshot);
}

export async function duplicateAgentTeamMember(
  dataRoot: string,
  rawRequest: unknown,
): Promise<AgentTeamMemberAddResponse> {
  const request = parseUserMemberRequest(rawRequest, "Only a user-team Agent can be copied.");
  const location = await resolveAgentTeamLocation(dataRoot, request);
  const result = await duplicateTeamMemberDirectory(location, request.memberSlug);
  await refreshUserTeamRecord(result.team);
  return { team: toListItem(result.team), member: toMemberDocument(result.member) };
}

export async function trashAgentTeamMember(
  dataRoot: string,
  rawRequest: unknown,
  moveToTrash: MovePathToTrash,
): Promise<AgentTeamListItem> {
  const request = parseUserMemberRequest(rawRequest, "Only a user-team Agent can be deleted.");
  const location = await resolveAgentTeamLocation(dataRoot, request);
  const snapshot = await trashTeamMemberDirectory(location, request.memberSlug, moveToTrash);
  await refreshUserTeamRecord(snapshot);
  return toListItem(snapshot);
}

export async function trashUserAgentTeam(
  dataRoot: string,
  rawRequest: unknown,
  moveToTrash: MovePathToTrash,
): Promise<void> {
  const request = parseUserTeamRequest(rawRequest, "Only a user team can be moved to the trash.");
  const location = await resolveAgentTeamLocation(dataRoot, request);
  await trashUserTeamDirectory(location, moveToTrash);
  await forgetTrashedUserTeamRecord({ dataRoot, teamId: request.teamId });
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

function parseUserMemberRequest(value: unknown, ownershipError: string): AgentTeamMemberDuplicateRequest {
  const request = parseMemberRequest(value);
  if (request.ownership !== "user") {
    throw new AgentTeamIpcRequestError(ownershipError);
  }
  return { ...request, ownership: "user" };
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export class AgentTeamIpcRequestError extends Error {
  readonly code = "AGENT_TEAM_IPC_REQUEST_INVALID";

  constructor(message: string) {
    super(message);
    this.name = "AgentTeamIpcRequestError";
  }
}
