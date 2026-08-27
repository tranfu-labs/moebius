import { useCallback, useMemo, useRef, type Dispatch, type MutableRefObject } from "react";
import type { OperatorProject, RightSidebarSourceTab, RightSidebarTabsState } from "@moebius/console-ui";

import {
  planConversationNavigation,
  planConversationNavigationAvailability,
} from "./conversation-navigation-model.js";
import type { NewConversationDraftEvent } from "./new-conversation.js";
import type { ConsoleSelection, ConsoleStateCoordinator } from "./console-state-coordinator.js";
import type { ConsolePresentationRoute } from "./presentation-route.js";
import type { RightSidebarTabsStore } from "./right-sidebar-tabs-store.js";
import type { useConversationTransition } from "./use-conversation-transition.js";

interface ConversationNavigationActions {
  selectSession(selection: ConsoleSelection): void;
}

export function useConversationNavigation(
  projects: readonly OperatorProject[],
  coordinator: ConsoleStateCoordinator,
  selectionRef: MutableRefObject<ConsoleSelection>,
  persistenceEnabledRef: MutableRefObject<boolean>,
  dispatchNewConversation: Dispatch<NewConversationDraftEvent>,
  commitRoute: (route: ConsolePresentationRoute) => void,
  activateComposer: (sessionId: string) => void,
  actions: ConversationNavigationActions,
  tabsStore: RightSidebarTabsStore,
  openTab: (tabs: RightSidebarTabsState, source: RightSidebarSourceTab) => RightSidebarTabsState,
  showTabsHost: (hostSessionId: string) => void,
  setRightSidebarOpen: (open: boolean) => void,
  transition: Pick<ReturnType<typeof useConversationTransition>, "queueTransition">,
) {
  const input = {
    projects,
    selectionMutationPending: () => coordinator.isSelectionMutationPending,
    getSelection: () => selectionRef.current,
    enableSelectionPersistence: () => { persistenceEnabledRef.current = true; },
    hideNewConversation: () => dispatchNewConversation({ type: "hide" }),
    commitRoute,
    activateComposer,
    selectSession: actions.selectSession,
    readTabs: (hostSessionId: string) => tabsStore.read(hostSessionId),
    writeTabs: (hostSessionId: string, tabs: RightSidebarTabsState) => tabsStore.write(hostSessionId, tabs),
    openTab,
    showTabsHost,
    setRightSidebarOpen,
    queueTransition: transition.queueTransition,
  };
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
        runtime.selectSession(plan.selection);
        runtime.commitRoute(plan.route);
        runtime.activateComposer(plan.composerSessionId);
        const tabs = runtime.openTab(runtime.readTabs(plan.hostSessionId!), plan.source!);
        runtime.writeTabs(plan.hostSessionId!, tabs);
        runtime.showTabsHost(plan.hostSessionId!);
        runtime.setRightSidebarOpen(true);
        runtime.queueTransition(previousSessionId, plan.viewedSessionId);
      },
      direct: () => {
        runtime.selectSession(plan.selection);
        runtime.commitRoute(plan.route);
        runtime.activateComposer(plan.composerSessionId);
        runtime.showTabsHost(plan.selection.sessionId);
        runtime.queueTransition(previousSessionId, plan.viewedSessionId);
      },
    };
    handlers[plan.kind]();
  }, []);
  return useMemo(() => ({ selectConversation }), [selectConversation]);
}
