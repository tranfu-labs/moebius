import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  cachePackagedTeam,
  readExecutionBindingDocument,
  readOfficialTeamStateDocument,
  readTeamExecutionBindings,
  replaceTeamExecutionBindings,
  saveTeamExecutionBinding,
  writeOfficialTeamStateDocument,
} from "../desktop/src/team-management-store.js";

const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((root) =>
    fs.rm(root, { recursive: true, force: true })));
});

async function makeRoot(): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "moebius-team-store-"));
  temporaryRoots.push(root);
  return root;
}

describe("team management state store", () => {
  it("persists versioned official state atomically", async () => {
    const dataRoot = await makeRoot();
    await writeOfficialTeamStateDocument(dataRoot, {
      schemaVersion: 1,
      teams: {
        development: {
          appliedOfficialVersion: "1",
          appliedContentFingerprint: "content",
          appliedRecommendationFingerprint: "recommendations",
          appliedRecommendations: {
            dev: { cli: "codex", model: "gpt-5.6-sol", effort: "high" },
          },
          baselineConfidence: "verified",
        },
      },
    });
    expect(await readOfficialTeamStateDocument(dataRoot)).toMatchObject({
      teams: {
        development: {
          appliedOfficialVersion: "1",
          baselineConfidence: "verified",
        },
      },
    });
  });

  it("saves and replaces member bindings by ownership and team id", async () => {
    const dataRoot = await makeRoot();
    await saveTeamExecutionBinding({
      dataRoot,
      ownership: "system",
      teamId: "development",
      memberSlug: "dev",
      binding: {
        source: "override",
        profile: { cli: "kimi", model: "kimi-for-coding", effort: "high" },
      },
    });
    expect(await readTeamExecutionBindings({
      dataRoot,
      ownership: "system",
      teamId: "development",
    })).toMatchObject({
      dev: { source: "override" },
    });
    await replaceTeamExecutionBindings({
      dataRoot,
      ownership: "system",
      teamId: "development",
      bindings: { dev: { source: "recommended" } },
    });
    expect(await readTeamExecutionBindings({
      dataRoot,
      ownership: "system",
      teamId: "development",
    })).toEqual({ dev: { source: "recommended" } });
    expect(await readExecutionBindingDocument(dataRoot)).toMatchObject({
      schemaVersion: 1,
      teams: {
        "system:development": {
          ownership: "system",
        },
      },
    });
  });

  it("caches packaged teams outside editable content", async () => {
    const dataRoot = await makeRoot();
    const source = path.join(dataRoot, "source");
    await fs.mkdir(source);
    await fs.writeFile(path.join(source, "team.json"), "{}");
    const destination = await cachePackagedTeam({
      dataRoot,
      teamId: "development",
      sourceDirectory: source,
    });
    expect(await fs.readFile(path.join(destination, "team.json"), "utf8")).toBe("{}");
    expect(destination).toContain(path.join(".state", "agent-teams", "packaged"));
  });

  it("rejects malformed persisted documents instead of silently replacing values", async () => {
    const dataRoot = await makeRoot();
    const stateRoot = path.join(dataRoot, ".state", "agent-teams");
    await fs.mkdir(stateRoot, { recursive: true });
    await fs.writeFile(path.join(stateRoot, "execution-bindings-v1.json"), JSON.stringify({
      schemaVersion: 1,
      teams: {
        "system:development": {
          ownership: "system",
          members: {
            dev: { source: "override", profile: { cli: "other" } },
          },
        },
      },
    }));
    await expect(readExecutionBindingDocument(dataRoot)).rejects.toThrow("CLI 必须");
  });
});
