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
import type { ConsoleSelection } from "./console-state-coordinator.js";
import { ordinaryPresentationRoute, type ConsolePresentationRoute } from "./presentation-route.js";
import { conversationTabSourceKey } from "./right-sidebar-tabs-model.js";
import type { RightSidebarTabsBundle } from "./use-right-sidebar-tabs.js";

interface AnalysisNavigationActions {
  selectSession(selection: ConsoleSelection): void;
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
    "store" | "commitCurrent" | "setOpen" | "requestFocus">,
  openTab: (state: RightSidebarTabsState, source: RightSidebarSourceTab) => RightSidebarTabsState,
  writeReadingPosition: (sessionId: string, messageId: number) => void,
  setError: (error: string | null) => void,
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
    setError,
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
    setError,
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
  ) => {
    const current = inputRef.current;
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
      current.setError(current.t(errorKeys[plan.reason]));
      return;
    }
    current.commitRoute(ordinaryPresentationRoute({
      projectId: plan.root.projectId,
      sessionId: plan.root.sessionId,
    }));
    if (plan.kind === "direct") {
      current.actions.selectSession({ projectId: plan.root.projectId, sessionId: plan.root.sessionId });
      current.setError(null);
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
      current.actions.selectSession({ projectId: plan.root.projectId, sessionId: plan.root.sessionId });
    }
    current.tabs.commitCurrent(nextTabs);
    current.tabs.setOpen(true);
    if (plan.focusTab && nextTabs.activeTabId !== null) {
      current.tabs.requestFocus({ hostSessionId: plan.root.sessionId, tabId: nextTabs.activeTabId });
    }
    current.setError(null);
  }, []);
  const openEntry = useCallback((parentSessionId: string, entry: AnalysisPanelEntry) => {
    openPlannedNavigation({ kind: "panel-entry", parentSessionId, sessionId: entry.sessionId });
  }, [openPlannedNavigation]);
  const openReference = useCallback((reference: ConversationReference) => {
    const current = inputRef.current;
    const messagePosition = planConversationReferencePosition(reference);
    if (messagePosition !== null) {
      current.writeReadingPosition(messagePosition.sessionId, messagePosition.messageId);
      navigationIdRef.current += 1;
      setMessageNavigation({ ...messagePosition, requestId: navigationIdRef.current });
    }
    openPlannedNavigation({ kind: "reference", sessionId: reference.sessionId });
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
