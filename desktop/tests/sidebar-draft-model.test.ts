import { describe, expect, it } from "vitest";
import type { OperatorAgentTeamsState, OperatorProject, OperatorSession } from "@moebius/console-ui";

import {
  planSidebarDraftPromotion,
  planSidebarDraftSubmission,
} from "../src/console-page/sidebar-draft-model.js";
import { createSidebarConversationDraft } from "../src/console-page/sidebar-conversation-drafts.js";

describe("sidebar draft model", () => {
  it("requires a usable team and complete draft before submission", () => {
    const draft = analysisDraft();
    expect(planSidebarDraftSubmission({
      apiBase: null,
      draft,
      sending: false,
      attachmentsBlocked: false,
      teams: teams(),
    })).toEqual({ kind: "skip" });
    expect(planSidebarDraftSubmission({
      apiBase: "http://local/",
      draft,
      sending: false,
      attachmentsBlocked: false,
      teams: { status: "ready", teams: [] },
    })).toEqual({ kind: "team-unavailable" });
    expect(planSidebarDraftSubmission({
      apiBase: "http://local/",
      draft,
      sending: false,
      attachmentsBlocked: false,
      teams: teams(),
    })).toMatchObject({ kind: "submit", apiBase: "http://local/", draft: { draftId: "draft-a" } });
  });

  it("keeps an analysis child under its root host after promotion", () => {
    const root = session("root", null);
    const child = session("child", "root");
    const promotion = planSidebarDraftPromotion({
      projects: [project(root, child)],
      sessions: [root, child],
      draft: { ...analysisDraft(), hostSessionId: "child", originSessionId: "child" },
      createdSessionId: "analysis",
    });
    expect(promotion).toMatchObject({
      tabHostSessionId: "root",
      route: {
        projectId: "project-a",
        selectedSessionId: "analysis",
        mainSessionId: "root",
        rightConversationSessionId: "analysis",
        hostSessionId: "root",
      },
    });
  });
});

function analysisDraft() {
  return {
    ...createSidebarConversationDraft({
      draftId: "draft-a",
      hostSessionId: "root",
      originSessionId: "root",
      entryTemplate: "session-analysis" as const,
      context: {
        projectId: "project-a",
        workspaceMode: "direct" as const,
        teamKey: "system:general-assistant",
      },
      now: "2026-08-02T00:00:00.000Z",
    }),
    body: "Analyze this",
  };
}

function teams(): OperatorAgentTeamsState {
  return {
    status: "ready",
    teams: [{
      teamKey: "system:general-assistant",
      id: "general-assistant",
      ownership: "system",
      name: "General",
      description: null,
      primaryAgentSlug: "ceo",
      memberOrder: [],
      members: [],
      status: "usable",
      canCreateConversation: true,
      canEditContent: false,
      canDeleteTeam: false,
      issues: [],
    }],
  };
}

function project(...sessions: OperatorSession[]): OperatorProject {
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
    sessions,
    runningCount: 0,
    waitingCount: 0,
    stuckCount: 0,
    errorCount: 0,
  };
}

function session(sessionId: string, parentSessionId: string | null): OperatorSession {
  return {
    sessionId,
    projectId: "project-a",
    parentSessionId: null,
    analysisParentSessionId: parentSessionId,
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
