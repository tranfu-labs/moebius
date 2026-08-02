import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

import {
  getAgentTeamsStateRoot,
  getPackagedTeamCacheDirectory,
  readExecutionBindingDocument,
  readOfficialTeamStateDocument,
  teamBindingKey,
  writeExecutionBindingDocument,
  writeOfficialTeamStateDocument,
  type OfficialTeamStateDocumentV1,
  type TeamExecutionBindingDocumentV1,
} from "./team-management-store.js";
import {
  computeOfficialTeamContentFingerprint,
  deriveOfficialTeamUpdateState,
  readPackagedOfficialTeamManifest,
  recommendationFingerprint,
  recommendationsFromManifest,
  type OfficialTeamUpdateState,
} from "./team-official-management.js";
import {
  assertOfficialContentFingerprint,
  createOfficialUpdatePlanId,
  selectBindingMembers,
  selectPersistedDocumentSource,
  selectSnapshotMemberSlugs,
} from "./team-official-update-plan.js";
import {
  materializeExplicitBindings,
  migrateOfficialMemberBindings,
  type ExecutionProfileBinding,
} from "./team-execution-profile.js";
import {
  getTeamsRoot,
  readTeamSnapshot,
  resolveTeamLocation,
} from "./team-store.js";
import {
  buildUserTeamRecordsDocument,
  readPersistedUserTeamRecordsDocument,
  upsertUserTeamRecord,
  writeUserTeamRecordsDocument,
  type UserTeamRecordsDocument,
} from "./team-record-store.js";

const JOURNAL_FILE = "official-update-journal-v1.json";
const COMPLETED_UPDATES_FILE = "official-update-receipts-v1.json";
const UPDATE_STAGING_DIRECTORY = "official-update-staging";

export interface PreparedOfficialTeamUpdate {
  schemaVersion: 1;
  planId: string;
  teamId: string;
  inputFingerprint: string;
  state: OfficialTeamUpdateState;
  copyTeamId: string | null;
}

export interface AppliedOfficialTeamUpdate {
  teamId: string;
  copiedTeamId: string | null;
  appliedOfficialVersion: string;
  memberChanges: {
    added: string[];
    removed: string[];
    renamed: Array<{ from: string; to: string }>;
    recommendationChanged: string[];
  };
  state: OfficialTeamUpdateState;
}

interface UpdateJournalV1 {
  schemaVersion: 1;
  planId: string;
  teamId: string;
  copyTeamId: string | null;
  officialDirectory: string;
  officialStagingDirectory: string;
  backupDirectory: string;
  copyStagingDirectory: string | null;
  copyPublishedDirectory: string | null;
  copyReservationToken: string | null;
  copyPublishOwned: boolean;
  copyPublished: boolean;
  previousOfficialDocument: OfficialTeamStateDocumentV1;
  previousBindingDocument: TeamExecutionBindingDocumentV1;
  previousUserTeamRecordsDocument: UserTeamRecordsDocument | null;
}

export async function inspectOfficialTeamUpdate(input: {
  dataRoot: string;
  teamId: string;
}): Promise<OfficialTeamUpdateState> {
  return (await readUpdateInputs(input)).state;
}

export async function prepareOfficialTeamUpdate(input: {
  dataRoot: string;
  teamId: string;
}): Promise<PreparedOfficialTeamUpdate> {
  const stateInput = await readUpdateInputs(input);
  if (stateInput.state.primaryAction === "none" || stateInput.state.primaryAction === "retry") {
    throw new OfficialTeamUpdateError(
      stateInput.state.primaryAction === "none"
        ? "这支官方团队当前没有可应用的更新。"
        : "暂时无法检查这支官方团队的更新。",
      stateInput.state.primaryAction === "none" ? "NO_OFFICIAL_UPDATE" : "OFFICIAL_UPDATE_UNAVAILABLE",
    );
  }
  const inputFingerprint = updateInputFingerprint(stateInput);
  const copyTeamId = stateInput.state.requiresProtectiveCopy
    ? await findAvailableCopyTeamId(input.dataRoot, input.teamId)
    : null;
  return {
    schemaVersion: 1,
    planId: createOfficialUpdatePlanId({
      teamId: input.teamId,
      inputFingerprint,
      copyTeamId,
    }),
    teamId: input.teamId,
    inputFingerprint,
    state: stateInput.state,
    copyTeamId,
  };
}

export async function commitOfficialTeamUpdate(input: {
  dataRoot: string;
  plan: PreparedOfficialTeamUpdate;
}): Promise<AppliedOfficialTeamUpdate> {
  await recoverOfficialTeamUpdateTransactions(input.dataRoot);
  const completed = await readCompletedUpdate(input.dataRoot, input.plan);
  if (completed !== null) {
    return completed;
  }
  const canonicalPlan = await prepareOfficialTeamUpdate({
    dataRoot: input.dataRoot,
    teamId: input.plan.teamId,
  });
  if (!plansEqual(input.plan, canonicalPlan)) {
    throw new OfficialTeamUpdateError(
      "团队更新计划已失效或被修改，请重新检查更新。",
      "STALE_UPDATE_PLAN",
    );
  }
  const plan = canonicalPlan;
  const current = await readUpdateInputs({ dataRoot: input.dataRoot, teamId: plan.teamId });

  const officialDocument = await readOfficialTeamStateDocument(input.dataRoot);
  const bindingDocument = await readExecutionBindingDocument(input.dataRoot);
  const previousUserTeamRecordsDocument = await readPersistedUserTeamRecordsDocument(input.dataRoot);
  const userTeamRecordLoaders = {
    persisted: async () => previousUserTeamRecordsDocument as UserTeamRecordsDocument,
    rebuild: async () => await buildUserTeamRecordsDocument(input.dataRoot),
  };
  const baseUserTeamRecordsDocument = await userTeamRecordLoaders[
    selectPersistedDocumentSource(previousUserTeamRecordsDocument)
  ]();
  const officialDirectory = resolveTeamLocation({
    dataRoot: input.dataRoot,
    teamId: plan.teamId,
    ownership: "system",
  }).directory;
  const packagedDirectory = getPackagedTeamCacheDirectory(input.dataRoot, plan.teamId);
  const stagingRoot = path.join(getAgentTeamsStateRoot(input.dataRoot), UPDATE_STAGING_DIRECTORY);
  const transactionRoot = path.join(stagingRoot, plan.planId);
  const officialStagingDirectory = path.join(transactionRoot, "official");
  const backupDirectory = path.join(transactionRoot, "backup");
  const copyStagingDirectory = plan.copyTeamId === null
    ? null
    : path.join(transactionRoot, "copy");
  const copyPublishedDirectory = plan.copyTeamId === null
    ? null
    : path.join(getTeamsRoot(input.dataRoot), plan.copyTeamId);
  const copyReservationToken = plan.copyTeamId === null
    ? null
    : createHash("sha256").update(`copy-reservation\0${plan.planId}`).digest("hex");
  const journal: UpdateJournalV1 = {
    schemaVersion: 1,
    planId: plan.planId,
    teamId: plan.teamId,
    copyTeamId: plan.copyTeamId,
    officialDirectory,
    officialStagingDirectory,
    backupDirectory,
    copyStagingDirectory,
    copyPublishedDirectory,
    copyReservationToken,
    copyPublishOwned: false,
    copyPublished: false,
    previousOfficialDocument: structuredClone(officialDocument),
    previousBindingDocument: structuredClone(bindingDocument),
    previousUserTeamRecordsDocument: structuredClone(previousUserTeamRecordsDocument),
  };

  await fs.rm(transactionRoot, { recursive: true, force: true });
  await fs.mkdir(transactionRoot, { recursive: true });
  const officialSnapshot = await readTeamSnapshot(resolveTeamLocation({
    dataRoot: input.dataRoot,
    teamId: plan.teamId,
    ownership: "system",
  }));
  const currentBindings = current.bindings;
  let copyBindings: Record<string, ExecutionProfileBinding> | null = null;
  if (copyStagingDirectory !== null) {
    if (officialSnapshot.definition === null) {
      throw new OfficialTeamUpdateError("当前团队结构不可用，无法保留副本。", "OFFICIAL_UPDATE_UNAVAILABLE");
    }
    await fs.cp(officialDirectory, copyStagingDirectory, {
      recursive: true,
      force: false,
      errorOnExist: true,
    });
    copyBindings = materializeExplicitBindings({
      memberSlugs: officialSnapshot.definition.memberOrder,
      bindings: currentBindings,
      recommendations: current.applied.appliedRecommendations,
    });
  }

  const shouldReplaceContent = current.state.primaryAction !== "register";
  if (shouldReplaceContent) {
    await fs.cp(packagedDirectory, officialStagingDirectory, {
      recursive: true,
      force: false,
      errorOnExist: true,
    });
    await fs.rm(path.join(officialStagingDirectory, "official.json"), { force: true });
    assertOfficialContentFingerprint(
      await computeOfficialTeamContentFingerprint(officialStagingDirectory),
      current.packaged.contentFingerprint,
      () => new OfficialTeamUpdateError(
        "官方团队更新包校验失败。",
        "OFFICIAL_UPDATE_UNAVAILABLE",
      ),
    );
  }

  await writeJournal(input.dataRoot, journal);
  try {
    if (
      copyStagingDirectory !== null
      && copyPublishedDirectory !== null
      && copyReservationToken !== null
    ) {
      try {
        await fs.mkdir(copyPublishedDirectory);
      } catch (error) {
        if (isNodeError(error) && error.code === "EEXIST") {
          throw new OfficialTeamUpdateError(
            "保留副本名称已被占用，请重新检查更新。",
            "STALE_UPDATE_PLAN",
          );
        }
        throw error;
      }
      await fs.writeFile(
        copyReservationMarker(copyPublishedDirectory),
        copyReservationToken,
        { encoding: "utf8", flag: "wx", mode: 0o600 },
      );
      journal.copyPublishOwned = true;
      await writeJournal(input.dataRoot, journal);
      for (const entry of await fs.readdir(copyStagingDirectory)) {
        await fs.rename(
          path.join(copyStagingDirectory, entry),
          path.join(copyPublishedDirectory, entry),
        );
      }
      journal.copyPublished = true;
      await writeJournal(input.dataRoot, journal);
    }
    if (shouldReplaceContent) {
      await fs.rename(officialDirectory, backupDirectory);
      await fs.rename(officialStagingDirectory, officialDirectory);
    }

    const migrated = migrateOfficialMemberBindings({
      previousMembers: current.applied.appliedRecommendations,
      nextMembers: current.packagedRecommendations,
      bindings: currentBindings,
    });
    officialDocument.teams[plan.teamId] = {
      appliedOfficialVersion: current.packaged.manifest.officialVersion,
      appliedContentFingerprint: current.packaged.contentFingerprint,
      appliedRecommendationFingerprint: recommendationFingerprint(current.packagedRecommendations),
      appliedRecommendations: current.packagedRecommendations,
      baselineConfidence: "verified",
    };
    bindingDocument.teams[teamBindingKey("system", plan.teamId)] = {
      ownership: "system",
      members: migrated.nextBindings,
    };
    if (plan.copyTeamId !== null && copyBindings !== null) {
      bindingDocument.teams[teamBindingKey("user", plan.copyTeamId)] = {
        ownership: "user",
        members: copyBindings,
      };
    }
    await writeOfficialTeamStateDocument(input.dataRoot, officialDocument);
    await writeExecutionBindingDocument(input.dataRoot, bindingDocument);
    if (copyPublishedDirectory !== null && plan.copyTeamId !== null) {
      const copiedSnapshot = await readTeamSnapshot(resolveTeamLocation({
        dataRoot: input.dataRoot,
        teamId: plan.copyTeamId,
        ownership: "user",
      }));
      await writeUserTeamRecordsDocument(
        input.dataRoot,
        upsertUserTeamRecord(baseUserTeamRecordsDocument, copiedSnapshot),
      );
    }
    const result: AppliedOfficialTeamUpdate = {
      teamId: plan.teamId,
      copiedTeamId: plan.copyTeamId,
      appliedOfficialVersion: current.packaged.manifest.officialVersion,
      memberChanges: {
        added: [...current.state.addedMembers],
        removed: [...current.state.removedMembers],
        renamed: current.state.renamedMembers.map((entry) => ({ ...entry })),
        recommendationChanged: [...current.state.recommendationChangedMembers],
      },
      state: current.state,
    };
    await writeCompletedUpdate(input.dataRoot, plan, result);
    await finalizeJournal(input.dataRoot, journal);
    return result;
  } catch (error) {
    if (await readCompletedUpdate(input.dataRoot, plan) !== null) {
      throw error;
    }
    await rollbackJournal(input.dataRoot, journal);
    throw error;
  }
}

export async function recoverOfficialTeamUpdateTransactions(dataRoot: string): Promise<void> {
  const journal = await readJournal(dataRoot);
  if (journal === null) {
    return;
  }
  const receipt = await readCompletedUpdateByPlanId(dataRoot, journal.planId);
  if (receipt !== null) {
    await finalizeJournal(dataRoot, journal);
    return;
  }
  await rollbackJournal(dataRoot, journal);
}

interface ReadUpdateInputs {
  applied: ReturnType<typeof getApplied>;
  bindings: Record<string, ExecutionProfileBinding>;
  currentContentFingerprint: string | null;
  currentMemberSlugs: string[];
  packaged: {
    manifest: Awaited<ReturnType<typeof readPackagedOfficialTeamManifest>>;
    contentFingerprint: string;
  };
  packagedRecommendations: ReturnType<typeof recommendationsFromManifest>;
  state: OfficialTeamUpdateState;
}

async function readUpdateInputs(input: {
  dataRoot: string;
  teamId: string;
}): Promise<ReadUpdateInputs> {
  const officialDocument = await readOfficialTeamStateDocument(input.dataRoot);
  const applied = getApplied(officialDocument, input.teamId);
  const bindingDocument = await readExecutionBindingDocument(input.dataRoot);
  const bindings = selectBindingMembers(
    bindingDocument.teams[teamBindingKey("system", input.teamId)]?.members,
    {},
  );
  const location = resolveTeamLocation({
    dataRoot: input.dataRoot,
    teamId: input.teamId,
    ownership: "system",
  });
  const snapshot = await readTeamSnapshot(location);
  const currentContentFingerprint = snapshot.definition === null
    ? null
    : await tryContentFingerprint(location.directory);
  const packagedDirectory = getPackagedTeamCacheDirectory(input.dataRoot, input.teamId);
  const manifest = await readPackagedOfficialTeamManifest(packagedDirectory);
  const packaged = {
    manifest,
    contentFingerprint: await computeOfficialTeamContentFingerprint(packagedDirectory),
  };
  const packagedRecommendations = recommendationsFromManifest(manifest);
  const currentMemberSlugs = selectSnapshotMemberSlugs({
    memberOrder: snapshot.definition?.memberOrder,
    members: snapshot.members,
  });
  const state = deriveOfficialTeamUpdateState({
    applied,
    currentContentFingerprint,
    currentMemberSlugs,
    packaged,
    bindings,
  });
  return {
    applied,
    bindings,
    currentContentFingerprint,
    currentMemberSlugs,
    packaged,
    packagedRecommendations,
    state,
  };
}

function getApplied(document: OfficialTeamStateDocumentV1, teamId: string) {
  const applied = document.teams[teamId];
  if (applied === undefined) {
    throw new OfficialTeamUpdateError("这支团队没有官方基线。", "OFFICIAL_UPDATE_UNAVAILABLE");
  }
  return applied;
}

function updateInputFingerprint(input: ReadUpdateInputs): string {
  return createHash("sha256")
    .update("moebius-official-update-input-v1\0")
    .update(JSON.stringify({
      applied: input.applied,
      bindings: input.bindings,
      currentContentFingerprint: input.currentContentFingerprint,
      currentMemberSlugs: input.currentMemberSlugs,
      packaged: input.packaged,
      state: input.state,
    }))
    .digest("hex");
}

async function findAvailableCopyTeamId(dataRoot: string, teamId: string): Promise<string> {
  for (let index = 1; ; index += 1) {
    const candidate = `${teamId}-copy${index === 1 ? "" : `-${index}`}`;
    try {
      await fs.access(path.join(getTeamsRoot(dataRoot), candidate));
    } catch (error) {
      if (isNodeError(error) && error.code === "ENOENT") {
        return candidate;
      }
      throw error;
    }
  }
}

async function rollbackJournal(dataRoot: string, journal: UpdateJournalV1): Promise<void> {
  if (await pathExists(journal.backupDirectory)) {
    await fs.rm(journal.officialDirectory, { recursive: true, force: true });
    await fs.rename(journal.backupDirectory, journal.officialDirectory);
  }
  if (
    journal.copyPublishedDirectory !== null
    && journal.copyPublishOwned === true
    && await reservationBelongsToJournal(journal)
  ) {
    await fs.rm(journal.copyPublishedDirectory, { recursive: true, force: true });
  }
  await writeOfficialTeamStateDocument(dataRoot, journal.previousOfficialDocument);
  await writeExecutionBindingDocument(dataRoot, journal.previousBindingDocument);
  if (journal.previousUserTeamRecordsDocument !== undefined) {
    await writeUserTeamRecordsDocument(dataRoot, journal.previousUserTeamRecordsDocument);
  }
  await fs.rm(path.dirname(journal.officialStagingDirectory), { recursive: true, force: true });
  await removeJournal(dataRoot);
}

async function finalizeJournal(dataRoot: string, journal: UpdateJournalV1): Promise<void> {
  if (
    journal.copyPublishedDirectory !== null
    && journal.copyPublishOwned === true
    && await reservationBelongsToJournal(journal)
  ) {
    await fs.rm(copyReservationMarker(journal.copyPublishedDirectory), { force: true });
  }
  await fs.rm(journal.backupDirectory, { recursive: true, force: true });
  await fs.rm(path.dirname(journal.officialStagingDirectory), { recursive: true, force: true });
  await removeJournal(dataRoot);
}

function copyReservationMarker(directory: string): string {
  return path.join(directory, ".moebius-official-update-reservation");
}

async function reservationBelongsToJournal(journal: UpdateJournalV1): Promise<boolean> {
  if (journal.copyPublishedDirectory === null || journal.copyReservationToken == null) {
    return false;
  }
  try {
    return await fs.readFile(
      copyReservationMarker(journal.copyPublishedDirectory),
      "utf8",
    ) === journal.copyReservationToken;
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") {
      return false;
    }
    throw error;
  }
}

async function writeJournal(dataRoot: string, journal: UpdateJournalV1): Promise<void> {
  const journalPath = path.join(getAgentTeamsStateRoot(dataRoot), JOURNAL_FILE);
  await writeJsonAtomically(journalPath, journal);
}

async function readJournal(dataRoot: string): Promise<UpdateJournalV1 | null> {
  try {
    return JSON.parse(await fs.readFile(
      path.join(getAgentTeamsStateRoot(dataRoot), JOURNAL_FILE),
      "utf8",
    )) as UpdateJournalV1;
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") {
      return null;
    }
    throw error;
  }
}

async function removeJournal(dataRoot: string): Promise<void> {
  await fs.rm(path.join(getAgentTeamsStateRoot(dataRoot), JOURNAL_FILE), { force: true });
}

async function readCompletedUpdate(
  dataRoot: string,
  plan: PreparedOfficialTeamUpdate,
): Promise<AppliedOfficialTeamUpdate | null> {
  const receipt = await readCompletedUpdateReceipt(dataRoot, plan.planId);
  if (receipt === null) return null;
  if (!plansEqual(receipt.plan, plan)) {
    throw new OfficialTeamUpdateError(
      "官方团队更新计划与完成记录不一致。",
      "STALE_UPDATE_PLAN",
    );
  }
  return receipt.result;
}

async function readCompletedUpdateByPlanId(
  dataRoot: string,
  planId: string,
): Promise<AppliedOfficialTeamUpdate | null> {
  return (await readCompletedUpdateReceipt(dataRoot, planId))?.result ?? null;
}

async function readCompletedUpdateReceipt(
  dataRoot: string,
  planId: string,
): Promise<{ plan: PreparedOfficialTeamUpdate; result: AppliedOfficialTeamUpdate } | null> {
  let document: unknown;
  try {
    document = JSON.parse(await fs.readFile(
      path.join(getAgentTeamsStateRoot(dataRoot), COMPLETED_UPDATES_FILE),
      "utf8",
    )) as unknown;
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") {
      return null;
    }
    throw error;
  }
  if (!isPlainObject(document) || document.schemaVersion !== 1 || !isPlainObject(document.updates)) {
    throw new OfficialTeamUpdateError("官方团队更新记录无法读取。", "OFFICIAL_UPDATE_UNAVAILABLE");
  }
  const receipt = document.updates[planId];
  if (receipt === undefined) return null;
  if (
    !isPlainObject(receipt)
    || !isPreparedUpdate(receipt.plan)
    || !isAppliedUpdate(receipt.result)
  ) {
    throw new OfficialTeamUpdateError("官方团队更新记录无法读取。", "OFFICIAL_UPDATE_UNAVAILABLE");
  }
  return { plan: receipt.plan, result: receipt.result };
}

async function writeCompletedUpdate(
  dataRoot: string,
  plan: PreparedOfficialTeamUpdate,
  result: AppliedOfficialTeamUpdate,
): Promise<void> {
  const filePath = path.join(getAgentTeamsStateRoot(dataRoot), COMPLETED_UPDATES_FILE);
  let updates: Record<string, unknown> = {};
  try {
    const existing = JSON.parse(await fs.readFile(filePath, "utf8")) as unknown;
    if (!isPlainObject(existing) || existing.schemaVersion !== 1 || !isPlainObject(existing.updates)) {
      throw new OfficialTeamUpdateError("官方团队更新记录无法读取。", "OFFICIAL_UPDATE_UNAVAILABLE");
    }
    updates = existing.updates;
  } catch (error) {
    if (!isNodeError(error) || error.code !== "ENOENT") {
      throw error;
    }
  }
  await writeJsonAtomically(filePath, {
    schemaVersion: 1,
    updates: {
      ...updates,
      [plan.planId]: {
        plan,
        result,
      },
    },
  });
}

async function writeJsonAtomically(filePath: string, value: unknown): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const temporaryPath = `${filePath}.${process.pid}.tmp`;
  await fs.writeFile(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o600,
  });
  await fs.rename(temporaryPath, filePath);
}

function isAppliedUpdate(value: unknown): value is AppliedOfficialTeamUpdate {
  return isPlainObject(value)
    && typeof value.teamId === "string"
    && (typeof value.copiedTeamId === "string" || value.copiedTeamId === null)
    && typeof value.appliedOfficialVersion === "string"
    && isPlainObject(value.memberChanges)
    && Array.isArray(value.memberChanges.added)
    && Array.isArray(value.memberChanges.removed)
    && Array.isArray(value.memberChanges.renamed)
    && Array.isArray(value.memberChanges.recommendationChanged)
    && isPlainObject(value.state);
}

function isPreparedUpdate(value: unknown): value is PreparedOfficialTeamUpdate {
  return isPlainObject(value)
    && value.schemaVersion === 1
    && typeof value.planId === "string"
    && typeof value.teamId === "string"
    && typeof value.inputFingerprint === "string"
    && isPlainObject(value.state)
    && (typeof value.copyTeamId === "string" || value.copyTeamId === null);
}

function plansEqual(
  left: PreparedOfficialTeamUpdate,
  right: PreparedOfficialTeamUpdate,
): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function tryContentFingerprint(directory: string): Promise<string | null> {
  try {
    return await computeOfficialTeamContentFingerprint(directory);
  } catch {
    return null;
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

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}

export class OfficialTeamUpdateError extends Error {
  constructor(
    message: string,
    readonly code:
      | "NO_OFFICIAL_UPDATE"
      | "OFFICIAL_UPDATE_UNAVAILABLE"
      | "STALE_UPDATE_PLAN",
  ) {
    super(message);
    this.name = "OfficialTeamUpdateError";
  }
}
