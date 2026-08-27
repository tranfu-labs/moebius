import { describe, expect, it } from "vitest";

import {
  decideNonContinuableRecordWrite,
  decideUnavailableTeamStop,
  planAttentionSynchronization,
  planFallbackSessionTitle,
  planNonContinuableRecord,
  planPersistedSessionTitle,
  planRuntimeActivity,
  planSessionBranchRead,
  planUnsafeRunContext,
} from "../src/local-console/session-presentation-plan.js";
import type {
  LocalConsoleMessage,
  LocalConsoleProjectSummary,
  LocalConsoleSessionSummary,
} from "../src/local-console/types.js";

function session(overrides: Partial<LocalConsoleSessionSummary> = {}): LocalConsoleSessionSummary {
  return {
    sessionId: "session-1",
    projectId: "project-1",
    workspaceMode: "direct",
    workspacePendingMode: null,
    title: "Session",
    status: "idle",
    awaitsHumanReason: null,
    unreadSince: null,
    runningCount: 0,
    waitingCount: 0,
    stuckCount: 0,
    errorCount: 0,
    interruptedCount: 0,
    createdAt: "2026-08-02T00:00:00.000Z",
    updatedAt: "2026-08-02T00:00:00.000Z",
    ...overrides,
  };
}

function project(sessions: LocalConsoleSessionSummary[]): LocalConsoleProjectSummary {
  return {
    projectId: "project-1",
    sourceType: "local-folder",
    title: "Project",
    folderPath: "/workspace/project-1",
    worktreeMode: false,
    workspaceCwd: null,
    workspaceMode: null,
    worktreePath: null,
    worktreeUnavailableReason: null,
    workspaceUpdatedAt: null,
    sessions,
    runningCount: sessions.reduce((total, item) => total + item.runningCount, 0),
    waitingCount: 0,
    stuckCount: 0,
    errorCount: 0,
  };
}

describe("session title presentation", () => {
  it("applies persisted and default session title fallbacks", () => {
    expect(planPersistedSessionTitle(null, "fallback")).toBe("fallback");
    expect(planFallbackSessionTitle("default", "default")).toBe("默认会话");
    expect(planFallbackSessionTitle("local:123", "default")).toBe("会话 123");
  });
});

describe("local console session presentation plan", () => {
  it("projects active runtime work over persisted counters", () => {
    const planned = planRuntimeActivity(project([
      session({ runningCount: 0, hasPendingControlWork: false }),
      session({ sessionId: "session-2", runningCount: 2, status: "waiting" }),
    ]), { "session-1": 1, "session-2": 1 });

    expect(planned.runningCount).toBe(3);
    expect(planned.sessions).toMatchObject([
      { sessionId: "session-1", status: "running", runningCount: 1, hasPendingControlWork: true },
      { sessionId: "session-2", status: "running", runningCount: 2, hasPendingControlWork: true },
    ]);
  });

  it("uses the persisted binding path before the legacy session worktree path", () => {
    expect(planSessionBranchRead({
      workspaceMode: "worktree",
      projectBranchName: "main",
      workspaceBinding: {
        canonicalPath: "/workspace/shared-feature",
        branchName: "feature/example",
      },
    })).toEqual({
      kind: "binding",
      workspacePath: "/workspace/shared-feature",
      fallbackBranchName: "feature/example",
    });
    expect(planSessionBranchRead({ workspaceMode: "worktree", projectBranchName: "main" }))
      .toEqual({ kind: "legacy-worktree" });
  });

  it("synchronizes continuation attention only when the persisted kind is stale", () => {
    const continuation = {
      canContinue: false as const,
      kind: "team-deleted" as const,
      reason: "deleted",
      recoveryAction: "select-team" as const,
    };

    expect(planAttentionSynchronization({ continuation, currentKind: null, portAvailable: true }))
      .toEqual({ kind: "sync", desiredKind: "team-deleted" });
    expect(planAttentionSynchronization({ continuation, currentKind: "team-deleted", portAvailable: true }))
      .toEqual({ kind: "preserve" });
    expect(planAttentionSynchronization({ continuation, currentKind: null, portAvailable: false }))
      .toEqual({ kind: "preserve" });
  });

  it("records one recovery notice for a non-continuable session", () => {
    const record = planNonContinuableRecord(session({
      continuation: {
        canContinue: false,
        kind: "project-unavailable",
        reason: "missing",
        recoveryAction: "repair-project",
      },
    }));

    expect(record).toMatchObject({ kind: "record", error: "project-unavailable" });
    if (record.kind !== "record") throw new Error("expected recovery record");
    expect(decideNonContinuableRecordWrite([], record.body)).toEqual({ kind: "record" });
    expect(decideNonContinuableRecordWrite([
      { speaker: "system", body: record.body } as LocalConsoleMessage,
    ], record.body)).toEqual({ kind: "skip" });
  });

  it("stops only active runs whose project or team context is no longer usable", () => {
    const unavailable = new Set(["project-1"]);
    expect(planUnsafeRunContext({
      workspaceMode: "direct",
      sourceProjectId: "project-1",
      unavailableProjectIds: unavailable,
      sessionHealth: "usable",
    })).toEqual({ kind: "abort-project" });
    expect(planUnsafeRunContext({
      workspaceMode: "worktree",
      sourceProjectId: "project-1",
      unavailableProjectIds: unavailable,
      sessionHealth: "deleted",
    })).toEqual({ kind: "inspect-team" });
    expect(decideUnavailableTeamStop(null)).toEqual({ kind: "abort" });
    expect(decideUnavailableTeamStop({ members: [] })).toEqual({ kind: "keep" });
  });
});
