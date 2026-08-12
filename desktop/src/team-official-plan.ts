import { createHash } from "node:crypto";

import {
  profileFingerprint,
  type ExecutionProfile,
  type ExecutionProfileBinding,
} from "./team-execution-profile.js";
import { parseTeamDefinitionJson } from "./team-model.js";

const RECOMMENDATION_FINGERPRINT_VERSION = "moebius-official-team-recommendations-v1";

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
  /**
   * Complete snapshot of the applied official baseline A (relative path -> UTF-8 text),
   * stored alongside the fingerprint so fast equality checks do not need to read content
   * and change-2 comparisons have A's full text. `null` when a legacy fingerprint-only
   * baseline was migrated as `conservative` (A's content is unknowable). Absent on legacy
   * documents until the one-time baseline migration ran.
   */
  appliedContentSnapshot?: Record<string, string> | null;
}

/**
 * Team content as a flat map of normalized relative paths to UTF-8 text. Only
 * text files participate (team.json + member files); binary attachments never
 * enter this snapshot.
 */
export type OfficialTeamContent = Readonly<Record<string, string>>;

export interface OfficialTeamContentEntry {
  relativePath: string;
  content: Uint8Array;
}

export interface PackagedOfficialTeamState {
  manifest: PackagedOfficialTeamManifestV1;
  contentFingerprint: string;
}

export type OfficialTeamCustomizationStatus = "clean" | "customized" | "unknown";

/**
 * Member-level delta between the applied official baseline A and the packaged
 * latest official version C. Shared by the auto-sync planner; the page only
 * consumes `customizationStatus` (see `deriveOfficialTeamCustomizationStatus`).
 */
export interface OfficialTeamMemberChanges {
  addedMembers: string[];
  removedMembers: string[];
  renamedMembers: Array<{ from: string; to: string }>;
  recommendationChangedMembers: string[];
  packagedRecommendations: Record<string, ExecutionProfile>;
  packagedRecommendationFingerprint: string;
  hasOfficialUpdate: boolean;
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

export function normalizeOfficialContentEntry(relativePath: string, content: Uint8Array): Uint8Array {
  if (relativePath !== "team.json") {
    return content;
  }
  const definition = parseTeamDefinitionJson(Buffer.from(content).toString("utf8"));
  return Buffer.from(JSON.stringify({
    name: definition.name,
    description: definition.description,
    primaryAgentSlug: definition.primaryAgentSlug,
    memberOrder: definition.memberOrder,
  }));
}

export const OFFICIAL_CONTENT_FINGERPRINT_VERSION = "moebius-official-team-content-v1";

/**
 * Pure fingerprint of a set of content entries. The filesystem-walking variant in
 * `team-official-management.ts` collects the entries; this function hashes them so
 * the migration planner can compute the fingerprint of an in-memory `OfficialTeamContent`
 * without touching disk.
 */
export function computeOfficialContentFingerprintFromEntries(
  entries: readonly OfficialTeamContentEntry[],
): string {
  const hash = createHash("sha256");
  hash.update(OFFICIAL_CONTENT_FINGERPRINT_VERSION);
  hash.update("\0");
  for (const entry of entries) {
    hash.update(entry.relativePath);
    hash.update("\0");
    const content = normalizeOfficialContentEntry(entry.relativePath, entry.content);
    hash.update(String(content.byteLength));
    hash.update("\0");
    hash.update(content);
    hash.update("\0");
  }
  return hash.digest("hex");
}

export function computeOfficialTeamContentFingerprintFromContent(
  content: OfficialTeamContent,
): string {
  return computeOfficialContentFingerprintFromEntries(
    Object.keys(content).sort(compareNames).map((relativePath) => ({
      relativePath,
      content: Buffer.from(content[relativePath]!, "utf8"),
    })),
  );
}

/**
 * Plans the one-time migration of a legacy fingerprint-only applied baseline.
 * When the current editable content's fingerprint equals the legacy fingerprint
 * the user never edited A, so A's content is back-filled from B and the baseline
 * becomes `verified`. Otherwise A's content is unknowable: the baseline becomes
 * `conservative` and no content is fabricated (the caller records a revision
 * starting point instead; no merge of any kind happens here).
 */
export function planAppliedBaselineMigration(input: {
  legacyFingerprint: string;
  currentContent: OfficialTeamContent;
}): { confidence: "verified" | "conservative"; backfillContent: OfficialTeamContent | null } {
  const fingerprint = computeOfficialTeamContentFingerprintFromContent(input.currentContent);
  return fingerprint === input.legacyFingerprint
    ? { confidence: "verified", backfillContent: input.currentContent }
    : { confidence: "conservative", backfillContent: null };
}

export function deriveOfficialTeamCustomizationStatus(input: {
  applied: AppliedOfficialTeamState;
  currentContentFingerprint: string | null;
}): OfficialTeamCustomizationStatus {
  if (input.currentContentFingerprint === null) return "unknown";
  return input.currentContentFingerprint === input.applied.appliedContentFingerprint
    ? "clean"
    : "customized";
}

/**
 * Computes the member-level delta between the applied baseline A and the
 * packaged latest official version C. Protection decisions (removed overrides,
 * user-member collisions) live in the auto-sync planner, which also consumes
 * these lists.
 */
export function computeOfficialTeamMemberChanges(input: {
  applied: AppliedOfficialTeamState;
  packaged: PackagedOfficialTeamState;
}): OfficialTeamMemberChanges {
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
  const packagedRecommendationFingerprint = recommendationFingerprint(packagedRecommendations);
  const hasOfficialUpdate =
    input.applied.appliedOfficialVersion !== input.packaged.manifest.officialVersion
    || input.applied.appliedContentFingerprint !== input.packaged.contentFingerprint
    || input.applied.appliedRecommendationFingerprint !== packagedRecommendationFingerprint;
  return {
    addedMembers,
    removedMembers,
    renamedMembers,
    recommendationChangedMembers,
    packagedRecommendations,
    packagedRecommendationFingerprint,
    hasOfficialUpdate,
  };
}

function normalizeManifestProfile(value: unknown): ExecutionProfile {
  if (!isPlainObject(value)) {
    throw new OfficialTeamManagementError("官方推荐运行配置无效。");
  }
  const { cli, model, effort } = value;
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

export class OfficialTeamManagementError extends Error {
  readonly code = "OFFICIAL_TEAM_MANAGEMENT_INVALID";

  constructor(message: string) {
    super(message);
    this.name = "OfficialTeamManagementError";
  }
}
