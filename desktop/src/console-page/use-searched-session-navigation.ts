import { useCallback, useMemo, useRef, type MutableRefObject } from "react";
import type { RightSidebarSourceTab, RightSidebarTabsState } from "@moebius/console-ui";

import type { LocalConsoleState } from "./console-state-contract.js";
import { planConsoleErrorMessage } from "./console-state-plan.js";
import type { SessionSearchResult } from "./conversation-search-model.js";
import type { ConsolePresentationRoute } from "./presentation-route.js";
import type { RightSidebarTabsStore } from "./right-sidebar-tabs-store.js";
import type { SearchedSessionPort } from "./searched-session-contract.js";
import {
  planSearchedSessionNavigation,
  planSearchedSessionTarget,
} from "./searched-session-model.js";
import type { ConsoleErrorController } from "./use-console-error-state.js";

export function useSearchedSessionNavigation(
  apiBase: string | null,
  stateRef: MutableRefObject<LocalConsoleState | null>,
  commitRoute: (route: ConsolePresentationRoute) => void,
  tabsStore: RightSidebarTabsStore,
  openTab: (tabs: RightSidebarTabsState, source: RightSidebarSourceTab) => RightSidebarTabsState,
  commitTabs: (tabs: RightSidebarTabsState) => void,
  setRightSidebarOpen: (open: boolean) => void,
  selectSession: (selection: { projectId: string; sessionId: string }) => void,
  port: SearchedSessionPort,
  errors: ConsoleErrorController,
) {
  const input = {
    apiBase, stateRef, commitRoute, tabsStore, openTab, commitTabs,
    setRightSidebarOpen, selectSession, port, errors,
  };
  const inputRef = useRef(input);
  inputRef.current = input;
  const openSearchedSession = useCallback(async (result: SessionSearchResult, restore: boolean) => {
    const current = inputRef.current;
    const targetPlan = planSearchedSessionTarget({ apiBase: current.apiBase, result, restore });
    if (targetPlan.kind === "unavailable") return false;
    const errorOperation = current.errors.begin({
      family: "search-navigation",
      scope: result.session.sessionId,
    });
    try {
      const target = targetPlan.kind === "restore"
        ? await current.port.restore(targetPlan.apiBase, targetPlan.sessionId)
        : targetPlan.target;
      const latest = inputRef.current;
      const navigation = planSearchedSessionNavigation({
        target,
        originAvailable: result.originAvailable,
        state: latest.stateRef.current,
      });
      latest.selectSession(navigation.selection);
      latest.commitRoute(navigation.route);
      if (navigation.kind === "hosted") {
        const tabs = latest.openTab(latest.tabsStore.read(navigation.hostSessionId), navigation.source);
        latest.tabsStore.write(navigation.hostSessionId, tabs);
        latest.commitTabs(tabs);
        latest.setRightSidebarOpen(true);
      } else {
        latest.setRightSidebarOpen(false);
      }
      latest.errors.succeed(errorOperation);
      return true;
    } catch (error) {
      inputRef.current.errors.fail(errorOperation, planConsoleErrorMessage(error));
      return false;
    }
  }, []);
  return useMemo(() => ({ openSearchedSession }), [openSearchedSession]);
}
