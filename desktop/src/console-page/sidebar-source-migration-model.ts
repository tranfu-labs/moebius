import type { OperatorProject } from "@moebius/console-ui";

import { sidebarPresentationRoute, type ConsolePresentationRoute } from "./presentation-route.js";

export function planSidebarSourceMigration(input: {
  projects: readonly OperatorProject[];
  route: ConsolePresentationRoute | null;
  migratingSessionId: string | null;
}):
  | { kind: "skip" }
  | {
      kind: "migrate";
      sessionId: string;
      selection: { projectId: string; sessionId: string };
      route: ConsolePresentationRoute;
    } {
  const route = input.route;
  if (route === null || route.rightConversationSessionId === null) return { kind: "skip" };
  const sessions = input.projects.flatMap((project) => project.sessions);
  if (sessions.some((session) => session.sessionId === route.mainSessionId)) return { kind: "skip" };
  const target = sessions.find((session) => session.sessionId === route.rightConversationSessionId);
  if (target === undefined || input.migratingSessionId === target.sessionId) return { kind: "skip" };
  return {
    kind: "migrate",
    sessionId: target.sessionId,
    selection: { projectId: target.projectId, sessionId: target.sessionId },
    route: sidebarPresentationRoute({
      sidebarProjectId: target.projectId,
      sidebarSessionId: target.sessionId,
      originSessionId: target.originSessionId ?? route.mainSessionId,
      originAvailable: false,
    }),
  };
}

export function decideSidebarSourceMigrationCommit(loaded: boolean): "commit" | "retain" {
  return loaded ? "commit" : "retain";
}
