import { describe, expect, it } from "vitest";

import {
  decideExternalChange,
  parseExternalChangeRequest,
  parseFileManagerRequest,
  parseRepairRequest,
  planExternalChangeRead,
  planFileManagerTarget,
} from "../src/team-desktop-action-plan.js";

describe("team desktop action plan", () => {
  it("plans external reads and content comparison", () => {
    // External-change detection covers BOTH official-source and user teams
    // (product-review blocker 2: an official team's Finder edit used to be
    // silently ignored).
    expect(planExternalChangeRead()).toBe("read");
    expect(decideExternalChange("same", "same")).toBe("unchanged");
    expect(decideExternalChange("old", "new")).toBe("changed");
  });

  it("parses file-manager and external-change requests", () => {
    expect(parseExternalChangeRequest({
      teamId: "development",
      ownership: "user",
      memberSlug: "manager",
      knownAgentMarkdown: "# manager",
    })).toMatchObject({ ownership: "user", memberSlug: "manager" });
    expect(parseFileManagerRequest({ teamId: "development", ownership: "system" }))
      .toEqual({ teamId: "development", ownership: "system" });
    expect(planFileManagerTarget("manager")).toBe("member");
  });

  it("rejects repair requests for built-in teams", () => {
    expect(() => parseRepairRequest({ teamId: "development", ownership: "system" }))
      .toThrow("软件自带团队");
  });
});
