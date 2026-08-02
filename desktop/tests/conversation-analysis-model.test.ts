import { describe, expect, it } from "vitest";
import type { OperatorProject, OperatorSession } from "@moebius/console-ui";

import type { LocalConsoleState } from "../src/console-page/console-state-contract.js";
import {
  planConversationAnalysisDraft,
  planConversationAnalysisStart,
} from "../src/console-page/conversation-analysis-model.js";

describe("conversation analysis model", () => {
  it("rejects missing or unavailable sources and plans selection work only when required", () => {
    expect(planConversationAnalysisStart(null, null, {
      kind: "message",
      sessionId: "missing",
      runId: null,
      messageId: null,
    })).toEqual({ kind: "error", error: "source-missing", notice: "open-failed" });

    const unavailable = state(session({ analysisRecordAvailable: false }), "other");
    expect(planConversationAnalysisStart(unavailable, "other", {
      kind: "conversation",
      sessionId: "root",
      projectId: "project-a",
    })).toEqual({ kind: "error", error: "record-unavailable", notice: "record-unavailable" });

    const ready = planConversationAnalysisStart(state(session(), "other"), "other", {
      kind: "conversation",
      sessionId: "root",
      projectId: "project-a",
    });
    expect(ready).toMatchObject({
      kind: "ready",
      targetSelection: { projectId: "project-a", sessionId: "root" },
      loadTarget: true,
      commitConversationRoute: true,
      requiresMutation: true,
    });
  });

  it("creates one analysis draft and appends later fragments without replacing its identity", () => {
    const source = session();
    const first = planConversationAnalysisDraft(null, {
      draftId: "draft-a",
      source,
      teamKey: "system:general-assistant",
      fragment: { id: "first", label: "ignored", text: "one" },
      fragmentLabel: "片段 1",
      now: "2026-08-02T00:00:00.000Z",
    });
    const second = planConversationAnalysisDraft(first, {
      draftId: "unused",
      source,
      teamKey: null,
      fragment: { id: "second", label: "ignored", text: "two" },
      fragmentLabel: "片段 2",
      now: "2026-08-02T00:00:01.000Z",
    });

    expect(second).toMatchObject({
      draftId: "draft-a",
      hostSessionId: "root",
      writePolicy: "confirm-current-plan-before-write",
      textFragments: [
        { id: "first", label: "片段 1", text: "one" },
        { id: "second", label: "片段 2", text: "two" },
      ],
      updatedAt: "2026-08-02T00:00:01.000Z",
    });
  });
});

function state(root: OperatorSession, selectedSessionId: string): LocalConsoleState {
  const project = operatorProject(root);
  return {
    projects: [project],
    project,
    selectedProjectId: "project-a",
    selectedSessionId,
    selectedSession: selectedSessionId === root.sessionId ? root : null,
    messages: [],
    pendingPrimaryMessages: [],
    childSessions: [],
    memberIdentities: [],
    activeRun: null,
    activeRuns: [],
    workspaceDiff: { available: false, fileCount: null, reason: "unavailable" },
    sqlitePath: "/tmp/test.sqlite",
    lastError: null,
  };
}

function operatorProject(root: OperatorSession): OperatorProject {
  return {
    projectId: "project-a",
    sourceType: "local-folder",
    title: "Project",
    folderPath: "/tmp/project-a",
    worktreeMode: false,
    workspaceCwd: "/tmp/project-a",
    workspaceMode: "direct",
    worktreePath: null,
    worktreeUnavailableReason: null,
    workspaceUpdatedAt: null,
    sessions: [root],
    runningCount: 0,
    waitingCount: 0,
    stuckCount: 0,
    errorCount: 0,
  };
}

function session(overrides: Partial<OperatorSession> = {}): OperatorSession {
  return {
    sessionId: "root",
    projectId: "project-a",
    analysisParentSessionId: null,
    workspaceMode: "direct",
    workspacePendingMode: null,
    title: "Root",
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
