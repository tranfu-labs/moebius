import type { CodexRunResult } from "../codex.js";
import { localTerminalFromResult } from "./runtime-domain.js";
import {
  decideDetachedTerminalCapability,
  planDetachedRunFailure,
  planGracefulWorkerPlaceholder,
} from "./run-failure-plan.js";
import { planActiveFailureContext, planTerminalRecord } from "./terminal-record-plan.js";
import type {
  LocalConsoleExecutionProfile,
  LocalConsoleStore,
  LocalConsoleSystemEventKind,
  LocalConsoleTerminal,
} from "./types.js";
import type { LocalRunActivity } from "./run-activity.js";

interface ActiveFailureContext {
  runId: string;
  gracefulResumePrepared: boolean;
  liveMarkdown: string | null;
  profile: LocalConsoleExecutionProfile | null;
}

/**
 * Detached（worker placeholder）运行的失败收口：失败事实挂在独立占位记录上，
 * 不占用主时间线的 source 消息。与直接失败（LocalRunFailureRuntime）分开，
 * 因为它们的生命周期与端口面不同。
 */
export class LocalDetachedRunFailureRuntime {
  constructor(private readonly input: {
    store: LocalConsoleStore;
    storeCall<T>(label: string, operation: () => Promise<T>): Promise<T>;
    nowIso(): string;
    timeoutKind(result: Extract<CodexRunResult, { ok: false }>): "idle" | "tool" | "max-duration" | null;
    interrupted(result: Extract<CodexRunResult, { ok: false }>): boolean;
    interruptionCause(result: Extract<CodexRunResult, { ok: false }>): "user" | "redirect" | "context-unavailable" | "runtime-closing" | "system" | null;
    activeRun(runId: string): ActiveFailureContext | undefined;
    recordError(event: string, error: unknown, originalError?: string): void;
  }) {}

  async recordDetached(
    sessionId: string,
    runId: string,
    result: Extract<CodexRunResult, { ok: false }>,
    role: string | null = null,
    processSteps: readonly LocalRunActivity[] = [],
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
      role,
      processSteps,
    });
  }

  async recordDetachedStartFailure(input: {
    sessionId: string;
    runId: string;
    runDir: string | null;
    error: string;
    role?: string | null;
    processSteps?: readonly LocalRunActivity[];
  }): Promise<void> {
    const record = planTerminalRecord(input);
    await this.recordDetachedTerminal({
      ...input,
      body: "这一步没跑起来。你可以直接告诉主理人下一步怎么处理。",
      systemEventKind: "run-not-started",
      status: "failed",
      role: record.role,
      processSteps: record.processSteps,
    });
  }

  private async recordDetachedTerminal(input: {
    sessionId: string;
    body: string;
    systemEventKind: LocalConsoleSystemEventKind;
    runId: string;
    runDir: string | null;
    error: string;
    status: "failed" | "interrupted" | "stuck";
    role: string | null;
    processSteps: readonly LocalRunActivity[];
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
