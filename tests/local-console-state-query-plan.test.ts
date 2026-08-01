import { describe, expect, it } from "vitest";

import {
  planLocalSnapshotStatus,
  planSelectedConsoleState,
} from "../src/local-console/state-query-plan.js";
import type {
  LocalConsoleMessage,
  LocalConsoleProjectSummary,
  LocalConsoleSessionSummary,
} from "../src/local-console/types.js";

function session(sessionId: string, projectId: string, parentSessionId: string | null = null): LocalConsoleSessionSummary {
  return {
    sessionId,
    projectId,
    parentSessionId,
    workspaceMode: "direct",
    workspacePendingMode: null,
    title: sessionId,
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
  };
}

function project(projectId: string, sessions: LocalConsoleSessionSummary[]): LocalConsoleProjectSummary {
  return {
    projectId,
    sourceType: "local-folder",
    title: projectId,
    folderPath: `/workspace/${projectId}`,
    worktreeMode: false,
    workspaceCwd: null,
    workspaceMode: null,
    worktreePath: null,
    worktreeUnavailableReason: null,
    workspaceUpdatedAt: null,
    sessions,
    runningCount: 0,
    waitingCount: 0,
    stuckCount: 0,
    errorCount: 0,
  };
}

describe("local console state query plan", () => {
  it("selects the requested project root when the previous session belongs elsewhere", () => {
    const rootA = session("session-a", "project-a");
    const rootB = session("session-b", "project-b");
    const selected = planSelectedConsoleState({
      projects: [project("project-a", [rootA]), project("project-b", [rootB])],
      requestedProjectId: "project-b",
      selectedSessionId: "session-a",
      projectRoot: "/workspace",
    });

    expect(selected).toMatchObject({
      selectedProject: { projectId: "project-b" },
      selectedSession: { sessionId: "session-b" },
      sessionId: "session-b",
    });
  });

  it("does not promote a child session when choosing a project fallback", () => {
    const child = session("child", "project-a", "parent");
    const selected = planSelectedConsoleState({
      projects: [project("project-a", [child])],
      requestedProjectId: undefined,
      selectedSessionId: "missing",
      projectRoot: "/workspace",
    });

    expect(selected.selectedProject.projectId).toBe("project-a");
    expect(selected.selectedSession).toBeNull();
    expect(selected.sessionId).toBe("missing");
  });

  it("projects active work before persisted terminal status", () => {
    const failed = [{ status: "failed" }] as LocalConsoleMessage[];
    expect(planLocalSnapshotStatus({ messages: failed, activeRunCount: 1 })).toBe("running");
    expect(planLocalSnapshotStatus({ messages: failed, activeRunCount: 0 })).toBe("failed");
    expect(planLocalSnapshotStatus({ messages: [], activeRunCount: 0 })).toBe("idle");
  });
});
