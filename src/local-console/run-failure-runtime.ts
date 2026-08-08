import type { CodexRunResult } from "../codex.js";
import { localTerminalFromResult } from "./runtime-domain.js";
import {
  decideStartFailureRecovery,
  planActiveFailureContext,
  planDetachedRunFailure,
  decideDetachedTerminalCapability,
  planDirectRunFailure,
  planFailureRecordFields,
  planGracefulWorkerPlaceholder,
  planTerminalRecordField,
} from "./run-failure-plan.js";
import type {
  LocalConsoleExecutionProfile,
  LocalConsoleMessage,
  LocalConsoleStore,
  LocalConsoleSystemEventKind,
  LocalConsoleTerminal,
} from "./types.js";

interface ActiveFailureContext {
  runId: string;
  gracefulResumePrepared: boolean;
  liveMarkdown: string | null;
  profile: LocalConsoleExecutionProfile | null;
}

export class LocalRunFailureRuntime {
  constructor(private readonly input: {
    store: LocalConsoleStore;
    storeCall<T>(label: string, operation: () => Promise<T>): Promise<T>;
    nowIso(): string;
    timeoutKind(result: Extract<CodexRunResult, { ok: false }>): "idle" | "tool" | "max-duration" | null;
    interrupted(result: Extract<CodexRunResult, { ok: false }>): boolean;
    interruptionCause(result: Extract<CodexRunResult, { ok: false }>): "user" | "redirect" | "context-unavailable" | "runtime-closing" | "system" | null;
    logTimeout(input: { event: string; runDir: string; reason: string }): void;
    activeRun(runId: string): ActiveFailureContext | undefined;
    recordError(event: string, error: unknown, originalError?: string): void;
    failureRetryLimit?: number;
    scheduleReprocess(sessionId: string): void;
  }) {}

  async recordDirect(
    message: LocalConsoleMessage,
    sessionId: string,
    runId: string,
    result: Extract<CodexRunResult, { ok: false }>,
    observedExternalSessionId: string | null = null,
  ): Promise<void> {
    const active = planActiveFailureContext(this.input.activeRun(runId));
    const terminal = localTerminalFromResult(result, active.liveMarkdown, active.profile);
    const plan = planDirectRunFailure({
      result,
      runId,
      activeRunId: active.runId,
      gracefulResumePrepared: active.gracefulResumePrepared,
      timeoutKind: this.input.timeoutKind(result),
      interrupted: this.input.interrupted(result),
      cause: this.input.interruptionCause(result),
    });
    if (plan.kind === "stuck") {
      this.input.logTimeout({ event: plan.logEvent, runDir: result.runDir, reason: result.reason });
      await this.recordStuck(message, sessionId, runId, result.runDir, result.reason, terminal);
      return;
    }
    if (plan.kind === "skip-graceful") return;
    if (plan.kind === "interrupted") {
      await this.recordInterrupted(
        message,
        sessionId,
        runId,
        result.runDir,
        result.reason,
        plan.cause,
        terminal,
      );
      return;
    }
    await this.recordFailureWithAutoRetry(message, sessionId, runId, result.runDir, result.reason, plan.body, terminal, observedExternalSessionId);
  }

  async recordDetached(
    sessionId: string,
    runId: string,
    result: Extract<CodexRunResult, { ok: false }>,
  ): Promise<void> {
    const active = planActiveFailureContext(this.input.activeRun(runId));
    const terminal = localTerminalFromResult(result, active.liveMarkdown, active.profile);
    const plan = planDetachedRunFailure({
      result,
      gracefulResumePrepared: active.gracefulResumePrepared,
      timeoutKind: this.input.timeoutKind(result),
      interrupted: this.input.interrupted(result),
      cause: this.input.interruptionCause(result),
    });
    if (plan.kind === "release-graceful-placeholder") {
      const messages = await this.input.storeCall("local-console-store-list-graceful-worker-placeholder", () =>
        this.input.store.listMessages(sessionId));
      const placeholder = planGracefulWorkerPlaceholder(messages, runId);
      if (placeholder.kind === "release") {
        await this.input.storeCall("local-console-store-release-graceful-worker-placeholder", () =>
          this.input.store.releaseMessageForRetry({ userMessageId: placeholder.messageId, sessionId, now: this.input.nowIso() }));
      }
      return;
    }
    await this.recordDetachedTerminal({
      sessionId,
      body: plan.body,
      systemEventKind: plan.systemEventKind,
      runId,
      runDir: result.runDir,
      error: result.reason,
      status: plan.status,
      terminal,
    });
  }

  /**
   * Deterministic dispatch failures (missing agent, broken route, missing
   * retry trigger): retrying cannot change the outcome, so they land as a
   * terminal record immediately.
   */
  async recordStartFailure(message: LocalConsoleMessage, sessionId: string, runId: string, runDir: string | null, error: string): Promise<void> {
    await this.recordFailure(message, sessionId, runId, runDir, error, undefined, null);
  }

  /** Infra failures where the run may simply not have started: eligible for silent auto-retry. */
  async recordRetryableStartFailure(message: LocalConsoleMessage, sessionId: string, runId: string, runDir: string | null, error: string): Promise<void> {
    await this.recordFailureWithAutoRetry(message, sessionId, runId, runDir, error, undefined, null, null);
  }

  /**
   * Terminal-only variant for failures where the run itself already produced a
   * result (e.g. success bookkeeping failed): auto-retry would run the agent a
   * second time, so these always land as a terminal record.
   */
  async recordCompletionFailure(message: LocalConsoleMessage, sessionId: string, runId: string, runDir: string | null, error: string): Promise<void> {
    await this.recordFailure(message, sessionId, runId, runDir, error, undefined, null);
  }

  /**
   * PRD boundary: a failure with no agent-visible output is "did not start" —
   * re-running duplicates nothing the user saw, so it is safe to retry
   * silently. Anything with visible output stays terminal.
   */
  private async recordFailureWithAutoRetry(
    message: LocalConsoleMessage,
    sessionId: string,
    runId: string,
    runDir: string | null,
    error: string,
    body: string | undefined,
    terminal: LocalConsoleTerminal | null,
    observedExternalSessionId: string | null,
  ): Promise<void> {
    const recovery = decideStartFailureRecovery({
      speaker: message.speaker,
      failureCount: message.failureCount,
      partialMarkdown: terminal?.partialMarkdown,
      liveMarkdown: this.input.activeRun(runId)?.liveMarkdown,
      diagnosticBody: body,
      observedExternalSessionId,
      failureRetryLimit: this.input.failureRetryLimit,
    });
    if (recovery.kind === "terminal") {
      await this.recordFailure(message, sessionId, runId, runDir, error, body, terminal);
      return;
    }
    if (recovery.kind === "retry") {
      try {
        await this.input.storeCall("local-console-store-record-retryable-failure", () =>
          this.input.store.recordRetryableFailure(
            { userMessageId: message.id, sessionId, error, runId, runDir, now: this.input.nowIso() },
          ));
        // The message is pending again but the current processing cycle is about
        // to end on this failure; without a kick nothing re-claims it.
        this.input.scheduleReprocess(sessionId);
      } catch (recordError) {
        this.input.recordError("local-console-record-retryable-failure-failed", recordError, error);
        await this.releaseForRetry(message, sessionId);
      }
      return;
    }
    try {
      await this.input.storeCall("local-console-store-record-dead-letter", () =>
        this.input.store.recordDeadLetter(
          { userMessageId: message.id, sessionId, error, runId, runDir, failureCount: recovery.attempt, now: this.input.nowIso() },
        ));
    } catch (recordError) {
      this.input.recordError("local-console-record-dead-letter-failed", recordError, error);
      await this.recordFailure(message, sessionId, runId, runDir, error, body, terminal);
    }
  }

  async recordDetachedStartFailure(input: {
    sessionId: string;
    runId: string;
    runDir: string | null;
    error: string;
  }): Promise<void> {
    await this.recordDetachedTerminal({
      ...input,
      body: "这一步没跑起来。你可以直接告诉主理人下一步怎么处理。",
      systemEventKind: "run-not-started",
      status: "failed",
    });
  }

  private async recordFailure(
    message: LocalConsoleMessage,
    sessionId: string,
    runId: string | null,
    runDir: string | null,
    error: string,
    body: string | undefined,
    terminal: LocalConsoleTerminal | null,
  ): Promise<void> {
    try {
      await this.input.storeCall("local-console-store-record-failure", () => this.input.store.recordFailure({
        userMessageId: message.id,
        sessionId,
        error,
        runId,
        runDir,
        now: this.input.nowIso(),
        ...planFailureRecordFields(body, terminal),
      }));
    } catch (recordError) {
      this.input.recordError("local-console-record-retryable-failure-failed", recordError, error);
      await this.releaseForRetry(message, sessionId);
    }
  }

  private async recordInterrupted(
    message: LocalConsoleMessage,
    sessionId: string,
    runId: string,
    runDir: string,
    reason: string,
    interruptionKind: "user" | "redirect" | "context-unavailable" | "system",
    terminal: LocalConsoleTerminal,
  ): Promise<void> {
    try {
      await this.input.storeCall("local-console-store-record-interrupted", () => this.input.store.recordInterrupted({
        userMessageId: message.id,
        sessionId,
        reason,
        interruptionKind,
        runId,
        runDir,
        now: this.input.nowIso(),
        ...planTerminalRecordField(terminal),
      }));
    } catch (recordError) {
      this.input.recordError("local-console-record-interrupted-failed", recordError, reason);
    }
  }

  private async recordStuck(
    message: LocalConsoleMessage,
    sessionId: string,
    runId: string,
    runDir: string,
    reason: string,
    terminal: LocalConsoleTerminal,
  ): Promise<void> {
    try {
      await this.input.storeCall("local-console-store-record-stuck", () => this.input.store.recordStuck({
        userMessageId: message.id,
        sessionId,
        reason,
        runId,
        runDir,
        now: this.input.nowIso(),
        ...planTerminalRecordField(terminal),
      }));
    } catch (recordError) {
      this.input.recordError("local-console-record-stuck-failed", recordError, reason);
    }
  }

  private async releaseForRetry(message: LocalConsoleMessage, sessionId: string): Promise<void> {
    try {
      await this.input.storeCall("local-console-store-release-retry", () => this.input.store.releaseMessageForRetry({
        userMessageId: message.id,
        sessionId,
        now: this.input.nowIso(),
      }));
    } catch (error) {
      this.input.recordError("local-console-release-retry-failed", error);
    }
  }

  private async recordDetachedTerminal(input: {
    sessionId: string;
    body: string;
    systemEventKind: LocalConsoleSystemEventKind;
    runId: string;
    runDir: string | null;
    error: string;
    status: "failed" | "interrupted" | "stuck";
    terminal?: LocalConsoleTerminal | null;
  }): Promise<void> {
    const decision = decideDetachedTerminalCapability(this.input.store.recordDetachedRunTerminal);
    if (decision.kind === "fallback") {
      await this.input.store.recordSystemMessage({ ...input, now: this.input.nowIso() });
      return;
    }
    await decision.capability.call(this.input.store, { ...input, now: this.input.nowIso() });
  }
}
