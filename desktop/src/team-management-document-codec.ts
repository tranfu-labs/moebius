import type { TeamOwnership } from "./team-model.js";
import {
  normalizeExecutionProfile,
  type ExecutionProfile,
  type ExecutionProfileBinding,
} from "./team-execution-profile.js";
import type { AppliedOfficialTeamState } from "./team-official-plan.js";

export interface OfficialTeamStateDocumentV1 {
  schemaVersion: 1;
  teams: Record<string, AppliedOfficialTeamState>;
}

export interface TeamExecutionBindingDocumentV1 {
  schemaVersion: 1;
  teams: Record<string, {
    ownership: TeamOwnership;
    members: Record<string, ExecutionProfileBinding>;
  }>;
}

export function normalizeOfficialTeamStateDocument(value: unknown): OfficialTeamStateDocumentV1 {
  if (!isPlainObject(value) || value.schemaVersion !== 1 || !isPlainObject(value.teams)) {
    throw new TeamManagementDocumentError("官方团队状态文件格式无效。");
  }
  const teams: Record<string, AppliedOfficialTeamState> = {};
  for (const [teamId, raw] of Object.entries(value.teams)) {
    assertStateKeySegment(teamId);
    if (!isPlainObject(raw)) {
      throw new TeamManagementDocumentError(`官方团队 ${teamId} 的状态无效。`);
    }
    const recommendations = normalizeRecommendations(raw.appliedRecommendations);
    const confidence = raw.baselineConfidence;
    if (
      typeof raw.appliedOfficialVersion !== "string"
      || typeof raw.appliedContentFingerprint !== "string"
      || typeof raw.appliedRecommendationFingerprint !== "string"
      || (confidence !== "verified" && confidence !== "conservative")
    ) {
      throw new TeamManagementDocumentError(`官方团队 ${teamId} 的状态无效。`);
    }
    const hasSnapshot = Object.hasOwn(raw, "appliedContentSnapshot");
    const snapshot = hasSnapshot ? normalizeAppliedContentSnapshot(raw.appliedContentSnapshot) : undefined;
    teams[teamId] = {
      appliedOfficialVersion: raw.appliedOfficialVersion,
      appliedContentFingerprint: raw.appliedContentFingerprint,
      appliedRecommendationFingerprint: raw.appliedRecommendationFingerprint,
      appliedRecommendations: recommendations,
      baselineConfidence: confidence,
      ...(hasSnapshot ? { appliedContentSnapshot: snapshot } : {}),
    };
  }
  return { schemaVersion: 1, teams };
}

/**
 * `undefined` means "legacy fingerprint-only document, migration not run yet";
 * `null` means "migrated conservative — A's content is unknowable"; an object is
 * the back-filled content snapshot of a verified baseline.
 */
function normalizeAppliedContentSnapshot(
  value: unknown,
): Record<string, string> | null {
  if (value === null) {
    return null;
  }
  if (!isPlainObject(value)) {
    throw new TeamManagementDocumentError("官方基线内容快照无效。");
  }
  return Object.fromEntries(Object.entries(value).map(([relativePath, content]) => {
    if (
      relativePath.length === 0
      || relativePath.startsWith("/")
      || relativePath.includes("\\")
      || relativePath.split("/").some((segment) => segment === ".." || segment === ".")
      || typeof content !== "string"
    ) {
      throw new TeamManagementDocumentError("官方基线内容快照包含无效路径。");
    }
    return [relativePath, content];
  }));
}

export function normalizeTeamExecutionBindingDocument(
  value: unknown,
): TeamExecutionBindingDocumentV1 {
  if (!isPlainObject(value) || value.schemaVersion !== 1 || !isPlainObject(value.teams)) {
    throw new TeamManagementDocumentError("Agent 运行配置状态文件格式无效。");
  }
  const teams: TeamExecutionBindingDocumentV1["teams"] = {};
  for (const [key, raw] of Object.entries(value.teams)) {
    if (!isPlainObject(raw) || (raw.ownership !== "system" && raw.ownership !== "user")
      || !isPlainObject(raw.members)) {
      throw new TeamManagementDocumentError(`团队 ${key} 的运行配置无效。`);
    }
    teams[key] = {
      ownership: raw.ownership,
      members: Object.fromEntries(Object.entries(raw.members).map(([slug, binding]) => {
        assertStateKeySegment(slug);
        return [slug, normalizeExecutionBinding(binding)];
      })),
    };
  }
  return { schemaVersion: 1, teams };
}

export function normalizeExecutionBinding(value: unknown): ExecutionProfileBinding {
  if (!isPlainObject(value)) {
    throw new TeamManagementDocumentError("Agent 运行配置无效。");
  }
  if (value.source === "recommended") {
    return { source: "recommended" };
  }
  if (value.source === "override" || value.source === "explicit") {
    return {
      source: value.source,
      profile: normalizeExecutionProfile(value.profile),
    };
  }
  throw new TeamManagementDocumentError("Agent 运行配置来源无效。");
}

export function selectStoredTeamBindings(
  members: Record<string, ExecutionProfileBinding> | undefined,
): Record<string, ExecutionProfileBinding> {
  return members ?? {};
}

export function assertStateKeySegment(value: string): void {
  if (!/^[a-z0-9](?:[a-z0-9-]{0,127})$/u.test(value)) {
    throw new TeamManagementDocumentError(`状态 key 无效：${value}`);
  }
}

function normalizeRecommendations(value: unknown): Record<string, ExecutionProfile> {
  if (!isPlainObject(value)) {
    throw new TeamManagementDocumentError("官方推荐运行配置无效。");
  }
  return Object.fromEntries(Object.entries(value).map(([slug, profile]) => {
    assertStateKeySegment(slug);
    return [slug, normalizeExecutionProfile(profile)];
  }));
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export class TeamManagementDocumentError extends Error {
  readonly code = "TEAM_MANAGEMENT_STORE_INVALID";

  constructor(message: string) {
    super(message);
    this.name = "TeamManagementStoreError";
  }
}
