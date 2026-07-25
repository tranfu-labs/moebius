import fs from "node:fs/promises";
import path from "node:path";

import type { TeamOwnership } from "./team-model.js";
import {
  normalizeExecutionProfile,
  type ExecutionProfile,
  type ExecutionProfileBinding,
} from "./team-execution-profile.js";
import type { AppliedOfficialTeamState } from "./team-official-management.js";

const STATE_DIRECTORY = path.join(".state", "agent-teams");
const OFFICIAL_STATE_FILE = "official-state-v1.json";
const EXECUTION_BINDINGS_FILE = "execution-bindings-v1.json";
const PACKAGED_TEAMS_DIRECTORY = "packaged";

export interface OfficialTeamStateDocumentV1 {
  schemaVersion: 1;
  teams: Record<string, AppliedOfficialTeamState>;
}

export interface TeamExecutionBindingDocumentV1 {
  schemaVersion: 1;
  teams: Record<string, {
    ownership: TeamOwnership;
    members: Record<string, ExecutionProfileBinding>;
  }>;
}

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
  return normalizeOfficialDocument(value);
}

export async function writeOfficialTeamStateDocument(
  dataRoot: string,
  document: OfficialTeamStateDocumentV1,
): Promise<void> {
  await writeJsonAtomically(
    path.join(getAgentTeamsStateRoot(dataRoot), OFFICIAL_STATE_FILE),
    normalizeOfficialDocument(document),
  );
}

export async function readExecutionBindingDocument(
  dataRoot: string,
): Promise<TeamExecutionBindingDocumentV1> {
  const value = await readOptionalJson(path.join(getAgentTeamsStateRoot(dataRoot), EXECUTION_BINDINGS_FILE));
  if (value === null) {
    return { schemaVersion: 1, teams: {} };
  }
  return normalizeBindingDocument(value);
}

export async function writeExecutionBindingDocument(
  dataRoot: string,
  document: TeamExecutionBindingDocumentV1,
): Promise<void> {
  await writeJsonAtomically(
    path.join(getAgentTeamsStateRoot(dataRoot), EXECUTION_BINDINGS_FILE),
    normalizeBindingDocument(document),
  );
}

export async function readTeamExecutionBindings(input: {
  dataRoot: string;
  ownership: TeamOwnership;
  teamId: string;
}): Promise<Record<string, ExecutionProfileBinding>> {
  const document = await readExecutionBindingDocument(input.dataRoot);
  return document.teams[teamBindingKey(input.ownership, input.teamId)]?.members ?? {};
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
      [input.memberSlug]: normalizeBinding(input.binding),
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
      return [slug, normalizeBinding(binding)];
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

function normalizeOfficialDocument(value: unknown): OfficialTeamStateDocumentV1 {
  if (!isPlainObject(value) || value.schemaVersion !== 1 || !isPlainObject(value.teams)) {
    throw new TeamManagementStoreError("官方团队状态文件格式无效。");
  }
  const teams: Record<string, AppliedOfficialTeamState> = {};
  for (const [teamId, raw] of Object.entries(value.teams)) {
    assertStateKeySegment(teamId);
    if (!isPlainObject(raw)) {
      throw new TeamManagementStoreError(`官方团队 ${teamId} 的状态无效。`);
    }
    const recommendations = normalizeRecommendations(raw.appliedRecommendations);
    const confidence = raw.baselineConfidence;
    if (
      typeof raw.appliedOfficialVersion !== "string"
      || typeof raw.appliedContentFingerprint !== "string"
      || typeof raw.appliedRecommendationFingerprint !== "string"
      || (confidence !== "verified" && confidence !== "conservative")
    ) {
      throw new TeamManagementStoreError(`官方团队 ${teamId} 的状态无效。`);
    }
    teams[teamId] = {
      appliedOfficialVersion: raw.appliedOfficialVersion,
      appliedContentFingerprint: raw.appliedContentFingerprint,
      appliedRecommendationFingerprint: raw.appliedRecommendationFingerprint,
      appliedRecommendations: recommendations,
      baselineConfidence: confidence,
    };
  }
  return { schemaVersion: 1, teams };
}

function normalizeBindingDocument(value: unknown): TeamExecutionBindingDocumentV1 {
  if (!isPlainObject(value) || value.schemaVersion !== 1 || !isPlainObject(value.teams)) {
    throw new TeamManagementStoreError("Agent 运行配置状态文件格式无效。");
  }
  const teams: TeamExecutionBindingDocumentV1["teams"] = {};
  for (const [key, raw] of Object.entries(value.teams)) {
    if (!isPlainObject(raw) || (raw.ownership !== "system" && raw.ownership !== "user")
      || !isPlainObject(raw.members)) {
      throw new TeamManagementStoreError(`团队 ${key} 的运行配置无效。`);
    }
    teams[key] = {
      ownership: raw.ownership,
      members: Object.fromEntries(Object.entries(raw.members).map(([slug, binding]) => {
        assertStateKeySegment(slug);
        return [slug, normalizeBinding(binding)];
      })),
    };
  }
  return { schemaVersion: 1, teams };
}

function normalizeBinding(value: unknown): ExecutionProfileBinding {
  if (!isPlainObject(value)) {
    throw new TeamManagementStoreError("Agent 运行配置无效。");
  }
  if (value.source === "recommended") {
    return { source: "recommended" };
  }
  if (value.source === "override" || value.source === "explicit") {
    return {
      source: value.source,
      profile: normalizeExecutionProfile(value.profile),
    };
  }
  throw new TeamManagementStoreError("Agent 运行配置来源无效。");
}

function normalizeRecommendations(value: unknown): Record<string, ExecutionProfile> {
  if (!isPlainObject(value)) {
    throw new TeamManagementStoreError("官方推荐运行配置无效。");
  }
  return Object.fromEntries(Object.entries(value).map(([slug, profile]) => {
    assertStateKeySegment(slug);
    return [slug, normalizeExecutionProfile(profile)];
  }));
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

function assertStateKeySegment(value: string): void {
  if (!/^[a-z0-9](?:[a-z0-9-]{0,127})$/u.test(value)) {
    throw new TeamManagementStoreError(`状态 key 无效：${value}`);
  }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}

export class TeamManagementStoreError extends Error {
  readonly code = "TEAM_MANAGEMENT_STORE_INVALID";

  constructor(message: string) {
    super(message);
    this.name = "TeamManagementStoreError";
  }
}
