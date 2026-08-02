import { describe, expect, it } from "vitest";

import {
  assertBuiltInTeamOwnership,
  assertDirectUserTeamDirectory,
  assertMemberIsNotPrimary,
  assertValidTeamId,
  classifyTeamOwnership,
  selectPrimaryAgentSlug,
  selectTeamDirectoryName,
  shouldIncludeCanonicalSystemTeam,
} from "../src/team-location-plan.js";
import {
  assertUserTeamRecordOwnership,
  classifyUserTeamRecordLocation,
} from "../src/team-record-plan.js";
import {
  assertSeedEntryIsNotReserved,
  deriveBuiltInTeamSeedStatus,
  shouldTrackSeedConflictRecovery,
} from "../src/team-seed-plan.js";

describe("team storage plans", () => {
  it("classifies managed records and system team locations", () => {
    expect(classifyUserTeamRecordLocation({
      isManagedDirectory: true,
      directoryName: "development",
      absolutePath: "/external/development",
    })).toEqual({ kind: "managed", directoryName: "development" });
    expect(selectTeamDirectoryName({
      ownership: "system",
      override: "development.official",
      teamId: "development",
      systemRoot: "/teams/.system",
      userRoot: "/teams",
    })).toEqual({ rootDirectory: "/teams/.system", directoryName: "development.official" });
    expect(classifyTeamOwnership(".system")).toBe("system");
  });

  it("rejects invalid ownership and path mutations", () => {
    expect(() => assertUserTeamRecordOwnership("system")).toThrow("只有用户团队");
    expect(() => assertValidTeamId("../development")).toThrow("Invalid team id");
    expect(() => assertBuiltInTeamOwnership("user", "user", "/teams/development"))
      .toThrow("Only a built-in team");
    expect(() => assertMemberIsNotPrimary("manager", "manager")).toThrow("删除主 Agent");
    expect(() => assertDirectUserTeamDirectory({
      parentDirectory: "/external",
      teamsRoot: "/teams",
      directoryName: "development",
    })).toThrow("direct children");
  });

  it("derives collection, primary-agent, and seed decisions", () => {
    expect(shouldIncludeCanonicalSystemTeam({
      teamId: "development",
      overriddenDirectoryNames: new Set(),
      excludedCanonicalIds: new Set(),
    })).toBe(true);
    expect(selectPrimaryAgentSlug(null, "manager")).toBe("manager");
    expect(shouldTrackSeedConflictRecovery({
      teamId: "general-assistant",
      generalAssistantTeamId: "general-assistant",
      preserveConflicts: true,
    })).toBe(true);
    expect(deriveBuiltInTeamSeedStatus(0, 1)).toBe("seeded");
    expect(deriveBuiltInTeamSeedStatus(1, 1)).toBe("conflict");
    expect(() => assertSeedEntryIsNotReserved(".teams-seed.marker", ".teams-seed.marker"))
      .toThrow("reserved");
  });
});
