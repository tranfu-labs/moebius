import { describe, expect, it } from "vitest";

import { decideSessionWorkspaceSwitch } from "../src/local-console/session-workspace-policy.js";

describe("local session workspace policy", () => {
  it("rejects workspace mutation after the first message without changing the selected team", () => {
    const decision = decideSessionWorkspaceSwitch({
      messageCount: 1,
      requestedMode: "worktree",
      workspaceIsGitRepository: true,
    });

    expect(decision).toEqual({ kind: "reject", reason: "workspace-locked" });
  });

  it.each([
    ["direct", false, { kind: "allow" }],
    ["worktree", true, { kind: "allow" }],
    ["worktree", false, { kind: "reject", reason: "not-git-repository" }],
  ] as const)("decides empty-session %s mutation", (requestedMode, workspaceIsGitRepository, expected) => {
    expect(decideSessionWorkspaceSwitch({
      messageCount: 0,
      requestedMode,
      workspaceIsGitRepository,
    })).toEqual(expected);
  });
});
