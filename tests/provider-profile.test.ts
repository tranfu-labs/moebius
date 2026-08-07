import { describe, expect, it } from "vitest";
import {
  PROVIDER_CATALOG,
  ProviderProfileError,
  ProviderReferenceError,
  classifyProviderFailure,
  createReadyProviderProfile,
  formatProviderSessionReferenceOwner,
  formatProviderTeamReferenceOwner,
  parseEffectiveProviderSessionReferenceOwner,
  parseProviderSessionReferenceOwner,
  parseProviderTeamReferenceOwner,
  providerProfileFingerprint,
  removeVerifiedModel,
  rotateProviderProfile,
} from "../src/provider-profile.js";

const now = "2026-08-04T12:00:00.000Z";

function profile() {
  return createReadyProviderProfile({
    id: "profile-1",
    providerId: "deepseek",
    displayName: "生产账号",
    credentialRef: "credential-1",
    keySuffix: "7K2M",
    defaultModel: "deepseek-v4-pro",
    verifiedModels: ["deepseek-v4-flash", "deepseek-v4-pro"],
    now,
  });
}

describe("provider profile domain", () => {
  it("publishes only the maintained DeepSeek catalog", () => {
    expect(PROVIDER_CATALOG).toEqual([
      expect.objectContaining({
        id: "deepseek",
        baseUrl: "https://api.deepseek.com",
        models: [
          expect.objectContaining({ id: "deepseek-v4-flash", efforts: ["high", "max"], defaultEffort: "high" }),
          expect.objectContaining({ id: "deepseek-v4-pro", efforts: ["high", "max"], defaultEffort: "high" }),
        ],
      }),
    ]);
  });

  it("atomically rotates only after every verified model passes", () => {
    expect(() => rotateProviderProfile(profile(), {
      credentialRef: "credential-2",
      keySuffix: "ABCD",
      validatedModels: ["deepseek-v4-pro"],
      now,
    })).toThrowError(ProviderProfileError);

    expect(rotateProviderProfile(profile(), {
      credentialRef: "credential-2",
      keySuffix: "ABCD",
      validatedModels: ["deepseek-v4-pro", "deepseek-v4-flash"],
      now: "2026-08-04T12:01:00.000Z",
    })).toEqual(expect.objectContaining({
      credentialRef: "credential-2",
      keySuffix: "ABCD",
      revision: 2,
      readiness: "ready",
    }));
  });

  it("distinguishes temporary enable failures from configuration failures", () => {
    expect(classifyProviderFailure({
      current: "disabled",
      reason: "network",
      duringEnable: true,
    })).toEqual({ readiness: "disabled", reason: "network" });
    expect(classifyProviderFailure({
      current: "disabled",
      reason: "credential-invalid",
      duringEnable: true,
    })).toEqual({ readiness: "needs-attention", reason: "credential-invalid" });
  });

  it("blocks a referenced model and clears a removed default model", () => {
    expect(() => removeVerifiedModel(profile(), "deepseek-v4-pro", [{
      kind: "resumable-session",
      ownerId: "session-1",
      label: "会话",
      profileId: "profile-1",
      model: "deepseek-v4-pro",
    }], now)).toThrowError(ProviderReferenceError);

    expect(removeVerifiedModel(profile(), "deepseek-v4-pro", [], now)).toEqual(expect.objectContaining({
      defaultModel: null,
      verifiedModels: ["deepseek-v4-flash"],
      readiness: "ready",
    }));
  });

  it("keeps key rotation outside the Pi identity fingerprint", () => {
    const identity = {
      providerProfileId: "profile-1",
      providerId: "deepseek" as const,
      model: "deepseek-v4-pro" as const,
      effort: "high" as const,
    };
    expect(providerProfileFingerprint(identity)).toBe(providerProfileFingerprint(identity));
    expect(providerProfileFingerprint({ ...identity, model: "deepseek-v4-flash" })).not.toBe(
      providerProfileFingerprint(identity),
    );
  });

  it("round-trips canonical reference identities containing colons", () => {
    const teamOwner = formatProviderTeamReferenceOwner({
      ownership: "user",
      teamId: "catalog:team",
      memberSlug: "dev:lead",
    });
    const sessionOwner = formatProviderSessionReferenceOwner({
      sessionId: "local:session:1",
      slot: "effective",
      memberName: "@dev:lead",
    });
    const pendingOwner = formatProviderSessionReferenceOwner({
      sessionId: "local:session:1",
      slot: "pending",
      memberName: "@dev:lead",
    });
    expect(parseProviderTeamReferenceOwner(teamOwner)).toEqual({
      ownership: "user",
      teamId: "catalog:team",
      memberSlug: "dev:lead",
    });
    expect(parseProviderSessionReferenceOwner(sessionOwner)).toEqual({
      sessionId: "local:session:1",
      slot: "effective",
      memberName: "@dev:lead",
    });
    expect(parseProviderSessionReferenceOwner(pendingOwner)).toEqual({
      sessionId: "local:session:1",
      slot: "pending",
      memberName: "@dev:lead",
    });
    expect(parseEffectiveProviderSessionReferenceOwner(sessionOwner)).toEqual({
      sessionId: "local:session:1",
      memberName: "@dev:lead",
    });
    expect(() => parseEffectiveProviderSessionReferenceOwner(pendingOwner)).toThrow("只有可恢复会话引用");
  });
});
