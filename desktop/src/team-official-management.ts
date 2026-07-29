import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

import {
  profileFingerprint,
  type ExecutionProfile,
  type ExecutionProfileBinding,
} from "./team-execution-profile.js";
import { TEAM_MANIFEST_FILE, parseTeamDefinitionJson } from "./team-model.js";

export const OFFICIAL_TEAM_MANIFEST_FILE = "official.json";

const CONTENT_FINGERPRINT_VERSION = "moebius-official-team-content-v1";
const RECOMMENDATION_FINGERPRINT_VERSION = "moebius-official-team-recommendations-v1";
const EXCLUDED_CONTENT_FILES = new Set([
  "onboarding-orchestration.json",
  OFFICIAL_TEAM_MANIFEST_FILE,
  ".teams-seed.marker",
]);

export interface PackagedOfficialMemberV1 {
  recommendedProfile: ExecutionProfile;
  renamedFrom?: string;
}

export interface PackagedOfficialTeamManifestV1 {
  schemaVersion: 1;
  officialVersion: string;
  members: Record<string, PackagedOfficialMemberV1>;
}

export interface AppliedOfficialTeamState {
  appliedOfficialVersion: string;
  appliedContentFingerprint: string;
  appliedRecommendationFingerprint: string;
  appliedRecommendations: Record<string, ExecutionProfile>;
  baselineConfidence: "verified" | "conservative";
}

export interface PackagedOfficialTeamState {
  manifest: PackagedOfficialTeamManifestV1;
  contentFingerprint: string;
}

export type OfficialTeamPrimaryAction =
  | "none"
  | "update"
  | "register"
  | "protect-and-update"
  | "retry";

export interface OfficialTeamUpdateState {
  currentOfficialVersion: string;
  latestOfficialVersion: string;
  customizationStatus: "clean" | "customized" | "unknown";
  updateStatus: "current" | "available" | "unknown";
  primaryAction: OfficialTeamPrimaryAction;
  requiresProtectiveCopy: boolean;
  addedMembers: string[];
  removedMembers: string[];
  renamedMembers: Array<{ from: string; to: string }>;
  recommendationChangedMembers: string[];
  protectedMembers: string[];
  collidingMembers: string[];
  reasonCode:
    | "CURRENT"
    | "CLEAN_UPDATE"
    | "CONTENT_ALREADY_LATEST"
    | "CUSTOMIZED_UPDATE"
    | "PROTECTED_MEMBER_REMOVAL"
    | "USER_MEMBER_COLLISION"
    | "CONSERVATIVE_BASELINE"
    | "COMPARISON_UNAVAILABLE";
}

export function parsePackagedOfficialTeamManifest(
  value: unknown,
): PackagedOfficialTeamManifestV1 {
  if (!isPlainObject(value) || value.schemaVersion !== 1) {
    throw new OfficialTeamManagementError("官方团队 manifest 版本不受支持。");
  }
  if (typeof value.officialVersion !== "string" || value.officialVersion.trim().length === 0) {
    throw new OfficialTeamManagementError("官方团队版本不能为空。");
  }
  if (!isPlainObject(value.members)) {
    throw new OfficialTeamManagementError("官方团队成员推荐配置无效。");
  }
  const members: Record<string, PackagedOfficialMemberV1> = {};
  for (const [slug, member] of Object.entries(value.members)) {
    if (!isValidStableSlug(slug) || !isPlainObject(member)) {
      throw new OfficialTeamManagementError(`官方团队成员 @${slug} 无效。`);
    }
    const recommendedProfile = normalizeManifestProfile(member.recommendedProfile);
    const renamedFrom = member.renamedFrom;
    if (renamedFrom !== undefined && (
      typeof renamedFrom !== "string" || !isValidStableSlug(renamedFrom)
    )) {
      throw new OfficialTeamManagementError(`官方团队成员 @${slug} 的 renamedFrom 无效。`);
    }
    members[slug] = {
      recommendedProfile,
      ...(renamedFrom === undefined ? {} : { renamedFrom }),
    };
  }
  return {
    schemaVersion: 1,
    officialVersion: value.officialVersion.trim(),
    members,
  };
}

export async function readPackagedOfficialTeamManifest(
  teamDirectory: string,
): Promise<PackagedOfficialTeamManifestV1> {
  const content = await fs.readFile(path.join(teamDirectory, OFFICIAL_TEAM_MANIFEST_FILE), "utf8");
  return parsePackagedOfficialTeamManifest(JSON.parse(content) as unknown);
}

export function recommendationFingerprint(
  recommendations: Readonly<Record<string, ExecutionProfile>>,
): string {
  const hash = createHash("sha256");
  hash.update(RECOMMENDATION_FINGERPRINT_VERSION);
  hash.update("\0");
  for (const slug of Object.keys(recommendations).sort(compareNames)) {
    hash.update(slug);
    hash.update("\0");
    hash.update(profileFingerprint(recommendations[slug]!));
    hash.update("\0");
  }
  return hash.digest("hex");
}

export function recommendationsFromManifest(
  manifest: PackagedOfficialTeamManifestV1,
): Record<string, ExecutionProfile> {
  return Object.fromEntries(Object.entries(manifest.members).map(([slug, member]) => [
    slug,
    member.recommendedProfile,
  ]));
}

export async function computeOfficialTeamContentFingerprint(
  teamDirectory: string,
): Promise<string> {
  const root = path.resolve(teamDirectory);
  const entries = await collectContentEntries(root);
  const hash = createHash("sha256");
  hash.update(CONTENT_FINGERPRINT_VERSION);
  hash.update("\0");
  for (const entry of entries) {
    hash.update(entry.relativePath);
    hash.update("\0");
    let content = await fs.readFile(entry.absolutePath);
    if (entry.relativePath === TEAM_MANIFEST_FILE) {
      const definition = parseTeamDefinitionJson(content.toString("utf8"));
      content = Buffer.from(JSON.stringify({
        name: definition.name,
        description: definition.description,
        primaryAgentSlug: definition.primaryAgentSlug,
        memberOrder: definition.memberOrder,
      }));
    }
    hash.update(String(content.byteLength));
    hash.update("\0");
    hash.update(content);
    hash.update("\0");
  }
  return hash.digest("hex");
}

export function deriveOfficialTeamUpdateState(input: {
  applied: AppliedOfficialTeamState;
  currentContentFingerprint: string | null;
  currentMemberSlugs: readonly string[];
  packaged: PackagedOfficialTeamState;
  bindings: Readonly<Record<string, ExecutionProfileBinding>>;
}): OfficialTeamUpdateState {
  const appliedSlugs = Object.keys(input.applied.appliedRecommendations);
  const packagedSlugs = Object.keys(input.packaged.manifest.members);
  const addedMembers = packagedSlugs.filter((slug) => !appliedSlugs.includes(slug)).sort(compareNames);
  const removedMembers = appliedSlugs.filter((slug) => !packagedSlugs.includes(slug)).sort(compareNames);
  const renamedMembers = Object.entries(input.packaged.manifest.members)
    .filter((entry): entry is [string, PackagedOfficialMemberV1 & { renamedFrom: string }] =>
      entry[1].renamedFrom !== undefined)
    .map(([to, member]) => ({ from: member.renamedFrom, to }))
    .sort((left, right) => compareNames(left.to, right.to));
  const packagedRecommendations = recommendationsFromManifest(input.packaged.manifest);
  const recommendationChangedMembers = packagedSlugs.filter((slug) =>
    !Object.hasOwn(input.applied.appliedRecommendations, slug)
      || profileFingerprint(input.applied.appliedRecommendations[slug]!)
        !== profileFingerprint(packagedRecommendations[slug]!))
    .sort(compareNames);
  const protectedMembers = removedMembers.filter((slug) => {
    const binding = input.bindings[slug];
    return binding?.source === "override";
  });
  const currentMemberSet = new Set(input.currentMemberSlugs);
  const appliedMemberSet = new Set(appliedSlugs);
  const collidingMembers = addedMembers.filter((slug) =>
    currentMemberSet.has(slug) && !appliedMemberSet.has(slug));
  const packagedRecommendationFingerprint = recommendationFingerprint(packagedRecommendations);
  const hasOfficialUpdate =
    input.applied.appliedOfficialVersion !== input.packaged.manifest.officialVersion
    || input.applied.appliedContentFingerprint !== input.packaged.contentFingerprint
    || input.applied.appliedRecommendationFingerprint !== packagedRecommendationFingerprint;

  if (input.currentContentFingerprint === null) {
    return makeState({
      customizationStatus: "unknown",
      updateStatus: "unknown",
      primaryAction: "retry",
      reasonCode: "COMPARISON_UNAVAILABLE",
    });
  }

  const customized = input.currentContentFingerprint !== input.applied.appliedContentFingerprint;
  const contentAlreadyLatest = input.currentContentFingerprint === input.packaged.contentFingerprint;
  const conservative = input.applied.baselineConfidence === "conservative";
  const protectionReason =
    protectedMembers.length > 0
      ? "PROTECTED_MEMBER_REMOVAL"
      : collidingMembers.length > 0
        ? "USER_MEMBER_COLLISION"
        : conservative
          ? "CONSERVATIVE_BASELINE"
          : null;
  const divergentCustomization = customized && !contentAlreadyLatest;
  const requiresProtectiveCopy = hasOfficialUpdate && (
    protectionReason !== null || divergentCustomization
  );

  if (!hasOfficialUpdate) {
    return makeState({
      customizationStatus: customized ? "customized" : "clean",
      updateStatus: "current",
      primaryAction: "none",
      reasonCode: "CURRENT",
    });
  }
  if (requiresProtectiveCopy) {
    return makeState({
      customizationStatus: customized ? "customized" : "clean",
      updateStatus: "available",
      primaryAction: "protect-and-update",
      requiresProtectiveCopy: true,
      reasonCode: protectionReason ?? "CUSTOMIZED_UPDATE",
    });
  }
  if (contentAlreadyLatest && customized) {
    return makeState({
      customizationStatus: customized ? "customized" : "clean",
      updateStatus: "available",
      primaryAction: "register",
      reasonCode: "CONTENT_ALREADY_LATEST",
    });
  }
  return makeState({
    customizationStatus: "clean",
    updateStatus: "available",
    primaryAction: "update",
    reasonCode: "CLEAN_UPDATE",
  });

  function makeState(overrides: Partial<OfficialTeamUpdateState> & Pick<
    OfficialTeamUpdateState,
    "customizationStatus" | "updateStatus" | "primaryAction" | "reasonCode"
  >): OfficialTeamUpdateState {
    return {
      currentOfficialVersion: input.applied.appliedOfficialVersion,
      latestOfficialVersion: input.packaged.manifest.officialVersion,
      customizationStatus: overrides.customizationStatus,
      updateStatus: overrides.updateStatus,
      primaryAction: overrides.primaryAction,
      requiresProtectiveCopy: overrides.requiresProtectiveCopy ?? false,
      addedMembers,
      removedMembers,
      renamedMembers,
      recommendationChangedMembers,
      protectedMembers,
      collidingMembers,
      reasonCode: overrides.reasonCode,
    };
  }
}

export class OfficialTeamManagementError extends Error {
  readonly code = "OFFICIAL_TEAM_MANAGEMENT_INVALID";

  constructor(message: string) {
    super(message);
    this.name = "OfficialTeamManagementError";
  }
}

interface ContentEntry {
  absolutePath: string;
  relativePath: string;
}

async function collectContentEntries(root: string, current = root): Promise<ContentEntry[]> {
  const directoryEntries = await fs.readdir(current, { withFileTypes: true });
  const collected: ContentEntry[] = [];
  for (const entry of directoryEntries.sort((left, right) => compareNames(left.name, right.name))) {
    const absolutePath = path.join(current, entry.name);
    const relativePath = path.relative(root, absolutePath).split(path.sep).join("/");
    const topLevel = relativePath.split("/")[0];
    if (topLevel !== undefined && EXCLUDED_CONTENT_FILES.has(topLevel)) {
      continue;
    }
    if (entry.isSymbolicLink()) {
      throw new OfficialTeamManagementError(`官方团队包含不支持的符号链接：${relativePath}`);
    }
    if (entry.isDirectory()) {
      collected.push(...await collectContentEntries(root, absolutePath));
      continue;
    }
    if (!entry.isFile()) {
      throw new OfficialTeamManagementError(`官方团队包含不支持的文件类型：${relativePath}`);
    }
    collected.push({ absolutePath, relativePath });
  }
  return collected.sort((left, right) => compareNames(left.relativePath, right.relativePath));
}

function normalizeManifestProfile(value: unknown): ExecutionProfile {
  if (!isPlainObject(value)) {
    throw new OfficialTeamManagementError("官方推荐运行配置无效。");
  }
  const cli = value.cli;
  const model = value.model;
  const effort = value.effort;
  if (
    (cli !== "codex" && cli !== "claude" && cli !== "kimi")
    || typeof model !== "string"
    || model.trim().length === 0
    || typeof effort !== "string"
    || effort.trim().length === 0
  ) {
    throw new OfficialTeamManagementError("官方推荐运行配置无效。");
  }
  return { cli, model: model.trim(), effort: effort.trim() };
}

function isValidStableSlug(value: string): boolean {
  return /^[a-z0-9](?:[a-z0-9-]{0,62})$/u.test(value);
}

function compareNames(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
