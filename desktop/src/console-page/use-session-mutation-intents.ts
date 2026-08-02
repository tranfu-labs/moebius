import {
  useCallback,
  useMemo,
  useRef,
  type Dispatch,
  type MutableRefObject,
  type SetStateAction,
} from "react";

import type { CopySessionLogPathResult } from "../session-log-clipboard.js";
import type { ConsoleStateActions } from "./console-state-actions.js";
import type { ConsoleSelection } from "./console-state-coordinator.js";
import { ordinaryPresentationRoute, type ConsolePresentationRoute } from "./presentation-route.js";
import {
  decideSessionLogCopyAvailability,
  planActiveHostSessionId,
  planArchivedSessionNavigation,
  planArchivedSessionResult,
} from "./session-mutation-model.js";
import type { useConversationSearch } from "./use-conversation-search.js";
import type { RightSidebarTabsBundle } from "./use-right-sidebar-tabs.js";

type RenameSession = Parameters<ConsoleStateActions["renameSession"]>[0];

export function useSessionMutationIntents(
  actions: ConsoleStateActions,
  search: ReturnType<typeof useConversationSearch>,
  tabs: RightSidebarTabsBundle,
  presentationRouteRef: MutableRefObject<ConsolePresentationRoute | null>,
  selectionRef: MutableRefObject<ConsoleSelection>,
  commitRoute: (route: ConsolePresentationRoute) => void,
  setUpdatingTitleIds: Dispatch<SetStateAction<Set<string>>>,
  copySessionLogPath: ((sessionId: string) => Promise<CopySessionLogPathResult>) | undefined,
) {
  const inputRef = useRef({
    actions, search, tabs, presentationRouteRef, selectionRef, commitRoute,
    setUpdatingTitleIds, copySessionLogPath,
  });
  inputRef.current = {
    actions, search, tabs, presentationRouteRef, selectionRef, commitRoute,
    setUpdatingTitleIds, copySessionLogPath,
  };

  const archiveSession = useCallback(async (sessionId: string, projectId: string) => {
    const result = planArchivedSessionResult(
      await inputRef.current.actions.archiveSession(sessionId, projectId),
    );
    if (result.kind === "skip") return;
    const latest = inputRef.current;
    for (const archivedSessionId of result.archivedSessionIds) latest.tabs.store.removeSession(archivedSessionId);
    latest.tabs.store.clearHosts(result.archivedSessionIds);
    const navigation = planArchivedSessionNavigation({
      sessionId,
      presentationRoute: latest.presentationRouteRef.current,
      selection: latest.selectionRef.current,
    });
    if (navigation.kind === "restore-main") {
      latest.commitRoute(ordinaryPresentationRoute(navigation.selection));
      latest.tabs.showHost(navigation.selection.sessionId);
      return;
    }
    latest.tabs.showHost(navigation.hostSessionId);
  }, []);

  const renameSession = useCallback(async (session: RenameSession, title: string) => {
    const started = inputRef.current;
    const resumeSearch = started.search.suspendForMutation();
    started.setUpdatingTitleIds((current) => new Set(current).add(session.id));
    try {
      await started.actions.renameSession(session, title);
      const latest = inputRef.current;
      latest.tabs.store.renameConversation(session.id, title.trim());
      latest.tabs.showHost(planActiveHostSessionId(
        latest.presentationRouteRef.current,
        latest.selectionRef.current,
      ));
      resumeSearch();
    } catch (error) {
      resumeSearch();
      throw error;
    } finally {
      inputRef.current.setUpdatingTitleIds((current) => {
        const next = new Set(current);
        next.delete(session.id);
        return next;
      });
    }
  }, []);

  const copyLogPath = useCallback(async (sessionId: string): Promise<CopySessionLogPathResult> => {
    const copy = inputRef.current.copySessionLogPath;
    if (decideSessionLogCopyAvailability(copy !== undefined) === "unavailable") {
      return { ok: false, reason: "service-unavailable" };
    }
    return copy!(sessionId);
  }, []);

  return useMemo(
    () => ({ archiveSession, renameSession, copyLogPath }),
    [archiveSession, copyLogPath, renameSession],
  );
}
