import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { readAiTeamBuilderProviderReferences } from "../src/provider-reference-reader.js";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});

describe("Provider reference reader", () => {
  it("includes resumable Pi builder drafts and releases selected drafts", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "moebius-provider-references-"));
    roots.push(root);
    const drafts = path.join(root, ".state", "ai-team-builder-drafts");
    await fs.mkdir(drafts, { recursive: true });
    const base = {
      version: 3,
      messages: [],
      proposal: null,
      proposalRevision: null,
      executionProfile: {
        cli: "pi",
        providerId: "deepseek",
        providerProfileId: "profile-1",
        model: "deepseek-v4-pro",
        effort: "high",
      },
    };
    await fs.writeFile(path.join(drafts, "active.json"), JSON.stringify({
      ...base,
      draftId: "active",
      phase: "clarifying",
    }));
    await fs.writeFile(path.join(drafts, "selected.json"), JSON.stringify({
      ...base,
      draftId: "selected",
      phase: "selected",
    }));

    await expect(readAiTeamBuilderProviderReferences(root, "profile-1")).resolves.toEqual([{
      kind: "team-builder-draft",
      ownerId: "active",
      label: "AI 建队草稿 · active",
      profileId: "profile-1",
      model: "deepseek-v4-pro",
    }]);
  });
});
