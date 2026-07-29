import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

import {
  cachePackagedTeam,
  readExecutionBindingDocument,
  readOfficialTeamStateDocument,
  teamBindingKey,
  writeExecutionBindingDocument,
  writeOfficialTeamStateDocument,
} from "./team-management-store.js";
import {
  DEFAULT_TEAM_EXECUTION_PROFILE,
} from "./team-execution-profile.js";
import {
  readPersistedUserTeamRecordsDocument,
  resolveRecordedTeamLocation,
} from "./team-record-store.js";
import {
  computeOfficialTeamContentFingerprint,
  readPackagedOfficialTeamManifest,
  recommendationFingerprint,
  recommendationsFromManifest,
} from "./team-official-management.js";
import { recoverOfficialTeamUpdateTransactions } from "./team-official-update.js";
import {
  getSystemTeamsRoot,
  getTeamsRoot,
  readSystemTeamLocationOverrides,
  readTeamSnapshot,
  resolveTeamLocation,
  writeSystemTeamLocationOverrides,
} from "./team-store.js";

export const TEAMS_SEED_MARKER_FILE = ".teams-seed.marker";
export const TEAM_SEED_CONFLICTS_FILE = path.join(
  ".state",
  "agent-teams",
  "seed-conflicts-v1.json",
);
export const GENERAL_ASSISTANT_TEAM_ID = "general-assistant";

const FINGERPRINT_VERSION = "moebius-team-seed-v1";
export interface BuiltInTeamSeedResult {
  fingerprint: string;
  status: "seeded" | "skipped" | "conflict";
  conflicts: TeamSeedConflict[];
}

export interface TeamSeedConflict {
  teamId: typeof GENERAL_ASSISTANT_TEAM_ID;
  kind: "stable-identity" | "directory";
  canPreserve: boolean;
}

interface SeedEntry {
  absolutePath: string;
  relativePath: string;
  type: "directory" | "file";
}

export async function seedBuiltInTeams(input: {
  seedTeamsRoot: string;
  dataRoot: string;
  preserveGeneralAssistantConflicts?: boolean;
}): Promise<BuiltInTeamSeedResult> {
  await recoverOfficialTeamUpdateTransactions(input.dataRoot);
  const seedTeamsRoot = path.resolve(input.seedTeamsRoot);
  const systemRoot = getSystemTeamsRoot(input.dataRoot);
  const fingerprint = await computeTeamSeedFingerprint(seedTeamsRoot);
  const officialDocument = await readOfficialTeamStateDocument(input.dataRoot);
  const bindingDocument = await readExecutionBindingDocument(input.dataRoot);
  const originalOfficialDocument = structuredClone(officialDocument);
  const originalBindingDocument = structuredClone(bindingDocument);
  const packagedTeamIds = await listPackagedTeamIds(seedTeamsRoot);
  let copiedTeamCount = 0;
  const conflicts: TeamSeedConflict[] = [];
  const originalOverrides = readSystemTeamLocationOverrides(input.dataRoot);
  let locationOverrides = { ...originalOverrides };
  let conflictRecoveryDirectory: string | null = null;

  await fs.mkdir(systemRoot, { recursive: true });

  for (const teamId of packagedTeamIds) {
    const sourceDirectory = path.join(seedTeamsRoot, teamId);
    const manifest = await readPackagedOfficialTeamManifest(sourceDirectory);
    const packagedDirectory = await cachePackagedTeam({
      dataRoot: input.dataRoot,
      teamId,
      sourceDirectory,
    });
    const packagedFingerprint = await computeOfficialTeamContentFingerprint(packagedDirectory);
    let location = resolveTeamLocation({
      dataRoot: input.dataRoot,
      teamId,
      ownership: "system",
    });
    let existed = await pathExists(location.directory);
    if (
      teamId === GENERAL_ASSISTANT_TEAM_ID
      && officialDocument.teams[teamId] === undefined
    ) {
      const userRecords = await readPersistedUserTeamRecordsDocument(input.dataRoot);
      const stableIdentityRecord = userRecords?.records.find((record) => record.id === teamId);
      const managedUserDirectoryExists = await pathExists(path.join(getTeamsRoot(input.dataRoot), teamId));
      const stableIdentityConflict = stableIdentityRecord !== undefined || managedUserDirectoryExists;
      const stableIdentityCanPreserve = stableIdentityConflict
        ? await canPreserveStableIdentity(input.dataRoot, stableIdentityRecord !== undefined)
        : true;
      const directoryConflict = existed;
      if (
        (stableIdentityConflict || directoryConflict)
        && (
          input.preserveGeneralAssistantConflicts !== true
          || (stableIdentityConflict && !stableIdentityCanPreserve)
        )
      ) {
        if (stableIdentityConflict) {
          conflicts.push({
            teamId,
            kind: "stable-identity",
            canPreserve: stableIdentityCanPreserve,
          });
        }
        if (directoryConflict) {
          conflicts.push({ teamId, kind: "directory", canPreserve: true });
          locationOverrides[teamId] = null;
          await writeSystemTeamLocationOverrides(input.dataRoot, locationOverrides);
        }
        continue;
      }
      if (directoryConflict) {
        const directoryName = await nextPreservedOfficialDirectoryName(systemRoot, teamId);
        locationOverrides[teamId] = directoryName;
        location = {
          dataRoot: path.resolve(input.dataRoot),
          id: teamId,
          ownership: "system",
          directory: path.join(systemRoot, directoryName),
        };
        existed = false;
      }
    }
    if (!existed) {
      await copyEditableTeamContent(sourceDirectory, location.directory);
      copiedTeamCount += 1;
      if (
        teamId === GENERAL_ASSISTANT_TEAM_ID
        && input.preserveGeneralAssistantConflicts === true
      ) {
        conflictRecoveryDirectory = location.directory;
      }
    }

    const currentFingerprint = await tryComputeContentFingerprint(location.directory);
    const recommendations = recommendationsFromManifest(manifest);
    if (officialDocument.teams[teamId] === undefined) {
      officialDocument.teams[teamId] = {
        appliedOfficialVersion: manifest.officialVersion,
        appliedContentFingerprint: existed
          ? currentFingerprint ?? packagedFingerprint
          : packagedFingerprint,
        appliedRecommendationFingerprint: recommendationFingerprint(recommendations),
        appliedRecommendations: recommendations,
        baselineConfidence: currentFingerprint === packagedFingerprint ? "verified" : "conservative",
      };
    }

    const key = teamBindingKey("system", teamId);
    if (bindingDocument.teams[key] === undefined) {
      const memberSlugs = await readCurrentMemberSlugs(location.directory);
      bindingDocument.teams[key] = {
        ownership: "system",
        members: Object.fromEntries(memberSlugs.map((slug) => [
          slug,
          Object.hasOwn(recommendations, slug)
            ? { source: "recommended" as const }
            : { source: "explicit" as const, profile: DEFAULT_TEAM_EXECUTION_PROFILE },
        ])),
      };
    }
  }

  try {
    await writeSystemTeamLocationOverrides(input.dataRoot, locationOverrides);
    await writeOfficialTeamStateDocument(input.dataRoot, officialDocument);
    await writeExecutionBindingDocument(input.dataRoot, bindingDocument);
    await writeSeedConflicts(input.dataRoot, conflicts);
    await writeMarker(path.join(systemRoot, TEAMS_SEED_MARKER_FILE), fingerprint);
  } catch (error) {
    if (conflictRecoveryDirectory !== null) {
      await fs.rm(conflictRecoveryDirectory, { recursive: true, force: true }).catch(() => undefined);
      await Promise.allSettled([
        writeSystemTeamLocationOverrides(input.dataRoot, originalOverrides),
        writeOfficialTeamStateDocument(input.dataRoot, originalOfficialDocument),
        writeExecutionBindingDocument(input.dataRoot, originalBindingDocument),
      ]);
    }
    throw error;
  }
  return {
    fingerprint,
    status: conflicts.length > 0 ? "conflict" : copiedTeamCount > 0 ? "seeded" : "skipped",
    conflicts,
  };
}

export async function readTeamSeedConflicts(dataRoot: string): Promise<TeamSeedConflict[]> {
  try {
    const value = JSON.parse(
      await fs.readFile(path.join(path.resolve(dataRoot), TEAM_SEED_CONFLICTS_FILE), "utf8"),
    ) as unknown;
    if (
      typeof value !== "object"
      || value === null
      || (value as { version?: unknown }).version !== 1
      || !Array.isArray((value as { conflicts?: unknown }).conflicts)
    ) {
      return [];
    }
    const conflicts = (value as { conflicts: unknown[] }).conflicts.flatMap((entry): TeamSeedConflict[] => {
      if (
        typeof entry !== "object"
        || entry === null
        || (entry as { teamId?: unknown }).teamId !== GENERAL_ASSISTANT_TEAM_ID
        || ((entry as { kind?: unknown }).kind !== "stable-identity"
          && (entry as { kind?: unknown }).kind !== "directory")
      ) {
        return [];
      }
      return [{
        teamId: GENERAL_ASSISTANT_TEAM_ID,
        kind: (entry as { kind: TeamSeedConflict["kind"] }).kind,
        canPreserve: (entry as { canPreserve?: unknown }).canPreserve === true,
      }];
    });
    return await Promise.all(conflicts.map(async (conflict) => conflict.kind === "stable-identity"
      ? {
          ...conflict,
          canPreserve: await canPreserveStableIdentity(dataRoot, true),
        }
      : conflict));
  } catch {
    return [];
  }
}

export async function computeTeamSeedFingerprint(seedTeamsRoot: string): Promise<string> {
  const resolvedRoot = path.resolve(seedTeamsRoot);
  const entries = await collectSeedEntries(resolvedRoot);
  const hash = createHash("sha256");
  hash.update(FINGERPRINT_VERSION);
  hash.update("\0");

  for (const entry of entries) {
    hash.update(entry.type === "directory" ? "d" : "f");
    hash.update("\0");
    hash.update(entry.relativePath);
    hash.update("\0");
    if (entry.type === "file") {
      const content = await fs.readFile(entry.absolutePath);
      hash.update(String(content.byteLength));
      hash.update("\0");
      hash.update(content);
      hash.update("\0");
    }
  }

  return hash.digest("hex");
}

async function listPackagedTeamIds(root: string): Promise<string[]> {
  const entries = await fs.readdir(root, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isDirectory() && !entry.name.startsWith("."))
    .map((entry) => entry.name)
    .sort(compareNames);
}

async function copyEditableTeamContent(source: string, destination: string): Promise<void> {
  await fs.mkdir(destination, { recursive: false });
  try {
    const entries = await fs.readdir(source, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.name === "official.json") {
        continue;
      }
      await fs.cp(path.join(source, entry.name), path.join(destination, entry.name), {
        recursive: true,
        force: false,
        errorOnExist: true,
      });
    }
  } catch (error) {
    await fs.rm(destination, { recursive: true, force: true });
    throw error;
  }
}

async function readCurrentMemberSlugs(teamDirectory: string): Promise<string[]> {
  let value: unknown;
  try {
    value = JSON.parse(await fs.readFile(path.join(teamDirectory, "team.json"), "utf8")) as unknown;
  } catch {
    return [];
  }
  if (
    typeof value !== "object"
    || value === null
    || !("memberOrder" in value)
    || !Array.isArray(value.memberOrder)
  ) {
    return [];
  }
  return value.memberOrder.filter((slug): slug is string => typeof slug === "string");
}

async function tryComputeContentFingerprint(teamDirectory: string): Promise<string | null> {
  try {
    return await computeOfficialTeamContentFingerprint(teamDirectory);
  } catch {
    return null;
  }
}

async function collectSeedEntries(root: string, current = root): Promise<SeedEntry[]> {
  const directoryEntries = await fs.readdir(current, { withFileTypes: true });
  const collected: SeedEntry[] = [];

  for (const directoryEntry of directoryEntries.sort((left, right) => compareNames(left.name, right.name))) {
    const absolutePath = path.join(current, directoryEntry.name);
    const relativePath = path.relative(root, absolutePath).split(path.sep).join("/");
    if (relativePath === TEAMS_SEED_MARKER_FILE) {
      throw new Error(`${TEAMS_SEED_MARKER_FILE} is reserved and cannot be packaged as team seed content`);
    }
    if (directoryEntry.isDirectory()) {
      collected.push({ absolutePath, relativePath, type: "directory" });
      collected.push(...await collectSeedEntries(root, absolutePath));
      continue;
    }
    if (directoryEntry.isFile()) {
      collected.push({ absolutePath, relativePath, type: "file" });
      continue;
    }
    throw new Error(`Team seed contains an unsupported file type: ${absolutePath}`);
  }

  return collected;
}

async function writeMarker(markerPath: string, fingerprint: string): Promise<void> {
  const temporaryMarkerPath = `${markerPath}.${process.pid}.tmp`;
  await fs.writeFile(temporaryMarkerPath, `${fingerprint}\n`, "utf8");
  await fs.rename(temporaryMarkerPath, markerPath);
}

async function writeSeedConflicts(
  dataRoot: string,
  conflicts: readonly TeamSeedConflict[],
): Promise<void> {
  const target = path.join(path.resolve(dataRoot), TEAM_SEED_CONFLICTS_FILE);
  await fs.mkdir(path.dirname(target), { recursive: true });
  const temporary = `${target}.${process.pid}.tmp`;
  await fs.writeFile(
    temporary,
    `${JSON.stringify({ version: 1, conflicts }, null, 2)}\n`,
    "utf8",
  );
  await fs.rename(temporary, target);
}

async function nextPreservedOfficialDirectoryName(
  systemRoot: string,
  teamId: string,
): Promise<string> {
  for (let index = 1; index < 10_000; index += 1) {
    const candidate = index === 1 ? `${teamId}.official` : `${teamId}.official-${String(index)}`;
    if (!await pathExists(path.join(systemRoot, candidate))) return candidate;
  }
  throw new Error(`No managed directory is available for official team ${teamId}`);
}

async function canPreserveStableIdentity(
  dataRoot: string,
  hasRecordedIdentity: boolean,
): Promise<boolean> {
  try {
    const location = hasRecordedIdentity
      ? await resolveRecordedTeamLocation(dataRoot, GENERAL_ASSISTANT_TEAM_ID)
      : resolveTeamLocation({
          dataRoot,
          teamId: GENERAL_ASSISTANT_TEAM_ID,
          ownership: "user",
        });
    return (await readTeamSnapshot(location)).status === "usable";
  } catch {
    return false;
  }
}

async function pathExists(targetPath: string): Promise<boolean> {
  try {
    await fs.access(targetPath);
    return true;
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") {
      return false;
    }
    throw error;
  }
}

function compareNames(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}
