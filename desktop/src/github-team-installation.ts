import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

import {
  findExistingGithubTeam,
  planGithubTeamCoreContent,
  planGithubTeamInstallation,
  type GithubTeamInstallPlanResult,
} from "./github-team-install-plan.js";
import type { GithubTeamSnapshot } from "./github-team-snapshot.js";
import {
  createTeamIdentityFingerprint,
  getUserTeamRecordsPath,
  readOrBuildUserTeamRecordsDocument,
  writeUserTeamRecordsDocument,
  type UserTeamRecord,
  type UserTeamRecordsDocument,
} from "./team-record-store.js";
import {
  getExecutionBindingDocumentPath,
  readExecutionBindingDocument,
  removeExecutionBindingDocument,
  teamBindingKey,
  writeExecutionBindingDocument,
  type TeamExecutionBindingDocumentV1,
} from "./team-management-store.js";
import {
  getTeamsRoot,
  readTeamSnapshot,
  resolveTeamLocation,
  type TeamLocation,
  type TeamSnapshot,
} from "./team-store.js";

/**
 * Per-repository install queue: two concurrent installs of the same upstream
 * must not both pass the duplicate check and create a second team. IPC handlers
 * run concurrently in the main process, so the adapter serializes installs per
 * repository (the queue is keyed by the normalized `owner/repo`).
 */
const githubInstallQueues = new Map<string, Promise<unknown>>();

function enqueueGithubInstall<T>(key: string, action: () => Promise<T>): Promise<T> {
  const previous = githubInstallQueues.get(key) ?? Promise.resolve();
  const run = previous.then(action);
  githubInstallQueues.set(key, run.catch(() => undefined));
  return run;
}

function normalizeInstallRepository(repository: string): string {
  return repository.trim().toLowerCase();
}

export interface GithubTeamInstallationPorts {
  /** Injectable write seam for failure-path tests; rollback always uses the real stores. */
  writeRecords: typeof writeUserTeamRecordsDocument;
  writeExecutionBindings: typeof writeExecutionBindingDocument;
}

interface GithubTeamInstallationInput {
  dataRoot: string;
  snapshot: GithubTeamSnapshot;
}

export type GithubTeamInstallationResult =
  | {
    status: "duplicate";
    existingTeamId: string;
  }
  | {
    status: "installed";
    teamId: string;
    location: TeamLocation;
    snapshot: TeamSnapshot;
    record: UserTeamRecord;
  };

export async function installGithubTeam(
  input: GithubTeamInstallationInput,
): Promise<GithubTeamInstallationResult> {
  const repository = normalizeInstallRepository(input.snapshot.repository.repository);
  return enqueueGithubInstall(repository, () => installGithubTeamWithPorts(input, {
    writeRecords: writeUserTeamRecordsDocument,
    writeExecutionBindings: writeExecutionBindingDocument,
  }));
}

export async function installGithubTeamWithPorts(
  input: GithubTeamInstallationInput,
  ports: GithubTeamInstallationPorts,
): Promise<GithubTeamInstallationResult> {
  const dataRoot = path.resolve(input.dataRoot);
  const previousRecords = await readOrBuildUserTeamRecordsDocument(dataRoot);
  const existing = findExistingGithubTeam(
    previousRecords.records,
    input.snapshot.repository.repository,
  );
  if (existing !== null) {
    return { status: "duplicate", existingTeamId: existing.id };
  }

  const teamId = `team-${randomUUID()}`;
  const location = resolveTeamLocation({ dataRoot, teamId, ownership: "user" });
  if (await pathExists(location.directory)) {
    throw new GithubTeamInstallationError("目标团队目录已经存在，无法安全安装。", "TARGET_EXISTS");
  }

  const previousRecordsFilePresent = await pathExists(getUserTeamRecordsPath(dataRoot));
  const previousBindingsFilePresent = await pathExists(getExecutionBindingDocumentPath(dataRoot));
  const previousBindings = await readExecutionBindingDocument(dataRoot);
  const writeRecords = ports.writeRecords;
  const writeExecutionBindings = ports.writeExecutionBindings;

  const teamsRoot = getTeamsRoot(dataRoot);
  const stagingDirectory = path.join(
    teamsRoot,
    `.${teamId}.github-install-${randomUUID()}`,
  );
  let targetCreated = false;
  let recordsWriteAttempted = false;
  let bindingsWriteAttempted = false;

  try {
    await fs.mkdir(teamsRoot, { recursive: true });
    await fs.mkdir(stagingDirectory, { recursive: false });
    await writeCoreContent(stagingDirectory, input.snapshot);
    await fs.rename(stagingDirectory, location.directory);
    targetCreated = true;

    const localSnapshot = await readTeamSnapshot(location);
    if (localSnapshot.status !== "usable" || localSnapshot.definition === null) {
      throw new GithubTeamInstallationError("安装后的团队文件未通过本地完整性校验。", "LOCAL_SNAPSHOT_INVALID");
    }
    const identityFingerprint = createTeamIdentityFingerprint(localSnapshot);
    const plan: GithubTeamInstallPlanResult = planGithubTeamInstallation({
      teamId,
      snapshot: input.snapshot,
      existingRecords: previousRecords.records,
    });
    if (plan.status === "duplicate") {
      await fs.rm(location.directory, { recursive: true, force: true });
      targetCreated = false;
      return { status: "duplicate", existingTeamId: plan.existingTeamId };
    }

    const record: UserTeamRecord = {
      id: teamId,
      location: { kind: "managed", directoryName: path.basename(location.directory) },
      identityFingerprint,
      lastKnownDefinition: localSnapshot.definition,
      installationSource: plan.installationSource,
    };
    const nextRecords: UserTeamRecordsDocument = {
      version: 2,
      records: [...previousRecords.records, record].sort((left, right) => left.id.localeCompare(right.id)),
    };
    const nextBindings: TeamExecutionBindingDocumentV1 = {
      schemaVersion: 1,
      teams: {
        ...previousBindings.teams,
        [teamBindingKey("user", teamId)]: {
          ownership: "user",
          members: plan.executionBindings,
        },
      },
    };

    recordsWriteAttempted = true;
    await writeRecords(dataRoot, nextRecords);
    bindingsWriteAttempted = true;
    await writeExecutionBindings(dataRoot, nextBindings);

    return { status: "installed", teamId, location, snapshot: localSnapshot, record };
  } catch (error) {
    const rollbackErrors: unknown[] = [];
    await attemptRollback(() => fs.rm(stagingDirectory, { recursive: true, force: true }), rollbackErrors);
    if (targetCreated) {
      await attemptRollback(() => fs.rm(location.directory, { recursive: true, force: true }), rollbackErrors);
    }
    if (recordsWriteAttempted) {
      await attemptRollback(
        () => previousRecordsFilePresent
          ? writeUserTeamRecordsDocument(dataRoot, previousRecords)
          : writeUserTeamRecordsDocument(dataRoot, null),
        rollbackErrors,
      );
    }
    if (bindingsWriteAttempted) {
      await attemptRollback(
        () => previousBindingsFilePresent
          ? writeExecutionBindingDocument(dataRoot, previousBindings)
          : removeExecutionBindingDocument(dataRoot),
        rollbackErrors,
      );
    }
    if (rollbackErrors.length > 0) {
      throw new GithubTeamInstallationError(
        `GitHub 团队安装失败且回滚失败：${formatError(error)}；${rollbackErrors.map(formatError).join("；")}`,
        "ROLLBACK_FAILED",
      );
    }
    throw error;
  }
}

async function writeCoreContent(stagingDirectory: string, snapshot: GithubTeamSnapshot): Promise<void> {
  for (const { relativePath, content } of planGithubTeamCoreContent(snapshot.content)) {
    const targetPath = path.join(stagingDirectory, ...relativePath.split("/"));
    await fs.mkdir(path.dirname(targetPath), { recursive: true });
    await fs.writeFile(targetPath, content, "utf8");
  }
}

async function pathExists(targetPath: string): Promise<boolean> {
  try {
    await fs.access(targetPath);
    return true;
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") return false;
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

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}

export class GithubTeamInstallationError extends Error {
  readonly code: string;

  constructor(message: string, code: string) {
    super(message);
    this.name = "GithubTeamInstallationError";
    this.code = code;
  }
}
