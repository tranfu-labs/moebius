import {
  executionInterruptionCauseForResult,
  executionTimeoutKind,
  isInterruptedCodexRunResult,
  type CodexRunResult,
} from "../codex.js";
import { log } from "../log.js";
import { localTerminalFromResult } from "./runtime-domain.js";
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
    const active = this.input.activeRun(runId);
    const terminal = localTerminalFromResult(result, active?.liveMarkdown ?? null, active?.profile ?? null);
    const timeoutKind = executionTimeoutKind(result);
    if (timeoutKind !== null) {
      log({
        event: timeoutKind === "idle" ? "local-console-codex-idle-timeout" : "local-console-codex-watchdog-timeout",
        runDir: result.runDir,
        reason: result.reason,
      });
      await this.input.recordStuck(message, sessionId, runId, result.runDir, result.reason, terminal);
      return;
    }
    if (isInterruptedCodexRunResult(result)) {
      const cause = executionInterruptionCauseForResult(result);
      if (cause === "runtime-closing" && active?.runId === runId && active.gracefulResumePrepared) return;
      await this.input.recordInterrupted(
        message,
        sessionId,
        runId,
        result.runDir,
        result.reason,
        cause === "context-unavailable" ? "context-unavailable" : cause === "redirect" ? "redirect" : cause === "user" ? "user" : "system",
        terminal,
      );
      return;
    }
    await this.input.recordFailure(message, sessionId, runId, result.runDir, result.reason, result.failure?.message, terminal);
  }

  async recordDetached(
    sessionId: string,
    runId: string,
    result: Extract<CodexRunResult, { ok: false }>,
  ): Promise<void> {
    const active = this.input.activeRun(runId);
    const terminal = localTerminalFromResult(result, active?.liveMarkdown ?? null, active?.profile ?? null);
    const cause = executionInterruptionCauseForResult(result);
    if (cause === "runtime-closing" && active?.gracefulResumePrepared) {
      const messages = await this.input.storeCall("local-console-store-list-graceful-worker-placeholder", () =>
        this.input.store.listMessages(sessionId));
      const placeholder = messages.find((message) => message.runId === runId && message.sourceKind === "local-worker-run");
      if (placeholder !== undefined) {
        await this.input.storeCall("local-console-store-release-graceful-worker-placeholder", () =>
          this.input.store.releaseMessageForRetry({ userMessageId: placeholder.id, sessionId, now: this.input.nowIso() }));
      }
      return;
    }
    const timeoutKind = executionTimeoutKind(result);
    if (timeoutKind !== null) {
      await this.input.recordDetached({
        sessionId,
        body: result.terminal?.kind === "timeout" && result.terminal.basis === "tool"
          ? "这一步的工具调用运行过久，已经停下。你可以直接告诉主理人下一步怎么处理。"
          : "这一步卡住了。你可以直接告诉主理人下一步怎么处理。",
        systemEventKind: "run-stuck",
        runId,
        runDir: result.runDir,
        error: result.reason,
        status: "stuck",
        terminal,
      });
      return;
    }
    if (isInterruptedCodexRunResult(result)) {
      const contextUnavailable = cause === "context-unavailable";
      const redirected = cause === "redirect";
      const systemStopped = cause === "runtime-closing" || cause === "system";
      await this.input.recordDetached({
        sessionId,
        body: contextUnavailable
          ? "这一步依赖的项目或团队内容已经不可用，因此已停止。已经产生的文件改动会保留。"
          : redirected
            ? "主理人发来了新的指令，当前这一步已经停下；这个成员会带着新指令重新开始。"
            : systemStopped
              ? "这一步被系统停止了。已经产生的文件改动会保留。"
              : "你让这一步停下了。已经产生的文件改动会保留。",
        systemEventKind: redirected || contextUnavailable || systemStopped ? "other" : "user-stopped",
        runId,
        runDir: result.runDir,
        error: result.reason,
        status: "interrupted",
        terminal,
      });
      return;
    }
    await this.input.recordDetached({
      sessionId,
      body: result.failure?.message ?? "这一步没跑起来。你可以直接告诉主理人下一步怎么处理。",
      systemEventKind: "run-not-started",
      runId,
      runDir: result.runDir,
      error: result.reason,
      status: "failed",
      terminal,
    });
  }
}
