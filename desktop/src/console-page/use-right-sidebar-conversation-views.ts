import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type MutableRefObject,
  type SetStateAction,
} from "react";
import type { OperatorSubSessionViewState } from "@moebius/console-ui";

import type { ConversationViewSyncPort } from "./conversation-view-sync-contract.js";
import {
  decideRemoteViewCommit,
  decideRemoteViewRequest,
  planConsoleErrorMessage,
  planRemoteConversationView,
  planRemoteViewLoadingState,
} from "./console-state-plan.js";

type ViewStates = Record<string, OperatorSubSessionViewState>;

export function useRightSidebarConversationViews(
  apiBase: string | null,
  activeSubSessionId: string | null,
  activeSidebarConversationSessionId: string | null,
  port: ConversationViewSyncPort,
) {
  const [subSessionViews, setSubSessionViews] = useState<ViewStates>({});
  const [sidebarConversationViews, setSidebarConversationViews] = useState<ViewStates>({});
  const inputRef = useRef({ apiBase, port });
  inputRef.current = { apiBase, port };

  usePollingConversationView(activeSubSessionId, inputRef, setSubSessionViews, "sub-session-tab-changed");
  usePollingConversationView(
    activeSidebarConversationSessionId,
    inputRef,
    setSidebarConversationViews,
    "sidebar-conversation-tab-changed",
  );

  const refreshSubSessionNow = useCallback(async (sessionId: string): Promise<void> => {
    const current = inputRef.current;
    const request = planRemoteConversationView(current.apiBase, sessionId);
    if (request.kind === "skip") return;
    const view = await current.port.load(request);
    setSubSessionViews((states) => ({
      ...states,
      [sessionId]: { status: "ready", view },
    }));
  }, []);

  const clearSubSessionViews = useCallback(() => setSubSessionViews({}), []);

  return useMemo(() => ({
    subSessionViews,
    sidebarConversationViews,
    setSidebarConversationViews,
    refreshSubSessionNow,
    clearSubSessionViews,
  }), [refreshSubSessionNow, sidebarConversationViews, subSessionViews]);
}

function usePollingConversationView(
  sessionId: string | null,
  inputRef: MutableRefObject<{ apiBase: string | null; port: ConversationViewSyncPort }>,
  setViews: Dispatch<SetStateAction<ViewStates>>,
  abortReason: string,
): void {
  useEffect(() => {
    const request = planRemoteConversationView(inputRef.current.apiBase, sessionId);
    if (request.kind === "skip") return;
    const controller = new AbortController();
    let inFlight = false;
    let timer: number | undefined;
    setViews((current) => ({
      ...current,
      [request.sessionId]: planRemoteViewLoadingState(current[request.sessionId]),
    }));
    const refreshView = async (): Promise<void> => {
      if (decideRemoteViewRequest(inFlight) === "wait") return;
      inFlight = true;
      try {
        const view = await inputRef.current.port.load({ ...request, signal: controller.signal });
        if (decideRemoteViewCommit(controller.signal.aborted) === "commit") {
          setViews((current) => ({
            ...current,
            [request.sessionId]: { status: "ready", view },
          }));
        }
      } catch (error) {
        if (decideRemoteViewCommit(controller.signal.aborted) === "commit") {
          setViews((current) => ({
            ...current,
            [request.sessionId]: { status: "error", message: planConsoleErrorMessage(error) },
          }));
        }
      } finally {
        inFlight = false;
        if (decideRemoteViewCommit(controller.signal.aborted) === "commit") {
          timer = window.setTimeout(() => void refreshView(), 1_000);
        }
      }
    };
    void refreshView();
    return () => {
      window.clearTimeout(timer);
      controller.abort(abortReason);
    };
  }, [abortReason, inputRef, sessionId, setViews]);
}
