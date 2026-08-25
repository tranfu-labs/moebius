import { useCallback, useMemo, useRef, useState, type MutableRefObject } from "react";
import type {
  AnalysisPanelEntry,
  OperatorSession,
  RightSidebarSourceTab,
  RightSidebarTabsState,
  TranslationKey,
} from "@moebius/console-ui";

import {
  planAnalysisNavigation,
  planAnalysisPanelEntries,
  planConversationReferencePosition,
  planHandledConversationMessageNavigation,
} from "./console-presentation-model.js";
import {
  planNavigationSceneArgument,
  planNavigationSceneSource,
} from "./console-state-plan.js";
import type { ConsoleSelection } from "./console-state-coordinator.js";
import type { ConsoleNavigationScene } from "./console-state-action-contract.js";
import { ordinaryPresentationRoute, type ConsolePresentationRoute } from "./presentation-route.js";
import { conversationTabSourceKey } from "./right-sidebar-tabs-model.js";
import type { RightSidebarTabsBundle } from "./use-right-sidebar-tabs.js";
import type { ConsoleErrorController } from "./use-console-error-state.js";

interface AnalysisNavigationActions {
  selectSession(selection: ConsoleSelection, navigationScene?: ConsoleNavigationScene): void;
  captureNavigationScene(): ConsoleNavigationScene | undefined;
}

export type ConversationReference =
  | { scope: "conversation"; sessionId: string }
  | { scope: "message"; sessionId: string; messageId: number };

export function useAnalysisPanelNavigation(
  sessions: readonly OperatorSession[],
  locale: string,
  selectionRef: MutableRefObject<ConsoleSelection>,
  actions: AnalysisNavigationActions,
  commitRoute: (route: ConsolePresentationRoute) => void,
  tabs: Pick<RightSidebarTabsBundle,
    "store" | "showHost" | "setOpen" | "requestFocus">,
  openTab: (state: RightSidebarTabsState, source: RightSidebarSourceTab) => RightSidebarTabsState,
  writeReadingPosition: (sessionId: string, messageId: number) => void,
  errors: ConsoleErrorController,
  t: (key: TranslationKey) => string,
) {
  const [openBySession, setOpenBySession] = useState<Record<string, boolean>>({});
  const [messageNavigation, setMessageNavigation] = useState<{
    sessionId: string;
    messageId: number;
    requestId: number;
  } | null>(null);
  const navigationIdRef = useRef(0);
  const inputRef = useRef({
    sessions,
    locale,
    selectionRef,
    actions,
    commitRoute,
    tabs,
    openTab,
    writeReadingPosition,
    errors,
    t,
  });
  inputRef.current = {
    sessions,
    locale,
    selectionRef,
    actions,
    commitRoute,
    tabs,
    openTab,
    writeReadingPosition,
    errors,
    t,
  };
  const entriesFor = useCallback((parentSessionId: string) =>
    planAnalysisPanelEntries(inputRef.current.sessions, parentSessionId, inputRef.current.locale), []);
  const setPanelOpen = useCallback((sessionId: string, open: boolean) => {
    setOpenBySession((current) => ({ ...current, [sessionId]: open }));
  }, []);
  const openPlannedNavigation = useCallback((
    request:
      | { kind: "panel-entry"; parentSessionId: string; sessionId: string }
      | { kind: "reference"; sessionId: string },
    navigationScene?: ConsoleNavigationScene,
  ) => {
    const current = inputRef.current;
    const rollbackScene = planNavigationSceneSource(
      navigationScene,
      current.actions.captureNavigationScene(),
    );
    const plan = planAnalysisNavigation(
      current.sessions,
      current.selectionRef.current.sessionId,
      request,
    );
    if (plan.kind === "error") {
      const errorKeys = {
        "source-missing": "console.sessionAnalysis.sourceMissing",
        "source-unavailable": "console.sessionAnalysis.sourceUnavailable",
        "open-failed": "console.sessionAnalysis.openFailed",
      } as const;
      current.errors.report(
        { family: "analysis", scope: `${request.sessionId}:navigation` },
        current.t(errorKeys[plan.reason]),
      );
      return;
    }
    const errorOperation = current.errors.begin({
      family: "analysis",
      scope: `${request.sessionId}:navigation`,
    });
    const route = ordinaryPresentationRoute({
      projectId: plan.root.projectId,
      sessionId: plan.root.sessionId,
    });
    const selectRoot = (): void => {
      const selection = { projectId: plan.root.projectId, sessionId: plan.root.sessionId };
      current.actions.selectSession(selection, ...planNavigationSceneArgument(rollbackScene));
    };
    if (plan.kind === "direct") {
      selectRoot();
      current.commitRoute(route);
      current.tabs.showHost(plan.root.sessionId);
      current.errors.succeed(errorOperation);
      return;
    }
    const nextTabs = current.openTab(current.tabs.store.read(plan.root.sessionId), {
      id: `conversation-${plan.target.sessionId}`,
      type: "conversation",
      title: plan.target.title,
      sourceKey: conversationTabSourceKey(plan.target.sessionId),
    });
    current.tabs.store.write(plan.root.sessionId, nextTabs);
    if (plan.selectRoot) {
      selectRoot();
    }
    current.commitRoute(route);
    current.tabs.showHost(plan.root.sessionId);
    current.tabs.setOpen(true);
    if (plan.focusTab && nextTabs.activeTabId !== null) {
      current.tabs.requestFocus({ hostSessionId: plan.root.sessionId, tabId: nextTabs.activeTabId });
    }
    current.errors.succeed(errorOperation);
  }, []);
  const openEntry = useCallback((parentSessionId: string, entry: AnalysisPanelEntry) => {
    openPlannedNavigation({ kind: "panel-entry", parentSessionId, sessionId: entry.sessionId });
  }, [openPlannedNavigation]);
  const openReference = useCallback((reference: ConversationReference) => {
    const current = inputRef.current;
    const messagePosition = planConversationReferencePosition(reference);
    const navigationScene = current.actions.captureNavigationScene();
    if (messagePosition !== null) {
      current.writeReadingPosition(messagePosition.sessionId, messagePosition.messageId);
      navigationIdRef.current += 1;
      setMessageNavigation({ ...messagePosition, requestId: navigationIdRef.current });
    }
    openPlannedNavigation({ kind: "reference", sessionId: reference.sessionId }, navigationScene);
  }, [openPlannedNavigation]);
  const handleMessageNavigation = useCallback((requestId: number) => {
    setMessageNavigation((current) =>
      planHandledConversationMessageNavigation(current, requestId));
  }, []);
  return useMemo(() => ({
    openBySession,
    messageNavigation,
    entriesFor,
    setPanelOpen,
    openEntry,
    openReference,
    handleMessageNavigation,
  }), [entriesFor, handleMessageNavigation, messageNavigation, openBySession, openEntry,
    openReference, setPanelOpen]);
}
