import { normalizeExecutionProfile, type ExecutionProfile, type ExecutionProfileBinding } from "./team-execution-profile.js";
import {
  AgentTeamIpcRequestError,
  type AgentTeamDuplicateBuiltInRequest,
  type AgentTeamDuplicateUserRequest,
  type AgentTeamExecutionProfileSaveRequest,
  type AgentTeamExecutionProfilesReplaceRequest,
  type AgentTeamListItem,
  type AgentTeamMemberAddRequest,
  type AgentTeamMemberRequest,
  type AgentTeamMemberWriteRequest,
  type AgentTeamOfficialUpdateCommitRequest,
  type AgentTeamPrimaryAgentWriteRequest,
} from "./team-ipc-contract.js";
import { isValidPathSegment, type TeamDefinition, type TeamInformation } from "./team-model.js";
import type { PreparedOfficialTeamUpdate } from "./team-official-update.js";
import type { TeamSnapshot } from "./team-store.js";
import type { TeamOnboardingOrchestrationReadResult } from "./team-onboarding-orchestration-plan.js";

export function planTeamListLoad(seedPending: boolean): "loading" | "read" {
  return seedPending ? "loading" : "read";
}

export function decideReadableBuiltInTeam(snapshots: readonly TeamSnapshot[]): boolean {
  return snapshots.some((snapshot) =>
    snapshot.location.ownership === "system" && snapshot.status === "usable");
}

export function planOwnershipSource(ownership: "system" | "user"): "system" | "user" {
  return ownership;
}

export function selectRecommendation(
  recommendations: Readonly<Record<string, ExecutionProfile>> | undefined,
  memberSlug: string,
): ExecutionProfile | null {
  return recommendations?.[memberSlug] ?? null;
}

export function toOptionalRecommendation(
  recommendation: ExecutionProfile | null,
): ExecutionProfile | undefined {
  return recommendation ?? undefined;
}

export function selectTeamDefinition(
  snapshot: TeamSnapshot,
  fallback?: { definition: TeamDefinition | null },
): TeamDefinition | null {
  return snapshot.definition ?? fallback?.definition ?? null;
}

export function selectOfficialSourceName(
  packaged: TeamSnapshot | null,
  snapshot: TeamSnapshot,
): string | undefined {
  return packaged?.definition?.name ?? snapshot.definition?.name ?? undefined;
}

export function selectRecommendationsOrEmpty(
  recommendations: Record<string, ExecutionProfile> | undefined,
): Record<string, ExecutionProfile> {
  return recommendations ?? {};
}

export function selectMemberSlugs(snapshot: TeamSnapshot): string[] {
  return snapshot.definition?.memberOrder ?? snapshot.members.map((member) => member.slug);
}

export function assertRequestedMembersAvailable(
  requested: readonly string[],
  available: readonly string[],
): void {
  if (requested.some((slug) => !available.includes(slug))) {
    throw new AgentTeamIpcRequestError("批量替换的 Agent 已不在当前团队中。");
  }
}

export function selectExecutionBinding(input: {
  binding: ExecutionProfileBinding | undefined;
  recommendation: ExecutionProfile | null;
  defaultProfile: ExecutionProfile;
}): ExecutionProfileBinding {
  return input.binding ?? (input.recommendation === null
    ? { source: "explicit", profile: input.defaultProfile }
    : { source: "recommended" });
}

export function planUserRecordRefresh(ownership: "system" | "user"): boolean {
  return ownership === "user";
}

export function planCopiedTeamLoad(copyTeamId: string | null): "none" | "load" {
  return copyTeamId === null ? "none" : "load";
}

export function planOptionalValue(value: unknown): "none" | "value" {
  return value == null ? "none" : "value";
}

export function toOnboardingListState(
  result: TeamOnboardingOrchestrationReadResult,
): AgentTeamListItem["onboardingOrchestration"] {
  return result.status === "ready"
    ? { status: "ready", relayBeats: result.orchestration.relayBeats.map((beat) => ({ ...beat })) }
    : { status: "unavailable" };
}

export function selectTeamMember(snapshot: TeamSnapshot, memberSlug: string) {
  const member = snapshot.members.find((candidate) => candidate.slug === memberSlug);
  if (member === undefined) {
    throw new AgentTeamIpcRequestError("The requested Agent is not available in this team.");
  }
  return member;
}

export function planExecutionBindingSource(recommendation: ExecutionProfile | undefined): "override" | "explicit" {
  return recommendation === undefined ? "explicit" : "override";
}

export function assertRecommendedProfileAvailable(input: {
  ownership: "system" | "user";
  recommendation: ExecutionProfile | undefined;
}): void {
  if (input.ownership !== "system") {
    throw new AgentTeamIpcRequestError("只有官方成员可以恢复推荐配置。");
  }
  if (input.recommendation === undefined) {
    throw new AgentTeamIpcRequestError("这个 Agent 没有当前官方版本的推荐配置。");
  }
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
  const memberSlugs = [...new Set([...orderedSlugs, ...snapshot.members.map((member) => member.slug)])];
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
    capabilities: { canEditContent: true, canDeleteTeam: snapshot.location.ownership === "user" },
    issues: snapshot.issues.map(({ code, slug }) => ({ code, ...(slug === undefined ? {} : { slug }) })),
    ...(onboardingOrchestration === undefined ? {} : { onboardingOrchestration }),
  };
}

export function parseMemberRequest(value: unknown): AgentTeamMemberRequest {
  const team = parseTeamRequest(value);
  if (!isPlainObject(value) || typeof value.memberSlug !== "string" || value.memberSlug.trim().length === 0) {
    throw new AgentTeamIpcRequestError("An Agent slug is required.");
  }
  return { ...team, memberSlug: value.memberSlug };
}

export function parseMemberWriteRequest(value: unknown): AgentTeamMemberWriteRequest {
  const request = parseMemberRequest(value);
  if (!isPlainObject(value) || typeof value.agentMarkdown !== "string") {
    throw new AgentTeamIpcRequestError("AGENT.md content is required.");
  }
  return { ...request, agentMarkdown: value.agentMarkdown };
}

export function parsePrimaryAgentWriteRequest(value: unknown): AgentTeamPrimaryAgentWriteRequest {
  const team = parseTeamRequest(value);
  if (!isPlainObject(value) || typeof value.primaryAgentSlug !== "string" || value.primaryAgentSlug.trim().length === 0) {
    throw new AgentTeamIpcRequestError("A primary Agent slug is required.");
  }
  return { ...team, primaryAgentSlug: value.primaryAgentSlug };
}

export function parseExecutionProfileSaveRequest(value: unknown): AgentTeamExecutionProfileSaveRequest {
  const member = parseMemberRequest(value);
  if (!isPlainObject(value)) throw new AgentTeamIpcRequestError("保存运行配置需要有效的配置内容。");
  return { ...member, profile: normalizeExecutionProfile(value.profile) };
}

export function parseExecutionProfilesReplaceRequest(value: unknown): AgentTeamExecutionProfilesReplaceRequest {
  const team = parseTeamRequest(value);
  if (!isPlainObject(value) || !Array.isArray(value.memberSlugs)) {
    throw new AgentTeamIpcRequestError("批量替换需要有效的 Agent 列表。");
  }
  const memberSlugs = [...new Set(value.memberSlugs.map((slug) => {
    if (typeof slug !== "string" || !isValidPathSegment(slug) || slug.trim() !== slug) {
      throw new AgentTeamIpcRequestError("批量替换包含无效的 Agent slug。");
    }
    return slug;
  }))];
  if (memberSlugs.length === 0 || memberSlugs.length > 256) {
    throw new AgentTeamIpcRequestError("批量替换至少需要一名 Agent。");
  }
  return { ...team, memberSlugs, profile: normalizeExecutionProfile(value.profile) };
}

export function parseOfficialTeamRequest(value: unknown): { teamId: string; ownership: "system" } {
  const request = parseTeamRequest(value);
  if (request.ownership !== "system") {
    throw new AgentTeamIpcRequestError("只有官方来源团队可以检查官方更新。");
  }
  return { teamId: request.teamId, ownership: "system" };
}

export function parseOfficialUpdateCommitRequest(value: unknown): AgentTeamOfficialUpdateCommitRequest {
  if (!isPlainObject(value) || !isPlainObject(value.plan)) {
    throw new AgentTeamIpcRequestError("需要有效的官方团队更新计划。");
  }
  const plan = value.plan;
  if (plan.schemaVersion !== 1 || typeof plan.planId !== "string" || typeof plan.teamId !== "string"
    || typeof plan.inputFingerprint !== "string" || !isPlainObject(plan.state)
    || (plan.copyTeamId !== null && typeof plan.copyTeamId !== "string")) {
    throw new AgentTeamIpcRequestError("官方团队更新计划无效。");
  }
  return { plan: plan as unknown as PreparedOfficialTeamUpdate };
}

export function parseTeamRequest(value: unknown): AgentTeamMemberAddRequest {
  if (!isPlainObject(value)) throw new AgentTeamIpcRequestError("A team request is required.");
  if (typeof value.teamId !== "string" || value.teamId.trim().length === 0) {
    throw new AgentTeamIpcRequestError("A team id is required.");
  }
  if (value.ownership !== "system" && value.ownership !== "user") {
    throw new AgentTeamIpcRequestError("A valid team ownership is required.");
  }
  return { teamId: value.teamId, ownership: value.ownership };
}

export function parseTeamInformation(value: unknown): TeamInformation {
  if (!isPlainObject(value)) throw new AgentTeamIpcRequestError("Team information is required.");
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

export function parseDuplicateBuiltInRequest(value: unknown): AgentTeamDuplicateBuiltInRequest {
  const request = parseTeamRequest(value);
  if (request.ownership !== "system") {
    throw new AgentTeamIpcRequestError("Only a built-in team can be copied by this operation.");
  }
  return { teamId: request.teamId, ownership: "system" };
}

export function parseUserTeamRequest(value: unknown, ownershipError: string): AgentTeamDuplicateUserRequest {
  const request = parseTeamRequest(value);
  if (request.ownership !== "user") throw new AgentTeamIpcRequestError(ownershipError);
  return { teamId: request.teamId, ownership: "user" };
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
