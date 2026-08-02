import { useCallback, useMemo, useRef, useState, type Dispatch, type MutableRefObject, type SetStateAction } from "react";

import type { ConversationDraftStore } from "./draft-store.js";
import { sessionDraftKey } from "./conversation-draft-model.js";
import type { ConsoleSelection } from "./console-state-coordinator.js";
import { planConsoleErrorMessage } from "./console-state-plan.js";
import type { SessionExecutionOverride, SessionRunPort } from "./session-run-contract.js";
import {
  decideSessionRunAvailability,
  planSubSessionComposerBody,
  planSubSessionMessage,
} from "./session-run-model.js";

export function useSessionRunActions(
  apiBase: string | null,
  composerValues: Readonly<Record<string, string>>,
  setComposerValues: Dispatch<SetStateAction<Record<string, string>>>,
  readyAttachmentIds: readonly string[],
  clearAttachmentDraft: (draftKey: string) => void,
  draftStore: ConversationDraftStore,
  selectionRef: MutableRefObject<ConsoleSelection>,
  refreshCurrent: (selection: ConsoleSelection) => Promise<boolean>,
  refreshSubSession: (sessionId: string) => Promise<unknown>,
  port: SessionRunPort,
  setError: (error: string | null) => void,
) {
  const [sendingSessionId, setSendingSessionId] = useState<string | null>(null);
  const input = {
    apiBase, composerValues, setComposerValues, readyAttachmentIds, clearAttachmentDraft,
    draftStore, selectionRef, refreshCurrent, refreshSubSession, port, setError,
    sendingSessionId,
  };
  const inputRef = useRef(input);
  inputRef.current = input;

  const interrupt = useCallback(async (sessionId: string, runId: string) => {
    const current = inputRef.current;
    const availability = decideSessionRunAvailability({ apiBase: current.apiBase, sending: false });
    if (availability.kind !== "available") return;
    try {
      await current.port.interrupt(
        availability.apiBase,
        sessionId,
        runId,
        () => current.refreshCurrent(current.selectionRef.current),
      );
      inputRef.current.setError(null);
    } catch (error) {
      inputRef.current.setError(planConsoleErrorMessage(error));
    }
  }, []);

  const sendSubSessionMessage = useCallback(async (sessionId: string) => {
    const current = inputRef.current;
    const availability = decideSessionRunAvailability({
      apiBase: current.apiBase,
      sending: current.sendingSessionId !== null,
    });
    if (availability.kind !== "available") return;
    const draftKey = sessionDraftKey(sessionId);
    const submission = planSubSessionMessage({
      body: planSubSessionComposerBody(
        current.composerValues,
        sessionId,
        current.draftStore.read(draftKey),
      ),
      attachmentIds: current.readyAttachmentIds,
    });
    if (submission.kind === "skip") return;
    setSendingSessionId(sessionId);
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
      await Promise.all([
        latest.refreshSubSession(sessionId),
        latest.refreshCurrent(latest.selectionRef.current),
      ]);
      latest.setError(null);
    } catch (error) {
      inputRef.current.setError(planConsoleErrorMessage(error));
    } finally {
      setSendingSessionId(null);
    }
  }, []);

  const retryRun = useCallback(async (
    sessionId: string,
    runId: string,
    executionOverride?: SessionExecutionOverride,
  ) => {
    const current = inputRef.current;
    const availability = decideSessionRunAvailability({
      apiBase: current.apiBase,
      sending: current.sendingSessionId !== null,
    });
    if (availability.kind !== "available") throw new Error("retry unavailable");
    setSendingSessionId(sessionId);
    try {
      await current.port.retryRun(availability.apiBase, sessionId, runId, executionOverride);
      const latest = inputRef.current;
      await Promise.all([
        latest.refreshSubSession(sessionId),
        latest.refreshCurrent(latest.selectionRef.current),
      ]);
      latest.setError(null);
    } catch (error) {
      inputRef.current.setError(planConsoleErrorMessage(error));
      throw error;
    } finally {
      setSendingSessionId(null);
    }
  }, []);

  const interruptSubSession = useCallback(async (sessionId: string, runId: string) => {
    const current = inputRef.current;
    const availability = decideSessionRunAvailability({ apiBase: current.apiBase, sending: false });
    if (availability.kind !== "available") return;
    try {
      await current.port.interrupt(availability.apiBase, sessionId, runId, async () => {
        const latest = inputRef.current;
        await Promise.all([
          latest.refreshSubSession(sessionId),
          latest.refreshCurrent(latest.selectionRef.current),
        ]);
      });
      inputRef.current.setError(null);
    } catch (error) {
      inputRef.current.setError(planConsoleErrorMessage(error));
    }
  }, []);

  return useMemo(() => ({
    isSending: sendingSessionId !== null,
    interrupt,
    sendSubSessionMessage,
    retryRun,
    interruptSubSession,
  }), [interrupt, interruptSubSession, retryRun, sendSubSessionMessage, sendingSessionId]);
}
