import {
  DEFAULT_TEAM_EXECUTION_PROFILE,
  materializeExplicitBindings,
  resolveEffectiveExecutionProfile,
  type ExecutionProfile,
  type ExecutionProfileBinding,
} from "./team-execution-profile.js";
import type {
  AgentTeamExecutionProfileDocument,
  AgentTeamListItem,
} from "./team-ipc-contract.js";
import type { OfficialTeamStateDocumentV1 } from "./team-management-document-codec.js";
import type { OfficialTeamUpdateState } from "./team-official-plan.js";
import type {
  AppliedOfficialTeamUpdate,
  PreparedOfficialTeamUpdate,
} from "./team-official-update.js";
import {
  assertRecommendedProfileAvailable,
  assertRequestedMembersAvailable,
  parseExecutionProfileSaveRequest,
  parseExecutionProfilesReplaceRequest,
  parseMemberRequest,
  parseOfficialTeamRequest,
  parseOfficialUpdateCommitRequest,
  planCopiedTeamLoad,
  planExecutionBindingSource,
  planOptionalValue,
  planOwnershipSource,
  selectExecutionBinding,
  selectMemberSlugs,
  selectRecommendation,
  selectRecommendationsOrEmpty,
  selectOfficialSourceName,
  selectTeamDefinition,
  toOptionalRecommendation,
  toListItem,
  toOnboardingListState,
} from "./team-service-plan.js";
import type { TeamDefinition, TeamOwnership } from "./team-model.js";
import type { TeamLocation, TeamSnapshot } from "./team-store.js";
import type { TeamOnboardingOrchestrationReadResult } from "./team-onboarding-orchestration-plan.js";

export interface TeamProfilePorts {
  readBindings(input: { dataRoot: string; ownership: TeamOwnership; teamId: string }): Promise<Record<string, ExecutionProfileBinding>>;
  saveBinding(input: { dataRoot: string; ownership: TeamOwnership; teamId: string; memberSlug: string; binding: ExecutionProfileBinding }): Promise<void>;
  replaceBindings(input: { dataRoot: string; ownership: TeamOwnership; teamId: string; bindings: Readonly<Record<string, ExecutionProfileBinding>> }): Promise<void>;
  readOfficial(dataRoot: string): Promise<OfficialTeamStateDocumentV1>;
  inspectUpdate(input: { dataRoot: string; teamId: string }): Promise<OfficialTeamUpdateState>;
  prepareUpdate(input: { dataRoot: string; teamId: string }): Promise<PreparedOfficialTeamUpdate>;
  commitUpdate(input: { dataRoot: string; plan: PreparedOfficialTeamUpdate }): Promise<AppliedOfficialTeamUpdate>;
  readSnapshot(location: TeamLocation): Promise<TeamSnapshot>;
  resolveLocation(input: { dataRoot: string; teamId: string; ownership: TeamOwnership }): TeamLocation;
  readOnboarding(input: { directory: string; memberOrder: readonly string[] }): Promise<TeamOnboardingOrchestrationReadResult>;
  readCreatedAt(directory: string): Promise<string | null>;
  getPackagedDirectory(dataRoot: string, teamId: string): string;
}

export function createTeamProfileService(ports: TeamProfilePorts) {
  const loadOfficial = async (dataRoot: string, teamId: string, ownership: TeamOwnership) => {
    const loaders = {
      system: async () => (await ports.readOfficial(dataRoot)).teams[teamId],
      user: async () => undefined,
    };
    return loaders[planOwnershipSource(ownership)]();
  };
  const resolveStoredMemberProfile = async (input: {
    dataRoot: string; teamId: string; ownership: TeamOwnership; memberSlug: string;
  }): Promise<Pick<AgentTeamExecutionProfileDocument, "binding" | "recommendation" | "effectiveProfile">> => {
    const bindings = await ports.readBindings(input);
    const official = await loadOfficial(input.dataRoot, input.teamId, input.ownership);
    const recommendation = selectRecommendation(official?.appliedRecommendations, input.memberSlug);
    const binding = selectExecutionBinding({ binding: bindings[input.memberSlug], recommendation,
      defaultProfile: DEFAULT_TEAM_EXECUTION_PROFILE });
    if (planOptionalValue(bindings[input.memberSlug]) === "none") await ports.saveBinding({ ...input, binding });
    return { binding, recommendation, effectiveProfile: resolveEffectiveExecutionProfile({
      binding, recommendation: toOptionalRecommendation(recommendation),
    }) };
  };
  const present = async (snapshot: TeamSnapshot, fallback?: { definition: TeamDefinition | null }) => {
    const definition = selectTeamDefinition(snapshot, fallback);
    const onboardingLoaders = {
      none: async () => ({ status: "unavailable" as const }),
      value: async () => {
        return toOnboardingListState(await ports.readOnboarding({
          directory: snapshot.location.directory,
          memberOrder: definition!.memberOrder,
        }));
      },
    };
    const item = toListItem(snapshot, fallback, await onboardingLoaders[planOptionalValue(definition)]());
    const createdAt = await ports.readCreatedAt(snapshot.location.directory);
    if (planOptionalValue(createdAt) === "value") item.createdAt = createdAt!;
    const official = await loadOfficial(snapshot.location.dataRoot, snapshot.location.id, snapshot.location.ownership);
    const sourceLoaders = {
      system: async () => await ports.readSnapshot({
        ...snapshot.location,
        directory: ports.getPackagedDirectory(snapshot.location.dataRoot, snapshot.location.id),
      }).catch(() => null),
      user: async () => null,
    };
    const packaged = await sourceLoaders[planOwnershipSource(snapshot.location.ownership)]();
    if (planOptionalValue(packaged) === "value") {
      item.officialSourceName = selectOfficialSourceName(packaged, snapshot);
    }
    const bindings = await ports.readBindings({ dataRoot: snapshot.location.dataRoot,
      ownership: snapshot.location.ownership, teamId: snapshot.location.id });
    item.members = item.members.map((member) => {
      const recommendation = selectRecommendation(official?.appliedRecommendations, member.slug);
      const binding = selectExecutionBinding({ binding: bindings[member.slug], recommendation,
        defaultProfile: DEFAULT_TEAM_EXECUTION_PROFILE });
      return { ...member, executionProfile: { binding, recommendation,
        effectiveProfile: resolveEffectiveExecutionProfile({
          binding,
          recommendation: toOptionalRecommendation(recommendation),
        }) } };
    });
    if (planOptionalValue(official) === "value") {
      item.officialManagement = await ports.inspectUpdate({
        dataRoot: snapshot.location.dataRoot,
        teamId: snapshot.location.id,
      });
    }
    return item;
  };

  return {
    present,
    resolveStoredMemberProfile,
    copyBindingsAsExplicit: async (input: { dataRoot: string; source: TeamLocation; destination: TeamLocation; snapshot: TeamSnapshot }) => {
      const bindings = await ports.readBindings({ dataRoot: input.dataRoot,
        ownership: input.source.ownership, teamId: input.source.id });
      const official = await loadOfficial(input.dataRoot, input.source.id, input.source.ownership);
      const memberSlugs = selectMemberSlugs(input.snapshot);
      const completeBindings = Object.fromEntries(memberSlugs.map((slug) => [slug,
        selectExecutionBinding({ binding: bindings[slug],
          recommendation: selectRecommendation(official?.appliedRecommendations, slug),
          defaultProfile: DEFAULT_TEAM_EXECUTION_PROFILE })]));
      await ports.replaceBindings({ dataRoot: input.dataRoot, ownership: "user", teamId: input.destination.id,
        bindings: materializeExplicitBindings({ memberSlugs, bindings: completeBindings,
          recommendations: selectRecommendationsOrEmpty(official?.appliedRecommendations) }) });
    },
    readAgentTeamExecutionProfile: async (dataRoot: string, raw: unknown) => {
      const request = parseMemberRequest(raw);
      return { ...request, ...await resolveStoredMemberProfile({ dataRoot, ...request }) };
    },
    saveAgentTeamExecutionProfile: async (dataRoot: string, raw: unknown) => {
      const request = parseExecutionProfileSaveRequest(raw);
      const official = await loadOfficial(dataRoot, request.teamId, request.ownership);
      await ports.saveBinding({ dataRoot, ...request, binding: {
        source: planExecutionBindingSource(official?.appliedRecommendations[request.memberSlug]),
        profile: request.profile,
      } });
      return { ...request, ...await resolveStoredMemberProfile({ dataRoot, ...request }) };
    },
    replaceUnavailableAgentTeamExecutionProfiles: async (dataRoot: string, raw: unknown) => {
      const request = parseExecutionProfilesReplaceRequest(raw);
      const location = ports.resolveLocation({ dataRoot, teamId: request.teamId, ownership: request.ownership });
      const snapshot = await ports.readSnapshot(location);
      const memberSlugs = selectMemberSlugs(snapshot);
      assertRequestedMembersAvailable(request.memberSlugs, memberSlugs);
      const stored = await ports.readBindings({ dataRoot, teamId: request.teamId, ownership: request.ownership });
      const official = await loadOfficial(dataRoot, request.teamId, request.ownership);
      const bindings = materializeExplicitBindings({
        memberSlugs,
        bindings: Object.fromEntries(memberSlugs.map((slug) => [slug, selectExecutionBinding({
          binding: stored[slug],
          recommendation: selectRecommendation(official?.appliedRecommendations, slug),
          defaultProfile: DEFAULT_TEAM_EXECUTION_PROFILE,
        })])),
        recommendations: selectRecommendationsOrEmpty(official?.appliedRecommendations),
      });
      for (const slug of request.memberSlugs) {
        bindings[slug] = { source: "explicit", profile: { ...request.profile } };
      }
      await ports.replaceBindings({
        dataRoot,
        teamId: request.teamId,
        ownership: request.ownership,
        bindings,
      });
      return {
        teamId: request.teamId,
        ownership: request.ownership,
        memberSlugs: [...request.memberSlugs],
        profile: { ...request.profile },
      };
    },
    restoreAgentTeamRecommendedProfile: async (dataRoot: string, raw: unknown) => {
      const request = parseMemberRequest(raw);
      const official = await loadOfficial(dataRoot, request.teamId, request.ownership);
      assertRecommendedProfileAvailable({ ownership: request.ownership,
        recommendation: official?.appliedRecommendations[request.memberSlug] });
      await ports.saveBinding({ dataRoot, ownership: "system", teamId: request.teamId,
        memberSlug: request.memberSlug, binding: { source: "recommended" } });
      return { ...request, ...await resolveStoredMemberProfile({ dataRoot, ...request }) };
    },
    prepareAgentTeamOfficialUpdate: async (dataRoot: string, raw: unknown) => {
      const request = parseOfficialTeamRequest(raw);
      return ports.prepareUpdate({ dataRoot, teamId: request.teamId });
    },
    applyAgentTeamOfficialUpdate: async (dataRoot: string, raw: unknown) => {
      const request = parseOfficialUpdateCommitRequest(raw);
      const result = await ports.commitUpdate({ dataRoot, plan: request.plan });
      const loaders = {
        none: async () => null,
        load: async () => await present(await ports.readSnapshot(ports.resolveLocation({
          dataRoot, teamId: result.copiedTeamId!, ownership: "user",
        }))),
      };
      return { ...result, copiedTeam: await loaders[planCopiedTeamLoad(result.copiedTeamId)]() };
    },
  };
}
