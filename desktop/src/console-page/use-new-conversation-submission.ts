import { useCallback, useMemo, useRef, type Dispatch, type MutableRefObject } from "react";
import type { Translate } from "@moebius/console-ui";

import type { DesktopApi } from "./desktop-api-contract.js";
import type { ConsoleSelection } from "./console-state-coordinator.js";
import type { ConversationDraftStore } from "./draft-store.js";
import {
  NEW_CONVERSATION_DRAFT_KEY,
} from "./conversation-draft-model.js";
import {
  planNewConversationCreation,
  planNewConversationPreferenceError,
  planNewConversationPreferenceResult,
  planNewConversationSubmission,
  submitNewConversation,
  type NewConversationDraftEvent,
  type NewConversationDraftState,
} from "./new-conversation.js";
import { ordinaryPresentationRoute, type ConsolePresentationRoute } from "./presentation-route.js";
import { planFindOperatorAgentTeam } from "./agent-team-console-model.js";
import { planConsoleErrorMessage } from "./console-state-plan.js";
import type { AgentTeamCatalogBundle } from "./use-agent-team-catalog.js";
import type { useManagedAttachmentDrafts } from "./use-managed-attachments.js";

type AttachmentsBundle = ReturnType<typeof useManagedAttachmentDrafts>;

interface NewConversationActions {
  createSessionWithFirstMessage(
    projectId: string,
    initialMessage: string,
    agentTeam: { ownership: "system" | "user"; id: string },
    workspaceMode: "direct" | "worktree",
    attachmentIds: readonly string[],
  ): Promise<{ sessionId: string } | null>;
}

export function useNewConversationSubmission(
  state: NewConversationDraftState | null,
  dispatch: Dispatch<NewConversationDraftEvent>,
  catalog: AgentTeamCatalogBundle,
  attachments: AttachmentsBundle,
  readyAttachmentIds: readonly string[],
  hasBlockingAttachments: boolean,
  actions: NewConversationActions,
  persistenceEnabledRef: MutableRefObject<boolean>,
  rememberSelection: (selection: ConsoleSelection) => void,
  commitRoute: (route: ConsolePresentationRoute) => void,
  draftStore: ConversationDraftStore,
  activateComposer: (sessionId: string) => void,
  api: DesktopApi | undefined,
  setError: (error: string | null) => void,
  t: Translate,
) {
  const input = {
    state,
    dispatch,
    catalog,
    attachments,
    readyAttachmentIds,
    hasBlockingAttachments,
    actions,
    persistenceEnabledRef,
    rememberSelection,
    commitRoute,
    draftStore,
    activateComposer,
    api,
    setError,
    t,
  };
  const inputRef = useRef(input);
  inputRef.current = input;
  const createConversation = useCallback(async (): Promise<void> => {
    const runtime = inputRef.current;
    const submission = planNewConversationSubmission(
      runtime.state,
      runtime.readyAttachmentIds.length,
      runtime.hasBlockingAttachments,
    );
    if (submission === null) return;
    const team = planFindOperatorAgentTeam(runtime.catalog.state, submission.teamKey);
    if (team === undefined || !team.canCreateConversation) {
      runtime.dispatch({ type: "submit-failed", error: runtime.t("desktop.error.teamUnavailable") });
      return;
    }
    runtime.dispatch({ type: "submit-started" });
    const result = await submitNewConversation({
      projectId: submission.projectId,
      workspaceMode: submission.workspaceMode,
      initialMessage: submission.draft,
      team: { teamId: team.id, ownership: team.ownership },
      createSessionWithFirstMessage: (projectId, message, selectedTeam, workspaceMode) =>
        runtime.actions.createSessionWithFirstMessage(
          projectId,
          message,
          { ownership: selectedTeam.ownership, id: selectedTeam.teamId },
          workspaceMode,
          runtime.readyAttachmentIds,
        ),
      recordSuccessfulTeam: async (request) => {
        await runtime.api?.recordSuccessfulConversationAgentTeam?.(request);
      },
    });
    const creation = planNewConversationCreation(result);
    if (creation.kind === "failed") {
      inputRef.current.dispatch({
        type: "submit-failed",
        error: inputRef.current.t("desktop.error.conversationCreate"),
      });
      return;
    }
    const current = inputRef.current;
    const createdSelection = { projectId: submission.projectId, sessionId: creation.sessionId };
    current.persistenceEnabledRef.current = true;
    current.rememberSelection(createdSelection);
    current.commitRoute(ordinaryPresentationRoute(createdSelection));
    current.draftStore.clear(NEW_CONVERSATION_DRAFT_KEY);
    current.attachments.clearDraft(NEW_CONVERSATION_DRAFT_KEY);
    current.activateComposer(creation.sessionId);
    current.dispatch({ type: "consume" });
    const preferenceCommands = {
      recorded: () => {
        current.catalog.setLastUsedTeamKey(team.teamKey);
        current.setError(null);
      },
      failed: () => current.setError(current.t("desktop.error.preferenceRecord", {
        error: planConsoleErrorMessage(planNewConversationPreferenceError(result)),
      })),
      "not-created": () => undefined,
    };
    preferenceCommands[planNewConversationPreferenceResult(result)]();
  }, []);
  return useMemo(() => ({ createConversation }), [createConversation]);
}
