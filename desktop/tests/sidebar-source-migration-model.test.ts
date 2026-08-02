import { describe, expect, it } from "vitest";

import { planSidebarSourceMigration } from "../src/console-page/sidebar-source-migration-model.js";
import { sidebarPresentationRoute } from "../src/console-page/presentation-route.js";

describe("sidebar source migration model", () => {
  it("migrates a surviving right conversation only after its main source disappears", () => {
    const target = session("right", "missing-main");
    const route = sidebarPresentationRoute({
      sidebarProjectId: "project-a",
      sidebarSessionId: "right",
      originSessionId: "missing-main",
      originAvailable: true,
    });
    expect(planSidebarSourceMigration({
      projects: [project(target)],
      route,
      migratingSessionId: null,
    })).toMatchObject({
      kind: "migrate",
      sessionId: "right",
      selection: { projectId: "project-a", sessionId: "right" },
      route: { mainSessionId: "right", rightConversationSessionId: null },
    });
    expect(planSidebarSourceMigration({
      projects: [project(target)],
      route,
      migratingSessionId: "right",
    })).toEqual({ kind: "skip" });
    expect(planSidebarSourceMigration({
      projects: [project(session("missing-main", null), target)],
      route,
      migratingSessionId: null,
    })).toEqual({ kind: "skip" });
  });
});

function project(...sessions: ReturnType<typeof session>[]) {
  return {
    projectId: "project-a", sourceType: "local-folder" as const, title: "Project",
    folderPath: "/tmp/project-a", worktreeMode: false, workspaceCwd: "/tmp/project-a",
    workspaceMode: "direct" as const, worktreePath: null, worktreeUnavailableReason: null,
    workspaceUpdatedAt: null, sessions, runningCount: 0, waitingCount: 0, stuckCount: 0, errorCount: 0,
  };
}

function session(sessionId: string, originSessionId: string | null) {
  return {
    sessionId, projectId: "project-a", originSessionId, analysisParentSessionId: null,
    workspaceMode: "direct" as const, workspacePendingMode: null, title: sessionId,
    status: "idle" as const, awaitsHumanReason: null, unreadSince: null,
    runningCount: 0, waitingCount: 0, stuckCount: 0, errorCount: 0, interruptedCount: 0,
    createdAt: "2026-08-02T00:00:00.000Z", updatedAt: "2026-08-02T00:00:00.000Z",
  };
}
