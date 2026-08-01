import type { OperatorSession } from "@moebius/console-ui";

import type { ConsoleStateActionsOptions } from "./console-state-action-contract.js";
import {
  decideConsoleApiBase,
  decideSendStarted,
  decideSessionViewTransition,
  planConsoleErrorMessage,
  planMessageSubmission,
  planMutationErrorMessage,
  planSessionReadPayload,
  planSessionPinPayload,
  planSessionTitlePayload,
} from "./console-state-plan.js";

export const conversationActions = {
  async updateSessionReadState(
    options: ConsoleStateActionsOptions,
    session: {
      id: string;
      titleRevision?: number;
      attentionRevision?: number;
      readStateRevision?: number;
    },
    action: "mark-read-attention" | "mark-read-unread" | "mark-unread",
  ): Promise<void> {
    await mutateSidebarSession(
      options,
      session.id,
      "attention",
      planSessionReadPayload(session, action, options.getSelection().sessionId),
      "update conversation read state failed",
    );
  },

  async setSessionPinned(
    options: ConsoleStateActionsOptions,
    session: { id: string; pinnedAt?: string | null },
    pinned: boolean,
  ): Promise<void> {
    await mutateSidebarSession(
      options,
      session.id,
      "pin",
      planSessionPinPayload(pinned, session.pinnedAt),
      "update conversation pin failed",
    );
  },

  async renameSession(
    options: ConsoleStateActionsOptions,
    session: { id: string; titleRevision?: number },
    title: string,
  ): Promise<void> {
    await mutateSidebarSession(
      options,
      session.id,
      "title",
      planSessionTitlePayload(title, session.titleRevision),
      "rename conversation failed",
    );
  },

  async transitionSessionView(
    options: ConsoleStateActionsOptions,
    previousSessionId: string,
    nextSessionId: string,
  ): Promise<string | null> {
    const decision = decideSessionViewTransition({
      apiBase: options.apiBase,
      previousSessionId,
      nextSessionId,
    });
    if (decision.kind === "skip") return null;
    try {
      await options.commands.mutateSession(
        decision.apiBase,
        previousSessionId,
        "arm-manual-unread",
        undefined,
      );
      await options.commands.mutateSession(decision.apiBase, nextSessionId, "viewed", undefined);
      return null;
    } catch (error) {
      const message = planConsoleErrorMessage(error);
      options.setError(message);
      return message;
    }
  },

  async sendMessage(options: ConsoleStateActionsOptions): Promise<void> {
    const selection = options.getSelection();
    const submission = planMessageSubmission({
      apiBase: options.apiBase,
      body: options.composerValue,
      attachmentIds: options.getAttachmentIds(),
      resumeRunId: options.getResumeRunId(selection.sessionId),
    });
    if (submission.kind === "skip") return;
    const started = decideSendStarted(options.coordinator.beginSend());
    if (started === "blocked") return;
    options.setSending(true);
    try {
      await options.commands.sendMessage(
        submission.apiBase,
        selection.sessionId,
        submission.payload,
      );
      options.clearComposer(selection.sessionId);
      options.clearAttachments(selection.sessionId);
      options.clearResumeRunId(selection.sessionId);
      await options.refresh(options.getSelection());
    } catch (error) {
      options.setError(planConsoleErrorMessage(error));
    } finally {
      options.coordinator.endSend();
      options.setSending(false);
    }
  },
};

async function mutateSidebarSession(
  options: ConsoleStateActionsOptions,
  sessionId: string,
  action: "attention" | "pin" | "title",
  payload: Record<string, unknown>,
  fallbackError: string,
): Promise<void> {
  const availability = decideConsoleApiBase(
    options.apiBase,
    options.t("desktop.error.localConsoleUnavailable"),
  );
  if (availability.kind === "unavailable") {
    const error = new Error(availability.message);
    options.setError(error.message);
    throw error;
  }
  try {
    const session = await options.commands.mutateSession(
      availability.apiBase,
      sessionId,
      action,
      payload,
    );
    options.commitSessionMetadata(session as OperatorSession);
    options.coordinator.invalidateRefresh();
    await options.refresh(options.getSelection());
  } catch (error) {
    options.setError(planMutationErrorMessage(error, fallbackError));
    throw error;
  }
}
