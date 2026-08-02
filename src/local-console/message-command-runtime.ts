import {
  decideEditResumeRecord,
  decideEditResumeLinkRead,
  decidePrimaryMessageAdmission,
  decideSubmittedMessageDispatch,
  decideSubmittedMessageWake,
  planSubmittedMessageContent,
} from "./message-command-plan.js";
import { LocalConsoleBusyError, type LocalConsoleMessage, type LocalConsoleTextFragment } from "./types.js";

export class LocalConsoleMessageCommandRuntime {
  constructor(private readonly input: {
    defaultSessionId: string;
    nowIso(): string;
    assertSessionCanContinue(sessionId: string): Promise<void>;
    hasActivePrimary(sessionId: string): boolean;
    hasPersistedPrimary(sessionId: string): Promise<boolean>;
    sessionSummary(sessionId: string): Promise<import("./types.js").LocalConsoleSessionSummary>;
    resolveDispatch(sessionId: string, body: string): Promise<import("./user-message-routing.js").LocalUserMessageDispatch>;
    appendUserMessage(input: {
      sessionId: string;
      body: string;
      attachmentIds: string[];
      attachmentDraftKey: string;
      dispatch: import("./user-message-routing.js").LocalUserMessageDispatch
        | { lane: "awaiting-team"; role: null; reason: "no-valid-mention" };
      now: string;
    }): Promise<LocalConsoleMessage>;
    resolveResumeLink(sessionId: string, runId: string): Promise<{ role: string } | undefined>;
    recordEditResume(input: {
      sessionId: string;
      targetRunId: string;
      sourceMessageId: number;
      role: string;
      createdAt: string;
    }): Promise<void>;
    scheduleWorkerWake(sessionId: string): void;
    processPending(sessionId: string): void;
    markPendingReferenceError(input: { sessionId: string; messageId: number; error: null; now: string }): Promise<unknown>;
    updatePendingUserMessage(input: { sessionId: string; messageId: number; body: string; now: string }): Promise<LocalConsoleMessage>;
    removePendingUserMessage(input: { sessionId: string; messageId: number; now: string }): Promise<void>;
    storeCall<T>(label: string, operation: () => Promise<T>): Promise<T>;
    setLastError(error: string | null): void;
    schedulePendingProcessing(sessionId: string): void;
  }) {}

  async submit(
    body: string,
    sessionId = this.input.defaultSessionId,
    attachmentIds: string[] = [],
    resumeRunId?: string,
    textFragments: LocalConsoleTextFragment[] = [],
  ): Promise<LocalConsoleMessage> {
    const content = planSubmittedMessageContent({ body, attachmentIds, textFragments });
    await this.input.assertSessionCanContinue(sessionId);
    const admission = decidePrimaryMessageAdmission({
      activePrimary: this.input.hasActivePrimary(sessionId),
      persistedPrimary: await this.input.hasPersistedPrimary(sessionId),
    });
    if (admission.kind === "busy") throw new LocalConsoleBusyError();
    const dispatchDecision = decideSubmittedMessageDispatch(await this.input.sessionSummary(sessionId));
    const dispatch = dispatchDecision.kind === "awaiting-team"
      ? dispatchDecision.dispatch
      : await this.input.resolveDispatch(sessionId, content.trimmed);
    const message = await this.input.storeCall("local-console-store-append-user", () =>
      this.input.appendUserMessage({
        sessionId,
        body: content.persistedBody,
        attachmentIds: content.attachmentIds,
        attachmentDraftKey: `draft:${sessionId}`,
        dispatch,
        now: this.input.nowIso(),
      }));
    const resumeLinkRead = decideEditResumeLinkRead(resumeRunId);
    const resume = decideEditResumeRecord({
      resumeRunId,
      link: resumeLinkRead.kind === "skip"
        ? undefined
        : await this.input.resolveResumeLink(sessionId, resumeLinkRead.runId),
    });
    if (resume.kind === "record") {
      await this.input.storeCall("local-console-store-record-edit-resume", () =>
        this.input.recordEditResume({
          sessionId,
          targetRunId: resume.targetRunId,
          sourceMessageId: message.id,
          role: resume.role,
          createdAt: this.input.nowIso(),
        }));
    }
    const wake = decideSubmittedMessageWake(dispatch);
    if (wake.kind === "worker") this.input.scheduleWorkerWake(sessionId);
    this.input.processPending(sessionId);
    return message;
  }

  async retryPending(input: { sessionId: string; messageId: number }): Promise<void> {
    await this.input.storeCall("local-console-store-clear-pending-reference-error", () =>
      this.input.markPendingReferenceError({ ...input, error: null, now: this.input.nowIso() }));
    this.input.setLastError(null);
    this.input.schedulePendingProcessing(input.sessionId);
  }

  async updatePending(input: { sessionId: string; messageId: number; body: string }): Promise<LocalConsoleMessage> {
    const message = await this.input.storeCall("local-console-store-update-pending-user", () =>
      this.input.updatePendingUserMessage({ ...input, now: this.input.nowIso() }));
    this.input.setLastError(null);
    this.input.schedulePendingProcessing(input.sessionId);
    return message;
  }

  async removePending(input: { sessionId: string; messageId: number }): Promise<void> {
    await this.input.storeCall("local-console-store-remove-pending-user", () =>
      this.input.removePendingUserMessage({ ...input, now: this.input.nowIso() }));
    this.input.setLastError(null);
    this.input.schedulePendingProcessing(input.sessionId);
  }
}
