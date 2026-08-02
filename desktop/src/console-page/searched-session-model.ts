import type { OperatorSession, RightSidebarSourceTab } from "@moebius/console-ui";

import type { LocalConsoleState } from "./console-state-contract.js";
import { planConversationProjectContext } from "./console-presentation-model.js";
import type { SessionSearchResult } from "./conversation-search-model.js";
import { sidebarPresentationRoute, type ConsolePresentationRoute } from "./presentation-route.js";
import { conversationTabSourceKey } from "./right-sidebar-tabs-model.js";

export function planSearchedSessionTarget(input: {
  apiBase: string | null;
  result: SessionSearchResult;
  restore: boolean;
}):
  | { kind: "unavailable" }
  | { kind: "existing"; target: OperatorSession }
  | { kind: "restore"; apiBase: string; sessionId: string } {
  if (input.apiBase === null) return { kind: "unavailable" };
  return input.restore
    ? { kind: "restore", apiBase: input.apiBase, sessionId: input.result.session.sessionId }
    : { kind: "existing", target: input.result.session };
}

export function planSearchedSessionNavigation(input: {
  target: OperatorSession;
  originAvailable: boolean;
  state: LocalConsoleState | null;
}):
  | {
      kind: "hosted";
      route: ConsolePresentationRoute;
      hostSessionId: string;
      source: RightSidebarSourceTab;
      selection: { projectId: string; sessionId: string };
    }
  | {
      kind: "direct";
      route: ConsolePresentationRoute;
      selection: { projectId: string; sessionId: string };
    } {
  const target = input.target;
  const origin = target.originSessionId == null
    ? undefined
    : input.state?.projects.flatMap((project) => project.sessions)
      .find((session) => session.sessionId === target.originSessionId);
  if (origin !== undefined && input.originAvailable) {
    return {
      kind: "hosted",
      route: sidebarPresentationRoute({
        sidebarProjectId: target.projectId,
        sidebarSessionId: target.sessionId,
        originSessionId: origin.sessionId,
        originAvailable: true,
      }),
      hostSessionId: origin.sessionId,
      source: {
        id: `conversation-${target.sessionId}`,
        type: "conversation",
        title: target.title,
        sourceKey: conversationTabSourceKey(target.sessionId),
        conversationContext: planConversationProjectContext(
          input.state?.projects.find((project) => project.projectId === target.projectId),
          target,
        ),
        conversationCreatedAt: target.createdAt,
      },
      selection: { projectId: origin.projectId, sessionId: origin.sessionId },
    };
  }
  return {
    kind: "direct",
    route: sidebarPresentationRoute({
      sidebarProjectId: target.projectId,
      sidebarSessionId: target.sessionId,
      originSessionId: target.originSessionId ?? null,
      originAvailable: false,
    }),
    selection: { projectId: target.projectId, sessionId: target.sessionId },
  };
}
