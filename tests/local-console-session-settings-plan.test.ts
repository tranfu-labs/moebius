import { describe, expect, it } from "vitest";
import {
  decideSessionArchive,
  decideSessionWorkspaceInspection,
  decideSessionWorkspacePersistenceError,
} from "../src/local-console/session-settings-plan.js";

describe("session settings plan", () => {
  it("locks workspace mutation before any workspace I/O after the first message", () => {
    expect(decideSessionWorkspaceInspection({ messageCount: 1, requestedMode: "worktree" }))
      .toEqual({ kind: "reject-locked" });
    expect(decideSessionWorkspaceInspection({ messageCount: 0, requestedMode: "worktree" }))
      .toEqual({ kind: "inspect-git" });
    expect(decideSessionWorkspaceInspection({ messageCount: 0, requestedMode: "direct" }))
      .toEqual({ kind: "allow-direct" });
  });

  it("maps only the stable persistence lock signal to the public lock error", () => {
    expect(decideSessionWorkspacePersistenceError("SESSION_WORKSPACE_LOCKED"))
      .toEqual({ kind: "workspace-locked" });
    expect(decideSessionWorkspacePersistenceError("disk failed")).toEqual({ kind: "rethrow" });
  });

  it("requires both archive capability and an idle session", () => {
    expect(decideSessionArchive({ capabilityAvailable: false, activeRun: false })).toEqual({ kind: "unavailable" });
    expect(decideSessionArchive({ capabilityAvailable: true, activeRun: true })).toEqual({ kind: "running" });
    expect(decideSessionArchive({ capabilityAvailable: true, activeRun: false })).toEqual({ kind: "archive" });
  });
});
