import path from "node:path";

import { loadGithubTeamSnapshot } from "./github-team-remote.js";
import { planGithubTeamSync } from "./github-team-sync-plan.js";
import type { GithubTeamTransport } from "./github-team-transport.js";
import { readOrBuildUserTeamRecordsDocument, type UserTeamRecord } from "./team-record-store.js";
import {
  readExecutionBindingDocument,
  readOfficialTeamStateDocument,
  teamBindingKey,
} from "./team-management-store.js";
import { readOfficialSyncStateDocument } from "./team-sync-batch-store.js";
import { tryReadTeamDirectoryContent } from "./team-auto-sync.js";
import { getTeamsRoot, resolveRelocatedUserTeamLocation } from "./team-store.js";

export interface GithubTeamUpstreamSyncView {
  officialVersion: string;
  occurredAt: string;
}

export type GithubTeamUpstreamCheckResult =
  | { status: "not-following" }
  | {
      status: "up-to-date" | "update-available" | "unreachable";
      recentSync: GithubTeamUpstreamSyncView | null;
      pendingMergeMemberCount: number;
    };

export async function checkGithubTeamUpstream(input: {
  dataRoot: string;
  teamId: string;
  transport: GithubTeamTransport;
}): Promise<GithubTeamUpstreamCheckResult> {
  const dataRoot = path.resolve(input.dataRoot);
  const records = await readOrBuildUserTeamRecordsDocument(dataRoot);
  const record = records.records.find((candidate) => candidate.id === input.teamId);
  if (record?.upstream === undefined) return { status: "not-following" };

  const syncDocument = await readOfficialSyncStateDocument(dataRoot);
  const recentBatch = syncDocument.batches[input.teamId];
  const recentSync = recentBatch !== undefined && recentBatch.status !== "reverted"
    ? { officialVersion: recentBatch.officialVersion, occurredAt: recentBatch.occurredAt }
    : null;
  const pendingMergeMemberCount = syncDocument.pendingMerges[input.teamId]?.pendingMemberSlugs.length ?? 0;
  const withSyncViews = (status: "up-to-date" | "update-available" | "unreachable") =>
    ({ status, recentSync, pendingMergeMemberCount });

  const snapshotResult = await loadGithubTeamSnapshot(input.transport, record.upstream.repository).catch(() => null);
  if (snapshotResult === null || snapshotResult.status === "invalid") {
    return withSyncViews("unreachable");
  }

  const location = locationForRecord(dataRoot, record);
  const [applied, bindingDocument, currentContent] = await Promise.all([
    readOfficialTeamStateDocument(dataRoot),
    readExecutionBindingDocument(dataRoot),
    tryReadTeamDirectoryContent(location.directory),
  ]);
  const appliedState = applied.teams[input.teamId];
  if (appliedState === undefined || currentContent === null) {
    return withSyncViews("unreachable");
  }

  const plan = planGithubTeamSync({
    upstream: record.upstream,
    snapshot: snapshotResult.snapshot,
    applied: appliedState,
    currentContent,
    bindings: bindingDocument.teams[teamBindingKey("user", input.teamId)]?.members ?? {},
    suppressedOfficialVersions: [],
  });
  if (plan.kind === "skip") return withSyncViews("unreachable");
  return withSyncViews(plan.decision.kind === "none" ? "up-to-date" : "update-available");
}

/**
 * Resolves the on-disk directory of a recorded user team (managed or
 * relocated). Shared by the check and the sync executor.
 */
export function resolveGithubTeamRecordLocation(
  dataRoot: string,
  record: UserTeamRecord,
): { directory: string } {
  return resolveRelocatedUserTeamLocation({
    dataRoot,
    teamId: record.id,
    directory: record.location.kind === "managed"
      ? path.join(getTeamsRoot(dataRoot), record.location.directoryName)
      : record.location.absolutePath,
  });
}

function locationForRecord(dataRoot: string, record: UserTeamRecord) {
  return resolveGithubTeamRecordLocation(dataRoot, record);
}
