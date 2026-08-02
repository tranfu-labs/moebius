import { useCallback, useMemo, useRef, type Dispatch, type MutableRefObject } from "react";
import type {
  RightSidebarSourceTab,
  RightSidebarTabsState,
  TranslationKey,
} from "@moebius/console-ui";

import type { AgentTeamCatalogBundle } from "./use-agent-team-catalog.js";
import { planGeneralAssistantTeamKey } from "./agent-team-console-model.js";
import type { LocalConsoleState } from "./console-state-contract.js";
import {
  planConversationAnalysisAvailability,
  planConversationAnalysisCommit,
  planConversationAnalysisDraft,
  planConversationAnalysisFragmentIndex,
  planConversationAnalysisMutation,
  planConversationAnalysisReferenceRequest,
  planConversationAnalysisRouteSessionId,
  planConversationAnalysisStart,
  planConversationAnalysisTargetResult,
  type ConversationAnalysisRequest,
} from "./conversation-analysis-model.js";
import type { ConversationAnalysisReferencePort } from "./conversation-analysis-contract.js";
import { planConsoleErrorMessage } from "./console-state-plan.js";
import {
  ConsoleStateCoordinator,
  type ConsoleSelection,
} from "./console-state-coordinator.js";
import { loadConversationAnalysisTarget } from "./load-conversation-analysis-target.js";
import {
  ordinaryPresentationRoute,
  type ConsolePresentationRoute,
} from "./presentation-route.js";
import { conversationDraftTabSourceKey } from "./right-sidebar-tabs-model.js";
import type {
  SidebarConversationDraft,
  SidebarConversationDraftStore,
} from "./sidebar-conversation-drafts.js";
import type { NewConversationDraftEvent } from "./new-conversation.js";
import type { RightSidebarTabsBundle } from "./use-right-sidebar-tabs.js";

type FetchLike = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

export function useConversationAnalysis(
  apiBase: string | null,
  stateRef: MutableRefObject<LocalConsoleState | null>,
  presentationRouteRef: MutableRefObject<ConsolePresentationRoute | null>,
  coordinator: ConsoleStateCoordinator,
  agentTeams: Pick<AgentTeamCatalogBundle, "state">,
  draftStore: SidebarConversationDraftStore,
  commitDrafts: (drafts: SidebarConversationDraft[]) => void,
  tabs: Pick<RightSidebarTabsBundle, "store" | "commitCurrent" | "setOpen">,
  selectionRef: MutableRefObject<ConsoleSelection>,
  selectionPersistenceEnabledRef: MutableRefObject<boolean>,
  dispatchNewConversation: Dispatch<NewConversationDraftEvent>,
  commitState: (state: LocalConsoleState) => void,
  commitSelection: (selection: ConsoleSelection) => void,
  rememberSelection: (selection: ConsoleSelection) => void,
  commitRoute: (route: ConsolePresentationRoute) => void,
  activateComposer: (sessionId: string) => void,
  openTab: (state: RightSidebarTabsState, source: RightSidebarSourceTab) => RightSidebarTabsState,
  referencePort: ConversationAnalysisReferencePort,
  fetch: FetchLike,
  setError: (error: string | null) => void,
  setNotice: (notice: string | null) => void,
  t: (key: TranslationKey, values?: Record<string, string | number>) => string,
) {
  const inputRef = useRef({
    apiBase, stateRef, presentationRouteRef, coordinator, agentTeams, draftStore, commitDrafts,
    tabs, selectionRef, selectionPersistenceEnabledRef, dispatchNewConversation, commitState,
    commitSelection, rememberSelection, commitRoute, activateComposer, openTab, referencePort, fetch,
    setError, setNotice, t,
  });
  inputRef.current = {
    apiBase, stateRef, presentationRouteRef, coordinator, agentTeams, draftStore, commitDrafts,
    tabs, selectionRef, selectionPersistenceEnabledRef, dispatchNewConversation, commitState,
    commitSelection, rememberSelection, commitRoute, activateComposer, openTab, referencePort, fetch,
    setError, setNotice, t,
  };
  const analyze = useCallback(async (request: ConversationAnalysisRequest): Promise<void> => {
    const current = inputRef.current;
    if (planConversationAnalysisAvailability(current.apiBase) === "skip") return;
    const start = planConversationAnalysisStart(
      current.stateRef.current,
      planConversationAnalysisRouteSessionId(current.presentationRouteRef.current),
      request,
    );
    if (start.kind === "error") {
      const errorKeys = {
        "source-missing": "console.sessionAnalysis.sourceMissing",
        "record-unavailable": "console.sessionAnalysis.recordUnavailable",
      } as const;
      const noticeKeys = {
        "open-failed": "console.sessionAnalysis.openFailed",
        "record-unavailable": "console.sessionAnalysis.recordUnavailable",
      } as const;
      current.setError(current.t(errorKeys[start.error]));
      current.setNotice(current.t(noticeKeys[start.notice]));
      return;
    }
    const mutation = start.requiresMutation
      ? current.coordinator.beginSelectionMutation("analyze-conversation")
      : null;
    const mutationPlan = planConversationAnalysisMutation(start.requiresMutation, mutation);
    if (mutationPlan.kind === "busy") {
      current.setError(current.t("console.sessionAnalysis.navigationBusy"));
      current.setNotice(current.t("console.sessionAnalysis.navigationBusy"));
      return;
    }
    try {
      const reference = await current.referencePort.load({
        apiBase: current.apiBase!,
        ...planConversationAnalysisReferenceRequest(request),
      });
      const latest = inputRef.current;
      const target = await loadConversationAnalysisTarget({
        loadTarget: start.loadTarget,
        apiBase: current.apiBase!,
        selection: start.targetSelection,
        sessionId: request.sessionId,
        coordinator: current.coordinator,
        mutation: mutationPlan.mutation,
        fetch: current.fetch,
        sourceMissingError: current.t("console.sessionAnalysis.sourceMissing"),
        setError: latest.setError,
      });
      if (
        target.kind === "failed"
        && planConversationAnalysisTargetResult(target.kind) === "stop"
      ) {
        latest.setNotice(latest.t("console.sessionAnalysis.openFailed"));
        return;
      }
      const preparedState = target.state;
      const existing = latest.draftStore.findMergeable({
        hostSessionId: request.sessionId,
        originSessionId: request.sessionId,
        initialProjectId: start.source.projectId,
        initialWorkspaceMode: start.source.workspaceMode,
        entryTemplate: "session-analysis",
      });
      const now = new Date().toISOString();
      const draft = planConversationAnalysisDraft(existing, {
        draftId: crypto.randomUUID(),
        source: start.source,
        teamKey: planGeneralAssistantTeamKey(latest.agentTeams.state),
        fragment: reference.fragment,
        fragmentLabel: latest.t("console.sessionAnalysis.fragmentLabel", {
          index: planConversationAnalysisFragmentIndex(existing),
        }),
        now,
      });
      latest.draftStore.write(draft);
      latest.commitDrafts(latest.draftStore.list());
      const nextTabs = latest.tabs.store.read(start.root.sessionId);
      const openedTabs = latest.openTab(
        nextTabs,
        {
          id: `conversation-draft-${draft.draftId}`,
          type: "conversation",
          title: latest.t("console.sessionAnalysis.newConversation"),
          sourceKey: conversationDraftTabSourceKey(draft.draftId),
        },
      );
      const commit = planConversationAnalysisCommit(request, preparedState);
      if (commit.kind === "commit-conversation") {
        latest.selectionPersistenceEnabledRef.current = true;
        latest.dispatchNewConversation({ type: "hide" });
        if (commit.preparedState !== null) latest.commitState(commit.preparedState);
        latest.commitSelection(start.targetSelection);
        latest.rememberSelection(start.targetSelection);
        latest.commitRoute(ordinaryPresentationRoute(start.targetSelection));
        latest.activateComposer(request.sessionId);
      }
      latest.tabs.store.write(start.root.sessionId, openedTabs);
      latest.tabs.commitCurrent(openedTabs);
      latest.tabs.setOpen(true);
      latest.setError(null);
      latest.setNotice(null);
    } catch (error) {
      const latest = inputRef.current;
      latest.setError(planConsoleErrorMessage(error));
      latest.setNotice(latest.t("console.sessionAnalysis.openFailed"));
    } finally {
      if (mutationPlan.mutation !== null) {
        current.coordinator.endSelectionMutation(mutationPlan.mutation);
      }
    }
  }, []);
  return useMemo(() => ({ analyze }), [analyze]);
}
