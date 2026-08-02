import { useCallback, useMemo, useRef, type Dispatch, type MutableRefObject, type SetStateAction } from "react";
import type { OperatorProject, TranslationKey } from "@moebius/console-ui";

import type { AgentTeamCatalogBundle } from "./use-agent-team-catalog.js";
import type { ConsoleSelection } from "./console-state-coordinator.js";
import { planConsoleErrorMessage } from "./console-state-plan.js";
import type { ConsolePresentationRoute } from "./presentation-route.js";
import type { RightSidebarTabsState } from "@moebius/console-ui";
import type { RightSidebarTabsStore } from "./right-sidebar-tabs-store.js";
import type { SidebarDraftPort, SidebarDraftPreferenceTransport } from "./sidebar-draft-contract.js";
import {
  decideSidebarTabCommit,
  decideSidebarTeamPreference,
  decideSidebarDraftUpdate,
  planSidebarCurrentHostSessionId,
  planSidebarCreatedTitle,
  planSidebarDraftPromotion,
  planSidebarDraftSubmission,
} from "./sidebar-draft-model.js";
import type {
  SidebarConversationDraft,
  SidebarConversationDraftStore,
} from "./sidebar-conversation-drafts.js";
import type { ConsoleErrorController } from "./use-console-error-state.js";

export function useSidebarDraftActions(
  apiBase: string | null,
  sendingId: string | null,
  setSendingId: (id: string | null) => void,
  projects: readonly OperatorProject[],
  catalog: AgentTeamCatalogBundle,
  attachmentIds: readonly string[],
  attachmentsBlocked: boolean,
  clearAttachmentDraft: (draftKey: string) => void,
  draftStore: SidebarConversationDraftStore,
  commitDrafts: (drafts: SidebarConversationDraft[]) => void,
  setComposerValues: Dispatch<SetStateAction<Record<string, string>>>,
  tabsStore: RightSidebarTabsStore,
  commitTabs: (tabs: RightSidebarTabsState) => void,
  presentationRouteRef: MutableRefObject<ConsolePresentationRoute | null>,
  selectionRef: MutableRefObject<ConsoleSelection>,
  commitRoute: (route: ConsolePresentationRoute) => void,
  refresh: (selection: ConsoleSelection) => Promise<boolean>,
  transport: SidebarDraftPreferenceTransport | undefined,
  port: SidebarDraftPort,
  errors: ConsoleErrorController,
  t: (key: TranslationKey) => string,
) {
  const input = {
    apiBase, sendingId, setSendingId, projects, catalog, attachmentIds, attachmentsBlocked,
    clearAttachmentDraft, draftStore, commitDrafts, setComposerValues, tabsStore, commitTabs,
    presentationRouteRef, selectionRef, commitRoute, refresh, transport, port, errors, t,
  };
  const inputRef = useRef(input);
  inputRef.current = input;

  const updateDraft = useCallback((
    draftId: string,
    update: (draft: SidebarConversationDraft) => SidebarConversationDraft,
  ) => {
    const current = inputRef.current;
    const decision = decideSidebarDraftUpdate(current.draftStore.read(draftId));
    if (decision.kind === "skip") return;
    current.draftStore.write(update(decision.draft));
    current.commitDrafts(current.draftStore.list());
  }, []);

  const submitDraft = useCallback(async (draftId: string) => {
    const current = inputRef.current;
    const submission = planSidebarDraftSubmission({
      apiBase: current.apiBase,
      draft: current.draftStore.read(draftId),
      sending: current.sendingId !== null,
      attachmentsBlocked: current.attachmentsBlocked,
      teams: current.catalog.state,
    });
    if (submission.kind === "skip") return;
    if (submission.kind === "team-unavailable") {
      current.errors.report({ family: "sidebar-draft", scope: draftId }, current.t("desktop.error.teamUnavailable"));
      return;
    }
    const errorOperation = current.errors.begin({ family: "sidebar-draft", scope: draftId });
    current.setSendingId(draftId);
    try {
      const created = await current.port.createConversation({
        apiBase: submission.apiBase,
        draft: submission.draft,
        team: submission.team,
        attachmentIds: current.attachmentIds,
      });
      const latest = inputRef.current;
      const promotion = planSidebarDraftPromotion({
        projects: latest.projects,
        sessions: latest.projects.flatMap((project) => project.sessions),
        draft: submission.draft,
        createdSessionId: created.sessionId,
      });
      latest.tabsStore.promoteConversationDraft({
        draftId,
        sessionId: created.sessionId,
        title: planSidebarCreatedTitle(created.title, submission.draft.body),
        conversationContext: promotion.conversationContext,
      });
      const nextTabs = latest.tabsStore.read(promotion.tabHostSessionId);
      const currentHostSessionId = planSidebarCurrentHostSessionId(
        latest.presentationRouteRef.current,
        latest.selectionRef.current.sessionId,
      );
      if (decideSidebarTabCommit(currentHostSessionId, promotion.tabHostSessionId) === "commit") {
        latest.commitTabs(nextTabs);
      }
      latest.draftStore.remove(draftId);
      latest.commitDrafts(latest.draftStore.list());
      latest.clearAttachmentDraft(submission.draft.attachmentDraftKey);
      latest.setComposerValues((values) => ({ ...values, [created.sessionId]: "" }));
      latest.commitRoute(promotion.route);
      await latest.refresh(latest.selectionRef.current);
      const preference = await latest.port.recordSuccessfulTeam(
        latest.transport,
        submission.team,
        created.sessionId,
      );
      if (decideSidebarTeamPreference(preference) === "commit") {
        latest.catalog.setLastUsedTeamKey(submission.team.teamKey);
      }
      latest.errors.succeed(errorOperation);
    } catch (error) {
      inputRef.current.errors.fail(errorOperation, planConsoleErrorMessage(error));
    } finally {
      inputRef.current.setSendingId(null);
    }
  }, []);

  return useMemo(
    () => ({ sendingId, updateDraft, submitDraft }),
    [sendingId, submitDraft, updateDraft],
  );
}
