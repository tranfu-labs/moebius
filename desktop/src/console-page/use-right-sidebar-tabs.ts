import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { RightSidebarTabsState } from "@moebius/console-ui";

import {
  planHandledRightSidebarFocusRequest,
  planRightSidebarTabsChange,
  planRightSidebarVisibilityPreference,
  type RightSidebarFocusRequest,
} from "./right-sidebar-tabs-model.js";
import type { RightSidebarTabsStore } from "./right-sidebar-tabs-store.js";
import {
  createSidebarConversationDraft,
  type SidebarConversationDraft,
  type SidebarConversationDraftStore,
} from "./sidebar-conversation-drafts.js";
import {
  readRightSidebarVisibilityPreference,
  readRightSidebarWidthPreference,
  writeRightSidebarVisibilityPreference,
  writeRightSidebarWidthPreference,
  type RightSidebarVisibilityPreference,
} from "./right-sidebar-preference.js";

interface SelectedSidebarSession {
  sessionId: string;
  projectId: string;
  workspaceMode: "direct" | "worktree";
}

export interface RightSidebarTabsBundle {
  state: RightSidebarTabsState;
  store: RightSidebarTabsStore;
  focusRequest: RightSidebarFocusRequest | null;
  visibilityPreference: RightSidebarVisibilityPreference;
  width: number;
  commitCurrent(state: RightSidebarTabsState): void;
  showHost(hostSessionId: string): RightSidebarTabsState;
  setOpen(open: boolean): void;
  changeWidth(width: number): void;
  changeTabs(state: RightSidebarTabsState): void;
  requestFocus(request: RightSidebarFocusRequest): void;
  handleFocus(tabId: string): void;
}

export function useRightSidebarTabs(
  storage: Storage,
  store: RightSidebarTabsStore,
  hostSessionId: string,
  selectedSession: SelectedSidebarSession | null,
  selectedProjectId: string,
  generalAssistantTeamKey: string | null,
  draftStore: SidebarConversationDraftStore,
  commitDrafts: (drafts: SidebarConversationDraft[]) => void,
): RightSidebarTabsBundle {
  const [state, setState] = useState<RightSidebarTabsState>(() => store.read(hostSessionId));
  const [focusRequest, setFocusRequest] = useState<RightSidebarFocusRequest | null>(null);
  const [visibilityPreference, setVisibilityPreference] =
    useState<RightSidebarVisibilityPreference>(() => readRightSidebarVisibilityPreference(storage));
  const [width, setWidth] = useState(() => readRightSidebarWidthPreference(storage));
  const inputRef = useRef({
    hostSessionId,
    selectedSession,
    selectedProjectId,
    generalAssistantTeamKey,
    draftStore,
    commitDrafts,
  });
  inputRef.current = {
    hostSessionId,
    selectedSession,
    selectedProjectId,
    generalAssistantTeamKey,
    draftStore,
    commitDrafts,
  };

  const showHost = useCallback((nextHostSessionId: string) => {
    const nextState = store.read(nextHostSessionId);
    setState(nextState);
    return nextState;
  }, [store]);
  useEffect(() => {
    showHost(hostSessionId);
  }, [hostSessionId, showHost]);

  const setOpen = useCallback((open: boolean) => {
    const preference = planRightSidebarVisibilityPreference(open);
    setVisibilityPreference(preference);
    writeRightSidebarVisibilityPreference(storage, preference);
  }, [storage]);
  const changeWidth = useCallback((nextWidth: number) => {
    setWidth(nextWidth);
    writeRightSidebarWidthPreference(storage, nextWidth);
  }, [storage]);
  const changeTabs = useCallback((nextState: RightSidebarTabsState) => {
    const current = inputRef.current;
    const plan = planRightSidebarTabsChange(nextState, {
      hostSessionId: current.hostSessionId,
      selectedSession: current.selectedSession,
      selectedProjectId: current.selectedProjectId,
      generalAssistantTeamKey: current.generalAssistantTeamKey,
      draftId: crypto.randomUUID(),
      now: new Date().toISOString(),
    });
    if (plan.kind === "create-conversation-draft") {
      const draft = createSidebarConversationDraft({
        draftId: plan.draft.draftId,
        hostSessionId: plan.draft.hostSessionId,
        originSessionId: plan.draft.originSessionId,
        entryTemplate: null,
        context: {
          projectId: plan.draft.projectId,
          workspaceMode: plan.draft.workspaceMode,
          teamKey: plan.draft.teamKey,
        },
        now: plan.draft.now,
      });
      current.draftStore.write(draft);
      current.commitDrafts(current.draftStore.list());
    }
    store.write(current.hostSessionId, plan.state);
    setState(plan.state);
  }, [store]);
  const handleFocus = useCallback((tabId: string) => {
    setFocusRequest((current) => planHandledRightSidebarFocusRequest(current, tabId));
  }, []);

  return useMemo(() => ({
    state,
    store,
    focusRequest,
    visibilityPreference,
    width,
    commitCurrent: setState,
    showHost,
    setOpen,
    changeWidth,
    changeTabs,
    requestFocus: setFocusRequest,
    handleFocus,
  }), [changeTabs, changeWidth, focusRequest, handleFocus, setOpen, showHost, state, store,
    visibilityPreference, width]);
}
