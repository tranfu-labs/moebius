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
  planNewConversationProjectChange,
  planNewConversationWorkspacePreference,
  planAddedNewConversationProject,
  planNewConversationTeamState,
  planNewConversationTeamRepair,
  planPendingNewConversationTeam,
} from "./new-conversation-launcher-model.js";
import { planConsoleErrorMessage } from "./console-state-plan.js";
import type { ConsoleErrorController } from "./use-console-error-state.js";

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
  addProject: (existingProjectIds: readonly string[]) => Promise<{ projectId: string } | null>,
  errors: ConsoleErrorController,
  updateProjectWorkspacePreference: (
    projectId: string,
    workspaceMode: "direct" | "worktree",
  ) => Promise<void>,
) {
  const teamState = planNewConversationTeamState(catalog.state);
  const preferredTeamKey = useMemo(
    () => resolveTeamKey(teamState.preferredTeams, catalog.lastUsedTeamKey, pendingTeamKey),
    [catalog.lastUsedTeamKey, pendingTeamKey, resolveTeamKey, teamState.preferredTeams],
  );
  const input = {
    projects, conversation, dispatch, catalog, pendingTeamKey, setPendingTeamKey,
    draftStore, resolveTeamKey, preferredTeamKey, addProject, errors, updateProjectWorkspacePreference,
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
    planNewConversationLaunch({
      requestedProjectId: projectId,
      projects: current.projects,
      conversation: current.conversation,
      preferredTeamKey: current.preferredTeamKey,
      storedDraft: current.draftStore.read(NEW_CONVERSATION_DRAFT_KEY),
    }).forEach(current.dispatch);
  }, []);

  const selectProject = useCallback((projectId: string) => {
    const current = inputRef.current;
    planNewConversationProjectChange(current.projects, projectId).forEach(current.dispatch);
  }, []);
  const selectWorkspace = useCallback((workspaceMode: "direct" | "worktree") => {
    const current = inputRef.current;
    current.dispatch({ type: "select-workspace", workspaceMode });
    const preference = planNewConversationWorkspacePreference({
      projectId: current.conversation?.projectId,
      workspaceMode,
    });
    if (preference.kind === "skip") return;
    const errorOperation = current.errors.begin({
      family: "project",
      scope: `${preference.projectId}:workspace-preference`,
    });
    void current.updateProjectWorkspacePreference(preference.projectId, preference.workspaceMode)
      .then(() => current.errors.succeed(errorOperation))
      .catch((error: unknown) => current.errors.fail(errorOperation, planConsoleErrorMessage(error)));
  }, []);
  const selectTeam = useCallback((teamKey: string) => {
    inputRef.current.dispatch({ type: "select-team", teamKey });
  }, []);
  const changeDraft = useCallback((value: string) => {
    const current = inputRef.current;
    current.draftStore.write(NEW_CONVERSATION_DRAFT_KEY, value);
    current.dispatch({ type: "edit-draft", draft: value });
  }, []);
  const addNewProject = useCallback(async () => {
    const current = inputRef.current;
    const added = await current.addProject(current.projects.map((project) => project.projectId));
    const events = planAddedNewConversationProject(added);
    events.forEach(inputRef.current.dispatch);
  }, []);

  return useMemo(
    () => ({
      preferredTeamKey,
      startNewConversation,
      selectProject,
      selectWorkspace,
      selectTeam,
      changeDraft,
      addProject: addNewProject,
    }),
    [addNewProject, changeDraft, preferredTeamKey, selectProject, selectTeam, selectWorkspace,
      startNewConversation],
  );
}
