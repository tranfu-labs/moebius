import type {
  OperatorProject,
} from "@moebius/console-ui";

import type { SidebarConversationDraft } from "./sidebar-conversation-drafts.js";

export function planSidebarDraftProjectChange(
  draft: SidebarConversationDraft,
  projectId: string,
  projects: readonly OperatorProject[],
  now: string,
): SidebarConversationDraft {
  const project = projects.find((candidate) => candidate.projectId === projectId);
  return {
    ...draft,
    context: {
      ...draft.context,
      projectId,
      workspaceMode: project?.worktreeMode === true ? "worktree" : "direct",
    },
    updatedAt: now,
  };
}

export function planSidebarDraftWorkspaceChange(
  draft: SidebarConversationDraft,
  workspaceMode: "direct" | "worktree",
  now: string,
): SidebarConversationDraft {
  return { ...draft, context: { ...draft.context, workspaceMode }, updatedAt: now };
}

export function planSidebarDraftTeamChange(
  draft: SidebarConversationDraft,
  teamKey: string | null,
  now: string,
): SidebarConversationDraft {
  return { ...draft, context: { ...draft.context, teamKey }, updatedAt: now };
}

export function planSidebarDraftBodyChange(
  draft: SidebarConversationDraft,
  body: string,
  now: string,
): SidebarConversationDraft {
  return { ...draft, body, updatedAt: now };
}

export function planSidebarDraftFragmentRemoval(
  draft: SidebarConversationDraft,
  fragmentId: string,
  now: string,
): SidebarConversationDraft {
  return {
    ...draft,
    textFragments: draft.textFragments.filter((fragment) => fragment.id !== fragmentId),
    updatedAt: now,
  };
}

export function planSidebarDraftSuggestionSelection(
  draft: SidebarConversationDraft,
  suggestion: { prompt: string },
  now: string,
): SidebarConversationDraft {
  return {
    ...draft,
    body: draft.body.trim() === ""
      ? suggestion.prompt
      : `${draft.body.trimEnd()}\n${suggestion.prompt}`,
    updatedAt: now,
  };
}
