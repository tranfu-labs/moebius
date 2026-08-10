import fs from "node:fs/promises";
import path from "node:path";

import {
  computeOfficialContentFingerprintFromEntries,
  OfficialTeamManagementError,
  parsePackagedOfficialTeamManifest,
  planAppliedBaselineMigration,
  type OfficialTeamContent,
  type OfficialTeamContentEntry,
  type PackagedOfficialTeamManifestV1,
} from "./team-official-plan.js";
import {
  TEAM_AGENT_FILE,
  isValidPathSegment,
} from "./team-model.js";
import { resolveTeamLocation } from "./team-store.js";
import {
  readOfficialTeamStateDocument,
  writeOfficialTeamStateDocument,
} from "./team-management-store.js";
import type { AgentRevisionStore } from "./agent-revision-store.js";

export {
  computeOfficialContentFingerprintFromEntries,
  deriveOfficialTeamUpdateState,
  OfficialTeamManagementError,
  parsePackagedOfficialTeamManifest,
  planAppliedBaselineMigration,
  recommendationFingerprint,
  recommendationsFromManifest,
} from "./team-official-plan.js";
export type {
  AppliedOfficialTeamState,
  OfficialTeamPrimaryAction,
  OfficialTeamUpdateState,
  OfficialTeamContent,
  PackagedOfficialMemberV1,
  PackagedOfficialTeamManifestV1,
  PackagedOfficialTeamState,
} from "./team-official-plan.js";

export const OFFICIAL_TEAM_MANIFEST_FILE = "official.json";

const EXCLUDED_CONTENT_FILES = new Set([
  "onboarding-orchestration.json",
  OFFICIAL_TEAM_MANIFEST_FILE,
  ".teams-seed.marker",
]);

export async function readPackagedOfficialTeamManifest(
  teamDirectory: string,
): Promise<PackagedOfficialTeamManifestV1> {
  const content = await fs.readFile(path.join(teamDirectory, OFFICIAL_TEAM_MANIFEST_FILE), "utf8");
  return parsePackagedOfficialTeamManifest(JSON.parse(content) as unknown);
}

export async function computeOfficialTeamContentFingerprint(
  teamDirectory: string,
): Promise<string> {
  const root = path.resolve(teamDirectory);
  const entries = await collectContentEntries(root);
  const withContent: OfficialTeamContentEntry[] = [];
  for (const entry of entries) {
    withContent.push({
      relativePath: entry.relativePath,
      content: await fs.readFile(entry.absolutePath),
    });
  }
  return computeOfficialContentFingerprintFromEntries(withContent);
}

/**
 * One-time migration of legacy fingerprint-only applied baselines to the
 * content-bearing structure. For each team whose state still lacks
 * `appliedContentSnapshot`:
 * - fingerprint equal (user never edited A) → back-fill A's snapshot from the
 *   current content and mark `verified`;
 * - fingerprint differs (A unknowable) → mark `conservative`, keep no snapshot,
 *   and record one `user`-authored revision per member capturing the current
 *   content as the member timeline's starting point (skipped for members that
 *   already have revisions, which makes re-runs after a crash idempotent).
 * The document is written atomically at the end; any failure leaves the old
 * document untouched. No merge and no one-time merge entry point exist here.
 */
export async function migrateOfficialTeamBaselines(input: {
  dataRoot: string;
  revisionStore: Pick<AgentRevisionStore, "listRevisions" | "createRevision">;
  now?: string;
}): Promise<{ migratedTeamIds: string[] }> {
  const now = input.now ?? new Date().toISOString();
  const document = await readOfficialTeamStateDocument(input.dataRoot);
  const legacyTeamIds = Object.entries(document.teams)
    .filter(([, state]) => !Object.hasOwn(state, "appliedContentSnapshot"))
    .map(([teamId]) => teamId);
  if (legacyTeamIds.length === 0) {
    return { migratedTeamIds: [] };
  }
  const migratedTeamIds: string[] = [];
  for (const teamId of legacyTeamIds) {
    const legacy = document.teams[teamId]!;
    const currentContent = await readOfficialTeamContent(input.dataRoot, teamId);
    const plan = planAppliedBaselineMigration({
      legacyFingerprint: legacy.appliedContentFingerprint,
      currentContent,
    });
    if (plan.confidence === "conservative") {
      await recordConservativeBaselineStartingRevisions({
        teamId,
        currentContent,
        revisionStore: input.revisionStore,
        now,
      });
    }
    document.teams[teamId] = {
      ...legacy,
      baselineConfidence: plan.confidence,
      appliedContentSnapshot: plan.backfillContent,
    };
    migratedTeamIds.push(teamId);
  }
  await writeOfficialTeamStateDocument(input.dataRoot, document);
  return { migratedTeamIds };
}

async function readOfficialTeamContent(
  dataRoot: string,
  teamId: string,
): Promise<OfficialTeamContent> {
  const location = resolveTeamLocation({ dataRoot, teamId, ownership: "system" });
  const entries = await collectContentEntries(location.directory);
  const content: Record<string, string> = {};
  for (const entry of entries) {
    const raw = await fs.readFile(entry.absolutePath);
    const text = raw.toString("utf8");
    // Only lossless UTF-8 text enters the snapshot. A binary file makes the
    // planner's fingerprint differ from the legacy fingerprint, which lands the
    // migration on `conservative` — the safe direction (no fabricated A).
    if (Buffer.from(text, "utf8").equals(raw)) {
      content[entry.relativePath] = text;
    }
  }
  return content;
}

async function recordConservativeBaselineStartingRevisions(input: {
  teamId: string;
  currentContent: OfficialTeamContent;
  revisionStore: Pick<AgentRevisionStore, "listRevisions" | "createRevision">;
  now: string;
}): Promise<void> {
  const memberSlugs = collectMemberSlugs(input.currentContent);
  for (const memberSlug of memberSlugs) {
    const existing = await input.revisionStore.listRevisions(input.teamId, memberSlug);
    if (existing.length > 0) {
      continue;
    }
    await input.revisionStore.createRevision({
      teamStableId: input.teamId,
      memberSlug,
      content: input.currentContent[`members/${memberSlug}/${TEAM_AGENT_FILE}`] ?? "",
      authorKind: "user",
      authorLabel: null,
      // The starting revision predates ownership tracking; every block renders
      // as user-authored (or plain) until the next real revision replaces it.
      blockOwnership: null,
      summaryStatus: "unavailable",
      now: input.now,
    });
  }
}

function collectMemberSlugs(content: OfficialTeamContent): string[] {
  const slugs = new Set<string>();
  const prefix = "members/";
  const suffix = `/${TEAM_AGENT_FILE}`;
  for (const relativePath of Object.keys(content)) {
    if (!relativePath.startsWith(prefix) || !relativePath.endsWith(suffix)) {
      continue;
    }
    const slug = relativePath.slice(prefix.length, -suffix.length);
    if (!slug.includes("/") && isValidPathSegment(slug)) {
      slugs.add(slug);
    }
  }
  return [...slugs].sort(compareNames);
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

function compareNames(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
