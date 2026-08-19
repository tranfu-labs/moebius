import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

import type { AgentRevisionService } from "./agent-revision-service.js";
import { loadGithubTeamSnapshot } from "./github-team-remote.js";
import { planGithubTeamSync, type GithubTeamRemoteOfficialState } from "./github-team-sync-plan.js";
import type { GithubTeamTransport } from "./github-team-transport.js";
import {
  readExecutionBindingDocument,
  readOfficialTeamStateDocument,
  teamBindingKey,
  writeExecutionBindingDocument,
  writeOfficialTeamStateDocument,
} from "./team-management-store.js";
import { normalizeExecutionBinding } from "./team-management-document-codec.js";
import { readOrBuildUserTeamRecordsDocument } from "./team-record-store.js";
import {
  readOfficialSyncStateDocument,
  writeOfficialSyncStateDocument,
  type OfficialSyncStateDocumentV1,
} from "./team-sync-batch-store.js";
import {
  clearPendingMerge,
  computeDirectoryFingerprint,
  createTransactionRoot,
  finalizeJournal,
  pruneStagedContent,
  recordOfficialRevisions,
  recordUndoRevisions,
  recoverAutoSyncTransactions,
  resolveMergeCandidates,
  rollbackJournal,
  tryReadTeamDirectoryContent,
  writeContentToDirectory,
  writeJournal,
  type AutoSyncJournalV1,
  type DefaultAgentMergeMember,
} from "./team-auto-sync.js";
import {
  computeTargetContentFingerprint,
  isEmptyOfficialSyncMemberChanges,
  officialSyncAffectedMemberCount,
  type OfficialAutoSyncApply,
  type OfficialAutoSyncMemberChanges,
  type OfficialSyncBatchRecord,
  type OfficialTeamAutoSyncPlan,
  type OfficialTeamContent,
} from "./team-auto-sync-plan.js";
import {
  recommendationFingerprint,
  type AppliedOfficialTeamState,
} from "./team-official-plan.js";
import type { ExecutionProfile, ExecutionProfileBinding } from "./team-execution-profile.js";
import { resolveGithubTeamRecordLocation } from "./github-team-sync-check.js";

/**
 * Serializes sync/revert executions: the auto-sync journal is a single file
 * per data root and the directory swap is not reentrant, so concurrent IPC
 * calls (sync vs revert, or two syncs) must not interleave.
 */
let githubSyncQueue: Promise<unknown> = Promise.resolve();

function withGithubSyncLock<T>(action: () => Promise<T>): Promise<T> {
  const run = githubSyncQueue.then(action);
  githubSyncQueue = run.catch(() => undefined);
  return run;
}

export type GithubTeamSyncOutcome =
  | {
    status: "applied";
    changedMemberCount: number;
    pendingMergeMemberCount: number;
  }
  | { status: "up-to-date" }
  | { status: "not-following" }
  | { status: "unreachable" };

export async function syncGithubTeamUpstream(input: {
  dataRoot: string;
  teamId: string;
  transport: GithubTeamTransport;
  mergeMember: DefaultAgentMergeMember;
  revisionService: Pick<AgentRevisionService, "recordMemberRevision">;
  now?: string;
}): Promise<GithubTeamSyncOutcome> {
  const dataRoot = path.resolve(input.dataRoot);
  const now = input.now ?? new Date().toISOString();
  return withGithubSyncLock(() => syncGithubTeamUpstreamLocked({ ...input, dataRoot, now }));
}

async function syncGithubTeamUpstreamLocked(input: {
  dataRoot: string;
  teamId: string;
  transport: GithubTeamTransport;
  mergeMember: DefaultAgentMergeMember;
  revisionService: Pick<AgentRevisionService, "recordMemberRevision">;
  now: string;
}): Promise<GithubTeamSyncOutcome> {
  const { dataRoot, now } = input;
  await recoverAutoSyncTransactions(dataRoot);

  const records = await readOrBuildUserTeamRecordsDocument(dataRoot);
  const record = records.records.find((candidate) => candidate.id === input.teamId);
  if (record?.upstream === undefined) return { status: "not-following" };

  const snapshotResult = await loadGithubTeamSnapshot(input.transport, record.upstream.repository).catch(() => null);
  if (snapshotResult === null || snapshotResult.status === "invalid") return { status: "unreachable" };

  const location = resolveGithubTeamRecordLocation(dataRoot, record);
  const [officialDocument, bindingDocument, currentContent, syncDocument] = await Promise.all([
    readOfficialTeamStateDocument(dataRoot),
    readExecutionBindingDocument(dataRoot),
    tryReadTeamDirectoryContent(location.directory),
    readOfficialSyncStateDocument(dataRoot),
  ]);
  const appliedState = officialDocument.teams[input.teamId];
  if (appliedState === undefined || currentContent === null) return { status: "unreachable" };

  const bindings = bindingDocument.teams[teamBindingKey("user", input.teamId)]?.members ?? {};
  const plan = planGithubTeamSync({
    upstream: record.upstream,
    snapshot: snapshotResult.snapshot,
    applied: appliedState,
    currentContent,
    bindings,
    suppressedOfficialVersions: [],
  });
  if (plan.kind === "skip") return { status: "unreachable" };

  const remote = plan.remote;
  let decision = plan.decision;
  if (decision.kind === "none") {
    // A previous sync may have kept diverged members at B while the default
    // Agent was unavailable; those members stay retryable even when there is
    // no new upstream update anymore (mirrors the official auto-sync retry).
    const pending = syncDocument.pendingMerges[input.teamId];
    const candidates = pending !== undefined && pending.reason === "DEFAULT_AGENT_UNAVAILABLE"
      ? pending.pendingMemberSlugs.filter((slug) =>
          currentContent[`members/${slug}/AGENT.md`] !== undefined
          && remote.content[`members/${slug}/AGENT.md`] !== undefined)
      : [];
    if (candidates.length === 0) {
      await clearPendingMerge(dataRoot, input.teamId);
      return { status: "up-to-date" };
    }
    decision = {
      kind: "apply",
      apply: {
        targetContent: currentContent,
        nextBindings: { ...bindings },
        changedMemberSlugs: [...candidates],
        mergeCandidates: [...candidates],
        memberChanges: emptyMemberChanges(),
      },
    };
  }

  switch (decision.kind) {
    case "defer":
      // GitHub installs always record a full verified baseline (A), so the
      // conservative-baseline branch can never be reached; keep the team as-is.
      return { status: "up-to-date" };
    case "register":
      return commitGithubRegister({
        dataRoot,
        teamId: input.teamId,
        now,
        remote,
        bindings,
        currentContent,
        syncDocument,
        decision,
      });
    case "apply":
      return commitGithubApply({
        dataRoot,
        teamId: input.teamId,
        now,
        location,
        appliedState,
        remote,
        bindings,
        currentContent,
        syncDocument,
        apply: decision.apply,
        mergeMember: input.mergeMember,
        revisionService: input.revisionService,
      });
    default:
      // "skip" was already returned above; keep the union exhaustive for TS.
      return { status: "unreachable" };
  }
}

export type GithubTeamRevertOutcome = { status: "reverted" } | { status: "none" };

export async function revertGithubTeamSync(input: {
  dataRoot: string;
  teamId: string;
  revisionService: Pick<AgentRevisionService, "recordMemberRevision">;
  now?: string;
}): Promise<GithubTeamRevertOutcome> {
  const dataRoot = path.resolve(input.dataRoot);
  const now = input.now ?? new Date().toISOString();
  return withGithubSyncLock(() => revertGithubTeamSyncLocked({ ...input, dataRoot, now }));
}

async function revertGithubTeamSyncLocked(input: {
  dataRoot: string;
  teamId: string;
  revisionService: Pick<AgentRevisionService, "recordMemberRevision">;
  now: string;
}): Promise<GithubTeamRevertOutcome> {
  const { dataRoot, now } = input;
  await recoverAutoSyncTransactions(dataRoot);

  const records = await readOrBuildUserTeamRecordsDocument(dataRoot);
  const record = records.records.find((candidate) => candidate.id === input.teamId);
  if (record?.upstream === undefined) return { status: "none" };

  const syncDocument = await readOfficialSyncStateDocument(dataRoot);
  const batch = syncDocument.batches[input.teamId];
  if (batch === undefined || batch.status === "reverted") return { status: "none" };
  if (batch.previousContent === null || batch.previousBindings === null) {
    throw new GithubTeamSyncError("这次 GitHub 同步缺少可撤销的快照。", "SYNC_UNAVAILABLE");
  }

  const officialDocument = await readOfficialTeamStateDocument(dataRoot);
  const bindingDocument = await readExecutionBindingDocument(dataRoot);
  const location = resolveGithubTeamRecordLocation(dataRoot, record);
  const currentContent = await tryReadTeamDirectoryContent(location.directory) ?? {};
  const operationId = `undo-${batch.batchId}`;
  const transaction = createTransactionRoot(dataRoot, operationId);
  await fs.rm(transaction.root, { recursive: true, force: true });
  await fs.mkdir(transaction.staging, { recursive: true });
  await writeContentToDirectory(transaction.staging, batch.previousContent);
  const journal: AutoSyncJournalV1 = {
    schemaVersion: 1,
    operationId,
    kind: "undo",
    teamId: input.teamId,
    officialDirectory: location.directory,
    stagingDirectory: transaction.staging,
    backupDirectory: transaction.backup,
    previousOfficialDocument: structuredClone(officialDocument),
    previousBindingDocument: structuredClone(bindingDocument),
    previousSyncDocument: structuredClone(syncDocument),
  };
  await writeJournal(dataRoot, journal);
  try {
    await fs.rename(location.directory, transaction.backup);
    await fs.rename(transaction.staging, location.directory);
    bindingDocument.teams[teamBindingKey("user", input.teamId)] = {
      ownership: "user",
      members: batch.previousBindings,
    };
    syncDocument.batches[input.teamId] = { ...batch, status: "reverted" };
    // 有意偏离：不写 suppressedVersions。无 manifest 团队的上游版本恒为
    // GITHUB_DEFAULT_BRANCH_BASELINE_VERSION，写入抑制会让该团队永远收不到
    // 后续更新；且同步时基线已推进到 C，撤销后同版本不会自动重合并。
    await writeExecutionBindingDocument(dataRoot, bindingDocument);
    await writeOfficialSyncStateDocument(dataRoot, syncDocument);
    await finalizeJournal(dataRoot, journal);
    await recordUndoRevisions({
      revisionService: input.revisionService,
      teamId: input.teamId,
      previousContent: batch.previousContent,
      currentContent,
      now,
    });
    return { status: "reverted" };
  } catch (error) {
    await rollbackJournal(dataRoot, journal);
    throw error;
  }
}

async function commitGithubApply(input: {
  dataRoot: string;
  teamId: string;
  now: string;
  location: { directory: string };
  appliedState: AppliedOfficialTeamState;
  remote: GithubTeamRemoteOfficialState;
  bindings: Readonly<Record<string, ExecutionProfileBinding>>;
  currentContent: OfficialTeamContent;
  syncDocument: ReturnType<typeof readOfficialSyncStateDocument> extends Promise<infer T> ? T : never;
  apply: OfficialAutoSyncApply;
  mergeMember: DefaultAgentMergeMember;
  revisionService: Pick<AgentRevisionService, "recordMemberRevision">;
}): Promise<GithubTeamSyncOutcome> {
  const { dataRoot, teamId, now, apply } = input;
  const mergeOutcome = await resolveMergeCandidates({
    dataRoot,
    teamId,
    apply,
    appliedContent: input.appliedState.appliedContentSnapshot ?? {},
    currentContent: input.currentContent,
    packagedContent: input.remote.content,
    now,
    mergeMember: input.mergeMember,
  });
  const targetContent: OfficialTeamContent = {
    ...apply.targetContent,
    ...Object.fromEntries(Object.entries(mergeOutcome.merged).map(([slug, content]) => [
      `members/${slug}/AGENT.md`,
      content,
    ])),
  };
  const memberChanges = {
    ...apply.memberChanges,
    mergedMembers: [...mergeOutcome.mergedMembers],
    pendingMergeMembers: [...mergeOutcome.pendingMergeMembers],
  };

  const officialDocument = await readOfficialTeamStateDocument(dataRoot);
  const bindingDocument = await readExecutionBindingDocument(dataRoot);
  const operationId = createHash("sha256")
    .update(`github-sync\0${teamId}\0${input.remote.manifest.officialVersion}\0${now}`)
    .digest("hex").slice(0, 24);
  const transaction = createTransactionRoot(dataRoot, operationId);
  await fs.rm(transaction.root, { recursive: true, force: true });
  await fs.mkdir(transaction.root, { recursive: true });
  await fs.cp(input.location.directory, transaction.staging, {
    recursive: true,
    force: false,
    errorOnExist: true,
  });
  await pruneStagedContent(transaction.staging, targetContent);
  await writeContentToDirectory(transaction.staging, targetContent);
  const stagedFingerprint = await computeDirectoryFingerprint(transaction.staging);
  if (stagedFingerprint !== computeTargetContentFingerprint(targetContent)) {
    await fs.rm(transaction.root, { recursive: true, force: true });
    throw new GithubTeamSyncError("GitHub 同步合并结果校验失败。", "SYNC_UNAVAILABLE");
  }
  const journal: AutoSyncJournalV1 = {
    schemaVersion: 1,
    operationId,
    kind: "apply",
    teamId,
    officialDirectory: input.location.directory,
    stagingDirectory: transaction.staging,
    backupDirectory: transaction.backup,
    previousOfficialDocument: structuredClone(officialDocument),
    previousBindingDocument: structuredClone(bindingDocument),
    previousSyncDocument: structuredClone(input.syncDocument),
  };
  await writeJournal(dataRoot, journal);
  try {
    await fs.rename(input.location.directory, transaction.backup);
    await fs.rename(transaction.staging, input.location.directory);
    officialDocument.teams[teamId] = appliedStateFor(input.remote);
    bindingDocument.teams[teamBindingKey("user", teamId)] = {
      ownership: "user",
      members: apply.nextBindings,
    };
    const batch: OfficialSyncBatchRecord = {
      schemaVersion: 1,
      batchId: operationId,
      teamId,
      officialVersion: input.remote.manifest.officialVersion,
      occurredAt: now,
      status: "active",
      seen: false,
      memberChanges,
      affectedMemberCount: officialSyncAffectedMemberCount(memberChanges),
      previousContent: input.currentContent,
      previousBindings: normalizeBindings(input.bindings),
    };
    // A sync that changed nothing (e.g. a pending-merge retry that merged
    // nothing) must not surface a batch or a revert entry.
    if (!isEmptyOfficialSyncMemberChanges(memberChanges)) {
      input.syncDocument.batches[teamId] = batch;
    }
    if (mergeOutcome.pendingMergeMembers.length > 0) {
      input.syncDocument.pendingMerges[teamId] = {
        teamId,
        officialVersion: input.remote.manifest.officialVersion,
        reason: "DEFAULT_AGENT_UNAVAILABLE",
        pendingMemberSlugs: [...mergeOutcome.pendingMergeMembers],
        since: now,
      };
    } else {
      delete input.syncDocument.pendingMerges[teamId];
    }
    await writeOfficialTeamStateDocument(dataRoot, officialDocument);
    await writeExecutionBindingDocument(dataRoot, bindingDocument);
    await writeOfficialSyncStateDocument(dataRoot, input.syncDocument);
    await finalizeJournal(dataRoot, journal);
    await recordOfficialRevisions({
      revisionService: input.revisionService,
      teamId,
      officialVersion: input.remote.manifest.officialVersion,
      changedMemberSlugs: apply.changedMemberSlugs,
      targetContent,
      currentContent: input.currentContent,
      now,
    });
    return {
      status: "applied",
      changedMemberCount: officialSyncAffectedMemberCount(memberChanges),
      pendingMergeMemberCount: mergeOutcome.pendingMergeMembers.length,
    };
  } catch (error) {
    await rollbackJournal(dataRoot, journal);
    throw error;
  }
}

async function commitGithubRegister(input: {
  dataRoot: string;
  teamId: string;
  now: string;
  remote: GithubTeamRemoteOfficialState;
  bindings: Readonly<Record<string, ExecutionProfileBinding>>;
  currentContent: OfficialTeamContent;
  syncDocument: OfficialSyncStateDocumentV1;
  decision: Extract<OfficialTeamAutoSyncPlan, { kind: "register" }>;
}): Promise<GithubTeamSyncOutcome> {
  const officialDocument = await readOfficialTeamStateDocument(input.dataRoot);
  const bindingDocument = await readExecutionBindingDocument(input.dataRoot);
  officialDocument.teams[input.teamId] = appliedStateFor(input.remote);
  bindingDocument.teams[teamBindingKey("user", input.teamId)] = {
    ownership: "user",
    members: input.decision.nextBindings,
  };
  if (!isEmptyOfficialSyncMemberChanges(input.decision.memberChanges)) {
    const batch: OfficialSyncBatchRecord = {
      schemaVersion: 1,
      batchId: createHash("sha256")
        .update(`github-sync-register\0${input.teamId}\0${input.remote.manifest.officialVersion}\0${input.now}`)
        .digest("hex").slice(0, 24),
      teamId: input.teamId,
      officialVersion: input.remote.manifest.officialVersion,
      occurredAt: input.now,
      status: "active",
      seen: false,
      memberChanges: input.decision.memberChanges,
      affectedMemberCount: officialSyncAffectedMemberCount(input.decision.memberChanges),
      previousContent: input.currentContent,
      previousBindings: normalizeBindings(input.bindings),
    };
    input.syncDocument.batches[input.teamId] = batch;
  }
  delete input.syncDocument.pendingMerges[input.teamId];
  await writeOfficialTeamStateDocument(input.dataRoot, officialDocument);
  await writeExecutionBindingDocument(input.dataRoot, bindingDocument);
  await writeOfficialSyncStateDocument(input.dataRoot, input.syncDocument);
  // Content untouched: from the user's point of view the team is up to date.
  return { status: "up-to-date" };
}

function appliedStateFor(remote: GithubTeamRemoteOfficialState): AppliedOfficialTeamState {
  const recommendations: Record<string, ExecutionProfile> = Object.fromEntries(
    Object.entries(remote.manifest.members).map(([slug, member]) => [slug, member.recommendedProfile]),
  );
  return {
    appliedOfficialVersion: remote.manifest.officialVersion,
    appliedContentFingerprint: remote.contentFingerprint,
    appliedRecommendationFingerprint: recommendationFingerprint(recommendations),
    appliedRecommendations: recommendations,
    baselineConfidence: "verified",
    appliedContentSnapshot: remote.content,
  };
}

function normalizeBindings(
  bindings: Readonly<Record<string, ExecutionProfileBinding>>,
): Record<string, ExecutionProfileBinding> {
  return Object.fromEntries(
    Object.entries(bindings).map(([slug, binding]) => [slug, normalizeExecutionBinding(binding)]),
  );
}

function emptyMemberChanges(): OfficialTeamAutoSyncPlan extends never ? never : {
  added: string[];
  removed: string[];
  renamed: Array<{ from: string; to: string }>;
  adopted: string[];
  recommendationChanged: string[];
  keptOverridden: string[];
  collidedMembers: string[];
  mergedMembers: string[];
  pendingMergeMembers: string[];
} {
  return {
    added: [],
    removed: [],
    renamed: [],
    adopted: [],
    recommendationChanged: [],
    keptOverridden: [],
    collidedMembers: [],
    mergedMembers: [],
    pendingMergeMembers: [],
  };
}

export class GithubTeamSyncError extends Error {
  readonly code: string;

  constructor(message: string, code: string) {
    super(message);
    this.name = "GithubTeamSyncError";
    this.code = code;
  }
}
