import { describe, expect, it } from "vitest";

import {
  planSearchedSessionNavigation,
  planSearchedSessionTarget,
} from "../src/console-page/searched-session-model.js";

describe("searched session model", () => {
  it("restores on request and otherwise keeps an available result", () => {
    const result = searchResult();
    expect(planSearchedSessionTarget({ apiBase: null, result, restore: true })).toEqual({
      kind: "unavailable",
    });
    expect(planSearchedSessionTarget({ apiBase: "http://local/", result, restore: true })).toEqual({
      kind: "restore",
      apiBase: "http://local/",
      sessionId: "child",
    });
    expect(planSearchedSessionTarget({ apiBase: "http://local/", result, restore: false })).toMatchObject({
      kind: "existing",
      target: { sessionId: "child" },
    });
  });

  it("opens a surviving origin as host and falls back to a direct route otherwise", () => {
    const state = consoleState();
    expect(planSearchedSessionNavigation({
      target: childSession(),
      originAvailable: true,
      state,
    })).toMatchObject({
      kind: "hosted",
      hostSessionId: "root",
      selection: { projectId: "project-a", sessionId: "root" },
      source: { sourceKey: "conversation:child" },
    });
    expect(planSearchedSessionNavigation({
      target: childSession(),
      originAvailable: false,
      state,
    })).toMatchObject({
      kind: "direct",
      selection: { projectId: "project-a", sessionId: "child" },
      route: { mainSessionId: "child", rightConversationSessionId: null },
    });
  });
});

function searchResult() {
  return {
    session: childSession(),
    project: { projectId: "project-a", title: "Project" },
    archived: true,
    originAvailable: true,
  };
}

function consoleState() {
  const root = rootSession();
  const child = childSession();
  const project = {
    projectId: "project-a",
    sourceType: "local-folder" as const,
    title: "Project",
    folderPath: "/tmp/project-a",
    worktreeMode: false,
    workspaceCwd: "/tmp/project-a",
    workspaceMode: "direct" as const,
    worktreePath: null,
    worktreeUnavailableReason: null,
    workspaceUpdatedAt: null,
    sessions: [root, child],
    runningCount: 0,
    waitingCount: 0,
    stuckCount: 0,
    errorCount: 0,
  };
  return {
    projects: [project],
    project,
    selectedProjectId: "project-a",
    selectedSessionId: "root",
    selectedSession: root,
    messages: [],
    pendingPrimaryMessages: [],
    childSessions: [],
    memberIdentities: [],
    activeRun: null,
    activeRuns: [],
    workspaceDiff: { available: false as const, fileCount: null, reason: "unavailable" as const },
    sqlitePath: "/tmp/test.sqlite",
    lastError: null,
  };
}

function rootSession() {
  return session({ sessionId: "root", originSessionId: null });
}

function childSession() {
  return session({ sessionId: "child", originSessionId: "root" });
}

function session(input: { sessionId: string; originSessionId: string | null }) {
  return {
    sessionId: input.sessionId,
    projectId: "project-a",
    originSessionId: input.originSessionId,
    analysisParentSessionId: null,
    workspaceMode: "direct" as const,
    workspacePendingMode: null,
    title: input.sessionId,
    status: "idle" as const,
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
