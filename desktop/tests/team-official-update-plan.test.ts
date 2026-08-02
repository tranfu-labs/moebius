import { describe, expect, it } from "vitest";

import {
  assertOfficialContentFingerprint,
  createOfficialUpdatePlanId,
  selectBindingMembers,
  selectPersistedDocumentSource,
  selectSnapshotMemberSlugs,
} from "../src/team-official-update-plan.js";

describe("official team update plan", () => {
  it("uses deterministic plan ids and an empty copy id discriminator", () => {
    expect(createOfficialUpdatePlanId({
      teamId: "development",
      inputFingerprint: "input",
      copyTeamId: null,
    })).toHaveLength(64);
    expect(createOfficialUpdatePlanId({
      teamId: "development",
      inputFingerprint: "input",
      copyTeamId: "development-copy",
    })).not.toBe(createOfficialUpdatePlanId({
      teamId: "development",
      inputFingerprint: "input",
      copyTeamId: null,
    }));
  });

  it("selects persisted records, bindings, and snapshot members with explicit fallbacks", () => {
    expect(selectPersistedDocumentSource(null)).toBe("rebuild");
    expect(selectPersistedDocumentSource("persisted")).toBe("persisted");
    expect(selectBindingMembers(undefined, { manager: 1 })).toEqual({ manager: 1 });
    expect(selectSnapshotMemberSlugs({
      memberOrder: undefined,
      members: [{ slug: "manager" }],
    })).toEqual(["manager"]);
  });

  it("rejects a staged content fingerprint mismatch", () => {
    expect(() => assertOfficialContentFingerprint(
      "actual",
      "expected",
      () => new Error("官方团队更新包校验失败。"),
    ))
      .toThrow("更新包校验失败");
  });
});
