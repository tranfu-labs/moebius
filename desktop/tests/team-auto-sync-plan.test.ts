import { describe, expect, it } from "vitest";

import {
  computeOfficialTeamContentFingerprintFromContent,
  recommendationFingerprint,
  type AppliedOfficialTeamState,
  type OfficialTeamContent,
  type PackagedOfficialTeamState,
} from "../src/team-official-plan.js";
import {
  planOfficialTeamAutoSync,
  type OfficialTeamAutoSyncPlan,
} from "../src/team-auto-sync-plan.js";
import type { ExecutionProfile, ExecutionProfileBinding } from "../src/team-execution-profile.js";
import type { PackagedOfficialTeamManifestV1 } from "../src/team-official-plan.js";

const codexProfile: ExecutionProfile = { cli: "codex", model: "gpt-5.6-sol", effort: "high" };
const kimiProfile: ExecutionProfile = { cli: "kimi", model: "kimi-for-coding", effort: "high" };

function teamJson(overrides: Partial<Record<string, unknown>> = {}): string {
  return JSON.stringify({
    name: "开发团队",
    description: "内置团队",
    primaryAgentSlug: "manager",
    memberOrder: ["manager", "dev", "qa"],
    ...overrides,
  });
}

function content(overrides: Partial<Record<string, string>> = {}): OfficialTeamContent {
  return {
    "team.json": teamJson(),
    "members/manager/AGENT.md": "# 开发经理\n\n负责技术决策。\n",
    "members/dev/AGENT.md": "# 开发\n\n负责实现。\n",
    "members/qa/AGENT.md": "# 测试\n\n负责验收。\n",
    ...overrides,
  };
}

function packagedContent(
  memberContent: Partial<Record<string, string>> = {},
  memberSlugs: readonly string[] = ["manager", "dev", "qa"],
): OfficialTeamContent {
  const base = content(memberContent);
  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(base)) {
    if (key === "team.json" || memberSlugs.some((slug) => key.startsWith(`members/${slug}/`))) {
      result[key] = value;
    }
  }
  for (const slug of memberSlugs) {
    const key = `members/${slug}/AGENT.md`;
    if (result[key] === undefined) {
      result[key] = `# ${slug}\n\n官方内容。\n`;
    }
  }
  return result;
}

function packaged(
  version = "2",
  members: Record<string, ExecutionProfile> = { manager: codexProfile, dev: codexProfile, qa: codexProfile },
  memberContent: Partial<Record<string, string>> = {},
  renamedFrom: Record<string, string> = {},
): PackagedOfficialTeamState {
  const manifest: PackagedOfficialTeamManifestV1 = {
    schemaVersion: 1,
    officialVersion: version,
    members: Object.fromEntries(Object.entries(members).map(([slug, recommendedProfile]) => [
      slug,
      { recommendedProfile, ...(renamedFrom[slug] === undefined ? {} : { renamedFrom: renamedFrom[slug] }) },
    ])),
  };
  return {
    manifest,
    contentFingerprint: computeOfficialTeamContentFingerprintFromContent(
      packagedContent(memberContent, Object.keys(members)),
    ),
  };
}

function applied(
  c: OfficialTeamContent,
  version = "1",
  recommendations: Record<string, ExecutionProfile> = { manager: codexProfile, dev: codexProfile, qa: codexProfile },
  confidence: AppliedOfficialTeamState["baselineConfidence"] = "verified",
): AppliedOfficialTeamState {
  return {
    appliedOfficialVersion: version,
    appliedContentFingerprint: computeOfficialTeamContentFingerprintFromContent(c),
    appliedRecommendationFingerprint: recommendationFingerprint(recommendations),
    appliedRecommendations: recommendations,
    baselineConfidence: confidence,
    appliedContentSnapshot: c,
  };
}

function plan(input: {
  appliedC: OfficialTeamContent;
  currentC: OfficialTeamContent;
  packagedState: PackagedOfficialTeamState;
  packagedContent?: OfficialTeamContent;
  bindings?: Record<string, ExecutionProfileBinding>;
  suppressed?: string[];
  confidence?: AppliedOfficialTeamState["baselineConfidence"];
  appliedVersion?: string;
}): OfficialTeamAutoSyncPlan {
  return planOfficialTeamAutoSync({
    applied: applied(input.appliedC, input.appliedVersion ?? "1", undefined, input.confidence),
    currentContentFingerprint: computeOfficialTeamContentFingerprintFromContent(input.currentC),
    currentContent: input.currentC,
    packaged: input.packagedState,
    packagedContent: input.packagedContent ?? packagedContent({}, Object.keys(input.packagedState.manifest.members)),
    bindings: input.bindings ?? {},
    suppressedOfficialVersions: input.suppressed ?? [],
  });
}

const managerV2 = "# 开发经理\n\n负责技术决策与质量。\n";
const devUser = "# 开发\n\n按方案实现并自测。\n";
const devOfficial = "# 开发\n\n按方案实现。\n";

describe("planOfficialTeamAutoSync", () => {
  it("adopts C wholesale when B equals A and C differs (clean team)", () => {
    const result = plan({
      appliedC: content(),
      currentC: content(),
      packagedState: packaged("2", undefined, { "members/manager/AGENT.md": managerV2 }),
      packagedContent: packagedContent({ "members/manager/AGENT.md": managerV2 }),
    });
    expect(result.kind).toBe("apply");
    if (result.kind !== "apply") return;
    expect(result.apply.targetContent["members/manager/AGENT.md"]).toBe(managerV2);
    expect(result.apply.memberChanges).toMatchObject({
      added: [],
      removed: [],
      adopted: ["manager"],
      recommendationChanged: [],
      keptOverridden: [],
      collidedMembers: [],
    });
  });

  it("does nothing when only the user changed content (C equals A)", () => {
    const customized = content({ "members/dev/AGENT.md": devUser });
    const result = plan({
      appliedC: content(),
      currentC: customized,
      packagedState: packaged("1"),
    });
    expect(result).toEqual({ kind: "none", reason: "ONLY_USER_CHANGES" });
  });

  it("registers the new baseline when B already equals C", () => {
    const result = plan({
      appliedC: content(),
      currentC: content({ "members/qa/AGENT.md": "# 测试\n\n负责验收与对抗。\n" }),
      packagedState: packaged("2", undefined, {
        "members/qa/AGENT.md": "# 测试\n\n负责验收与对抗。\n",
      }),
      packagedContent: packagedContent({ "members/qa/AGENT.md": "# 测试\n\n负责验收与对抗。\n" }),
    });
    expect(result.kind).toBe("register");
  });

  it("marks a diverged member as a merge candidate while adopting one-sided changes", () => {
    const result = plan({
      appliedC: content(),
      currentC: content({ "members/manager/AGENT.md": managerV2, "members/dev/AGENT.md": devUser }),
      packagedState: packaged("2", undefined, {
        "members/manager/AGENT.md": managerV2,
        "members/dev/AGENT.md": devOfficial,
      }),
      packagedContent: packagedContent({
        "members/manager/AGENT.md": managerV2,
        "members/dev/AGENT.md": devOfficial,
      }),
    });
    expect(result.kind).toBe("apply");
    if (result.kind !== "apply") return;
    // manager: B == C → keep; dev: B≠A, C≠A and B≠C → merge; qa: A==C → keep.
    expect(result.apply.mergeCandidates).toEqual(["dev"]);
    expect(result.apply.targetContent["members/dev/AGENT.md"]).toBe(devUser);
  });

  it("keeps a removed member that the user changed (content or override)", () => {
    const result = plan({
      appliedC: content(),
      currentC: content({ "members/qa/AGENT.md": "# 测试\n\n我的验收标准。\n" }),
      packagedState: packaged("2", { manager: codexProfile, dev: codexProfile }),
      packagedContent: packagedContent({}, ["manager", "dev"]),
    });
    expect(result.kind).toBe("apply");
    if (result.kind !== "apply") return;
    expect(result.apply.memberChanges).toMatchObject({
      removed: [],
      keptOverridden: ["qa"],
    });
    expect(result.apply.targetContent["members/qa/AGENT.md"]).toBe("# 测试\n\n我的验收标准。\n");
  });

  it("removes a member the user never changed", () => {
    const result = plan({
      appliedC: content(),
      currentC: content(),
      packagedState: packaged("2", { manager: codexProfile, dev: codexProfile }),
      packagedContent: packagedContent({}, ["manager", "dev"]),
    });
    expect(result.kind).toBe("apply");
    if (result.kind !== "apply") return;
    expect(result.apply.memberChanges.removed).toEqual(["qa"]);
    expect(Object.keys(result.apply.targetContent).some((key) => key.startsWith("members/qa/"))).toBe(false);
  });

  it("treats a renamed official slug as remove plus add and keeps an overridden old slug", () => {
    const result = plan({
      appliedC: content(),
      currentC: content(),
      packagedState: packaged(
        "2",
        { manager: codexProfile, dev: codexProfile, quality: codexProfile },
        {},
        { quality: "qa" },
      ),
      packagedContent: packagedContent({}, ["manager", "dev", "quality"]),
    });
    expect(result.kind).toBe("apply");
    if (result.kind !== "apply") return;
    expect(result.apply.memberChanges.renamed).toEqual([{ from: "qa", to: "quality" }]);
    expect(result.apply.memberChanges.added).toEqual(["quality"]);
    expect(result.apply.memberChanges.removed).toEqual(["qa"]);
  });

  it("defers conservative baselines without auto-merging", () => {
    const result = plan({
      appliedC: content(),
      currentC: content({ "members/dev/AGENT.md": devUser }),
      packagedState: packaged("2"),
      confidence: "conservative",
    });
    expect(result).toEqual({ kind: "defer", reason: "CONSERVATIVE_BASELINE" });
  });

  it("never re-merges a suppressed (reverted) official version", () => {
    const result = plan({
      appliedC: content(),
      currentC: content(),
      packagedState: packaged("2"),
      suppressed: ["2"],
    });
    expect(result).toEqual({ kind: "none", reason: "SUPPRESSED_VERSION" });
  });

  it("skips unreadable current content", () => {
    const unreadable = planOfficialTeamAutoSync({
      applied: applied(content()),
      currentContentFingerprint: null,
      currentContent: null,
      packaged: packaged("2"),
      packagedContent: packagedContent(),
      bindings: {},
      suppressedOfficialVersions: [],
    });
    expect(unreadable).toEqual({ kind: "skip", reason: "UNREADABLE" });
  });

  it("lists recommendation changes for follow-recommendation members and freezes kept overrides", () => {
    const result = plan({
      appliedC: content(),
      currentC: content(),
      packagedState: packaged("2", { manager: kimiProfile, dev: codexProfile, qa: codexProfile }),
      bindings: { qa: { source: "override", profile: kimiProfile } },
    });
    expect(result.kind).toBe("apply");
    if (result.kind !== "apply") return;
    expect(result.apply.memberChanges.recommendationChanged).toEqual(["manager"]);
  });
});
