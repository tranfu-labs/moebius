import { describe, expect, it } from "vitest";

import {
  computeOfficialTeamContentFingerprintFromContent,
  planAppliedBaselineMigration,
} from "./team-official-plan.js";

const cleanContent = {
  "team.json": JSON.stringify({
    name: "开发团队",
    description: "内置团队",
    primaryAgentSlug: "dev-manager",
    memberOrder: ["dev-manager", "dev", "qa"],
  }),
  "members/dev-manager/AGENT.md": "# 开发经理\n\n负责技术决策。\n",
  "members/dev/AGENT.md": "# 开发\n\n负责实现。\n",
  "members/qa/AGENT.md": "# 测试\n\n负责验收。\n",
};

describe("planAppliedBaselineMigration", () => {
  it("back-fills A and marks verified when the current content matches the legacy fingerprint", () => {
    const legacyFingerprint = computeOfficialTeamContentFingerprintFromContent(cleanContent);
    const plan = planAppliedBaselineMigration({
      legacyFingerprint,
      currentContent: cleanContent,
    });
    expect(plan.confidence).toBe("verified");
    expect(plan.backfillContent).toEqual(cleanContent);
  });

  it("marks conservative without fabricating content when the fingerprints differ", () => {
    const legacyFingerprint = computeOfficialTeamContentFingerprintFromContent(cleanContent);
    const edited = {
      ...cleanContent,
      "members/dev-manager/AGENT.md": "# 开发经理\n\n负责技术决策与质量。\n",
    };
    const plan = planAppliedBaselineMigration({
      legacyFingerprint,
      currentContent: edited,
    });
    expect(plan.confidence).toBe("conservative");
    expect(plan.backfillContent).toBeNull();
  });

  it("treats team.json key ordering as content equality (normalized entry)", () => {
    const legacyFingerprint = computeOfficialTeamContentFingerprintFromContent(cleanContent);
    const differentlyKeyed = {
      ...cleanContent,
      "team.json": JSON.stringify({
        memberOrder: ["dev-manager", "dev", "qa"],
        primaryAgentSlug: "dev-manager",
        description: "内置团队",
        name: "开发团队",
      }),
    };
    const plan = planAppliedBaselineMigration({
      legacyFingerprint,
      currentContent: differentlyKeyed,
    });
    expect(plan.confidence).toBe("verified");
  });

  it("treats an extra member file as a content difference", () => {
    const legacyFingerprint = computeOfficialTeamContentFingerprintFromContent(cleanContent);
    const withExtraFile = {
      ...cleanContent,
      "members/dev/notes.md": "备注\n",
    };
    const plan = planAppliedBaselineMigration({
      legacyFingerprint,
      currentContent: withExtraFile,
    });
    expect(plan.confidence).toBe("conservative");
  });
});
