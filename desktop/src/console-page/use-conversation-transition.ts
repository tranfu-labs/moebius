import { useCallback, useMemo, useRef, useState } from "react";
import type { Translate } from "@moebius/console-ui";

import {
  planConversationSubmissionAction,
  planConversationSubmissionBlockText,
  planSessionTransitionSettlement,
  type ConversationDraftKey,
} from "./conversation-draft-model.js";
import { SessionViewTransitionQueue } from "./console-state-coordinator.js";
import type { ConsoleErrorController } from "./use-console-error-state.js";

interface ConversationTransitionActions {
  transitionSessionView(previousSessionId: string, viewedSessionId: string): Promise<string | null>;
  sendMessage(): Promise<void>;
}

export function useConversationTransition(
  composerOwnerKey: ConversationDraftKey,
  selectedSessionId: string,
  actions: ConversationTransitionActions,
  errors: ConsoleErrorController,
  t: Translate,
) {
  const input = {
    composerOwnerKey,
    selectedSessionId,
    transitionSessionView: actions.transitionSessionView,
    sendMessage: actions.sendMessage,
    errors,
    t,
  };
  const inputRef = useRef(input);
  inputRef.current = input;
  const queueRef = useRef(new SessionViewTransitionQueue());
  const pendingRef = useRef(false);
  const [transitionPending, setTransitionPending] = useState(false);
  const [transitionError, setTransitionError] = useState<string | null>(null);
  const queueTransition = useCallback((previousSessionId: string, viewedSessionId: string) => {
    const queue = queueRef.current;
    const transition = inputRef.current.transitionSessionView;
    pendingRef.current = true;
    setTransitionPending(true);
    setTransitionError(null);
    const ticket = queue.enqueue(async () => {
      const error = await transition(previousSessionId, viewedSessionId);
      setTransitionError(error);
    });
    void ticket.completion.finally(() => {
      if (planSessionTransitionSettlement(queue.isLatest(ticket.generation)) === "stale") return;
      pendingRef.current = queue.isPending;
      setTransitionPending(queue.isPending);
    });
  }, []);
  const submissionAction = planConversationSubmissionAction({
    ownerKey: input.composerOwnerKey,
    selectedSessionId: input.selectedSessionId,
    transitionPending,
  });
  const submissionBlockText = planConversationSubmissionBlockText(submissionAction, input.t);
  const sendMainComposer = useCallback(() => {
    const runtime = inputRef.current;
    const action = planConversationSubmissionAction({
      ownerKey: runtime.composerOwnerKey,
      selectedSessionId: runtime.selectedSessionId,
      transitionPending: pendingRef.current,
    });
    const commands = {
      send: () => void runtime.sendMessage(),
      "transition-pending": () => runtime.errors.report(
        { family: "conversation", scope: `${runtime.selectedSessionId}:submission` },
        runtime.t("desktop.composer.transitionPending"),
      ),
      "owner-mismatch": () => runtime.errors.report(
        { family: "conversation", scope: `${runtime.selectedSessionId}:submission` },
        runtime.t("desktop.composer.ownerMismatch"),
      ),
    };
    commands[action]();
  }, []);
  return useMemo(() => ({
    transitionPending,
    transitionError,
    submissionBlockText,
    queueTransition,
    sendMainComposer,
  }), [queueTransition, sendMainComposer, submissionBlockText, transitionError, transitionPending]);
}
