import { describe, expect, it } from "vitest";

import {
  normalizeOfficialTeamStateDocument,
  normalizeTeamExecutionBindingDocument,
} from "../src/team-management-document-codec.js";

describe("team management document codec", () => {
  it("normalizes valid official and binding documents", () => {
    expect(normalizeOfficialTeamStateDocument({
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
    }).teams.development?.baselineConfidence).toBe("verified");
    expect(normalizeTeamExecutionBindingDocument({
      schemaVersion: 1,
      teams: {
        "system:development": {
          ownership: "system",
          members: { dev: { source: "recommended" } },
        },
      },
    }).teams["system:development"]?.members).toEqual({ dev: { source: "recommended" } });
  });

  it("rejects malformed ownership and state keys", () => {
    expect(() => normalizeTeamExecutionBindingDocument({
      schemaVersion: 1,
      teams: { development: { ownership: "other", members: {} } },
    })).toThrow("运行配置无效");
    expect(() => normalizeOfficialTeamStateDocument({
      schemaVersion: 1,
      teams: { "../development": {} },
    })).toThrow("状态 key 无效");
  });
});
