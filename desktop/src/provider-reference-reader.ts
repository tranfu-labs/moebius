import fs from "node:fs/promises";
import path from "node:path";

import {
  normalizeProviderModel,
  type ProviderReference,
} from "../../src/provider-profile.js";

export async function readAiTeamBuilderProviderReferences(
  dataRoot: string,
  profileId: string,
): Promise<ProviderReference[]> {
  const root = path.join(path.resolve(dataRoot), ".state", "ai-team-builder-drafts");
  let entries: string[];
  try {
    entries = await fs.readdir(root);
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") return [];
    throw error;
  }
  const references: ProviderReference[] = [];
  for (const entry of entries.filter((candidate) => candidate.endsWith(".json")).sort()) {
    const raw = JSON.parse(await fs.readFile(path.join(root, entry), "utf8")) as unknown;
    if (!isRecord(raw) || !isRecord(raw.executionProfile)) {
      continue;
    }
    const executionProfile = raw.executionProfile;
    if (
      executionProfile.cli !== "pi"
      || executionProfile.providerId !== "deepseek"
      || executionProfile.providerProfileId !== profileId
      || raw.phase === "selected"
      || raw.continuationEnded === true
    ) {
      continue;
    }
    if (typeof raw.draftId !== "string" || raw.draftId.trim().length === 0) {
      throw new Error("AI team builder draft has an invalid identity");
    }
    references.push({
      kind: "team-builder-draft",
      ownerId: raw.draftId,
      label: `AI 建队草稿 · ${raw.draftId}`,
      profileId,
      model: normalizeProviderModel("deepseek", executionProfile.model),
    });
  }
  return references;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}
