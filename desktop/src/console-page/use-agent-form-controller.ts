import type {
  AgentFormDraft,
  OperatorAgentFormController,
} from "@moebius/console-ui";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type { AgentFormPresentation } from "./agent-form-presentation.js";
import {
  discardAgentForm,
  isAgentFormSubmitted,
  readAgentFormDraft,
  writeAgentFormDraft,
} from "./agent-form-draft.js";
import {
  agentFormDraftKey,
  agentFormSubmittedKey,
  type ConversationDraftKey,
} from "./conversation-draft-model.js";
import type { ConversationDraftStore } from "./draft-store.js";

interface LoadedAgentFormState {
  presentationKey: string;
  storageKey: ConversationDraftKey;
  submitted: boolean;
  submitting: boolean;
  draft: AgentFormDraft;
}

export interface UseAgentFormControllerInput {
  selectedSession: { sessionId: string } | null;
  agentForm: AgentFormPresentation | null;
  conversationDraftStore: ConversationDraftStore;
  sendFormMessage(message: string): Promise<boolean>;
  transitionPending: boolean;
}

export interface AgentFormControllerBundle {
  controller: OperatorAgentFormController | null;
  discard(): void;
  onIndependentMessageResult(sent: boolean): void;
}

export function useAgentFormController(
  input: UseAgentFormControllerInput,
): AgentFormControllerBundle {
  const activeAgentFormKey = input.selectedSession === null || input.agentForm === null
    ? null
    : `${input.selectedSession.sessionId}:${String(input.agentForm.sourceMessageId)}:${input.agentForm.spec.id}`;
  const activeAgentFormStorageKey = input.selectedSession === null || input.agentForm === null
    ? null
    : agentFormDraftKey(input.selectedSession.sessionId, input.agentForm.sourceMessageId);
  const activeAgentFormSubmittedKey = input.selectedSession === null || input.agentForm === null
    ? null
    : agentFormSubmittedKey(input.selectedSession.sessionId, input.agentForm.sourceMessageId);
  const activeAgentFormSpec = input.agentForm?.spec ?? null;
  const [loadedAgentForm, setLoadedAgentForm] = useState<LoadedAgentFormState | null>(null);
  const submittingRef = useRef(false);

  useEffect(() => {
    if (
      input.selectedSession === null
      || input.agentForm === null
      || activeAgentFormKey === null
      || activeAgentFormStorageKey === null
      || activeAgentFormSubmittedKey === null
      || activeAgentFormSpec === null
    ) {
      submittingRef.current = false;
      setLoadedAgentForm(null);
      return;
    }
    submittingRef.current = false;
    setLoadedAgentForm({
      presentationKey: activeAgentFormKey,
      storageKey: activeAgentFormStorageKey,
      draft: readAgentFormDraft(input.conversationDraftStore, activeAgentFormStorageKey, activeAgentFormSpec),
      submitted: isAgentFormSubmitted(input.conversationDraftStore, activeAgentFormSubmittedKey),
      submitting: false,
    });
  }, [
    activeAgentFormKey,
    activeAgentFormStorageKey,
    activeAgentFormSubmittedKey,
    activeAgentFormSpec,
    input.conversationDraftStore,
  ]);

  const discard = useCallback(() => {
    if (activeAgentFormStorageKey === null || activeAgentFormSubmittedKey === null) return;
    discardAgentForm(
      input.conversationDraftStore,
      activeAgentFormStorageKey,
      activeAgentFormSubmittedKey,
    );
    submittingRef.current = false;
    setLoadedAgentForm((current) => current?.presentationKey === activeAgentFormKey
      ? { ...current, submitted: true, submitting: false }
      : current);
  }, [
    activeAgentFormKey,
    activeAgentFormStorageKey,
    activeAgentFormSubmittedKey,
    input.conversationDraftStore,
  ]);

  const controller = useMemo<OperatorAgentFormController | null>(() => {
    if (
      activeAgentFormSpec === null
      || activeAgentFormKey === null
      || activeAgentFormStorageKey === null
      || loadedAgentForm?.presentationKey !== activeAgentFormKey
      || loadedAgentForm.submitted
    ) {
      return null;
    }
    return {
      spec: activeAgentFormSpec,
      draft: loadedAgentForm.draft,
      onDraftChange: (draft: AgentFormDraft): void => {
        if (loadedAgentForm.submitting) return;
        writeAgentFormDraft(input.conversationDraftStore, activeAgentFormStorageKey, draft);
        setLoadedAgentForm((current) => current?.presentationKey === activeAgentFormKey
          ? { ...current, draft }
          : current);
      },
      onSubmit: (message: string): void => {
        if (loadedAgentForm.submitting || submittingRef.current || input.transitionPending) return;
        submittingRef.current = true;
        setLoadedAgentForm((current) => current?.presentationKey === activeAgentFormKey
          ? { ...current, submitting: true }
          : current);
        void input.sendFormMessage(message).then((sent) => {
          if (sent) {
            discard();
            return;
          }
          submittingRef.current = false;
          setLoadedAgentForm((current) => current?.presentationKey === activeAgentFormKey
            ? { ...current, submitting: false }
            : current);
        }, () => {
          submittingRef.current = false;
          setLoadedAgentForm((current) => current?.presentationKey === activeAgentFormKey
            ? { ...current, submitting: false }
            : current);
        });
      },
      onSkip: discard,
    };
  }, [
    activeAgentFormKey,
    activeAgentFormStorageKey,
    discard,
    activeAgentFormSpec,
    input.conversationDraftStore,
    input.sendFormMessage,
    input.transitionPending,
    loadedAgentForm,
  ]);

  const onIndependentMessageResult = useCallback((sent: boolean): void => {
    if (sent) discard();
  }, [discard]);

  return { controller, discard, onIndependentMessageResult };
}
