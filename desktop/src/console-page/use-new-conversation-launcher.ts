import { useCallback, useEffect, useMemo, useRef, type Dispatch } from "react";
import type { OperatorAgentTeam, OperatorProject } from "@moebius/console-ui";

import type { AgentTeamCatalogBundle } from "./use-agent-team-catalog.js";
import type { ConversationDraftStore } from "./draft-store.js";
import {
  NEW_CONVERSATION_DRAFT_KEY,
} from "./conversation-draft-model.js";
import type { NewConversationDraftEvent, NewConversationDraftState } from "./new-conversation.js";
import {
  planNewConversationLaunch,
  planNewConversationTeamState,
  planNewConversationTeamRepair,
  planPendingNewConversationTeam,
} from "./new-conversation-launcher-model.js";

type ResolveTeamKey = (
  teams: readonly OperatorAgentTeam[],
  lastUsedTeamKey: string | null,
  pendingTeamKey?: string | null,
) => string | null;

export function useNewConversationLauncher(
  projects: readonly OperatorProject[],
  conversation: NewConversationDraftState | null,
  dispatch: Dispatch<NewConversationDraftEvent>,
  catalog: AgentTeamCatalogBundle,
  pendingTeamKey: string | null,
  setPendingTeamKey: (teamKey: string | null) => void,
  draftStore: ConversationDraftStore,
  resolveTeamKey: ResolveTeamKey,
  setError: (error: string | null) => void,
) {
  const teamState = planNewConversationTeamState(catalog.state);
  const preferredTeamKey = useMemo(
    () => resolveTeamKey(teamState.preferredTeams, catalog.lastUsedTeamKey, pendingTeamKey),
    [catalog.lastUsedTeamKey, pendingTeamKey, resolveTeamKey, teamState.preferredTeams],
  );
  const input = {
    projects, conversation, dispatch, catalog, pendingTeamKey, setPendingTeamKey,
    draftStore, resolveTeamKey, setError, preferredTeamKey,
  };
  const inputRef = useRef(input);
  inputRef.current = input;

  useEffect(() => {
    const plan = planPendingNewConversationTeam({
      pendingTeamKey,
      conversation,
      teamsReady: teamState.ready,
      resolvedTeamKey: preferredTeamKey,
    });
    if (plan.kind === "skip") return;
    dispatch({ type: "select-team", teamKey: plan.teamKey });
    setPendingTeamKey(null);
  }, [conversation, dispatch, pendingTeamKey, preferredTeamKey, setPendingTeamKey, teamState.ready]);

  useEffect(() => {
    const plan = planNewConversationTeamRepair({
      conversation,
      teams: teamState.repairTeams,
      preferredTeamKey,
    });
    if (plan.kind === "select") dispatch({ type: "select-team", teamKey: plan.teamKey });
  }, [conversation, dispatch, preferredTeamKey, teamState.repairTeams]);

  const startNewConversation = useCallback((projectId?: string) => {
    const current = inputRef.current;
    current.setError(null);
    planNewConversationLaunch({
      requestedProjectId: projectId,
      projects: current.projects,
      conversation: current.conversation,
      preferredTeamKey: current.preferredTeamKey,
      storedDraft: current.draftStore.read(NEW_CONVERSATION_DRAFT_KEY),
    }).forEach(current.dispatch);
  }, []);

  return useMemo(
    () => ({ preferredTeamKey, startNewConversation }),
    [preferredTeamKey, startNewConversation],
  );
}
