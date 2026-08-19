import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import {
  getTeamsRoot,
  listTeamLocations,
  readTeamSnapshot,
  resolveRelocatedUserTeamLocation,
  type TeamLocation,
  type TeamSnapshot,
} from "./team-store.js";
import {
  isValidPathSegment,
  parseTeamDefinitionJson,
  serializeTeamDefinition,
  type TeamDefinition,
} from "./team-model.js";
import {
  readLegacyEmbeddedOnboardingOrchestration,
  serializeLegacyRelayInclusiveTeamDefinition,
  type TeamRelayBeat,
} from "./team-onboarding-orchestration.js";
import {
  normalizeGithubRepository,
} from "./github-team-contract.js";
import type { GithubTeamUpstreamRecord } from "./github-team-install-plan.js";
import {
  assertUserTeamRecordOwnership,
  classifyUserTeamRecordLocation,
  TeamRecordError,
  type UserTeamRecordLocation,
} from "./team-record-plan.js";

export { TeamRecordError } from "./team-record-plan.js";
export type { UserTeamRecordLocation } from "./team-record-plan.js";

export const USER_TEAM_RECORDS_FILE = ".agent-team-records.json";

export interface UserTeamRecord {
  id: string;
  location: UserTeamRecordLocation;
  identityFingerprint: string | null;
  lastKnownDefinition: TeamDefinition | null;
  upstream?: GithubTeamUpstreamRecord;
  /** Transitional compatibility input retained only until a live snapshot can refresh the record. */
  legacyRelayBeats?: TeamRelayBeat[];
}

export interface UserTeamRecordsDocument {
  version: 2;
  records: UserTeamRecord[];
}

export interface RecordedUserTeamSnapshot {
  record: UserTeamRecord;
  snapshot: TeamSnapshot;
}

export async function listRecordedUserTeamSnapshots(dataRoot: string): Promise<RecordedUserTeamSnapshot[]> {
  const document = await loadOrBootstrapRecords(dataRoot);
  const results: RecordedUserTeamSnapshot[] = [];
  let changed = false;

  for (const record of document.records) {
    const location = locationForRecord(dataRoot, record);
    const snapshot = await readTeamSnapshot(location);
    const refreshed = refreshRecordFromSnapshot(record, snapshot);
    if (!recordsEqual(refreshed, record)) {
      changed = true;
    }
    results.push({ record: refreshed, snapshot });
  }

  if (changed) {
    await writeRecords(dataRoot, { version: 2, records: results.map(({ record }) => record) });
  }
  return results;
}

export async function resolveRecordedTeamLocation(dataRoot: string, teamId: string): Promise<TeamLocation> {
  const document = await loadOrBootstrapRecords(dataRoot);
  const record = document.records.find((candidate) => candidate.id === teamId);
  if (record === undefined) {
    throw new TeamRecordError("这支团队的应用记录不存在，请重新载入团队列表。");
  }
  return locationForRecord(dataRoot, record);
}

export async function registerUserTeamSnapshot(snapshot: TeamSnapshot): Promise<void> {
  assertUserTeamRecordOwnership(snapshot.location.ownership);
  const dataRoot = snapshot.location.dataRoot;
  const document = await loadOrBootstrapRecords(dataRoot);
  const location = recordLocationFromDirectory(dataRoot, snapshot.location.directory);
  const existing = document.records.find((record) => record.id === snapshot.location.id);
  const base: UserTeamRecord = existing ?? {
    id: snapshot.location.id,
    location,
    identityFingerprint: null,
    lastKnownDefinition: null,
  };
  const nextRecord = refreshRecordFromSnapshot({ ...base, location }, snapshot);
  const nextRecords = document.records.filter((record) => record.id !== nextRecord.id);
  nextRecords.push(nextRecord);
  await writeRecords(dataRoot, { version: 2, records: sortRecords(nextRecords) });
}

export async function readPersistedUserTeamRecordsDocument(
  dataRoot: string,
): Promise<UserTeamRecordsDocument | null> {
  return (await readPersistedRecords(dataRoot))?.document ?? null;
}

export async function readOrBuildUserTeamRecordsDocument(
  dataRoot: string,
): Promise<UserTeamRecordsDocument> {
  const persisted = await readPersistedRecords(dataRoot);
  if (persisted !== null) {
    return persisted.document;
  }
  return buildUserTeamRecordsDocument(dataRoot);
}

export function getUserTeamRecordsPath(dataRoot: string): string {
  return getRecordsPath(dataRoot);
}

async function readPersistedRecords(
  dataRoot: string,
): Promise<{ document: UserTeamRecordsDocument; sourceVersion: 1 | 2 } | null> {
  try {
    return parseRecordsDocumentWithSourceVersion(
      await fs.readFile(getRecordsPath(dataRoot), "utf8"),
    );
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") {
      return null;
    }
    throw error;
  }
}

export async function buildUserTeamRecordsDocument(
  dataRoot: string,
): Promise<UserTeamRecordsDocument> {
  const locations = (await listTeamLocations(dataRoot)).filter((location) => location.ownership === "user");
  const records: UserTeamRecord[] = [];
  for (const location of locations) {
    const snapshot = await readTeamSnapshot(location);
    records.push(refreshRecordFromSnapshot({
      id: location.id,
      location: { kind: "managed", directoryName: path.basename(location.directory) },
      identityFingerprint: null,
      lastKnownDefinition: null,
    }, snapshot));
  }
  return { version: 2, records: sortRecords(records) };
}

export function upsertUserTeamRecord(
  document: UserTeamRecordsDocument,
  snapshot: TeamSnapshot,
): UserTeamRecordsDocument {
  assertUserTeamRecordOwnership(snapshot.location.ownership);
  const location = recordLocationFromDirectory(
    snapshot.location.dataRoot,
    snapshot.location.directory,
  );
  const existing = document.records.find((record) => record.id === snapshot.location.id);
  const base: UserTeamRecord = existing ?? {
    id: snapshot.location.id,
    location,
    identityFingerprint: null,
    lastKnownDefinition: null,
  };
  const nextRecord = refreshRecordFromSnapshot({ ...base, location }, snapshot);
  return {
    version: 2,
    records: sortRecords([
      ...document.records.filter((record) => record.id !== nextRecord.id),
      nextRecord,
    ]),
  };
}

export async function writeUserTeamRecordsDocument(
  dataRoot: string,
  document: UserTeamRecordsDocument | null,
): Promise<void> {
  if (document === null) {
    await fs.rm(getRecordsPath(dataRoot), { force: true });
    return;
  }
  await writeRecords(dataRoot, document);
}

export async function relocateUserTeamRecord(input: {
  dataRoot: string;
  teamId: string;
  directory: string;
}): Promise<TeamSnapshot> {
  const document = await loadOrBootstrapRecords(input.dataRoot);
  const recordIndex = document.records.findIndex((record) => record.id === input.teamId);
  if (recordIndex < 0) {
    throw new TeamRelocationError("原团队记录不存在，无法重新定位。");
  }
  const record = document.records[recordIndex]!;

  let candidateLocation: TeamLocation;
  try {
    candidateLocation = resolveRelocatedUserTeamLocation({
      dataRoot: input.dataRoot,
      teamId: record.id,
      directory: input.directory,
    });
  } catch {
    throw new TeamRelocationError("请选择一支有效的用户 Agent 团队文件夹。");
  }

  const occupied = document.records.find(
    (candidate, index) => index !== recordIndex
      && path.resolve(locationForRecord(input.dataRoot, candidate).directory) === candidateLocation.directory,
  );
  if (occupied !== undefined) {
    throw new TeamRelocationError("这个位置已经属于另一支团队，不能重复绑定。");
  }

  const candidate = await readTeamSnapshot(candidateLocation);
  if (candidate.status !== "usable") {
    throw new TeamRelocationError(explainRejectedCandidate(candidate));
  }
  if (record.identityFingerprint === null) {
    throw new TeamRelocationError("原记录缺少足够的完整信息，暂时无法确认所选位置属于同一支团队。");
  }
  const candidateFingerprints = [
    createTeamIdentityFingerprint(candidate),
    ...(record.legacyRelayBeats === undefined
      ? []
      : [createTeamIdentityFingerprint(candidate, record.legacyRelayBeats)]),
  ];
  if (!candidateFingerprints.includes(record.identityFingerprint)) {
    throw new TeamRelocationError("所选位置的团队名称、成员或 AGENT.md 内容与原记录不一致，不能认作同一支团队。");
  }

  const updatedRecord = refreshRecordFromSnapshot({
    ...record,
    location: recordLocationFromDirectory(input.dataRoot, candidateLocation.directory),
  }, candidate);
  const nextRecords = [...document.records];
  nextRecords[recordIndex] = updatedRecord;
  await writeRecords(input.dataRoot, { version: 2, records: nextRecords });
  return candidate;
}

export async function removeUserTeamRecord(input: { dataRoot: string; teamId: string }): Promise<void> {
  const document = await loadOrBootstrapRecords(input.dataRoot);
  const record = document.records.find((candidate) => candidate.id === input.teamId);
  if (record === undefined) {
    throw new TeamRecordError("这支团队的应用记录已经不存在。");
  }

  const snapshot = await readTeamSnapshot(locationForRecord(input.dataRoot, record));
  if (snapshot.status !== "needs-repair") {
    throw new TeamRecordError("只有需要修复的失效团队记录可以移除。");
  }

  await writeRecords(input.dataRoot, {
    version: 2,
    records: document.records.filter((candidate) => candidate.id !== input.teamId),
  });
}

export async function forgetTrashedUserTeamRecord(input: { dataRoot: string; teamId: string }): Promise<void> {
  const document = await loadOrBootstrapRecords(input.dataRoot);
  const nextRecords = document.records.filter((candidate) => candidate.id !== input.teamId);
  if (nextRecords.length === document.records.length) {
    return;
  }
  await writeRecords(input.dataRoot, { version: 2, records: nextRecords });
}

export function createTeamIdentityFingerprint(
  snapshot: TeamSnapshot,
  legacyRelayBeats?: readonly TeamRelayBeat[],
): string {
  if (snapshot.status !== "usable" || snapshot.definition === null) {
    throw new TeamRecordError("只有完整可用的团队才能生成身份指纹。");
  }
  const membersBySlug = new Map(snapshot.members.map((member) => [member.slug, member]));
  const hash = createHash("sha256");
  hash.update(legacyRelayBeats === undefined
    ? serializeTeamDefinition(snapshot.definition)
    : serializeLegacyRelayInclusiveTeamDefinition(snapshot.definition, legacyRelayBeats));
  for (const slug of snapshot.definition.memberOrder) {
    const member = membersBySlug.get(slug);
    if (member === undefined) {
      throw new TeamRecordError("团队成员文件不完整，无法生成身份指纹。");
    }
    hash.update(`\u0000${slug}\u0000${member.agentMarkdown}`);
  }
  return hash.digest("hex");
}

export class TeamRelocationError extends Error {
  readonly code = "TEAM_RELOCATION_REJECTED";

  constructor(message: string) {
    super(message);
    this.name = "TeamRelocationError";
  }
}

async function loadOrBootstrapRecords(dataRoot: string): Promise<UserTeamRecordsDocument> {
  const persisted = await readPersistedRecords(dataRoot);
  if (persisted !== null) {
    if (persisted.sourceVersion === 1) {
      await writeRecords(dataRoot, persisted.document);
    }
    return persisted.document;
  }
  const document = await buildUserTeamRecordsDocument(dataRoot);
  await writeRecords(dataRoot, document);
  return document;
}

function refreshRecordFromSnapshot(record: UserTeamRecord, snapshot: TeamSnapshot): UserTeamRecord {
  if (snapshot.status === "needs-repair") {
    return record;
  }
  return {
    id: record.id,
    location: record.location,
    identityFingerprint: snapshot.status === "usable" ? createTeamIdentityFingerprint(snapshot) : null,
    lastKnownDefinition: snapshot.definition,
    ...(record.upstream === undefined ? {} : { upstream: record.upstream }),
  };
}

function locationForRecord(dataRoot: string, record: UserTeamRecord): TeamLocation {
  return resolveRelocatedUserTeamLocation({
    dataRoot,
    teamId: record.id,
    directory: record.location.kind === "managed"
      ? path.join(getTeamsRoot(dataRoot), record.location.directoryName)
      : record.location.absolutePath,
  });
}

function recordLocationFromDirectory(dataRoot: string, directory: string): UserTeamRecordLocation {
  const resolvedDirectory = path.resolve(directory);
  const teamsRoot = getTeamsRoot(dataRoot);
  return classifyUserTeamRecordLocation({
    isManagedDirectory: path.dirname(resolvedDirectory) === teamsRoot,
    directoryName: path.basename(resolvedDirectory),
    absolutePath: resolvedDirectory,
  });
}

function explainRejectedCandidate(snapshot: TeamSnapshot): string {
  const codes = new Set(snapshot.issues.map((issue) => issue.code));
  if (codes.has("team-directory-missing") || codes.has("team-directory-unreadable")) {
    return "所选位置不是可读取的团队文件夹。";
  }
  if (codes.has("team-manifest-missing") || codes.has("team-manifest-unreadable") || codes.has("team-manifest-invalid")) {
    return "所选位置缺少可读取的团队信息文件。";
  }
  if (
    codes.has("member-agent-missing")
    || codes.has("member-agent-unreadable")
    || codes.has("member-agent-metadata-invalid")
  ) {
    return "所选团队有成员的 AGENT.md 缺失、无法读取或身份元数据无效。";
  }
  if (codes.has("member-slug-missing") || codes.has("member-slug-duplicate")) {
    return "所选团队的成员标识缺失或重复。";
  }
  return "所选位置不是一支结构完整、可用于新建对话的团队。";
}

function getRecordsPath(dataRoot: string): string {
  return path.join(getTeamsRoot(dataRoot), USER_TEAM_RECORDS_FILE);
}

async function writeRecords(dataRoot: string, document: UserTeamRecordsDocument): Promise<void> {
  const recordsPath = getRecordsPath(dataRoot);
  await fs.mkdir(path.dirname(recordsPath), { recursive: true });
  const temporaryPath = `${recordsPath}.tmp-${process.pid}-${randomUUID()}`;
  try {
    await fs.writeFile(temporaryPath, `${JSON.stringify({
      version: document.version,
      records: document.records.map(toPersistedRecord),
    }, null, 2)}\n`, "utf8");
    await fs.rename(temporaryPath, recordsPath);
  } catch (error) {
    await fs.rm(temporaryPath, { force: true });
    throw error;
  }
}

function parseRecordsDocumentWithSourceVersion(
  source: string,
): { document: UserTeamRecordsDocument; sourceVersion: 1 | 2 } {
  const value: unknown = JSON.parse(source);
  if (!isPlainObject(value) || (value.version !== 1 && value.version !== 2) || !Array.isArray(value.records)) {
    throw new TeamRecordError("Agent 团队记录文件无法读取。");
  }
  const version = value.version as 1 | 2;
  const records = value.records.map((record) => parseRecord(record, version));
  const ids = new Set<string>();
  const directories = new Set<string>();
  for (const record of records) {
    const directory = locationForRecord("/", record).directory;
    if (ids.has(record.id) || directories.has(directory)) {
      throw new TeamRecordError("Agent 团队记录中存在重复条目。");
    }
    ids.add(record.id);
    directories.add(directory);
  }
  return {
    document: { version: 2, records: sortRecords(records) },
    sourceVersion: version,
  };
}

function parseRecord(value: unknown, version: 1 | 2): UserTeamRecord {
  if (!isPlainObject(value)
    || typeof value.id !== "string"
    || (value.identityFingerprint !== null && typeof value.identityFingerprint !== "string")
    || (value.lastKnownDefinition !== null && !isPlainObject(value.lastKnownDefinition))) {
    throw new TeamRecordError("Agent 团队记录包含无效条目。");
  }
  if (!isValidPathSegment(value.id) || value.id.trim() !== value.id) {
    throw new TeamRecordError("Agent 团队记录包含无效位置。");
  }
  const location = version === 1
    ? parseLegacyLocation(value.directoryName)
    : parseRecordLocation(value.location);
  const definition = value.lastKnownDefinition === null
    ? null
    : parseCachedDefinition(value.lastKnownDefinition);
  const upstream = value.upstream === undefined ? undefined : parseGithubTeamUpstream(value.upstream);
  const legacyOrchestration = definition === null
    ? { status: "missing" as const }
    : readLegacyEmbeddedOnboardingOrchestration(value.lastKnownDefinition, definition.memberOrder);
  return {
    id: value.id,
    location,
    identityFingerprint: value.identityFingerprint,
    lastKnownDefinition: definition,
    ...(upstream === undefined ? {} : { upstream }),
    ...(legacyOrchestration.status === "ready"
      ? { legacyRelayBeats: legacyOrchestration.orchestration.relayBeats }
      : {}),
  };
}

function parseGithubTeamUpstream(value: unknown): GithubTeamUpstreamRecord {
  if (!isPlainObject(value) || value.provider !== "github") {
    throw new TeamRecordError("Agent 团队记录包含无效上游来源。");
  }
  const repository = typeof value.repository === "string"
    ? normalizeGithubRepository(value.repository)
    : null;
  if (repository === null || typeof value.defaultBranch !== "string" || value.defaultBranch.trim().length === 0) {
    throw new TeamRecordError("Agent 团队记录包含无效 GitHub 上游来源。");
  }
  return {
    provider: "github",
    repository,
    defaultBranch: value.defaultBranch.trim(),
  };
}

function parseLegacyLocation(value: unknown): UserTeamRecordLocation {
  if (typeof value !== "string" || !isValidPathSegment(value) || value.trim() !== value) {
    throw new TeamRecordError("Agent 团队记录包含无效位置。");
  }
  return { kind: "managed", directoryName: value };
}

function parseRecordLocation(value: unknown): UserTeamRecordLocation {
  if (!isPlainObject(value) || (value.kind !== "managed" && value.kind !== "external")) {
    throw new TeamRecordError("Agent 团队记录包含无效位置。");
  }
  if (value.kind === "managed") {
    return parseLegacyLocation(value.directoryName);
  }
  if (typeof value.absolutePath !== "string" || !path.isAbsolute(value.absolutePath)) {
    throw new TeamRecordError("Agent 团队记录包含无效外部位置。");
  }
  return { kind: "external", absolutePath: path.resolve(value.absolutePath) };
}

function parseCachedDefinition(value: Record<string, unknown>): TeamDefinition {
  return parseTeamDefinitionJson(JSON.stringify(value));
}

function sortRecords(records: UserTeamRecord[]): UserTeamRecord[] {
  return [...records].sort((left, right) => left.id.localeCompare(right.id));
}

function recordsEqual(left: UserTeamRecord, right: UserTeamRecord): boolean {
  return JSON.stringify(toPersistedRecord(left)) === JSON.stringify(toPersistedRecord(right));
}

function toPersistedRecord(record: UserTeamRecord): Record<string, unknown> {
  const lastKnownDefinition = record.legacyRelayBeats === undefined || record.lastKnownDefinition === null
    ? record.lastKnownDefinition
    : {
        ...record.lastKnownDefinition,
        relayBeats: record.legacyRelayBeats,
      };
  return {
    id: record.id,
    location: record.location,
    identityFingerprint: record.identityFingerprint,
    lastKnownDefinition,
    ...(record.upstream === undefined ? {} : { upstream: record.upstream }),
  };
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}
