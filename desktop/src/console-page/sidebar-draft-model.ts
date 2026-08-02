import type {
  OperatorAgentTeam,
  OperatorAgentTeamsState,
  OperatorProject,
  OperatorSession,
} from "@moebius/console-ui";

import { planFindOperatorAgentTeam } from "./agent-team-console-model.js";
import {
  planAnalysisRootSession,
  planConversationProjectContext,
} from "./console-presentation-model.js";
import type { ConsolePresentationRoute } from "./presentation-route.js";
import { sidebarPresentationRoute } from "./presentation-route.js";
import type { SidebarConversationDraft } from "./sidebar-conversation-drafts.js";

export function planSidebarDraftSubmission(input: {
  apiBase: string | null;
  draft: SidebarConversationDraft | null;
  sending: boolean;
  attachmentsBlocked: boolean;
  teams: OperatorAgentTeamsState;
}):
  | { kind: "skip" }
  | { kind: "team-unavailable" }
  | { kind: "submit"; apiBase: string; draft: SidebarConversationDraft; team: OperatorAgentTeam } {
  const draft = input.draft;
  if (
    input.apiBase === null
    || draft === null
    || draft.body.trim() === ""
    || draft.context.projectId === null
    || draft.context.teamKey === null
    || input.sending
    || input.attachmentsBlocked
  ) {
    return { kind: "skip" };
  }
  const team = planFindOperatorAgentTeam(input.teams, draft.context.teamKey);
  return team === undefined || !team.canCreateConversation
    ? { kind: "team-unavailable" }
    : { kind: "submit", apiBase: input.apiBase, draft, team };
}

export function planSidebarCreatedTitle(title: string | undefined, body: string): string {
  return title ?? body.trim().replace(/\s+/gu, " ").slice(0, 32);
}

export function planSidebarDraftPromotion(input: {
  projects: readonly OperatorProject[];
  sessions: readonly OperatorSession[];
  draft: SidebarConversationDraft;
  createdSessionId: string;
}): {
  conversationContext: ReturnType<typeof planConversationProjectContext>;
  tabHostSessionId: string;
  route: ConsolePresentationRoute;
} {
  const createdProject = input.projects.find(
    (project) => project.projectId === input.draft.context.projectId,
  );
  const directParent = input.sessions.find(
    (session) => session.sessionId === input.draft.hostSessionId,
  );
  const root = directParent === undefined
    ? null
    : planAnalysisRootSession(input.sessions, directParent.sessionId);
  return {
    conversationContext: planConversationProjectContext(createdProject),
    tabHostSessionId: root?.sessionId ?? input.draft.hostSessionId,
    route: root === null
      ? sidebarPresentationRoute({
          sidebarProjectId: input.draft.context.projectId!,
          sidebarSessionId: input.createdSessionId,
          originSessionId: input.draft.originSessionId,
          originAvailable: input.draft.originSessionId !== null,
        })
      : {
          version: 1,
          projectId: root.projectId,
          selectedSessionId: input.createdSessionId,
          mainSessionId: root.sessionId,
          rightConversationSessionId: input.createdSessionId,
          hostSessionId: root.sessionId,
          notice: null,
        },
  };
}

export function decideSidebarTabCommit(
  currentHostSessionId: string,
  targetHostSessionId: string,
): "commit" | "retain" {
  return currentHostSessionId === targetHostSessionId ? "commit" : "retain";
}

export function decideSidebarTeamPreference(result: "recorded" | "unavailable"): "commit" | "skip" {
  return result === "recorded" ? "commit" : "skip";
}

export function decideSidebarDraftUpdate(draft: SidebarConversationDraft | null):
  | { kind: "update"; draft: SidebarConversationDraft }
  | { kind: "skip" } {
  return draft === null ? { kind: "skip" } : { kind: "update", draft };
}

export function planSidebarCurrentHostSessionId(
  route: ConsolePresentationRoute | null,
  selectionSessionId: string,
): string {
  return route?.hostSessionId ?? selectionSessionId;
}
