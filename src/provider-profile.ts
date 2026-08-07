import { createHash } from "node:crypto";

export const DEEPSEEK_PROVIDER_ID = "deepseek" as const;
export const DEEPSEEK_BASE_URL = "https://api.deepseek.com" as const;

export type ProviderId = typeof DEEPSEEK_PROVIDER_ID;
export type PiEffort = "high" | "max";
export type DeepSeekModelId = "deepseek-v4-flash" | "deepseek-v4-pro";

export interface ProviderCatalogModel {
  id: DeepSeekModelId;
  displayName: string;
  efforts: readonly PiEffort[];
  defaultEffort: PiEffort;
}

export interface ProviderCatalogEntry {
  id: ProviderId;
  displayName: string;
  baseUrl: typeof DEEPSEEK_BASE_URL;
  protocol: "openai-chat-completions";
  models: readonly ProviderCatalogModel[];
}

export const PROVIDER_CATALOG_REVISION = 1;

export const PROVIDER_CATALOG: readonly ProviderCatalogEntry[] = Object.freeze([
  Object.freeze({
    id: DEEPSEEK_PROVIDER_ID,
    displayName: "DeepSeek",
    baseUrl: DEEPSEEK_BASE_URL,
    protocol: "openai-chat-completions" as const,
    models: Object.freeze([
      Object.freeze({
        id: "deepseek-v4-flash" as const,
        displayName: "DeepSeek V4 Flash",
        efforts: Object.freeze(["high", "max"] as const),
        defaultEffort: "high" as const,
      }),
      Object.freeze({
        id: "deepseek-v4-pro" as const,
        displayName: "DeepSeek V4 Pro",
        efforts: Object.freeze(["high", "max"] as const),
        defaultEffort: "high" as const,
      }),
    ]),
  }),
]);

export type ProviderReadiness = "ready" | "needs-attention" | "disabled";

export type SafeProviderReason =
  | "credential-unavailable"
  | "credential-invalid"
  | "provider-removed"
  | "model-removed"
  | "model-incompatible"
  | "quota"
  | "rate-limited"
  | "network"
  | "provider-unavailable"
  | "local-save-failed";

export interface ProviderProfile {
  id: string;
  providerId: ProviderId;
  displayName: string;
  credentialRef: string;
  keySuffix: string;
  defaultModel: DeepSeekModelId | null;
  verifiedModels: DeepSeekModelId[];
  readiness: ProviderReadiness;
  reason: SafeProviderReason | null;
  catalogRevision: number;
  revision: number;
  createdAt: string;
  updatedAt: string;
}

export type ProviderOperationKind =
  | "create"
  | "rotate-key"
  | "enable"
  | "add-model"
  | "set-default-model"
  | "remove-model"
  | "migrate"
  | "delete";

export type ProviderOperationStatus =
  | "validating"
  | "saving"
  | "migrating"
  | "deleting"
  | "completed"
  | "failed"
  | "cancelled";

export interface ProviderOperation {
  id: string;
  profileId: string;
  kind: ProviderOperationKind;
  status: ProviderOperationStatus;
  baseRevision: number | null;
  targetModels: DeepSeekModelId[];
  completedTargets: string[];
  /** The destination profile for a reference migration; omitted for legacy operations and end actions. */
  targetProfileId?: string | null;
  /** The complete set of reference owner ids selected for a migration/end operation. */
  targetOwnerIds?: string[];
  safeReason: SafeProviderReason | null;
  startedAt: string;
  updatedAt: string;
}

export type ProviderReferenceKind =
  | "team-member"
  | "team-builder-draft"
  | "queued-task"
  | "resumable-session"
  | "single-run";

export interface ProviderReference {
  kind: ProviderReferenceKind;
  ownerId: string;
  label: string;
  profileId: string;
  model: DeepSeekModelId;
}

export interface ProviderTeamReferenceGroup {
  ownership: "system" | "user";
  teamId: string;
  memberSlugs: string[];
  ownerIds: string[];
}

export function planProviderTeamReferenceGroups(
  references: readonly ProviderReference[],
): ProviderTeamReferenceGroup[] {
  const groups = new Map<string, ProviderTeamReferenceGroup>();
  for (const reference of references.filter((candidate) => candidate.kind === "team-member")) {
    const owner = parseProviderTeamReferenceOwner(reference.ownerId);
    const key = `${owner.ownership}\0${owner.teamId}`;
    const group = groups.get(key) ?? {
      ownership: owner.ownership,
      teamId: owner.teamId,
      memberSlugs: [],
      ownerIds: [],
    };
    group.memberSlugs.push(owner.memberSlug);
    group.ownerIds.push(reference.ownerId);
    groups.set(key, group);
  }
  return [...groups.values()];
}

export function parseProviderTeamReferenceOwner(ownerId: string): {
  ownership: "system" | "user";
  teamId: string;
  memberSlug: string;
} {
  const value = parseProviderReferenceIdentity(ownerId, "team");
  const [ownership, teamId, memberSlug] = value;
  if ((ownership !== "system" && ownership !== "user") || !teamId || !memberSlug || value.length !== 3) {
    throw new ProviderProfileError("PROVIDER_PROFILE_INVALID", "团队引用身份无效。");
  }
  return { ownership, teamId, memberSlug };
}

export function formatProviderTeamReferenceOwner(input: {
  ownership: "system" | "user";
  teamId: string;
  memberSlug: string;
}): string {
  return `team:${JSON.stringify([input.ownership, input.teamId, input.memberSlug])}`;
}

export function parseProviderSessionReferenceOwner(ownerId: string): {
  sessionId: string;
  slot: "effective" | "pending";
  memberName: string;
} {
  const value = parseProviderReferenceIdentity(ownerId, "session");
  const [sessionId, slot, memberName] = value;
  if (!sessionId || (slot !== "effective" && slot !== "pending") || !memberName || value.length !== 3) {
    throw new ProviderProfileError("PROVIDER_PROFILE_INVALID", "会话引用身份无效。");
  }
  return { sessionId, slot, memberName };
}

export function parseEffectiveProviderSessionReferenceOwner(ownerId: string): {
  sessionId: string;
  memberName: string;
} {
  const owner = parseProviderSessionReferenceOwner(ownerId);
  if (owner.slot !== "effective") {
    throw new ProviderProfileError("PROVIDER_PROFILE_INVALID", "只有可恢复会话引用可以执行该操作。");
  }
  return { sessionId: owner.sessionId, memberName: owner.memberName };
}

export function formatProviderSessionReferenceOwner(input: {
  sessionId: string;
  slot: "effective" | "pending";
  memberName: string;
}): string {
  return `session:${JSON.stringify([input.sessionId, input.slot, input.memberName])}`;
}

function parseProviderReferenceIdentity(ownerId: string, kind: "team" | "session"): string[] {
  if (!ownerId.startsWith(`${kind}:`)) {
    throw new ProviderProfileError("PROVIDER_PROFILE_INVALID", "运行引用身份无效。");
  }
  let value: unknown;
  try {
    value = JSON.parse(ownerId.slice(kind.length + 1)) as unknown;
  } catch {
    throw new ProviderProfileError("PROVIDER_PROFILE_INVALID", "运行引用身份无效。");
  }
  if (!Array.isArray(value) || !value.every((item) => typeof item === "string")) {
    throw new ProviderProfileError("PROVIDER_PROFILE_INVALID", "运行引用身份无效。");
  }
  return value;
}

export interface ProviderProfileDraft {
  id: string;
  providerId: ProviderId;
  displayName: string;
  credentialRef: string;
  keySuffix: string;
  defaultModel: DeepSeekModelId;
  verifiedModels: DeepSeekModelId[];
  now: string;
}

export function getProviderCatalogEntry(providerId: string): ProviderCatalogEntry | null {
  return PROVIDER_CATALOG.find((entry) => entry.id === providerId) ?? null;
}

export function getProviderCatalogModel(
  providerId: string,
  modelId: string,
): ProviderCatalogModel | null {
  return getProviderCatalogEntry(providerId)?.models.find((model) => model.id === modelId) ?? null;
}

export function normalizeProviderModel(providerId: string, modelId: unknown): DeepSeekModelId {
  const value = typeof modelId === "string" ? modelId.trim() : "";
  const model = getProviderCatalogModel(providerId, value);
  if (model === null) {
    throw new ProviderProfileError("PROVIDER_MODEL_UNSUPPORTED", "请选择服务商目录中的模型。");
  }
  return model.id;
}

export function normalizeProviderProfile(value: unknown): ProviderProfile {
  if (!isRecord(value)) {
    throw new ProviderProfileError("PROVIDER_PROFILE_INVALID", "AI 服务商档案无效。");
  }
  const providerId = readProviderId(value.providerId);
  const verifiedModels = uniqueModels(providerId, value.verifiedModels);
  const defaultModel = value.defaultModel === null
    ? null
    : normalizeProviderModel(providerId, value.defaultModel);
  if (defaultModel !== null && !verifiedModels.includes(defaultModel)) {
    throw new ProviderProfileError("PROVIDER_DEFAULT_MODEL_INVALID", "默认模型必须已经验证。");
  }
  const readiness = readReadiness(value.readiness);
  if (readiness === "ready" && verifiedModels.length === 0) {
    throw new ProviderProfileError("PROVIDER_PROFILE_INVALID", "已就绪档案至少需要一个已验证模型。");
  }
  return {
    id: readNonEmpty(value.id, "档案 ID"),
    providerId,
    displayName: readNonEmpty(value.displayName, "档案名称"),
    credentialRef: readNonEmpty(value.credentialRef, "凭据引用"),
    keySuffix: normalizeKeySuffix(value.keySuffix),
    defaultModel,
    verifiedModels,
    readiness,
    reason: readSafeReason(value.reason),
    catalogRevision: readPositiveInteger(value.catalogRevision, "目录版本"),
    revision: readPositiveInteger(value.revision, "档案版本"),
    createdAt: readIsoDate(value.createdAt, "创建时间"),
    updatedAt: readIsoDate(value.updatedAt, "更新时间"),
  };
}

export function createReadyProviderProfile(draft: ProviderProfileDraft): ProviderProfile {
  const providerId = readProviderId(draft.providerId);
  const verifiedModels = uniqueModels(providerId, draft.verifiedModels);
  const defaultModel = normalizeProviderModel(providerId, draft.defaultModel);
  if (!verifiedModels.includes(defaultModel)) {
    throw new ProviderProfileError("PROVIDER_DEFAULT_MODEL_INVALID", "默认模型必须包含在验证结果中。");
  }
  return normalizeProviderProfile({
    id: draft.id,
    providerId,
    displayName: draft.displayName,
    credentialRef: draft.credentialRef,
    keySuffix: draft.keySuffix,
    defaultModel,
    verifiedModels,
    readiness: "ready",
    reason: null,
    catalogRevision: PROVIDER_CATALOG_REVISION,
    revision: 1,
    createdAt: draft.now,
    updatedAt: draft.now,
  });
}

export function rotateProviderProfile(
  current: ProviderProfile,
  input: { credentialRef: string; keySuffix: string; validatedModels: readonly string[]; now: string },
): ProviderProfile {
  const normalized = normalizeProviderProfile(current);
  const validatedModels = uniqueModels(normalized.providerId, input.validatedModels);
  if (!sameModelSet(validatedModels, normalized.verifiedModels)) {
    throw new ProviderProfileError(
      "PROVIDER_ROTATION_INCOMPLETE",
      "新 Key 必须通过档案全部已验证模型后才能替换。",
    );
  }
  return normalizeProviderProfile({
    ...normalized,
    credentialRef: input.credentialRef,
    keySuffix: input.keySuffix,
    readiness: "ready",
    reason: null,
    revision: normalized.revision + 1,
    updatedAt: input.now,
  });
}

export function classifyProviderFailure(input: {
  current: ProviderReadiness;
  reason: SafeProviderReason;
  duringEnable?: boolean;
}): Pick<ProviderProfile, "readiness" | "reason"> {
  const configurationFailure = input.reason === "credential-unavailable"
    || input.reason === "credential-invalid"
    || input.reason === "provider-removed"
    || input.reason === "model-removed"
    || input.reason === "model-incompatible";
  if (configurationFailure) {
    return { readiness: "needs-attention", reason: input.reason };
  }
  if (input.duringEnable || input.current === "disabled") {
    return { readiness: "disabled", reason: input.reason };
  }
  return { readiness: input.current, reason: input.reason };
}

export function planProviderRuntimeFailureReason(code: string): SafeProviderReason | null {
  switch (code) {
    case "auth": return "credential-invalid";
    case "model-unavailable":
    case "model-incompatible": return "model-incompatible";
    case "rate-limited": return "rate-limited";
    case "quota": return "quota";
    case "network": return "network";
    case "provider-unavailable": return "provider-unavailable";
    default: return null;
  }
}

export function removeVerifiedModel(
  current: ProviderProfile,
  modelId: string,
  references: readonly ProviderReference[],
  now: string,
): ProviderProfile {
  const normalized = normalizeProviderProfile(current);
  const model = normalizeProviderModel(normalized.providerId, modelId);
  const blockers = references.filter((reference) =>
    reference.profileId === normalized.id && reference.model === model
  );
  if (blockers.length > 0) {
    throw new ProviderReferenceError(blockers);
  }
  const verifiedModels = normalized.verifiedModels.filter((candidate) => candidate !== model);
  return normalizeProviderProfile({
    ...normalized,
    verifiedModels,
    defaultModel: normalized.defaultModel === model ? null : normalized.defaultModel,
    readiness: verifiedModels.length === 0 ? "needs-attention" : normalized.readiness,
    reason: verifiedModels.length === 0 ? "model-removed" : normalized.reason,
    revision: normalized.revision + 1,
    updatedAt: now,
  });
}

export function providerProfileFingerprint(input: {
  providerProfileId: string;
  providerId: ProviderId;
  model: DeepSeekModelId;
  effort: PiEffort;
}): string {
  return createHash("sha256")
    .update("moebius-pi-execution-profile-v2\0")
    .update(input.providerProfileId)
    .update("\0")
    .update(input.providerId)
    .update("\0")
    .update(input.model)
    .update("\0")
    .update(input.effort)
    .digest("hex");
}

export function keySuffix(apiKey: string): string {
  const trimmed = apiKey.trim();
  if (trimmed.length < 8) {
    throw new ProviderProfileError("PROVIDER_KEY_INVALID", "API Key 长度无效。");
  }
  return trimmed.slice(-4);
}

export class ProviderProfileError extends Error {
  constructor(
    readonly code:
      | "PROVIDER_PROFILE_INVALID"
      | "PROVIDER_ID_UNSUPPORTED"
      | "PROVIDER_MODEL_UNSUPPORTED"
      | "PROVIDER_DEFAULT_MODEL_INVALID"
      | "PROVIDER_ROTATION_INCOMPLETE"
      | "PROVIDER_KEY_INVALID",
    message: string,
  ) {
    super(message);
    this.name = "ProviderProfileError";
  }
}

export class ProviderReferenceError extends Error {
  readonly code = "PROVIDER_MODEL_REFERENCED";

  constructor(readonly references: readonly ProviderReference[]) {
    super("这个模型仍被团队、草稿、任务或可恢复会话使用，请先迁移或结束引用。");
    this.name = "ProviderReferenceError";
  }
}

function readProviderId(value: unknown): ProviderId {
  if (value !== DEEPSEEK_PROVIDER_ID) {
    throw new ProviderProfileError("PROVIDER_ID_UNSUPPORTED", "请选择服务商目录中的服务商。");
  }
  return value;
}

function uniqueModels(providerId: ProviderId, value: unknown): DeepSeekModelId[] {
  if (!Array.isArray(value)) {
    throw new ProviderProfileError("PROVIDER_PROFILE_INVALID", "已验证模型集合无效。");
  }
  return [...new Set(value.map((model) => normalizeProviderModel(providerId, model)))];
}

function sameModelSet(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length
    && [...left].sort().every((value, index) => value === [...right].sort()[index]);
}

function readReadiness(value: unknown): ProviderReadiness {
  if (value === "ready" || value === "needs-attention" || value === "disabled") {
    return value;
  }
  throw new ProviderProfileError("PROVIDER_PROFILE_INVALID", "档案状态无效。");
}

function readSafeReason(value: unknown): SafeProviderReason | null {
  if (value === null) {
    return null;
  }
  const reasons: readonly SafeProviderReason[] = [
    "credential-unavailable",
    "credential-invalid",
    "provider-removed",
    "model-removed",
    "model-incompatible",
    "quota",
    "rate-limited",
    "network",
    "provider-unavailable",
    "local-save-failed",
  ];
  if (typeof value === "string" && reasons.includes(value as SafeProviderReason)) {
    return value as SafeProviderReason;
  }
  throw new ProviderProfileError("PROVIDER_PROFILE_INVALID", "档案原因无效。");
}

function normalizeKeySuffix(value: unknown): string {
  if (typeof value !== "string" || !/^[^\s]{4}$/u.test(value)) {
    throw new ProviderProfileError("PROVIDER_PROFILE_INVALID", "Key 脱敏尾号无效。");
  }
  return value;
}

function readPositiveInteger(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 1) {
    throw new ProviderProfileError("PROVIDER_PROFILE_INVALID", `${label}无效。`);
  }
  return value;
}

function readIsoDate(value: unknown, label: string): string {
  const stringValue = readNonEmpty(value, label);
  if (!Number.isFinite(Date.parse(stringValue))) {
    throw new ProviderProfileError("PROVIDER_PROFILE_INVALID", `${label}无效。`);
  }
  return stringValue;
}

function readNonEmpty(value: unknown, label: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new ProviderProfileError("PROVIDER_PROFILE_INVALID", `${label}不能为空。`);
  }
  return value.trim();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
