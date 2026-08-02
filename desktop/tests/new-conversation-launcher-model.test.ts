import { describe, expect, it } from "vitest";

import {
  planAddedNewConversationProject,
  planNewConversationLaunch,
  planNewConversationProjectChange,
  planNewConversationTeamRepair,
  planPendingNewConversationTeam,
} from "../src/console-page/new-conversation-launcher-model.js";
import { createNewConversationDraft } from "../src/console-page/new-conversation.js";

describe("new conversation launcher model", () => {
  it("applies a pending team once the open draft and catalog are ready", () => {
    const conversation = createNewConversationDraft({ teamKey: null, draft: "" });
    expect(planPendingNewConversationTeam({
      pendingTeamKey: "system:development",
      conversation,
      teamsReady: true,
      resolvedTeamKey: "system:development",
    })).toEqual({ kind: "select", teamKey: "system:development" });
    expect(planPendingNewConversationTeam({
      pendingTeamKey: "system:development",
      conversation: { ...conversation, isOpen: false },
      teamsReady: true,
      resolvedTeamKey: "system:development",
    })).toEqual({ kind: "skip" });
    expect(planNewConversationTeamRepair({
      conversation: { ...conversation, teamKey: "missing" },
      teams: [team("system:development")],
      preferredTeamKey: "system:development",
    })).toEqual({ kind: "select", teamKey: "system:development" });
  });

  it("retains a usable draft project and resets an unavailable requested project", () => {
    const open = createNewConversationDraft({
      projectId: "project-a",
      workspaceMode: "worktree",
      teamKey: "system:development",
      draft: "draft",
    });
    expect(planNewConversationLaunch({
      requestedProjectId: "missing",
      projects: [project("project-a", true)],
      conversation: open,
      preferredTeamKey: "system:development",
      storedDraft: "stored",
    })).toEqual([{ type: "show" }]);
    expect(planNewConversationLaunch({
      requestedProjectId: "project-b",
      projects: [project("project-a", false), project("project-b", false)],
      conversation: open,
      preferredTeamKey: "system:development",
      storedDraft: "stored",
    })).toEqual([
      { type: "select-project", projectId: null },
      { type: "select-workspace", workspaceMode: "direct" },
      { type: "show" },
    ]);
    expect(planNewConversationLaunch({
      projects: [project("project-a", true)],
      conversation: null,
      preferredTeamKey: "system:development",
      storedDraft: "stored",
    })).toMatchObject([{ type: "open", draft: { teamKey: "system:development", draft: "stored" } }]);
  });

  it("maps project selection and successful project creation into draft events", () => {
    expect(planNewConversationProjectChange([project("project-a", true)], "project-a")).toEqual([
      { type: "select-project", projectId: "project-a" },
      { type: "select-workspace", workspaceMode: "worktree" },
    ]);
    expect(planNewConversationProjectChange([project("project-a", true)], "missing")).toEqual([
      { type: "select-project", projectId: "missing" },
      { type: "select-workspace", workspaceMode: "direct" },
    ]);
    expect(planAddedNewConversationProject(null)).toEqual([]);
    expect(planAddedNewConversationProject({ projectId: "project-b" })).toEqual([
      { type: "select-project", projectId: "project-b" },
      { type: "select-workspace", workspaceMode: "direct" },
    ]);
  });
});

function team(teamKey: string) {
  return {
    teamKey,
    id: teamKey.split(":")[1]!,
    ownership: "system" as const,
    name: "Development",
    description: null,
    primaryAgentSlug: "dev",
    memberOrder: [],
    members: [],
    status: "usable" as const,
    canCreateConversation: true,
    canEditContent: false,
    canDeleteTeam: false,
    issues: [],
  };
}

function project(projectId: string, available: boolean) {
  return {
    projectId,
    sourceType: "local-folder" as const,
    title: projectId,
    folderPath: `/tmp/${projectId}`,
    directoryAvailable: available,
    newConversationDisabledReason: available ? null : "missing-folder",
    worktreeMode: projectId === "project-a",
    workspaceCwd: `/tmp/${projectId}`,
    workspaceMode: "direct" as const,
    worktreePath: null,
    worktreeUnavailableReason: null,
    workspaceUpdatedAt: null,
    sessions: [],
    runningCount: 0,
    waitingCount: 0,
    stuckCount: 0,
    errorCount: 0,
  };
}
