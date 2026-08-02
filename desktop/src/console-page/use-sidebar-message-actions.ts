import { useCallback, useMemo, useRef, type Dispatch, type MutableRefObject, type SetStateAction } from "react";
import type { OperatorSubSessionView } from "@moebius/console-ui";

import type { ConversationDraftStore } from "./draft-store.js";
import { sessionDraftKey } from "./conversation-draft-model.js";
import type { ConsoleSelection } from "./console-state-coordinator.js";
import { planConsoleErrorMessage } from "./console-state-plan.js";
import type { SidebarMessagePort } from "./sidebar-message-contract.js";
import {
  decideSidebarMessageAvailability,
  decideSidebarViewRefresh,
  planSidebarComposerBody,
  planSidebarMessageSubmission,
} from "./sidebar-message-model.js";

type SidebarConversationViewState =
  | { status: "idle" | "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; view: OperatorSubSessionView };

export function useSidebarMessageActions(
  apiBase: string | null,
  sendingId: string | null,
  setSendingId: (sessionId: string | null) => void,
  composerValues: Readonly<Record<string, string>>,
  setComposerValues: Dispatch<SetStateAction<Record<string, string>>>,
  readyAttachmentIds: readonly string[],
  clearAttachmentDraft: (draftKey: string) => void,
  draftStore: ConversationDraftStore,
  views: Readonly<Record<string, SidebarConversationViewState>>,
  setViews: Dispatch<SetStateAction<Record<string, SidebarConversationViewState>>>,
  selectionRef: MutableRefObject<ConsoleSelection>,
  refresh: (selection: ConsoleSelection) => Promise<boolean>,
  port: SidebarMessagePort,
  setError: (error: string | null) => void,
) {
  const input = {
    apiBase, sendingId, setSendingId, composerValues, setComposerValues, readyAttachmentIds,
    clearAttachmentDraft, draftStore, views, setViews, selectionRef, refresh, port, setError,
  };
  const inputRef = useRef(input);
  inputRef.current = input;

  const sendMessage = useCallback(async (sessionId: string) => {
    const current = inputRef.current;
    const availability = decideSidebarMessageAvailability({
      apiBase: current.apiBase,
      sending: current.sendingId !== null,
    });
    if (availability.kind === "skip") return;
    const draftKey = sessionDraftKey(sessionId);
    const submission = planSidebarMessageSubmission({
      body: planSidebarComposerBody(
        current.composerValues,
        sessionId,
        current.draftStore.read(draftKey),
      ),
      attachmentIds: current.readyAttachmentIds,
    });
    if (submission.kind === "skip") return;
    current.setSendingId(sessionId);
    try {
      await current.port.submitMessage(
        availability.apiBase,
        sessionId,
        submission.body,
        submission.attachmentIds,
      );
      const latest = inputRef.current;
      latest.draftStore.clear(draftKey);
      latest.setComposerValues((values) => ({ ...values, [sessionId]: "" }));
      latest.clearAttachmentDraft(draftKey);
      const view = await latest.port.loadView(availability.apiBase, sessionId);
      latest.setViews((views) => ({ ...views, [sessionId]: { status: "ready", view } }));
      await latest.refresh(latest.selectionRef.current);
      latest.setError(null);
    } catch (error) {
      inputRef.current.setError(planConsoleErrorMessage(error));
    } finally {
      inputRef.current.setSendingId(null);
    }
  }, []);

  const refreshAfterPendingMutation = useCallback(async (sessionId: string) => {
    const current = inputRef.current;
    await current.refresh(current.selectionRef.current);
    const decision = decideSidebarViewRefresh({
      apiBase: current.apiBase,
      hasView: current.views[sessionId] !== undefined,
    });
    if (decision.kind === "skip") return;
    const view = await current.port.loadView(decision.apiBase, sessionId);
    inputRef.current.setViews((views) => ({
      ...views,
      [sessionId]: { status: "ready", view },
    }));
  }, []);

  const retryPendingMessage = useCallback(async (sessionId: string, messageId: number) => {
    const current = inputRef.current;
    const availability = decideSidebarMessageAvailability({ apiBase: current.apiBase, sending: false });
    if (availability.kind === "skip") return;
    try {
      await current.port.retryPending(availability.apiBase, sessionId, messageId);
      await refreshAfterPendingMutation(sessionId);
      inputRef.current.setError(null);
    } catch (error) {
      inputRef.current.setError(planConsoleErrorMessage(error));
    }
  }, [refreshAfterPendingMutation]);

  const editPendingMessage = useCallback(async (sessionId: string, messageId: number, body: string) => {
    const current = inputRef.current;
    const availability = decideSidebarMessageAvailability({ apiBase: current.apiBase, sending: false });
    if (availability.kind === "skip") return;
    try {
      await current.port.updatePending(availability.apiBase, sessionId, messageId, body);
      await refreshAfterPendingMutation(sessionId);
      inputRef.current.setError(null);
    } catch (error) {
      inputRef.current.setError(planConsoleErrorMessage(error));
    }
  }, [refreshAfterPendingMutation]);

  const removePendingMessage = useCallback(async (sessionId: string, messageId: number) => {
    const current = inputRef.current;
    const availability = decideSidebarMessageAvailability({ apiBase: current.apiBase, sending: false });
    if (availability.kind === "skip") return;
    try {
      await current.port.removePending(availability.apiBase, sessionId, messageId);
      await refreshAfterPendingMutation(sessionId);
      inputRef.current.setError(null);
    } catch (error) {
      inputRef.current.setError(planConsoleErrorMessage(error));
    }
  }, [refreshAfterPendingMutation]);

  return useMemo(() => ({
    sendMessage,
    retryPendingMessage,
    editPendingMessage,
    removePendingMessage,
  }), [editPendingMessage, removePendingMessage, retryPendingMessage, sendMessage]);
}
