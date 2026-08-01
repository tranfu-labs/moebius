import type { CodexRunResult } from "../codex.js";
import { localTerminalFromResult } from "./runtime-domain.js";
import {
  planActiveFailureContext,
  planDetachedRunFailure,
  planDirectRunFailure,
  planGracefulWorkerPlaceholder,
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
    recordStuck(message: LocalConsoleMessage, sessionId: string, runId: string, runDir: string, reason: string, terminal: LocalConsoleTerminal): Promise<void>;
    recordInterrupted(message: LocalConsoleMessage, sessionId: string, runId: string, runDir: string, reason: string, cause: "context-unavailable" | "redirect" | "user" | "system", terminal: LocalConsoleTerminal): Promise<void>;
    recordFailure(message: LocalConsoleMessage, sessionId: string, runId: string, runDir: string, reason: string, body: string | undefined, terminal: LocalConsoleTerminal): Promise<void>;
    recordDetached(input: {
      sessionId: string;
      body: string;
      systemEventKind: LocalConsoleSystemEventKind;
      runId: string;
      runDir: string;
      error: string;
      status: "failed" | "interrupted" | "stuck";
      terminal: LocalConsoleTerminal;
    }): Promise<void>;
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
      await this.input.recordStuck(message, sessionId, runId, result.runDir, result.reason, terminal);
      return;
    }
    if (plan.kind === "skip-graceful") return;
    if (plan.kind === "interrupted") {
      await this.input.recordInterrupted(
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
    await this.input.recordFailure(message, sessionId, runId, result.runDir, result.reason, plan.body, terminal);
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
      await this.input.recordDetached({
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
      await this.input.recordDetached({
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
    await this.input.recordDetached({
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
}
