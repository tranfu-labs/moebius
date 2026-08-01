import type { CodexRunResult } from "../codex.js";
import { localTerminalFromResult } from "./runtime-domain.js";
import {
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
  }) {}

  async recordDirect(
    message: LocalConsoleMessage,
    sessionId: string,
    runId: string,
    result: Extract<CodexRunResult, { ok: false }>,
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
    await this.recordFailure(message, sessionId, runId, result.runDir, result.reason, plan.body, terminal);
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
    if (plan.kind === "stuck") {
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
      return;
    }
    if (plan.kind === "interrupted") {
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

  private async recordFailure(
    message: LocalConsoleMessage,
    sessionId: string,
    runId: string,
    runDir: string,
    error: string,
    body: string | undefined,
    terminal: LocalConsoleTerminal,
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
    runDir: string;
    error: string;
    status: "failed" | "interrupted" | "stuck";
    terminal: LocalConsoleTerminal;
  }): Promise<void> {
    const decision = decideDetachedTerminalCapability(this.input.store.recordDetachedRunTerminal);
    if (decision.kind === "fallback") {
      await this.input.store.recordSystemMessage({ ...input, now: this.input.nowIso() });
      return;
    }
    await decision.capability.call(this.input.store, { ...input, now: this.input.nowIso() });
  }
}
