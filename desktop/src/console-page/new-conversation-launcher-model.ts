import type { OperatorAgentTeam, OperatorAgentTeamsState, OperatorProject } from "@moebius/console-ui";

import {
  createNewConversationDraft,
  type NewConversationDraftEvent,
  type NewConversationDraftState,
} from "./new-conversation.js";

export function planPendingNewConversationTeam(input: {
  pendingTeamKey: string | null;
  conversation: NewConversationDraftState | null;
  teamsReady: boolean;
  resolvedTeamKey: string | null;
}): { kind: "skip" } | { kind: "select"; teamKey: string | null } {
  return input.pendingTeamKey !== null
    && input.conversation?.isOpen === true
    && input.teamsReady
    ? { kind: "select", teamKey: input.resolvedTeamKey }
    : { kind: "skip" };
}

export function planNewConversationTeamState(state: OperatorAgentTeamsState): {
  ready: boolean;
  preferredTeams: readonly OperatorAgentTeam[];
  repairTeams: readonly OperatorAgentTeam[] | null;
} {
  return state.status === "ready"
    ? { ready: true, preferredTeams: state.teams, repairTeams: state.teams }
    : { ready: false, preferredTeams: [], repairTeams: null };
}

export function planNewConversationTeamRepair(input: {
  conversation: NewConversationDraftState | null;
  teams: readonly OperatorAgentTeam[] | null;
  preferredTeamKey: string | null;
}): { kind: "skip" } | { kind: "select"; teamKey: string | null } {
  const conversation = input.conversation;
  if (conversation === null || !conversation.isOpen || input.teams === null) return { kind: "skip" };
  const usable = input.teams.some(
    (team) => team.teamKey === conversation.teamKey && team.canCreateConversation,
  );
  return !usable && conversation.teamKey !== input.preferredTeamKey
    ? { kind: "select", teamKey: input.preferredTeamKey }
    : { kind: "skip" };
}

export function planNewConversationLaunch(input: {
  requestedProjectId?: string;
  projects: readonly OperatorProject[];
  conversation: NewConversationDraftState | null;
  preferredTeamKey: string | null;
  storedDraft: string;
}): NewConversationDraftEvent[] {
  const available = (project: OperatorProject) =>
    project.directoryAvailable !== false && project.newConversationDisabledReason == null;
  const selectedProject = input.requestedProjectId === undefined
    ? undefined
    : input.projects.find((project) =>
        project.projectId === input.requestedProjectId && available(project));
  const current = input.conversation;
  if (current !== null) {
    const draftProjectIsAvailable = current.projectId === null
      || input.projects.some((project) => project.projectId === current.projectId && available(project));
    const nextProject = selectedProject
      ?? (draftProjectIsAvailable
        ? input.projects.find((project) => project.projectId === current.projectId)
        : undefined);
    const selectionEvents: NewConversationDraftEvent[] = current.projectId === (nextProject?.projectId ?? null)
      ? []
      : [
          { type: "select-project", projectId: nextProject?.projectId ?? null },
          {
            type: "select-workspace",
            workspaceMode: nextProject?.worktreeMode === true ? "worktree" : "direct",
          },
        ];
    return [...selectionEvents, { type: "show" }];
  }
  return [{
    type: "open",
    draft: createNewConversationDraft({
      projectId: selectedProject?.projectId,
      workspaceMode: selectedProject?.worktreeMode === true ? "worktree" : "direct",
      teamKey: input.preferredTeamKey,
      draft: input.storedDraft,
    }),
  }];
}

export function planNewConversationProjectChange(
  projects: readonly OperatorProject[],
  projectId: string,
): NewConversationDraftEvent[] {
  const project = projects.find((candidate) => candidate.projectId === projectId);
  return [
    { type: "select-project", projectId },
    {
      type: "select-workspace",
      workspaceMode: project?.worktreeMode === true ? "worktree" : "direct",
    },
  ];
}

export function planNewConversationWorkspacePreference(input: {
  projectId: string | null | undefined;
  workspaceMode: "direct" | "worktree";
}): { kind: "skip" } | { kind: "persist"; projectId: string; workspaceMode: "direct" | "worktree" } {
  return input.projectId === null || input.projectId === undefined
    ? { kind: "skip" }
    : { kind: "persist", projectId: input.projectId, workspaceMode: input.workspaceMode };
}

export function planAddedNewConversationProject(
  project: { projectId: string } | null,
): NewConversationDraftEvent[] {
  return project === null
    ? []
    : [
        { type: "select-project", projectId: project.projectId },
        { type: "select-workspace", workspaceMode: "direct" },
      ];
}
