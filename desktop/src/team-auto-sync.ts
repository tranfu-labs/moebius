import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

import { parseAgentMarkdownFrontmatter } from "../../src/agent-frontmatter.js";
import type { AgentRevisionService } from "./agent-revision-service.js";
import type { AgentRevisionOneShotPort } from "./agent-revision-summary-job.js";
import type { DefaultAgentConfigStore } from "./default-agent-config-store.js";
import { resolveDefaultAgentProfile } from "./default-agent-plan.js";
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
  computeOfficialContentFingerprintFromEntries,
  readPackagedOfficialTeamManifest,
  OFFICIAL_TEAM_MANIFEST_FILE,
} from "./team-official-management.js";
import {
  AUTO_SYNC_JOURNAL_FILE,
  buildMemberMergePrompt,
  computeTargetContentFingerprint,
  contentMemberSlugs,
  isEmptyOfficialSyncMemberChanges,
  officialSyncAffectedMemberCount,
  planOfficialTeamAutoSync,
  type OfficialAutoSyncMemberChanges,
  type OfficialAutoSyncApply,
  type OfficialSyncBatchRecord,
  type OfficialTeamAutoSyncPlan,
  type OfficialTeamContent,
  type PendingOfficialMergeRecord,
} from "./team-auto-sync-plan.js";
import { recommendationFingerprint } from "./team-official-plan.js";
import {
  normalizeExecutionBinding,
} from "./team-management-document-codec.js";
import {
  readOfficialSyncStateDocument,
  writeOfficialSyncStateDocument,
  type OfficialSyncStateDocumentV1,
} from "./team-sync-batch-store.js";
import {
  type ExecutionProfile,
  type ExecutionProfileBinding,
} from "./team-execution-profile.js";
import { resolveTeamLocation } from "./team-store.js";
import { parseTeamDefinitionJson } from "./team-model.js";

const AUTO_SYNC_STAGING_DIRECTORY = "auto-sync-staging";

const EXCLUDED_CONTENT_FILES = new Set([
  "onboarding-orchestration.json",
  OFFICIAL_TEAM_MANIFEST_FILE,
  ".teams-seed.marker",
]);

export type OfficialTeamAutoSyncOutcome =
  | { kind: "applied"; officialVersion: string; memberChanges: OfficialAutoSyncMemberChanges; pendingMergeMembers: string[] }
  | { kind: "registered"; officialVersion: string; memberChanges: OfficialAutoSyncMemberChanges }
  | { kind: "none"; reason: string }
  | { kind: "skipped"; reason: string }
  | { kind: "deferred"; reason: "CONSERVATIVE_BASELINE" }
  | { kind: "reverted"; officialVersion: string };

export interface OfficialSyncBannerView {
  officialVersion: string;
  affectedMemberCount: number;
  memberChanges: OfficialAutoSyncMemberChanges;
}

export interface OfficialTeamSyncViews {
  banner: OfficialSyncBannerView | null;
  recent: (OfficialSyncBannerView & { occurredAt: string }) | null;
  hasUnseen: boolean;
  pendingMerge: {
    officialVersion: string;
    reason: "CONSERVATIVE_BASELINE" | "DEFAULT_AGENT_UNAVAILABLE";
    pendingMemberSlugs: string[];
  } | null;
}

export interface OfficialTeamAutoSyncService {
  runForTeam(input: {
    dataRoot: string;
    teamId: string;
    mode?: "auto" | "explicit";
    now?: string;
  }): Promise<OfficialTeamAutoSyncOutcome>;
  runAll(dataRoot: string, now?: string): Promise<Record<string, OfficialTeamAutoSyncOutcome>>;
  revertLatestSync(input: { dataRoot: string; teamId: string; now?: string }): Promise<OfficialTeamAutoSyncOutcome>;
  dismissLatestSyncBanner(input: { dataRoot: string; teamId: string }): Promise<void>;
  markSyncSeen(input: { dataRoot: string; teamId: string }): Promise<void>;
  readTeamSyncViews(input: { dataRoot: string; teamId: string }): Promise<OfficialTeamSyncViews>;
}

interface AutoSyncJournalV1 {
  schemaVersion: 1;
  operationId: string;
  kind: "apply" | "undo";
  teamId: string;
  officialDirectory: string;
  stagingDirectory: string;
  backupDirectory: string;
  previousOfficialDocument: OfficialTeamStateDocumentV1;
  previousBindingDocument: TeamExecutionBindingDocumentV1;
  previousSyncDocument: OfficialSyncStateDocumentV1;
}

export function createOfficialTeamAutoSyncService(input: {
  revisionService: Pick<AgentRevisionService, "recordMemberRevision">;
  defaultAgent: Pick<DefaultAgentConfigStore, "read">;
  oneShot: AgentRevisionOneShotPort;
  runDirRoot: string;
}): OfficialTeamAutoSyncService {
  const mergeMember = async (mergeInput: {
    dataRoot: string;
    teamId: string;
    memberSlug: string;
    officialPrevious: string;
    userCurrent: string;
    officialNew: string;
    now: string;
  }): Promise<{ ok: true; content: string } | { ok: false }> => {
    const runDir = path.join(
      input.runDirRoot,
      createHash("sha256")
        .update(`official-merge\0${mergeInput.teamId}\0${mergeInput.memberSlug}\0${mergeInput.now}`)
        .digest("hex").slice(0, 24),
    );
    try {
      const document = await input.defaultAgent.read();
      const profile = resolveDefaultAgentProfile(document);
      await fs.mkdir(runDir, { recursive: true });
      const result = await input.oneShot.run({
        profile,
        prompt: buildMemberMergePrompt(mergeInput),
        runDir,
      });
      if (!result.ok) {
        return { ok: false };
      }
      const content = result.text.trim();
      if (content.length === 0) {
        return { ok: false };
      }
      if (!acceptMergedAgentMarkdown(mergeInput.userCurrent, content)) {
        return { ok: false };
      }
      return { ok: true, content };
    } catch {
      return { ok: false };
    }
  };

  const runForTeam = async (runInput: {
    dataRoot: string;
    teamId: string;
    mode: "auto" | "explicit";
    now: string;
  }): Promise<OfficialTeamAutoSyncOutcome> => {
    const { dataRoot, teamId, now } = runInput;
    await recoverAutoSyncTransactions(dataRoot);
    const officialDocument = await readOfficialTeamStateDocument(dataRoot);
    const applied = officialDocument.teams[teamId];
    if (applied === undefined) {
      return { kind: "skipped", reason: "NO_OFFICIAL_RECORD" };
    }
    const location = resolveTeamLocation({ dataRoot, teamId, ownership: "system" });
    const packagedDirectory = getPackagedTeamCacheDirectory(dataRoot, teamId);
    const [currentContent, currentFingerprint, packagedManifest, packagedContent, syncDocument, bindingDocument] =
      await Promise.all([
        tryReadTeamDirectoryContent(location.directory),
        tryComputeDirectoryFingerprint(location.directory),
        readPackagedOfficialTeamManifest(packagedDirectory),
        readTeamDirectoryContent(packagedDirectory),
        readOfficialSyncStateDocument(dataRoot),
        readExecutionBindingDocument(dataRoot),
      ]);
    const bindings = bindingDocument.teams[teamBindingKey("system", teamId)]?.members ?? {};
    const packaged = {
      manifest: packagedManifest,
      contentFingerprint: await computeDirectoryFingerprint(packagedDirectory),
    };
    if (currentFingerprint === null || currentContent === null) {
      return { kind: "skipped", reason: "UNREADABLE" };
    }
    const suppressed = syncDocument.suppressedVersions[teamId] ?? [];
    let plan: OfficialTeamAutoSyncPlan = planOfficialTeamAutoSync({
      applied,
      currentContentFingerprint: currentFingerprint,
      currentContent,
      packaged,
      packagedContent,
      bindings,
      suppressedOfficialVersions: suppressed,
    });
    if (plan.kind === "defer" && runInput.mode === "explicit") {
      plan = planConservativeOneTimeMerge({
        applied,
        currentContent,
        packaged,
        packagedContent,
        bindings,
      });
    }
    if (plan.kind === "none") {
      // A previous run may have applied the one-sided changes while the default
      // Agent was unavailable for some diverged members (A now equals C). The
      // pending record keeps those members retryable even though there is no
      // new official update anymore.
      const pending = syncDocument.pendingMerges[teamId];
      if (pending !== undefined && pending.reason === "DEFAULT_AGENT_UNAVAILABLE") {
        const candidates = pending.pendingMemberSlugs.filter((slug) =>
          currentContent[`members/${slug}/AGENT.md`] !== undefined
          && packagedContent[`members/${slug}/AGENT.md`] !== undefined);
        if (candidates.length > 0) {
          plan = {
            kind: "apply",
            apply: {
              targetContent: currentContent,
              nextBindings: { ...bindings },
              changedMemberSlugs: [...candidates],
              mergeCandidates: [...candidates],
              memberChanges: {
                added: [],
                removed: [],
                renamed: [],
                adopted: [],
                recommendationChanged: [],
                keptOverridden: [],
                collidedMembers: [],
                mergedMembers: [],
                pendingMergeMembers: [],
              },
            },
          };
        }
      }
    }
    switch (plan.kind) {
      case "skip":
        return { kind: "skipped", reason: plan.reason };
      case "none":
        await clearPendingMerge(dataRoot, teamId);
        return { kind: "none", reason: plan.reason };
      case "defer": {
        await upsertPendingMerge(dataRoot, {
          teamId,
          officialVersion: packaged.manifest.officialVersion,
          reason: "CONSERVATIVE_BASELINE",
          pendingMemberSlugs: [],
          since: now,
        });
        return { kind: "deferred", reason: "CONSERVATIVE_BASELINE" };
      }
      case "register": {
        return await commitRegister({
          dataRoot,
          teamId,
          packaged,
          packagedContent,
          bindings,
          plan,
          syncDocument,
          now,
        });
      }
      case "apply": {
        return await commitApply({
          dataRoot,
          teamId,
          applied,
          packaged,
          packagedContent,
          bindings,
          plan,
          syncDocument,
          now,
          revisionService: input.revisionService,
          mergeMember,
        });
      }
    }
  };

  return {
    runForTeam: (runInput) => runForTeam({ mode: "auto", now: new Date().toISOString(), ...runInput }),
    runAll: async (dataRoot, now) => {
      const officialDocument = await readOfficialTeamStateDocument(dataRoot);
      const results: Record<string, OfficialTeamAutoSyncOutcome> = {};
      for (const teamId of Object.keys(officialDocument.teams)) {
        results[teamId] = await runForTeam({
          dataRoot,
          teamId,
          mode: "auto",
          now: now ?? new Date().toISOString(),
        });
      }
      return results;
    },
    revertLatestSync: async (revertInput) => {
      const { dataRoot, teamId, now } = { now: new Date().toISOString(), ...revertInput };
      await recoverAutoSyncTransactions(dataRoot);
      const syncDocument = await readOfficialSyncStateDocument(dataRoot);
      const batch = syncDocument.batches[teamId];
      if (batch === undefined || batch.status === "reverted") {
        return { kind: "none", reason: "NO_REVERTIBLE_SYNC" };
      }
      if (batch.previousContent === null || batch.previousBindings === null) {
        throw new AutoSyncError("这次官方同步缺少可撤销的快照。", "AUTO_SYNC_UNAVAILABLE");
      }
      const officialDocument = await readOfficialTeamStateDocument(dataRoot);
      const bindingDocument = await readExecutionBindingDocument(dataRoot);
      const location = resolveTeamLocation({ dataRoot, teamId, ownership: "system" });
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
        teamId,
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
        bindingDocument.teams[teamBindingKey("system", teamId)] = {
          ownership: "system",
          members: batch.previousBindings,
        };
        syncDocument.batches[teamId] = { ...batch, status: "reverted" };
        const suppressed = syncDocument.suppressedVersions[teamId] ?? [];
        if (!suppressed.includes(batch.officialVersion)) {
          syncDocument.suppressedVersions[teamId] = [...suppressed, batch.officialVersion];
        }
        await writeExecutionBindingDocument(dataRoot, bindingDocument);
        await writeOfficialSyncStateDocument(dataRoot, syncDocument);
        await finalizeJournal(dataRoot, journal);
        await recordUndoRevisions({
          revisionService: input.revisionService,
          teamId,
          previousContent: batch.previousContent,
          currentContent,
          now,
        });
        return { kind: "reverted", officialVersion: batch.officialVersion };
      } catch (error) {
        await rollbackJournal(dataRoot, journal);
        throw error;
      }
    },
    dismissLatestSyncBanner: async ({ dataRoot, teamId }) => {
      const syncDocument = await readOfficialSyncStateDocument(dataRoot);
      const batch = syncDocument.batches[teamId];
      if (batch !== undefined && batch.status === "active") {
        syncDocument.batches[teamId] = { ...batch, status: "dismissed" };
        await writeOfficialSyncStateDocument(dataRoot, syncDocument);
      }
    },
    markSyncSeen: async ({ dataRoot, teamId }) => {
      const syncDocument = await readOfficialSyncStateDocument(dataRoot);
      const batch = syncDocument.batches[teamId];
      if (batch !== undefined && !batch.seen) {
        syncDocument.batches[teamId] = { ...batch, seen: true };
        await writeOfficialSyncStateDocument(dataRoot, syncDocument);
      }
    },
    readTeamSyncViews: async ({ dataRoot, teamId }) => {
      const syncDocument = await readOfficialSyncStateDocument(dataRoot);
      const batch = syncDocument.batches[teamId];
      const pending = syncDocument.pendingMerges[teamId];
      const banner = batch !== undefined && batch.status === "active"
        ? {
            officialVersion: batch.officialVersion,
            affectedMemberCount: batch.affectedMemberCount,
            memberChanges: batch.memberChanges,
          }
        : null;
      const recent = batch !== undefined && batch.status !== "reverted"
        ? {
            officialVersion: batch.officialVersion,
            affectedMemberCount: batch.affectedMemberCount,
            memberChanges: batch.memberChanges,
            occurredAt: batch.occurredAt,
          }
        : null;
      const hasUnseen = batch !== undefined
        && batch.status !== "reverted"
        && !batch.seen
        && !isEmptyOfficialSyncMemberChanges(batch.memberChanges);
      return {
        banner,
        recent,
        hasUnseen,
        pendingMerge: pending === undefined
          ? null
          : {
              officialVersion: pending.officialVersion,
              reason: pending.reason,
              pendingMemberSlugs: pending.pendingMemberSlugs,
            },
      };
    },
  };
}

async function commitApply(input: {
  dataRoot: string;
  teamId: string;
  applied: OfficialTeamStateDocumentV1["teams"][string];
  packaged: PackagedTeamInput;
  packagedContent: OfficialTeamContent;
  bindings: Readonly<Record<string, ExecutionProfileBinding>>;
  plan: Extract<OfficialTeamAutoSyncPlan, { kind: "apply" }>;
  syncDocument: OfficialSyncStateDocumentV1;
  now: string;
  revisionService: Pick<AgentRevisionService, "recordMemberRevision">;
  mergeMember: (mergeInput: {
    dataRoot: string;
    teamId: string;
    memberSlug: string;
    officialPrevious: string;
    userCurrent: string;
    officialNew: string;
    now: string;
  }) => Promise<{ ok: true; content: string } | { ok: false }>;
}): Promise<OfficialTeamAutoSyncOutcome> {
  const { dataRoot, teamId, now } = input;
  const apply = input.plan.apply;
  const location = resolveTeamLocation({ dataRoot, teamId, ownership: "system" });
  const currentContent = await readTeamDirectoryContent(location.directory);
  const appliedContent = input.applied.appliedContentSnapshot;
  const mergeOutcome = await resolveMergeCandidates({
    dataRoot,
    teamId,
    apply,
    appliedContent: appliedContent ?? {},
    currentContent,
    packagedContent: input.packagedContent,
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
  const memberChanges: OfficialAutoSyncMemberChanges = {
    ...apply.memberChanges,
    mergedMembers: [...mergeOutcome.mergedMembers],
    pendingMergeMembers: [...mergeOutcome.pendingMergeMembers],
  };

  const officialDocument = await readOfficialTeamStateDocument(dataRoot);
  const bindingDocument = await readExecutionBindingDocument(dataRoot);
  const syncDocument = input.syncDocument;
  const operationId = createHash("sha256")
    .update(`auto-sync\0${teamId}\0${input.packaged.manifest.officialVersion}\0${now}`)
    .digest("hex").slice(0, 24);
  const transaction = createTransactionRoot(dataRoot, operationId);
  await fs.rm(transaction.root, { recursive: true, force: true });
  await fs.mkdir(transaction.root, { recursive: true });
  await fs.cp(location.directory, transaction.staging, {
    recursive: true,
    force: false,
    errorOnExist: true,
  });
  await pruneStagedContent(transaction.staging, targetContent);
  await writeContentToDirectory(transaction.staging, targetContent);
  const stagedFingerprint = await computeDirectoryFingerprint(transaction.staging);
  if (stagedFingerprint !== computeTargetContentFingerprint(targetContent)) {
    await fs.rm(transaction.root, { recursive: true, force: true });
    throw new AutoSyncError("官方同步合并结果校验失败。", "AUTO_SYNC_UNAVAILABLE");
  }
  const journal: AutoSyncJournalV1 = {
    schemaVersion: 1,
    operationId,
    kind: "apply",
    teamId,
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
    officialDocument.teams[teamId] = {
      appliedOfficialVersion: input.packaged.manifest.officialVersion,
      appliedContentFingerprint: input.packaged.contentFingerprint,
      appliedRecommendationFingerprint: recommendationFingerprint(
        recommendationsFromManifest(input.packaged),
      ),
      appliedRecommendations: recommendationsFromManifest(input.packaged),
      baselineConfidence: "verified",
      appliedContentSnapshot: input.packagedContent,
    };
    bindingDocument.teams[teamBindingKey("system", teamId)] = {
      ownership: "system",
      members: apply.nextBindings,
    };
    const batch: OfficialSyncBatchRecord = {
      schemaVersion: 1,
      batchId: operationId,
      teamId,
      officialVersion: input.packaged.manifest.officialVersion,
      occurredAt: now,
      status: "active",
      seen: false,
      memberChanges,
      affectedMemberCount: officialSyncAffectedMemberCount(memberChanges),
      previousContent: currentContent,
      previousBindings: Object.fromEntries(
        Object.entries(input.bindings).map(([slug, binding]) => [slug, normalizeExecutionBinding(binding)]),
      ),
    };
    // A merge that changed nothing (e.g. the one-time conservative merge with
    // B already equal to C) must not surface a banner or a revert entry: there
    // is nothing to review or undo.
    if (!isEmptyOfficialSyncMemberChanges(memberChanges)) {
      syncDocument.batches[teamId] = batch;
    }
    if (mergeOutcome.pendingMergeMembers.length > 0) {
      syncDocument.pendingMerges[teamId] = {
        teamId,
        officialVersion: input.packaged.manifest.officialVersion,
        reason: "DEFAULT_AGENT_UNAVAILABLE",
        pendingMemberSlugs: [...mergeOutcome.pendingMergeMembers],
        since: now,
      };
    } else {
      delete syncDocument.pendingMerges[teamId];
    }
    await writeOfficialTeamStateDocument(dataRoot, officialDocument);
    await writeExecutionBindingDocument(dataRoot, bindingDocument);
    await writeOfficialSyncStateDocument(dataRoot, syncDocument);
    await finalizeJournal(dataRoot, journal);
    await recordOfficialRevisions({
      revisionService: input.revisionService,
      teamId,
      officialVersion: input.packaged.manifest.officialVersion,
      changedMemberSlugs: apply.changedMemberSlugs,
      targetContent,
      currentContent,
      now,
    });
    return {
      kind: "applied",
      officialVersion: input.packaged.manifest.officialVersion,
      memberChanges,
      pendingMergeMembers: [...mergeOutcome.pendingMergeMembers],
    };
  } catch (error) {
    await rollbackJournal(dataRoot, journal);
    throw error;
  }
}

async function commitRegister(input: {
  dataRoot: string;
  teamId: string;
  packaged: PackagedTeamInput;
  packagedContent: OfficialTeamContent;
  bindings: Readonly<Record<string, ExecutionProfileBinding>>;
  plan: Extract<OfficialTeamAutoSyncPlan, { kind: "register" }>;
  syncDocument: OfficialSyncStateDocumentV1;
  now: string;
}): Promise<OfficialTeamAutoSyncOutcome> {
  const { dataRoot, teamId, now } = input;
  const officialDocument = await readOfficialTeamStateDocument(dataRoot);
  const bindingDocument = await readExecutionBindingDocument(dataRoot);
  const syncDocument = input.syncDocument;
  officialDocument.teams[teamId] = {
    appliedOfficialVersion: input.packaged.manifest.officialVersion,
    appliedContentFingerprint: input.packaged.contentFingerprint,
    appliedRecommendationFingerprint: recommendationFingerprint(
      recommendationsFromManifest(input.packaged),
    ),
    appliedRecommendations: recommendationsFromManifest(input.packaged),
    baselineConfidence: "verified",
    appliedContentSnapshot: input.packagedContent,
  };
  bindingDocument.teams[teamBindingKey("system", teamId)] = {
    ownership: "system",
    members: input.plan.nextBindings,
  };
  if (!isEmptyOfficialSyncMemberChanges(input.plan.memberChanges)) {
    const location = resolveTeamLocation({ dataRoot, teamId, ownership: "system" });
    const currentContent = await tryReadTeamDirectoryContent(location.directory) ?? {};
    const batch: OfficialSyncBatchRecord = {
      schemaVersion: 1,
      batchId: createHash("sha256")
        .update(`auto-sync-register\0${teamId}\0${input.packaged.manifest.officialVersion}\0${now}`)
        .digest("hex").slice(0, 24),
      teamId,
      officialVersion: input.packaged.manifest.officialVersion,
      occurredAt: now,
      status: "active",
      seen: false,
      memberChanges: input.plan.memberChanges,
      affectedMemberCount: officialSyncAffectedMemberCount(input.plan.memberChanges),
      previousContent: currentContent,
      previousBindings: Object.fromEntries(
        Object.entries(input.bindings).map(([slug, binding]) => [slug, normalizeExecutionBinding(binding)]),
      ),
    };
    syncDocument.batches[teamId] = batch;
  }
  delete syncDocument.pendingMerges[teamId];
  await writeOfficialTeamStateDocument(dataRoot, officialDocument);
  await writeExecutionBindingDocument(dataRoot, bindingDocument);
  await writeOfficialSyncStateDocument(dataRoot, syncDocument);
  return {
    kind: "registered",
    officialVersion: input.packaged.manifest.officialVersion,
    memberChanges: input.plan.memberChanges,
  };
}

interface PackagedTeamInput {
  manifest: Awaited<ReturnType<typeof readPackagedOfficialTeamManifest>>;
  contentFingerprint: string;
}

async function resolveMergeCandidates(input: {
  dataRoot: string;
  teamId: string;
  apply: OfficialAutoSyncApply;
  appliedContent: OfficialTeamContent;
  currentContent: OfficialTeamContent;
  packagedContent: OfficialTeamContent;
  now: string;
  mergeMember: (mergeInput: {
    dataRoot: string;
    teamId: string;
    memberSlug: string;
    officialPrevious: string;
    userCurrent: string;
    officialNew: string;
    now: string;
  }) => Promise<{ ok: true; content: string } | { ok: false }>;
}): Promise<{
  merged: Record<string, string>;
  mergedMembers: string[];
  pendingMergeMembers: string[];
}> {
  const merged: Record<string, string> = {};
  const mergedMembers: string[] = [];
  const pendingMergeMembers: string[] = [];
  for (const slug of input.apply.mergeCandidates) {
    const userCurrent = input.currentContent[`members/${slug}/AGENT.md`] ?? "";
    const officialNew = input.packagedContent[`members/${slug}/AGENT.md`] ?? "";
    const officialPrevious = input.appliedContent[`members/${slug}/AGENT.md`] ?? "";
    const result = await input.mergeMember({
      dataRoot: input.dataRoot,
      teamId: input.teamId,
      memberSlug: slug,
      officialPrevious,
      userCurrent,
      officialNew,
      now: input.now,
    });
    if (result.ok) {
      merged[slug] = result.content;
      mergedMembers.push(slug);
    } else {
      // Never overwrite user content because the merge was unavailable: the
      // target already keeps B's files for merge candidates.
      pendingMergeMembers.push(slug);
    }
  }
  return { merged, mergedMembers, pendingMergeMembers };
}

function acceptMergedAgentMarkdown(userCurrent: string, merged: string): boolean {
  let userParsed: ReturnType<typeof parseAgentMarkdownFrontmatter>;
  try {
    userParsed = parseAgentMarkdownFrontmatter(userCurrent);
  } catch {
    return true;
  }
  if (userParsed.frontmatter === null) {
    return true;
  }
  try {
    const mergedParsed = parseAgentMarkdownFrontmatter(merged);
    if (mergedParsed.frontmatter === null) {
      return false;
    }
    return typeof mergedParsed.frontmatter.display_name === "string"
      && typeof mergedParsed.frontmatter.description === "string";
  } catch {
    return false;
  }
}

async function recordOfficialRevisions(input: {
  revisionService: Pick<AgentRevisionService, "recordMemberRevision">;
  teamId: string;
  officialVersion: string;
  changedMemberSlugs: readonly string[];
  targetContent: OfficialTeamContent;
  currentContent: OfficialTeamContent;
  now: string;
}): Promise<void> {
  for (const slug of input.changedMemberSlugs) {
    const content = input.targetContent[`members/${slug}/AGENT.md`];
    if (content === undefined) {
      continue;
    }
    try {
      await input.revisionService.recordMemberRevision({
        teamStableId: input.teamId,
        memberSlug: slug,
        content,
        authorKind: "official",
        authorLabel: input.officialVersion,
        now: input.now,
        baselineContent: input.currentContent[`members/${slug}/AGENT.md`] ?? null,
      });
    } catch {
      // The sync itself is already durable; a failed revision must not roll it
      // back (the member timeline simply misses this entry).
    }
  }
}

async function recordUndoRevisions(input: {
  revisionService: Pick<AgentRevisionService, "recordMemberRevision">;
  teamId: string;
  previousContent: OfficialTeamContent;
  currentContent: OfficialTeamContent;
  now: string;
}): Promise<void> {
  const slugs = new Set([
    ...contentMemberSlugs(input.previousContent),
    ...contentMemberSlugs(input.currentContent),
  ]);
  for (const slug of slugs) {
    const previous = input.previousContent[`members/${slug}/AGENT.md`] ?? "";
    const current = input.currentContent[`members/${slug}/AGENT.md`] ?? "";
    if (previous === current) {
      continue;
    }
    try {
      await input.revisionService.recordMemberRevision({
        teamStableId: input.teamId,
        memberSlug: slug,
        content: previous,
        authorKind: "user",
        authorLabel: null,
        now: input.now,
        baselineContent: current,
      });
    } catch {
      // Best-effort like the sync revisions; the undo itself stays durable.
    }
  }
}

function planConservativeOneTimeMerge(input: {
  applied: OfficialTeamStateDocumentV1["teams"][string];
  currentContent: OfficialTeamContent;
  packaged: PackagedTeamInput;
  packagedContent: OfficialTeamContent;
  bindings: Readonly<Record<string, ExecutionProfileBinding>>;
}): OfficialTeamAutoSyncPlan {
  const currentSlugs = contentMemberSlugs(input.currentContent);
  const packagedSlugs = contentMemberSlugs(input.packagedContent);
  const currentSet = new Set(currentSlugs);
  const mergeCandidates = currentSlugs.filter((slug) =>
    packagedSlugs.includes(slug)
    && input.currentContent[`members/${slug}/AGENT.md`] !== input.packagedContent[`members/${slug}/AGENT.md`]);
  const addedSlugs = packagedSlugs.filter((slug) => !currentSet.has(slug));
  const keptSlugs = currentSlugs.filter((slug) => !packagedSlugs.includes(slug));
  const target: Record<string, string> = {};
  for (const slug of currentSlugs) {
    for (const [relativePath, content] of Object.entries(input.currentContent)) {
      if (relativePath.startsWith(`members/${slug}/`)) {
        target[relativePath] = content;
      }
    }
  }
  for (const slug of addedSlugs) {
    for (const [relativePath, content] of Object.entries(input.packagedContent)) {
      if (relativePath.startsWith(`members/${slug}/`)) {
        target[relativePath] = content;
      }
    }
  }
  const currentDefinition = parseDefinition(input.currentContent["team.json"]);
  target["team.json"] = JSON.stringify({
    name: currentDefinition?.name ?? "",
    description: currentDefinition?.description ?? "",
    primaryAgentSlug: currentDefinition?.primaryAgentSlug ?? null,
    memberOrder: [
      ...(currentDefinition?.memberOrder ?? []),
      ...addedSlugs.filter((slug) => !(currentDefinition?.memberOrder ?? []).includes(slug)),
    ],
    ...(currentDefinition?.memberPortraits !== undefined && Object.keys(currentDefinition.memberPortraits).length > 0
      ? { memberPortraits: currentDefinition.memberPortraits }
      : {}),
  });
  const packagedRecommendations = recommendationsFromManifest(input.packaged);
  const nextBindings: Record<string, ExecutionProfileBinding> = {};
  for (const [slug, recommendation] of Object.entries(packagedRecommendations)) {
    const binding = input.bindings[slug];
    if (binding !== undefined && binding.source !== "recommended") {
      nextBindings[slug] = {
        source: binding.source,
        profile: binding.profile,
      };
      continue;
    }
    nextBindings[slug] = { source: "recommended" };
    void recommendation;
  }
  for (const [slug, binding] of Object.entries(input.bindings)) {
    if (Object.hasOwn(packagedRecommendations, slug) || binding.source === "recommended") {
      continue;
    }
    nextBindings[slug] = {
      source: binding.source,
      profile: binding.profile,
    };
  }
  return {
    kind: "apply",
    apply: {
      targetContent: target,
      nextBindings,
      changedMemberSlugs: [...mergeCandidates, ...addedSlugs],
      mergeCandidates,
      memberChanges: {
        added: [...addedSlugs],
        removed: [],
        renamed: [],
        adopted: [],
        recommendationChanged: [],
        keptOverridden: [...keptSlugs],
        collidedMembers: [],
        mergedMembers: [],
        pendingMergeMembers: [],
      },
    },
  };
}

async function upsertPendingMerge(
  dataRoot: string,
  pending: PendingOfficialMergeRecord,
): Promise<void> {
  const syncDocument = await readOfficialSyncStateDocument(dataRoot);
  const existing = syncDocument.pendingMerges[pending.teamId];
  if (
    existing !== undefined
    && existing.officialVersion === pending.officialVersion
    && existing.reason === pending.reason
    && sameStringArray(existing.pendingMemberSlugs, pending.pendingMemberSlugs)
  ) {
    return;
  }
  syncDocument.pendingMerges[pending.teamId] = pending;
  await writeOfficialSyncStateDocument(dataRoot, syncDocument);
}

async function clearPendingMerge(dataRoot: string, teamId: string): Promise<void> {
  const syncDocument = await readOfficialSyncStateDocument(dataRoot);
  if (syncDocument.pendingMerges[teamId] === undefined) {
    return;
  }
  delete syncDocument.pendingMerges[teamId];
  await writeOfficialSyncStateDocument(dataRoot, syncDocument);
}

function createTransactionRoot(dataRoot: string, operationId: string): {
  root: string;
  staging: string;
  backup: string;
} {
  const root = path.join(getAgentTeamsStateRoot(dataRoot), AUTO_SYNC_STAGING_DIRECTORY, operationId);
  return {
    root,
    staging: path.join(root, "staging"),
    backup: path.join(root, "backup"),
  };
}

async function writeJournal(dataRoot: string, journal: AutoSyncJournalV1): Promise<void> {
  const journalPath = path.join(getAgentTeamsStateRoot(dataRoot), AUTO_SYNC_JOURNAL_FILE);
  await fs.mkdir(path.dirname(journalPath), { recursive: true });
  await writeJsonAtomically(journalPath, journal);
}

async function readJournal(dataRoot: string): Promise<AutoSyncJournalV1 | null> {
  try {
    return JSON.parse(await fs.readFile(
      path.join(getAgentTeamsStateRoot(dataRoot), AUTO_SYNC_JOURNAL_FILE),
      "utf8",
    )) as AutoSyncJournalV1;
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") {
      return null;
    }
    throw error;
  }
}

async function removeJournal(dataRoot: string): Promise<void> {
  await fs.rm(path.join(getAgentTeamsStateRoot(dataRoot), AUTO_SYNC_JOURNAL_FILE), { force: true });
}

/**
 * Recovers an interrupted auto-sync transaction. An operation only becomes
 * visible once every document write succeeded; a journal whose writes did not
 * all land is rolled back (old directory restored, documents untouched).
 */
async function recoverAutoSyncTransactions(dataRoot: string): Promise<void> {
  const journal = await readJournal(dataRoot);
  if (journal === null) {
    await recoverLegacyOfficialUpdateTransaction(dataRoot);
    return;
  }
  await rollbackJournal(dataRoot, journal);
}

const LEGACY_UPDATE_JOURNAL_FILE = "official-update-journal-v1.json";
const LEGACY_COMPLETED_UPDATES_FILE = "official-update-receipts-v1.json";
const LEGACY_UPDATE_STAGING_DIRECTORY = "official-update-staging";

/**
 * Recovers an interrupted transaction of the retired manual-update machinery
 * (team-official-update.ts, removed with the 08-07 auto-merge decision). A
 * machine that crashed mid-update may still carry its journal; the receipt
 * decides whether the update actually landed (finalize) or must be rolled
 * back so the official team directory stays complete.
 */
async function recoverLegacyOfficialUpdateTransaction(dataRoot: string): Promise<void> {
  const stateRoot = getAgentTeamsStateRoot(dataRoot);
  let journal: unknown;
  try {
    journal = JSON.parse(await fs.readFile(path.join(stateRoot, LEGACY_UPDATE_JOURNAL_FILE), "utf8"));
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") {
      return;
    }
    // Unreadable legacy journal: keep it untouched (never guess), the stale
    // staging directories are inert without a reader.
    return;
  }
  if (!isPlainObject(journal) || typeof journal.planId !== "string"
    || typeof journal.officialDirectory !== "string" || typeof journal.backupDirectory !== "string") {
    return;
  }
  const planId = journal.planId;
  const officialDirectory = journal.officialDirectory;
  const backupDirectory = journal.backupDirectory;
  const stagingDirectory = typeof journal.officialStagingDirectory === "string"
    ? journal.officialStagingDirectory
    : null;
  let completed = false;
  try {
    const receipts = JSON.parse(await fs.readFile(
      path.join(stateRoot, LEGACY_COMPLETED_UPDATES_FILE),
      "utf8",
    ));
    completed = isPlainObject(receipts)
      && isPlainObject(receipts.updates)
      && isPlainObject(receipts.updates[planId]);
  } catch {
    completed = false;
  }
  if (completed) {
    await fs.rm(backupDirectory, { recursive: true, force: true }).catch(() => undefined);
    if (stagingDirectory !== null) {
      await fs.rm(path.dirname(stagingDirectory), { recursive: true, force: true }).catch(() => undefined);
    }
    await fs.rm(path.join(stateRoot, LEGACY_UPDATE_JOURNAL_FILE), { force: true }).catch(() => undefined);
    return;
  }
  if (await pathExists(backupDirectory)) {
    await fs.rm(officialDirectory, { recursive: true, force: true }).catch(() => undefined);
    await fs.rename(backupDirectory, officialDirectory);
  }
  if (stagingDirectory !== null) {
    await fs.rm(path.dirname(stagingDirectory), { recursive: true, force: true }).catch(() => undefined);
  }
  await fs.rm(path.join(stateRoot, LEGACY_UPDATE_JOURNAL_FILE), { force: true }).catch(() => undefined);
}

async function rollbackJournal(dataRoot: string, journal: AutoSyncJournalV1): Promise<void> {
  if (await pathExists(journal.backupDirectory)) {
    await fs.rm(journal.officialDirectory, { recursive: true, force: true });
    await fs.rename(journal.backupDirectory, journal.officialDirectory);
  }
  await writeOfficialTeamStateDocument(dataRoot, journal.previousOfficialDocument);
  await writeExecutionBindingDocument(dataRoot, journal.previousBindingDocument);
  await writeOfficialSyncStateDocument(dataRoot, journal.previousSyncDocument);
  await fs.rm(path.dirname(journal.stagingDirectory), { recursive: true, force: true });
  await removeJournal(dataRoot);
}

async function finalizeJournal(dataRoot: string, journal: AutoSyncJournalV1): Promise<void> {
  await fs.rm(journal.backupDirectory, { recursive: true, force: true });
  await fs.rm(path.dirname(journal.stagingDirectory), { recursive: true, force: true });
  await removeJournal(dataRoot);
}

async function pruneStagedContent(
  stagingDirectory: string,
  targetContent: OfficialTeamContent,
): Promise<void> {
  const entries = await collectContentEntries(stagingDirectory);
  for (const entry of entries) {
    if (Object.hasOwn(targetContent, entry.relativePath)) {
      continue;
    }
    await fs.rm(entry.absolutePath, { force: true });
  }
}

async function writeContentToDirectory(directory: string, content: OfficialTeamContent): Promise<void> {
  for (const [relativePath, text] of Object.entries(content)) {
    const target = path.join(directory, ...relativePath.split("/"));
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, text, "utf8");
  }
}

async function readTeamDirectoryContent(directory: string): Promise<OfficialTeamContent> {
  const entries = await collectContentEntries(directory);
  const content: Record<string, string> = {};
  for (const entry of entries) {
    const raw = await fs.readFile(entry.absolutePath);
    const text = raw.toString("utf8");
    if (!Buffer.from(text, "utf8").equals(raw)) {
      throw new AutoSyncError(`团队包含不支持的非文本文件：${entry.relativePath}`, "AUTO_SYNC_UNAVAILABLE");
    }
    content[entry.relativePath] = text;
  }
  return content;
}

async function tryReadTeamDirectoryContent(directory: string): Promise<OfficialTeamContent | null> {
  try {
    return await readTeamDirectoryContent(directory);
  } catch {
    return null;
  }
}

async function computeDirectoryFingerprint(directory: string): Promise<string> {
  const entries = await collectContentEntries(directory);
  const withContent: Array<{ relativePath: string; content: Uint8Array }> = [];
  for (const entry of entries) {
    withContent.push({
      relativePath: entry.relativePath,
      content: await fs.readFile(entry.absolutePath),
    });
  }
  return computeOfficialContentFingerprintFromEntries(withContent);
}

async function tryComputeDirectoryFingerprint(directory: string): Promise<string | null> {
  try {
    return await computeDirectoryFingerprint(directory);
  } catch {
    return null;
  }
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
    if (entry.isDirectory()) {
      collected.push(...await collectContentEntries(root, absolutePath));
      continue;
    }
    if (entry.isFile()) {
      collected.push({ absolutePath, relativePath });
      continue;
    }
  }
  return collected.sort((left, right) => compareNames(left.relativePath, right.relativePath));
}

function recommendationsFromManifest(input: PackagedTeamInput): Record<string, ExecutionProfile> {
  return Object.fromEntries(Object.entries(input.manifest.members).map(([slug, member]) => [
    slug,
    member.recommendedProfile,
  ]));
}

function parseDefinition(source: string | undefined): ReturnType<typeof parseTeamDefinitionJson> | null {
  if (source === undefined) {
    return null;
  }
  try {
    return parseTeamDefinitionJson(source);
  } catch {
    return null;
  }
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

function sameStringArray(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function compareNames(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}

export class AutoSyncError extends Error {
  constructor(
    message: string,
    readonly code: "AUTO_SYNC_UNAVAILABLE",
  ) {
    super(message);
    this.name = "AutoSyncError";
  }
}
