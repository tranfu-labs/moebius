import type {
  AgentTeamListItem,
  AgentTeamListResponse,
  AgentTeamMemberAddResponse,
  AgentTeamMemberDocument,
} from "./team-ipc-contract.js";
import {
  decideReadableBuiltInTeam,
  parseDuplicateBuiltInRequest,
  parseMemberRequest,
  parseMemberWriteRequest,
  parsePrimaryAgentWriteRequest,
  parseTeamInformation,
  parseTeamRequest,
  parseUserTeamRequest,
  planTeamListLoad,
  planUserRecordRefresh,
  selectTeamMember,
} from "./team-service-plan.js";
import { DEFAULT_TEAM_EXECUTION_PROFILE, type ExecutionProfileBinding } from "./team-execution-profile.js";
import type { TeamDefinition, TeamOwnership } from "./team-model.js";
import type { MovePathToTrash, TeamLocation, TeamSnapshot } from "./team-store.js";

export interface TeamCatalogPorts {
  listLocations(dataRoot: string): Promise<TeamLocation[]>;
  readSnapshot(location: TeamLocation): Promise<TeamSnapshot>;
  listRecorded(dataRoot: string): Promise<Array<{ record: { lastKnownDefinition: TeamDefinition | null }; snapshot: TeamSnapshot }>>;
  readRegistrationIssues(dataRoot: string): Promise<Array<{ kind: "stable-identity" | "directory"; canPreserve: boolean }>>;
  create(dataRoot: string, information: { name: string; description: string }): Promise<TeamSnapshot>;
  resolveSystem(input: { dataRoot: string; teamId: string; ownership: "system" }): TeamLocation;
  resolveUser(dataRoot: string, teamId: string): Promise<TeamLocation>;
  writeMember(location: TeamLocation, slug: string, markdown: string): Promise<void>;
  addMember(location: TeamLocation): Promise<{ team: TeamSnapshot; member: TeamSnapshot["members"][number] }>;
  updateInformation(location: TeamLocation, information: { name: string; description: string }): Promise<TeamSnapshot>;
  setPrimary(location: TeamLocation, slug: string): Promise<TeamSnapshot>;
  duplicateBuiltIn(location: TeamLocation): Promise<TeamLocation>;
  duplicateUser(location: TeamLocation): Promise<TeamLocation>;
  duplicateMember(location: TeamLocation, slug: string): Promise<{ team: TeamSnapshot; member: TeamSnapshot["members"][number] }>;
  trashMember(location: TeamLocation, slug: string, move: MovePathToTrash): Promise<TeamSnapshot>;
  trashUser(location: TeamLocation, move: MovePathToTrash): Promise<void>;
  readBindings(input: { dataRoot: string; ownership: TeamOwnership; teamId: string }): Promise<Record<string, ExecutionProfileBinding>>;
  replaceBindings(input: { dataRoot: string; ownership: TeamOwnership; teamId: string; bindings: Readonly<Record<string, ExecutionProfileBinding>> }): Promise<void>;
  saveBinding(input: { dataRoot: string; ownership: TeamOwnership; teamId: string; memberSlug: string; binding: ExecutionProfileBinding }): Promise<void>;
  removeBindings(input: { dataRoot: string; ownership: TeamOwnership; teamId: string }): Promise<void>;
  register(snapshot: TeamSnapshot): Promise<void>;
  forget(input: { dataRoot: string; teamId: string }): Promise<void>;
  present(snapshot: TeamSnapshot, fallback?: { definition: TeamDefinition | null }): Promise<AgentTeamListItem>;
  copyBindings(input: { dataRoot: string; source: TeamLocation; destination: TeamLocation; snapshot: TeamSnapshot }): Promise<void>;
  resolveMemberProfile(input: { dataRoot: string; teamId: string; ownership: TeamOwnership; memberSlug: string }): Promise<{ effectiveProfile: import("./team-execution-profile.js").ExecutionProfile }>;
}

export function createTeamCatalogService(ports: TeamCatalogPorts) {
  const resolveLocation = async (dataRoot: string, request: { teamId: string; ownership: TeamOwnership }) => {
    const loaders = {
      system: async () => ports.resolveSystem({ dataRoot, teamId: request.teamId, ownership: "system" }),
      user: async () => await ports.resolveUser(dataRoot, request.teamId),
    };
    return loaders[request.ownership]();
  };
  const refreshUserRecord = async (snapshot: TeamSnapshot) => {
    const actions = { true: async () => await ports.register(snapshot), false: async () => undefined };
    await actions[String(planUserRecordRefresh(snapshot.location.ownership)) as "true" | "false"]();
  };

  return {
    listAgentTeams: async (input: { dataRoot: string; seedPending: boolean }): Promise<AgentTeamListResponse> => {
      if (planTeamListLoad(input.seedPending) === "loading") return { status: "loading" };
      const systemLocations = (await ports.listLocations(input.dataRoot))
        .filter((location) => location.ownership === "system");
      const [systemSnapshots, recordedUserTeams] = await Promise.all([
        Promise.all(systemLocations.map((location) => ports.readSnapshot(location))),
        ports.listRecorded(input.dataRoot),
      ]);
      if (!decideReadableBuiltInTeam(systemSnapshots)) return { status: "configuration-error" };
      const registrationIssues = await ports.readRegistrationIssues(input.dataRoot);
      return {
        status: "ready",
        registrationIssues: registrationIssues.map(({ kind, canPreserve }) => ({ kind, canPreserve })),
        teams: await Promise.all([
          ...systemSnapshots.map((snapshot) => ports.present(snapshot)),
          ...recordedUserTeams.map(({ record, snapshot }) => ports.present(snapshot, {
            definition: record.lastKnownDefinition,
          })),
        ]),
      };
    },
    createAgentTeam: async (dataRoot: string, raw: unknown) => {
      const snapshot = await ports.create(dataRoot, parseTeamInformation(raw));
      await ports.replaceBindings({
        dataRoot,
        ownership: snapshot.location.ownership,
        teamId: snapshot.location.id,
        bindings: Object.fromEntries(snapshot.members.map((member) => [
          member.slug,
          { source: "explicit", profile: DEFAULT_TEAM_EXECUTION_PROFILE },
        ])),
      });
      await ports.register(snapshot);
      return ports.present(snapshot);
    },
    readAgentTeamMember: async (dataRoot: string, raw: unknown): Promise<AgentTeamMemberDocument> => {
      const request = parseMemberRequest(raw);
      return toMemberDocument(selectTeamMember(await ports.readSnapshot(
        await resolveLocation(dataRoot, request),
      ), request.memberSlug));
    },
    writeAgentTeamMember: async (dataRoot: string, raw: unknown): Promise<AgentTeamMemberDocument> => {
      const request = parseMemberWriteRequest(raw);
      const location = await resolveLocation(dataRoot, request);
      await ports.writeMember(location, request.memberSlug, request.agentMarkdown);
      const snapshot = await ports.readSnapshot(location);
      await refreshUserRecord(snapshot);
      return toMemberDocument(selectTeamMember(snapshot, request.memberSlug));
    },
    addAgentTeamMember: async (dataRoot: string, raw: unknown): Promise<AgentTeamMemberAddResponse> => {
      const location = await resolveLocation(dataRoot, parseTeamRequest(raw));
      const result = await ports.addMember(location);
      await ports.saveBinding({ dataRoot, ownership: location.ownership, teamId: location.id,
        memberSlug: result.member.slug, binding: { source: "explicit", profile: DEFAULT_TEAM_EXECUTION_PROFILE } });
      await refreshUserRecord(result.team);
      return { team: await ports.present(result.team), member: toMemberDocument(result.member) };
    },
    updateAgentTeamInformation: async (dataRoot: string, raw: unknown) => {
      const request = parseTeamRequest(raw);
      const snapshot = await ports.updateInformation(await resolveLocation(dataRoot, request), parseTeamInformation(raw));
      await refreshUserRecord(snapshot);
      return ports.present(snapshot);
    },
    setAgentTeamPrimaryAgent: async (dataRoot: string, raw: unknown) => {
      const request = parsePrimaryAgentWriteRequest(raw);
      const snapshot = await ports.setPrimary(await resolveLocation(dataRoot, request), request.primaryAgentSlug);
      await refreshUserRecord(snapshot);
      return ports.present(snapshot);
    },
    duplicateBuiltInAgentTeam: async (dataRoot: string, raw: unknown) => {
      const request = parseDuplicateBuiltInRequest(raw);
      const source = ports.resolveSystem({ dataRoot, teamId: request.teamId, ownership: "system" });
      const destination = await ports.duplicateBuiltIn(source);
      const snapshot = await ports.readSnapshot(destination);
      await ports.copyBindings({ dataRoot, source, destination, snapshot });
      await ports.register(snapshot);
      return ports.present(snapshot);
    },
    duplicateUserAgentTeam: async (dataRoot: string, raw: unknown) => {
      const request = parseUserTeamRequest(raw, "Only a user team can be copied by this operation.");
      const source = await resolveLocation(dataRoot, request);
      const destination = await ports.duplicateUser(source);
      const snapshot = await ports.readSnapshot(destination);
      await ports.copyBindings({ dataRoot, source, destination, snapshot });
      await ports.register(snapshot);
      return ports.present(snapshot);
    },
    duplicateAgentTeamMember: async (dataRoot: string, raw: unknown): Promise<AgentTeamMemberAddResponse> => {
      const request = parseMemberRequest(raw);
      const location = await resolveLocation(dataRoot, request);
      const sourceProfile = await ports.resolveMemberProfile({ dataRoot, ...request });
      const result = await ports.duplicateMember(location, request.memberSlug);
      await ports.saveBinding({ dataRoot, ownership: location.ownership, teamId: location.id,
        memberSlug: result.member.slug, binding: { source: "explicit", profile: sourceProfile.effectiveProfile } });
      await refreshUserRecord(result.team);
      return { team: await ports.present(result.team), member: toMemberDocument(result.member) };
    },
    trashAgentTeamMember: async (dataRoot: string, raw: unknown, move: MovePathToTrash) => {
      const request = parseMemberRequest(raw);
      const snapshot = await ports.trashMember(await resolveLocation(dataRoot, request), request.memberSlug, move);
      const bindings = await ports.readBindings({ dataRoot, ownership: request.ownership, teamId: request.teamId });
      delete bindings[request.memberSlug];
      await ports.replaceBindings({ dataRoot, ownership: request.ownership, teamId: request.teamId, bindings });
      await refreshUserRecord(snapshot);
      return ports.present(snapshot);
    },
    trashUserAgentTeam: async (dataRoot: string, raw: unknown, move: MovePathToTrash) => {
      const request = parseUserTeamRequest(raw, "Only a user team can be moved to the trash.");
      await ports.trashUser(await resolveLocation(dataRoot, request), move);
      await ports.removeBindings({ dataRoot, ownership: "user", teamId: request.teamId });
      await ports.forget({ dataRoot, teamId: request.teamId });
    },
  };
}

function toMemberDocument(member: TeamSnapshot["members"][number]): AgentTeamMemberDocument {
  return { slug: member.slug, displayName: member.displayName, description: member.description,
    available: true, agentMarkdown: member.agentMarkdown };
}
