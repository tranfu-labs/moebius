import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

import {
  normalizeOfficialContentEntry,
  OfficialTeamManagementError,
  parsePackagedOfficialTeamManifest,
  type PackagedOfficialTeamManifestV1,
} from "./team-official-plan.js";

export {
  deriveOfficialTeamUpdateState,
  OfficialTeamManagementError,
  parsePackagedOfficialTeamManifest,
  recommendationFingerprint,
  recommendationsFromManifest,
} from "./team-official-plan.js";
export type {
  AppliedOfficialTeamState,
  OfficialTeamPrimaryAction,
  OfficialTeamUpdateState,
  PackagedOfficialMemberV1,
  PackagedOfficialTeamManifestV1,
  PackagedOfficialTeamState,
} from "./team-official-plan.js";

export const OFFICIAL_TEAM_MANIFEST_FILE = "official.json";

const CONTENT_FINGERPRINT_VERSION = "moebius-official-team-content-v1";
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
  const hash = createHash("sha256");
  hash.update(CONTENT_FINGERPRINT_VERSION);
  hash.update("\0");
  for (const entry of entries) {
    hash.update(entry.relativePath);
    hash.update("\0");
    const content = normalizeOfficialContentEntry(
      entry.relativePath,
      await fs.readFile(entry.absolutePath),
    );
    hash.update(String(content.byteLength));
    hash.update("\0");
    hash.update(content);
    hash.update("\0");
  }
  return hash.digest("hex");
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
