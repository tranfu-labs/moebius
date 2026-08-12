import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import type {
  ExecutionProfile,
} from "../desktop/src/team-execution-profile.js";
import {
  computeOfficialTeamContentFingerprint,
  parsePackagedOfficialTeamManifest,
  type PackagedOfficialTeamManifestV1,
} from "../desktop/src/team-official-management.js";

const temporaryRoots: string[] = [];
const codexProfile: ExecutionProfile = {
  cli: "codex",
  model: "gpt-5.6-sol",
  effort: "high",
};

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((root) =>
    fs.rm(root, { recursive: true, force: true })));
});

async function makeTeam(): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "moebius-official-team-"));
  temporaryRoots.push(root);
  await fs.mkdir(path.join(root, "members", "manager"), { recursive: true });
  await fs.writeFile(path.join(root, "team.json"), JSON.stringify({
    name: "团队",
    description: "说明",
    primaryAgentSlug: "manager",
    memberOrder: ["manager"],
  }, null, 2));
  await fs.writeFile(path.join(root, "members", "manager", "AGENT.md"), "# manager\n");
  await fs.writeFile(path.join(root, "onboarding-orchestration.json"), "{\"ignored\":1}");
  await fs.writeFile(path.join(root, "official.json"), "{\"ignored\":1}");
  return root;
}

function manifest(
  members: Record<string, ExecutionProfile> = { manager: codexProfile },
  version = "2",
): PackagedOfficialTeamManifestV1 {
  return {
    schemaVersion: 1,
    officialVersion: version,
    members: Object.fromEntries(Object.entries(members).map(([slug, recommendedProfile]) => [
      slug,
      { recommendedProfile },
    ])),
  };
}

describe("official team management", () => {
  it("normalizes and validates packaged manifests", () => {
    expect(parsePackagedOfficialTeamManifest(manifest())).toEqual(manifest());
    expect(() => parsePackagedOfficialTeamManifest({
      schemaVersion: 1,
      officialVersion: "",
      members: {},
    })).toThrow("版本不能为空");
  });

  it("excludes orchestration and official metadata from content fingerprints", async () => {
    const root = await makeTeam();
    const before = await computeOfficialTeamContentFingerprint(root);
    await fs.writeFile(path.join(root, "onboarding-orchestration.json"), "{\"ignored\":2}");
    await fs.writeFile(path.join(root, "official.json"), "{\"ignored\":2}");
    expect(await computeOfficialTeamContentFingerprint(root)).toBe(before);
    await fs.writeFile(path.join(root, "members", "manager", "AGENT.md"), "# changed\n");
    expect(await computeOfficialTeamContentFingerprint(root)).not.toBe(before);
  });

  it("normalizes team.json formatting before hashing", async () => {
    const root = await makeTeam();
    const before = await computeOfficialTeamContentFingerprint(root);
    await fs.writeFile(path.join(root, "team.json"), JSON.stringify({
      memberOrder: ["manager"],
      primaryAgentSlug: "manager",
      description: "说明",
      name: "团队",
    }));
    expect(await computeOfficialTeamContentFingerprint(root)).toBe(before);
  });
});
