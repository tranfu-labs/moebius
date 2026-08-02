import { useCallback, useMemo, useRef } from "react";
import type { OperatorProject, RightSidebarSourceTab, RightSidebarTabsState } from "@moebius/console-ui";

import {
  planConversationNavigation,
  planConversationNavigationAvailability,
} from "./conversation-navigation-model.js";
import type { ConsoleSelection } from "./console-state-coordinator.js";
import type { ConsolePresentationRoute } from "./presentation-route.js";

export function useConversationNavigation(input: {
  projects: readonly OperatorProject[];
  selectionMutationPending(): boolean;
  getSelection(): ConsoleSelection;
  enableSelectionPersistence(): void;
  hideNewConversation(): void;
  commitRoute(route: ConsolePresentationRoute): void;
  activateComposer(sessionId: string): void;
  selectSession(selection: ConsoleSelection): void;
  readTabs(hostSessionId: string): RightSidebarTabsState;
  writeTabs(hostSessionId: string, tabs: RightSidebarTabsState): void;
  openTab(tabs: RightSidebarTabsState, source: RightSidebarSourceTab): RightSidebarTabsState;
  commitTabs(tabs: RightSidebarTabsState): void;
  setRightSidebarOpen(open: boolean): void;
  queueTransition(previousSessionId: string, viewedSessionId: string): void;
}) {
  const inputRef = useRef(input);
  inputRef.current = input;
  const selectConversation = useCallback((selection: ConsoleSelection) => {
    const runtime = inputRef.current;
    if (planConversationNavigationAvailability(runtime.selectionMutationPending()) === "blocked") return;
    const previousSessionId = runtime.getSelection().sessionId;
    runtime.enableSelectionPersistence();
    runtime.hideNewConversation();
    const plan = planConversationNavigation(runtime.projects, selection);
    const handlers = {
      hosted: () => {
        runtime.commitRoute(plan.route);
        runtime.activateComposer(plan.composerSessionId);
        runtime.selectSession(plan.selection);
        const tabs = runtime.openTab(runtime.readTabs(plan.hostSessionId!), plan.source!);
        runtime.writeTabs(plan.hostSessionId!, tabs);
        runtime.commitTabs(tabs);
        runtime.setRightSidebarOpen(true);
        runtime.queueTransition(previousSessionId, plan.viewedSessionId);
      },
      direct: () => {
        runtime.commitRoute(plan.route);
        runtime.activateComposer(plan.composerSessionId);
        runtime.selectSession(plan.selection);
        runtime.commitTabs(runtime.readTabs(plan.selection.sessionId));
        const sidebarCommands = {
          close: () => runtime.setRightSidebarOpen(false),
          keep: () => undefined,
        };
        sidebarCommands[plan.rightSidebar]();
        runtime.queueTransition(previousSessionId, plan.viewedSessionId);
      },
    };
    handlers[plan.kind]();
  }, []);
  return useMemo(() => ({ selectConversation }), [selectConversation]);
}
