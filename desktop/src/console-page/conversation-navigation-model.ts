import type { OperatorProject, OperatorSession, RightSidebarSourceTab } from "@moebius/console-ui";

import { planConversationProjectContext } from "./console-presentation-model.js";
import type { ConsoleSelection } from "./console-state-coordinator.js";
import {
  ordinaryPresentationRoute,
  sidebarPresentationRoute,
  type ConsolePresentationRoute,
} from "./presentation-route.js";
import { conversationTabSourceKey } from "./right-sidebar-tabs-model.js";

export interface ConversationNavigationPlan {
  kind: "hosted" | "direct";
  route: ConsolePresentationRoute;
  selection: ConsoleSelection;
  composerSessionId: string;
  hostSessionId: string | null;
  source: RightSidebarSourceTab | null;
  rightSidebar: "close" | "keep";
  viewedSessionId: string;
}

export function planConversationNavigationAvailability(pending: boolean): "navigate" | "blocked" {
  return pending ? "blocked" : "navigate";
}

export function planConversationNavigation(
  projects: readonly OperatorProject[],
  selection: ConsoleSelection,
): ConversationNavigationPlan {
  const sessions = projects.flatMap((project) => project.sessions);
  const target = sessions.find((session) => session.sessionId === selection.sessionId);
  const origin = findOrigin(sessions, target);
  if (target?.originSessionId != null && origin !== undefined) {
    return {
      kind: "hosted",
      route: sidebarPresentationRoute({
        sidebarProjectId: target.projectId,
        sidebarSessionId: target.sessionId,
        originSessionId: origin.sessionId,
        originAvailable: true,
      }),
      selection: { projectId: origin.projectId, sessionId: origin.sessionId },
      composerSessionId: origin.sessionId,
      hostSessionId: origin.sessionId,
      source: {
        id: `conversation-${target.sessionId}`,
        type: "conversation",
        title: target.title,
        sourceKey: conversationTabSourceKey(target.sessionId),
        conversationContext: planConversationProjectContext(
          projects.find((project) => project.projectId === target.projectId),
          target,
        ),
        conversationCreatedAt: target.createdAt,
      },
      rightSidebar: "keep",
      viewedSessionId: target.sessionId,
    };
  }
  return {
    kind: "direct",
    route: target?.originSessionId != null
      ? sidebarPresentationRoute({
          sidebarProjectId: target.projectId,
          sidebarSessionId: target.sessionId,
          originSessionId: target.originSessionId,
          originAvailable: false,
        })
      : ordinaryPresentationRoute(selection),
    selection,
    composerSessionId: selection.sessionId,
    hostSessionId: null,
    source: null,
    rightSidebar: target?.originSessionId != null ? "close" : "keep",
    viewedSessionId: selection.sessionId,
  };
}

function findOrigin(
  sessions: readonly OperatorSession[],
  target: OperatorSession | undefined,
): OperatorSession | undefined {
  return target?.originSessionId == null
    ? undefined
    : sessions.find((session) => session.sessionId === target.originSessionId);
}
