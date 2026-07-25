import { describe, expect, it } from "vitest";

import {
  capabilitySnapshotId,
  evaluateExecutionProfile,
  materializeExplicitBindings,
  migrateOfficialMemberBindings,
  normalizeExecutionProfile,
  profileFingerprint,
  resolveEffectiveExecutionProfile,
  type ExecutionCapabilitySnapshot,
  type ExecutionProfile,
} from "../desktop/src/team-execution-profile.js";

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

function capability(
  profile: ExecutionProfile,
): ExecutionCapabilitySnapshot {
  const models = [{
    id: profile.model,
    displayName: profile.model,
    efforts: [profile.effort],
    defaultEffort: profile.effort,
  }];
  return {
    cli: profile.cli,
    cliVersion: "1.0.0",
    status: "available",
    models,
    snapshotId: capabilitySnapshotId({
      cli: profile.cli,
      cliVersion: "1.0.0",
      status: "available",
      models,
    }),
    checkedAt: "2026-07-25T00:00:00.000Z",
  };
}

describe("team execution profiles", () => {
  it("normalizes complete profiles and rejects implicit values", () => {
    expect(normalizeExecutionProfile({
      cli: " codex ",
      model: " gpt-5.6-sol ",
      effort: " high ",
    })).toEqual(codexProfile);
    expect(() => normalizeExecutionProfile({
      cli: "codex",
      model: "",
      effort: "high",
    })).toThrow("Model 不能为空");
    expect(() => normalizeExecutionProfile({
      cli: "other",
      model: "model",
      effort: "high",
    })).toThrow("CLI 必须");
  });

  it("uses stable fingerprints without leaking the profile values", () => {
    const first = profileFingerprint(codexProfile);
    expect(first).toHaveLength(64);
    expect(first).toBe(profileFingerprint({ ...codexProfile }));
    expect(first).not.toBe(profileFingerprint(kimiProfile));
    expect(first).not.toContain(codexProfile.model);
  });

  it("resolves recommended and explicit bindings", () => {
    expect(resolveEffectiveExecutionProfile({
      binding: { source: "recommended" },
      recommendation: codexProfile,
    })).toEqual(codexProfile);
    expect(resolveEffectiveExecutionProfile({
      binding: { source: "explicit", profile: kimiProfile },
      recommendation: codexProfile,
    })).toEqual(kimiProfile);
    expect(() => resolveEffectiveExecutionProfile({
      binding: { source: "recommended" },
    })).toThrow("没有可用的官方推荐");
  });

  it("reports capability availability without replacing a saved value", () => {
    expect(evaluateExecutionProfile(kimiProfile, capability(kimiProfile))).toEqual({
      status: "available",
      profile: kimiProfile,
    });
    expect(evaluateExecutionProfile(kimiProfile, undefined)).toMatchObject({
      status: "unable-to-verify",
      profile: kimiProfile,
    });
    expect(evaluateExecutionProfile(kimiProfile, capability(codexProfile))).toMatchObject({
      status: "needs-adjustment",
      profile: kimiProfile,
    });
    const missingModel = capability(kimiProfile);
    missingModel.models = [];
    expect(evaluateExecutionProfile(kimiProfile, missingModel)).toMatchObject({
      status: "needs-adjustment",
      profile: kimiProfile,
      reason: "已保存的模型当前不可用。",
    });
  });

  it("keeps overrides for stable slugs and protects removed overrides", () => {
    expect(migrateOfficialMemberBindings({
      previousMembers: {
        manager: codexProfile,
        qa: codexProfile,
      },
      nextMembers: {
        manager: kimiProfile,
        reviewer: kimiProfile,
      },
      bindings: {
        manager: { source: "override", profile: codexProfile },
        qa: { source: "override", profile: kimiProfile },
      },
    })).toEqual({
      nextBindings: {
        manager: { source: "override", profile: codexProfile },
        reviewer: { source: "recommended" },
      },
      removedOverrides: {
        qa: kimiProfile,
      },
    });
  });

  it("materializes copies as independent explicit profiles", () => {
    expect(materializeExplicitBindings({
      memberSlugs: ["manager", "qa"],
      bindings: {
        manager: { source: "recommended" },
        qa: { source: "override", profile: kimiProfile },
      },
      recommendations: {
        manager: codexProfile,
        qa: codexProfile,
      },
    })).toEqual({
      manager: { source: "explicit", profile: codexProfile },
      qa: { source: "explicit", profile: kimiProfile },
    });
  });
});
