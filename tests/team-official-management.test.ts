import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import type {
  ExecutionProfile,
  ExecutionProfileBinding,
} from "../desktop/src/team-execution-profile.js";
import {
  computeOfficialTeamContentFingerprint,
  deriveOfficialTeamUpdateState,
  parsePackagedOfficialTeamManifest,
  recommendationFingerprint,
  type AppliedOfficialTeamState,
  type PackagedOfficialTeamManifestV1,
} from "../desktop/src/team-official-management.js";

const temporaryRoots: string[] = [];
const codexProfile: ExecutionProfile = {
  cli: "codex",
  model: "gpt-5.6-sol",
  effort: "high",
};
const kimiProfile: ExecutionProfile = {
  cli: "kimi",
  model: "kimi-for-coding",
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

function applied(
  contentFingerprint: string,
  recommendations: Record<string, ExecutionProfile> = { manager: codexProfile },
  confidence: AppliedOfficialTeamState["baselineConfidence"] = "verified",
): AppliedOfficialTeamState {
  return {
    appliedOfficialVersion: "1",
    appliedContentFingerprint: contentFingerprint,
    appliedRecommendationFingerprint: recommendationFingerprint(recommendations),
    appliedRecommendations: recommendations,
    baselineConfidence: confidence,
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

  it("derives clean and customized update actions", () => {
    const packaged = { manifest: manifest(), contentFingerprint: "latest" };
    expect(deriveOfficialTeamUpdateState({
      applied: applied("base"),
      currentContentFingerprint: "base",
      currentMemberSlugs: ["manager"],
      packaged,
      bindings: { manager: { source: "recommended" } },
    })).toMatchObject({
      primaryAction: "update",
      requiresProtectiveCopy: false,
      reasonCode: "CLEAN_UPDATE",
    });
    expect(deriveOfficialTeamUpdateState({
      applied: applied("base"),
      currentContentFingerprint: "custom",
      currentMemberSlugs: ["manager"],
      packaged,
      bindings: { manager: { source: "recommended" } },
    })).toMatchObject({
      primaryAction: "protect-and-update",
      requiresProtectiveCopy: true,
      reasonCode: "CUSTOMIZED_UPDATE",
    });
  });

  it("protects removed overrides even when current content already equals C", () => {
    const bindings: Record<string, ExecutionProfileBinding> = {
      manager: { source: "recommended" },
      qa: { source: "override", profile: kimiProfile },
    };
    expect(deriveOfficialTeamUpdateState({
      applied: applied("base", { manager: codexProfile, qa: codexProfile }),
      currentContentFingerprint: "latest",
      currentMemberSlugs: ["manager"],
      packaged: {
        manifest: manifest({ manager: codexProfile }),
        contentFingerprint: "latest",
      },
      bindings,
    })).toMatchObject({
      primaryAction: "protect-and-update",
      protectedMembers: ["qa"],
      reasonCode: "PROTECTED_MEMBER_REMOVAL",
    });
  });

  it("protects a user member colliding with a newly official slug", () => {
    expect(deriveOfficialTeamUpdateState({
      applied: applied("base"),
      currentContentFingerprint: "custom",
      currentMemberSlugs: ["manager", "qa"],
      packaged: {
        manifest: manifest({ manager: codexProfile, qa: codexProfile }),
        contentFingerprint: "custom",
      },
      bindings: {
        manager: { source: "recommended" },
        qa: { source: "explicit", profile: kimiProfile },
      },
    })).toMatchObject({
      primaryAction: "protect-and-update",
      collidingMembers: ["qa"],
      reasonCode: "USER_MEMBER_COLLISION",
    });
  });

  it("registers already-latest content only when no protection applies", () => {
    expect(deriveOfficialTeamUpdateState({
      applied: applied("base"),
      currentContentFingerprint: "latest",
      currentMemberSlugs: ["manager"],
      packaged: {
        manifest: manifest(),
        contentFingerprint: "latest",
      },
      bindings: { manager: { source: "recommended" } },
    })).toMatchObject({
      primaryAction: "register",
      reasonCode: "CONTENT_ALREADY_LATEST",
    });
  });

  it("treats recommendation-only changes as an official update", () => {
    expect(deriveOfficialTeamUpdateState({
      applied: applied("same"),
      currentContentFingerprint: "same",
      currentMemberSlugs: ["manager"],
      packaged: {
        manifest: manifest({ manager: kimiProfile }),
        contentFingerprint: "same",
      },
      bindings: { manager: { source: "recommended" } },
    })).toMatchObject({
      updateStatus: "available",
      recommendationChangedMembers: ["manager"],
      primaryAction: "update",
    });
  });

  it("fails closed when content cannot be compared", () => {
    expect(deriveOfficialTeamUpdateState({
      applied: applied("base"),
      currentContentFingerprint: null,
      currentMemberSlugs: ["manager"],
      packaged: { manifest: manifest(), contentFingerprint: "latest" },
      bindings: {},
    })).toMatchObject({
      updateStatus: "unknown",
      primaryAction: "retry",
      reasonCode: "COMPARISON_UNAVAILABLE",
    });
  });
});
