import { useCallback, useMemo, useRef, type MutableRefObject } from "react";
import type { OperatorEditAndResendTarget } from "@moebius/console-ui";

import type { LocalConsoleState } from "./console-state-contract.js";
import {
  editConversationComposerDraft,
  sessionDraftKey,
  type ConversationComposerDraftState,
} from "./conversation-draft-model.js";
import type { ConversationDraftStore } from "./draft-store.js";
import { refillStoppedRunDraft } from "./edit-resend.js";
import { planConsoleErrorMessage } from "./console-state-plan.js";
import { planEditResendPersistence, planEditResendStart } from "./edit-resend-model.js";

export function useEditResend(
  stateRef: MutableRefObject<LocalConsoleState | null>,
  replaceAttachments: (source: { sessionId: string; sourceMessageId: number }) => Promise<void>,
  draftStore: ConversationDraftStore,
  composerDraftRef: MutableRefObject<ConversationComposerDraftState>,
  commitComposerDraft: (draft: ConversationComposerDraftState) => void,
  setError: (error: string | null) => void,
) {
  const inputRef = useRef({
    stateRef, replaceAttachments, draftStore, composerDraftRef, commitComposerDraft, setError,
  });
  inputRef.current = {
    stateRef, replaceAttachments, draftStore, composerDraftRef, commitComposerDraft, setError,
  };
  const editAndResend = useCallback((target: OperatorEditAndResendTarget) => {
    const current = inputRef.current;
    const start = planEditResendStart(current.stateRef.current, target);
    if (start.kind === "skip") return;
    current.setError(null);
    void refillStoppedRunDraft({
      messages: start.messages,
      stoppedMessageId: start.target.stoppedMessageId,
      stoppedRunId: start.target.runId,
      sessionId: start.target.sessionId,
      replaceAttachments: current.replaceAttachments,
      persistBody: (body) => {
        const latest = inputRef.current;
        const draftKey = sessionDraftKey(start.target.sessionId);
        const persistence = planEditResendPersistence({
          runId: start.target.runId,
          draftKey,
          activeDraftKey: latest.composerDraftRef.current.key,
        });
        latest.draftStore.write(draftKey, body);
        if (persistence.persistRunId) {
          latest.draftStore.writeResumeRunId(draftKey, start.target.runId!);
        }
        if (persistence.commitActiveDraft) {
          latest.commitComposerDraft(editConversationComposerDraft(latest.composerDraftRef.current, body));
        }
      },
    }).catch((error: unknown) => inputRef.current.setError(planConsoleErrorMessage(error)));
  }, []);
  return useMemo(() => ({ editAndResend }), [editAndResend]);
}
