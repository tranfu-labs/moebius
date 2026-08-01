import { describe, expect, it } from "vitest";
import {
  decideConversationBaselineRead,
  decideConversationDiffRead,
  planConversationWorkspaceContext,
} from "../src/local-console/conversation-workspace-plan.js";

describe("conversation workspace plan", () => {
  it("reads a persisted baseline only when the cache is empty and the port exists", () => {
    expect(decideConversationBaselineRead({ cached: false, persistenceAvailable: true })).toEqual({ kind: "read" });
    expect(decideConversationBaselineRead({ cached: true, persistenceAvailable: true })).toEqual({ kind: "skip" });
    expect(decideConversationBaselineRead({ cached: false, persistenceAvailable: false })).toEqual({ kind: "skip" });
  });

  it("requires a baseline before requesting a workspace diff", () => {
    expect(decideConversationDiffRead(null)).toEqual({ kind: "missing-baseline" });
    expect(decideConversationDiffRead("abc123")).toEqual({ kind: "read" });
  });

  it("prefers the persisted baseline and preserves the selected workspace mode", () => {
    expect(planConversationWorkspaceContext({
      workspaceMode: "worktree",
      persistedBaselineCommit: "persisted",
      cachedBaselineCommit: "cached",
    })).toEqual({ workspaceKind: "worktree", baselineCommit: "persisted" });
    expect(planConversationWorkspaceContext({
      workspaceMode: "direct",
      persistedBaselineCommit: null,
      cachedBaselineCommit: "cached",
    })).toEqual({ workspaceKind: "direct", baselineCommit: "cached" });
  });
});
