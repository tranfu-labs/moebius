import { createHash } from "node:crypto";

export type ExecutionCli = "codex" | "kimi";

export interface ExecutionProfile {
  cli: ExecutionCli;
  model: string;
  effort: string;
}

export type ExecutionProfileBinding =
  | { source: "recommended" }
  | { source: "override" | "explicit"; profile: ExecutionProfile };

export interface ExecutionCapabilityModel {
  id: string;
  displayName: string;
  efforts: string[];
  defaultEffort: string | null;
}

export interface ExecutionCapabilitySnapshot {
  cli: ExecutionCli;
  cliVersion: string | null;
  status: "available" | "missing" | "unavailable";
  models: ExecutionCapabilityModel[];
  snapshotId: string;
  checkedAt: string;
  reason?: string;
  failureCode?: ExecutionCapabilityFailureCode;
}

export type ExecutionCapabilityFailureCode =
  | "CLI_MISSING"
  | "CLI_UNAVAILABLE"
  | "AUTHENTICATION_REQUIRED"
  | "CAPABILITY_TIMEOUT"
  | "CAPABILITY_PROTOCOL_UNAVAILABLE";

export type ExecutionProfileStatus =
  | { status: "available"; profile: ExecutionProfile }
  | { status: "unable-to-verify"; profile: ExecutionProfile; reason: string }
  | { status: "needs-adjustment"; profile: ExecutionProfile; reason: string };

export function normalizeExecutionProfile(value: unknown): ExecutionProfile {
  if (!isPlainObject(value)) {
    throw new ExecutionProfileError("CLI 必须是 Codex 或 Kimi。");
  }
  const cli = typeof value.cli === "string" ? value.cli.trim() : "";
  if (cli !== "codex" && cli !== "kimi") {
    throw new ExecutionProfileError("CLI 必须是 Codex 或 Kimi。");
  }
  if (typeof value.model !== "string" || value.model.trim().length === 0) {
    throw new ExecutionProfileError("Model 不能为空。");
  }
  if (typeof value.effort !== "string" || value.effort.trim().length === 0) {
    throw new ExecutionProfileError("思考程度不能为空。");
  }
  return {
    cli,
    model: value.model.trim(),
    effort: value.effort.trim(),
  };
}

export function profileFingerprint(profile: ExecutionProfile): string {
  return createHash("sha256")
    .update("moebius-execution-profile-v1\0")
    .update(profile.cli)
    .update("\0")
    .update(profile.model)
    .update("\0")
    .update(profile.effort)
    .digest("hex");
}

export function capabilitySnapshotId(input: {
  cli: ExecutionCli;
  cliVersion: string | null;
  status: ExecutionCapabilitySnapshot["status"];
  models: readonly ExecutionCapabilityModel[];
  failureCode?: ExecutionCapabilityFailureCode;
}): string {
  const hash = createHash("sha256");
  hash.update("moebius-execution-capability-v1\0");
  hash.update(JSON.stringify({
    cli: input.cli,
    cliVersion: input.cliVersion,
    status: input.status,
    failureCode: input.failureCode ?? null,
    models: [...input.models]
      .map((model) => ({
        id: model.id,
        displayName: model.displayName,
        efforts: [...new Set(model.efforts)].sort(),
        defaultEffort: model.defaultEffort,
      }))
      .sort((left, right) => left.id.localeCompare(right.id)),
  }));
  return hash.digest("hex");
}

export function resolveEffectiveExecutionProfile(input: {
  binding: ExecutionProfileBinding;
  recommendation?: ExecutionProfile;
}): ExecutionProfile {
  if (input.binding.source !== "recommended") {
    return normalizeExecutionProfile(input.binding.profile);
  }
  if (input.recommendation === undefined) {
    throw new ExecutionProfileError("这个 Agent 没有可用的官方推荐运行配置。");
  }
  return normalizeExecutionProfile(input.recommendation);
}

export function evaluateExecutionProfile(
  profile: ExecutionProfile,
  capability: ExecutionCapabilitySnapshot | undefined,
): ExecutionProfileStatus {
  if (capability === undefined || capability.status !== "available") {
    return {
      status: "unable-to-verify",
      profile,
      reason: capability?.reason ?? "暂时无法读取这套 CLI 的模型能力。",
    };
  }
  if (capability.cli !== profile.cli) {
    return {
      status: "needs-adjustment",
      profile,
      reason: "保存的 CLI 与当前能力快照不一致。",
    };
  }
  const model = capability.models.find((candidate) => candidate.id === profile.model);
  if (model === undefined) {
    return {
      status: "needs-adjustment",
      profile,
      reason: "已保存的模型当前不可用。",
    };
  }
  if (!model.efforts.includes(profile.effort)) {
    return {
      status: "needs-adjustment",
      profile,
      reason: "已保存的思考程度当前不可用。",
    };
  }
  return { status: "available", profile };
}

export function migrateOfficialMemberBindings(input: {
  previousMembers: Readonly<Record<string, ExecutionProfile>>;
  nextMembers: Readonly<Record<string, ExecutionProfile>>;
  bindings: Readonly<Record<string, ExecutionProfileBinding>>;
}): {
  nextBindings: Record<string, ExecutionProfileBinding>;
  removedOverrides: Record<string, ExecutionProfile>;
} {
  const nextBindings: Record<string, ExecutionProfileBinding> = {};
  const removedOverrides: Record<string, ExecutionProfile> = {};

  for (const [slug, recommendation] of Object.entries(input.nextMembers)) {
    const previous = input.bindings[slug];
    if (Object.hasOwn(input.previousMembers, slug) && previous !== undefined) {
      nextBindings[slug] = previous.source === "recommended"
        ? { source: "recommended" }
        : { source: previous.source, profile: normalizeExecutionProfile(previous.profile) };
      continue;
    }
    nextBindings[slug] = { source: "recommended" };
    normalizeExecutionProfile(recommendation);
  }

  for (const [slug, binding] of Object.entries(input.bindings)) {
    if (Object.hasOwn(input.nextMembers, slug) || binding.source === "recommended") {
      continue;
    }
    removedOverrides[slug] = normalizeExecutionProfile(binding.profile);
  }

  return { nextBindings, removedOverrides };
}

export function materializeExplicitBindings(input: {
  memberSlugs: readonly string[];
  bindings: Readonly<Record<string, ExecutionProfileBinding>>;
  recommendations: Readonly<Record<string, ExecutionProfile>>;
}): Record<string, ExecutionProfileBinding> {
  return Object.fromEntries(input.memberSlugs.map((slug) => {
    const binding = input.bindings[slug];
    if (binding === undefined) {
      throw new ExecutionProfileError(`Agent @${slug} 没有已保存的运行配置。`);
    }
    const profile = resolveEffectiveExecutionProfile({
      binding,
      recommendation: input.recommendations[slug],
    });
    return [slug, { source: "explicit", profile }];
  }));
}

export class ExecutionProfileError extends Error {
  readonly code = "EXECUTION_PROFILE_INVALID";

  constructor(message: string) {
    super(message);
    this.name = "ExecutionProfileError";
  }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
