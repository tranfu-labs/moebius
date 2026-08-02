import { describe, expect, it } from "vitest";
import type { OperatorProject, OperatorSession } from "@moebius/console-ui";

import {
  decideProjectRemovalMigration,
  planProjectRemovalContext,
  planRemovedProjectSessionIds,
} from "../src/console-page/project-mutation-model.js";
import { sidebarPresentationRoute } from "../src/console-page/presentation-route.js";

describe("project mutation model", () => {
  it("migrates a surviving sidebar conversation when its main project is removed", () => {
    const main = session("main", "project-a");
    const sidebar = session("sidebar", "project-b", "main");
    const route = sidebarPresentationRoute({
      sidebarProjectId: "project-b",
      sidebarSessionId: "sidebar",
      originSessionId: "main",
      originAvailable: true,
    });

    const removal = planProjectRemovalContext({
      projectId: "project-a",
      selection: { projectId: "project-a", sessionId: "main" },
      projects: [project("project-a", main), project("project-b", sidebar)],
      route,
    });

    expect(removal).toMatchObject({
      wasCurrentProject: true,
      removingSessionIds: ["main"],
      migratingSidebarSession: { sessionId: "sidebar", projectId: "project-b" },
    });
    expect(decideProjectRemovalMigration(removal.migratingSidebarSession)).toMatchObject({
      kind: "migrate",
      session: { sessionId: "sidebar" },
    });
  });

  it("refreshes the current selection when no surviving sidebar session exists", () => {
    const main = session("main", "project-a");
    const sidebar = session("sidebar", "project-a", "main");
    const removal = planProjectRemovalContext({
      projectId: "project-a",
      selection: { projectId: "project-b", sessionId: "other" },
      projects: [project("project-a", main, sidebar)],
      route: sidebarPresentationRoute({
        sidebarProjectId: "project-a",
        sidebarSessionId: "sidebar",
        originSessionId: "main",
        originAvailable: true,
      }),
    });

    expect(decideProjectRemovalMigration(removal.migratingSidebarSession)).toEqual({
      kind: "refresh-current",
    });
    expect(planRemovedProjectSessionIds({}, removal.removingSessionIds)).toEqual(["main", "sidebar"]);
    expect(planRemovedProjectSessionIds(
      { archivedSessionIds: ["server-selected"] },
      removal.removingSessionIds,
    )).toEqual(["server-selected"]);
  });
});

function project(projectId: string, ...sessions: OperatorSession[]): OperatorProject {
  return {
    projectId,
    sourceType: "local-folder",
    title: projectId,
    folderPath: `/tmp/${projectId}`,
    worktreeMode: false,
    workspaceCwd: `/tmp/${projectId}`,
    workspaceMode: "direct",
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

function session(
  sessionId: string,
  projectId: string,
  originSessionId: string | null = null,
): OperatorSession {
  return {
    sessionId,
    projectId,
    originSessionId,
    analysisParentSessionId: null,
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
