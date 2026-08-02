import type { OperatorProject, OperatorSession } from "@moebius/console-ui";

import type { ConsoleSelection } from "./console-state-coordinator.js";
import type { ConsolePresentationRoute } from "./presentation-route.js";

export function decideProjectMutationAvailability(apiBase: string | null):
  | { kind: "available"; apiBase: string }
  | { kind: "unavailable"; error: string } {
  return apiBase === null
    ? { kind: "unavailable", error: "local console server unavailable" }
    : { kind: "available", apiBase };
}

export function planProjectRemovalContext(input: {
  projectId: string;
  selection: ConsoleSelection;
  projects: readonly OperatorProject[];
  route: ConsolePresentationRoute | null;
}): {
  wasCurrentProject: boolean;
  removingSessionIds: string[];
  routeBeforeRemoval: ConsolePresentationRoute | null;
  migratingSidebarSession: OperatorSession | null;
} {
  const removingSessionIds = input.projects
    .find((candidate) => candidate.projectId === input.projectId)
    ?.sessions.map((session) => session.sessionId) ?? [];
  const removing = new Set(removingSessionIds);
  const route = input.route;
  const shouldMigrate = route !== null
    && route.rightConversationSessionId !== null
    && removing.has(route.mainSessionId)
    && !removing.has(route.rightConversationSessionId);
  const migratingSidebarSession = shouldMigrate
    ? input.projects.flatMap((candidate) => candidate.sessions)
      .find((session) => session.sessionId === route.rightConversationSessionId) ?? null
    : null;
  return {
    wasCurrentProject: input.selection.projectId === input.projectId,
    removingSessionIds,
    routeBeforeRemoval: route,
    migratingSidebarSession,
  };
}

export function planRemovedProjectSessionIds(
  response: { archivedSessionIds?: string[] },
  fallbackSessionIds: readonly string[],
): string[] {
  return response.archivedSessionIds ?? [...fallbackSessionIds];
}

export function decideProjectRemovalMigration(
  session: OperatorSession | null,
): { kind: "migrate"; session: OperatorSession } | { kind: "refresh-current" } {
  return session === null ? { kind: "refresh-current" } : { kind: "migrate", session };
}

export function decideProjectRemovalRefresh(loaded: boolean): "commit" | "retain" {
  return loaded ? "commit" : "retain";
}
