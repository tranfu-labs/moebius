import fs from "node:fs/promises";
import path from "node:path";

import type { TeamOwnership } from "./team-model.js";
import type { ExecutionProfileBinding } from "./team-execution-profile.js";
import {
  assertStateKeySegment,
  normalizeExecutionBinding,
  normalizeOfficialTeamStateDocument,
  normalizeTeamExecutionBindingDocument,
  selectStoredTeamBindings,
  TeamManagementDocumentError as TeamManagementStoreError,
  type OfficialTeamStateDocumentV1,
  type TeamExecutionBindingDocumentV1,
} from "./team-management-document-codec.js";

export type {
  OfficialTeamStateDocumentV1,
  TeamExecutionBindingDocumentV1,
} from "./team-management-document-codec.js";

const STATE_DIRECTORY = path.join(".state", "agent-teams");
const OFFICIAL_STATE_FILE = "official-state-v1.json";
const EXECUTION_BINDINGS_FILE = "execution-bindings-v1.json";
const PACKAGED_TEAMS_DIRECTORY = "packaged";

export function getAgentTeamsStateRoot(dataRoot: string): string {
  return path.join(path.resolve(dataRoot), STATE_DIRECTORY);
}

export function getPackagedTeamsCacheRoot(dataRoot: string): string {
  return path.join(getAgentTeamsStateRoot(dataRoot), PACKAGED_TEAMS_DIRECTORY);
}

export function getPackagedTeamCacheDirectory(dataRoot: string, teamId: string): string {
  assertStateKeySegment(teamId);
  return path.join(getPackagedTeamsCacheRoot(dataRoot), teamId);
}

export function teamBindingKey(ownership: TeamOwnership, teamId: string): string {
  assertStateKeySegment(teamId);
  return `${ownership}:${teamId}`;
}

export async function readOfficialTeamStateDocument(
  dataRoot: string,
): Promise<OfficialTeamStateDocumentV1> {
  const value = await readOptionalJson(path.join(getAgentTeamsStateRoot(dataRoot), OFFICIAL_STATE_FILE));
  if (value === null) {
    return { schemaVersion: 1, teams: {} };
  }
  return normalizeOfficialTeamStateDocument(value);
}

export async function writeOfficialTeamStateDocument(
  dataRoot: string,
  document: OfficialTeamStateDocumentV1,
): Promise<void> {
  await writeJsonAtomically(
    path.join(getAgentTeamsStateRoot(dataRoot), OFFICIAL_STATE_FILE),
    normalizeOfficialTeamStateDocument(document),
  );
}

export async function readExecutionBindingDocument(
  dataRoot: string,
): Promise<TeamExecutionBindingDocumentV1> {
  const value = await readOptionalJson(path.join(getAgentTeamsStateRoot(dataRoot), EXECUTION_BINDINGS_FILE));
  if (value === null) {
    return { schemaVersion: 1, teams: {} };
  }
  return normalizeTeamExecutionBindingDocument(value);
}

export async function writeExecutionBindingDocument(
  dataRoot: string,
  document: TeamExecutionBindingDocumentV1,
): Promise<void> {
  await writeJsonAtomically(
    path.join(getAgentTeamsStateRoot(dataRoot), EXECUTION_BINDINGS_FILE),
    normalizeTeamExecutionBindingDocument(document),
  );
}

export async function readTeamExecutionBindings(input: {
  dataRoot: string;
  ownership: TeamOwnership;
  teamId: string;
}): Promise<Record<string, ExecutionProfileBinding>> {
  const document = await readExecutionBindingDocument(input.dataRoot);
  return selectStoredTeamBindings(
    document.teams[teamBindingKey(input.ownership, input.teamId)]?.members,
  );
}

export async function saveTeamExecutionBinding(input: {
  dataRoot: string;
  ownership: TeamOwnership;
  teamId: string;
  memberSlug: string;
  binding: ExecutionProfileBinding;
}): Promise<void> {
  assertStateKeySegment(input.memberSlug);
  const document = await readExecutionBindingDocument(input.dataRoot);
  const key = teamBindingKey(input.ownership, input.teamId);
  const existing = document.teams[key];
  document.teams[key] = {
    ownership: input.ownership,
    members: {
      ...existing?.members,
      [input.memberSlug]: normalizeExecutionBinding(input.binding),
    },
  };
  await writeExecutionBindingDocument(input.dataRoot, document);
}

export async function replaceTeamExecutionBindings(input: {
  dataRoot: string;
  ownership: TeamOwnership;
  teamId: string;
  bindings: Readonly<Record<string, ExecutionProfileBinding>>;
}): Promise<void> {
  const document = await readExecutionBindingDocument(input.dataRoot);
  document.teams[teamBindingKey(input.ownership, input.teamId)] = {
    ownership: input.ownership,
    members: Object.fromEntries(Object.entries(input.bindings).map(([slug, binding]) => {
      assertStateKeySegment(slug);
      return [slug, normalizeExecutionBinding(binding)];
    })),
  };
  await writeExecutionBindingDocument(input.dataRoot, document);
}

export async function removeTeamExecutionBindings(input: {
  dataRoot: string;
  ownership: TeamOwnership;
  teamId: string;
}): Promise<void> {
  const document = await readExecutionBindingDocument(input.dataRoot);
  delete document.teams[teamBindingKey(input.ownership, input.teamId)];
  await writeExecutionBindingDocument(input.dataRoot, document);
}

export async function cachePackagedTeam(input: {
  dataRoot: string;
  teamId: string;
  sourceDirectory: string;
}): Promise<string> {
  const destination = getPackagedTeamCacheDirectory(input.dataRoot, input.teamId);
  const staging = `${destination}.staging`;
  await fs.rm(staging, { recursive: true, force: true });
  await fs.mkdir(path.dirname(destination), { recursive: true });
  await fs.cp(input.sourceDirectory, staging, {
    recursive: true,
    force: false,
    errorOnExist: true,
  });
  await fs.rm(destination, { recursive: true, force: true });
  await fs.rename(staging, destination);
  return destination;
}

async function readOptionalJson(filePath: string): Promise<unknown | null> {
  try {
    return JSON.parse(await fs.readFile(filePath, "utf8")) as unknown;
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") {
      return null;
    }
    if (error instanceof SyntaxError) {
      throw new TeamManagementStoreError(`状态文件无法解析：${path.basename(filePath)}`);
    }
    throw error;
  }
}

async function writeJsonAtomically(filePath: string, value: unknown): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const temporaryPath = `${filePath}.${process.pid}.tmp`;
  const handle = await fs.open(temporaryPath, "w", 0o600);
  try {
    await handle.writeFile(`${JSON.stringify(value, null, 2)}\n`, "utf8");
    await handle.sync();
  } finally {
    await handle.close();
  }
  await fs.rename(temporaryPath, filePath);
  const directory = await fs.open(path.dirname(filePath), "r");
  try {
    await directory.sync();
  } finally {
    await directory.close();
  }
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}

export { TeamManagementStoreError };
