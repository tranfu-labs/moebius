import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

import {
  getExecutionBindingDocumentPath,
  readExecutionBindingDocument,
  removeExecutionBindingDocument,
  teamBindingKey,
  writeExecutionBindingDocument,
  type TeamExecutionBindingDocumentV1,
} from "./team-management-store.js";
import { DEFAULT_TEAM_EXECUTION_PROFILE, type ExecutionProfileBinding } from "./team-execution-profile.js";
import {
  buildUserTeamRecordsDocument,
  createTeamIdentityFingerprint,
  getUserTeamRecordsPath,
  readPersistedUserTeamRecordsDocument,
  writeUserTeamRecordsDocument,
  type UserTeamRecord,
} from "./team-record-store.js";
import {
  readPackagedOfficialTeamManifest,
  recommendationsFromManifest,
} from "./team-official-management.js";
import { assertSeedEntryIsNotReserved } from "./team-seed-plan.js";
import {
  getTeamsRoot,
  readTeamSnapshot,
  resolveTeamLocation,
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

/**
 * Legacy seed-conflict records are still readable by the repair surface. The
 * new seed path does not create or resolve these records because it never
 * writes the legacy `.system` tree.
 */
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

/**
 * Installs packaged teams using the same ordinary-user path as GitHub import.
 * Existing user records/directories and legacy system directories are left
 * untouched; the only source-specific record written for a fresh install is
 * `installationSource: { provider: "moebius" }`.
 */
export async function seedBuiltInTeams(input: {
  seedTeamsRoot: string;
  dataRoot: string;
  /** Retained for callers from the removed legacy conflict flow. */
  preserveGeneralAssistantConflicts?: boolean;
}): Promise<BuiltInTeamSeedResult> {
  const seedTeamsRoot = path.resolve(input.seedTeamsRoot);
  const fingerprint = await computeTeamSeedFingerprint(seedTeamsRoot);
  const persistedRecords = await readPersistedUserTeamRecordsDocument(input.dataRoot);
  let records = persistedRecords?.records ?? (await buildUserTeamRecordsDocument(input.dataRoot)).records;
  let bindingDocument = await readExecutionBindingDocument(input.dataRoot);
  const packagedTeamIds = await listPackagedTeamIds(seedTeamsRoot);
  let copiedTeamCount = 0;

  // Conflict recovery belonged to the removed system-team seed flow. Keep the
  // parameter source-compatible, but never move, replace, or copy over legacy
  // system directories.
  void input.preserveGeneralAssistantConflicts;

  for (const teamId of packagedTeamIds) {
    const sourceDirectory = path.join(seedTeamsRoot, teamId);
    const legacySystemLocation = resolveTeamLocation({
      dataRoot: input.dataRoot,
      teamId,
      ownership: "system",
    });
    const location = resolveTeamLocation({
      dataRoot: input.dataRoot,
      teamId,
      ownership: "user",
    });

    // A legacy official team, an existing user directory, or an existing
    // record all wins over a new seed. This keeps stable IDs and old sessions
    // intact without creating a duplicate visible team.
    if (
      await pathExists(legacySystemLocation.directory)
      || await pathExists(location.directory)
      || records.some((record) => record.id === teamId)
    ) {
      continue;
    }

    const manifest = await readPackagedOfficialTeamManifest(sourceDirectory);
    const recommendations = recommendationsFromManifest(manifest);
    const stagingDirectory = path.join(
      getTeamsRoot(input.dataRoot),
      `.${teamId}.moebius-install-${randomUUID()}`,
    );
    const previousRecordsFilePresent = await pathExists(getUserTeamRecordsPath(input.dataRoot));
    const previousBindingsFilePresent = await pathExists(
      getExecutionBindingDocumentPath(input.dataRoot),
    );
    const previousRecords = { version: 2 as const, records: [...records] };
    const previousBindings = structuredClone(bindingDocument);
    let targetCreated = false;
    let recordsWriteAttempted = false;
    let bindingsWriteAttempted = false;

    try {
      await fs.mkdir(getTeamsRoot(input.dataRoot), { recursive: true });
      await copyEditableTeamContent(sourceDirectory, stagingDirectory);
      await fs.rename(stagingDirectory, location.directory);
      targetCreated = true;

      const snapshot = await readTeamSnapshot(location);
      if (snapshot.status !== "usable" || snapshot.definition === null) {
        throw new Error("内置团队安装后的文件未通过本地完整性校验。");
      }
      const record: UserTeamRecord = {
        id: teamId,
        location: { kind: "managed", directoryName: path.basename(location.directory) },
        identityFingerprint: createTeamIdentityFingerprint(snapshot),
        lastKnownDefinition: snapshot.definition,
        installationSource: { provider: "moebius" },
      };
      const nextRecords = {
        version: 2 as const,
        records: [...records, record].sort((left, right) => left.id.localeCompare(right.id)),
      };
      const nextBindings: TeamExecutionBindingDocumentV1 = {
        schemaVersion: 1,
        teams: {
          ...bindingDocument.teams,
          [teamBindingKey("user", teamId)]: {
            ownership: "user",
            members: materializeExplicitBindings(snapshot.definition.memberOrder, recommendations),
          },
        },
      };

      recordsWriteAttempted = true;
      await writeUserTeamRecordsDocument(input.dataRoot, nextRecords);
      bindingsWriteAttempted = true;
      await writeExecutionBindingDocument(input.dataRoot, nextBindings);
      records = nextRecords.records;
      bindingDocument = nextBindings;
      copiedTeamCount += 1;
    } catch (error) {
      const rollbackErrors: unknown[] = [];
      await attemptRollback(() => fs.rm(stagingDirectory, { recursive: true, force: true }), rollbackErrors);
      if (targetCreated) {
        await attemptRollback(() => fs.rm(location.directory, { recursive: true, force: true }), rollbackErrors);
      }
      if (recordsWriteAttempted) {
        await attemptRollback(
          () => previousRecordsFilePresent
            ? writeUserTeamRecordsDocument(input.dataRoot, previousRecords)
            : writeUserTeamRecordsDocument(input.dataRoot, null),
          rollbackErrors,
        );
      }
      if (bindingsWriteAttempted) {
        await attemptRollback(
          () => previousBindingsFilePresent
            ? writeExecutionBindingDocument(input.dataRoot, previousBindings)
            : removeExecutionBindingDocument(input.dataRoot),
          rollbackErrors,
        );
      }
      if (rollbackErrors.length > 0) {
        throw new Error(
          `内置团队安装失败且回滚失败：${formatError(error)}；${rollbackErrors.map(formatError).join("；")}`,
        );
      }
      throw error;
    }
  }

  return {
    fingerprint,
    status: copiedTeamCount > 0 ? "seeded" : "skipped",
    conflicts: [],
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
    return (value as { conflicts: unknown[] }).conflicts.flatMap((entry): TeamSeedConflict[] => {
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

function materializeExplicitBindings(
  memberSlugs: readonly string[],
  recommendations: Readonly<Record<string, import("./team-execution-profile.js").ExecutionProfile>>,
): Record<string, ExecutionProfileBinding> {
  return Object.fromEntries(memberSlugs.map((slug) => [
    slug,
    {
      source: "explicit" as const,
      profile: recommendations[slug] ?? DEFAULT_TEAM_EXECUTION_PROFILE,
    },
  ]));
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

async function collectSeedEntries(root: string, current = root): Promise<SeedEntry[]> {
  const directoryEntries = await fs.readdir(current, { withFileTypes: true });
  const collected: SeedEntry[] = [];

  for (const directoryEntry of directoryEntries.sort((left, right) => compareNames(left.name, right.name))) {
    const absolutePath = path.join(current, directoryEntry.name);
    const relativePath = path.relative(root, absolutePath).split(path.sep).join("/");
    assertSeedEntryIsNotReserved(relativePath, TEAMS_SEED_MARKER_FILE);
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

async function attemptRollback(action: () => Promise<void>, errors: unknown[]): Promise<void> {
  try {
    await action();
  } catch (error) {
    errors.push(error);
  }
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function compareNames(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}
