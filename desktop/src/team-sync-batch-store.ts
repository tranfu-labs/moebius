import fs from "node:fs/promises";
import path from "node:path";

import { getAgentTeamsStateRoot } from "./team-management-store.js";
import {
  OFFICIAL_SYNC_BATCHES_FILE,
  type OfficialSyncBatchRecord,
  type PendingOfficialMergeRecord,
} from "./team-auto-sync-plan.js";

export interface OfficialSyncStateDocumentV1 {
  schemaVersion: 1;
  /** teamId -> latest sync batch (a newer sync replaces the previous batch). */
  batches: Record<string, OfficialSyncBatchRecord>;
  /** teamId -> merge still waiting for the default Agent or the one-time merge. */
  pendingMerges: Record<string, PendingOfficialMergeRecord>;
  /** teamId -> official versions whose sync the user reverted (never re-merged). */
  suppressedVersions: Record<string, string[]>;
}

export async function readOfficialSyncStateDocument(
  dataRoot: string,
): Promise<OfficialSyncStateDocumentV1> {
  try {
    const value = JSON.parse(await fs.readFile(
      path.join(getAgentTeamsStateRoot(dataRoot), OFFICIAL_SYNC_BATCHES_FILE),
      "utf8",
    )) as unknown;
    if (!isPlainObject(value) || value.schemaVersion !== 1) {
      throw new Error("官方同步记录文件格式无效。");
    }
    return {
      schemaVersion: 1,
      batches: isPlainObject(value.batches)
        ? value.batches as Record<string, OfficialSyncBatchRecord>
        : {},
      pendingMerges: isPlainObject(value.pendingMerges)
        ? value.pendingMerges as Record<string, PendingOfficialMergeRecord>
        : {},
      suppressedVersions: isPlainObject(value.suppressedVersions)
        ? value.suppressedVersions as Record<string, string[]>
        : {},
    };
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") {
      return { schemaVersion: 1, batches: {}, pendingMerges: {}, suppressedVersions: {} };
    }
    throw error;
  }
}

export async function writeOfficialSyncStateDocument(
  dataRoot: string,
  document: OfficialSyncStateDocumentV1,
): Promise<void> {
  const target = path.join(getAgentTeamsStateRoot(dataRoot), OFFICIAL_SYNC_BATCHES_FILE);
  await fs.mkdir(path.dirname(target), { recursive: true });
  const temporary = `${target}.${process.pid}.tmp`;
  await fs.writeFile(temporary, `${JSON.stringify(document, null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o600,
  });
  await fs.rename(temporary, target);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}
