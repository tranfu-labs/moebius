import type { CodexRunResult } from "../codex.js";
import type { ActiveLocalRun } from "./active-run.js";
import type { LocalProviderInvocationFact } from "./execution-context.js";
import type { LocalPreparedPrimaryRun, LocalPrimaryRunInput } from "./primary-preparation-runtime.js";
import {
  decidePrimaryRecoveryPersistence,
  decidePrimarySuccessPersistence,
  planPrimaryGracefulResume,
  planPrimaryLastSeenIndex,
} from "./primary-runtime-plan.js";
import { executeLocalRunTerminalFlow, type LocalRunTerminalChildCard } from "./run-terminal-flow.js";
import type { LocalConsoleStore } from "./types.js";

interface PrimaryRecoveryUsageStore {
  recordCodexRunUsage(input: {
    sessionId: string;
    runId: string;
    cachedInputTokens: number | null;
    recordedAt: string;
  }): Promise<void>;
}

export class LocalPrimaryTerminalRuntime {
  constructor(private readonly input: {
    store: LocalConsoleStore;
    storeCall<T>(label: string, operation: () => Promise<T>): Promise<T>;
    nowIso(): string;
    activeRun(runId: string): ActiveLocalRun | undefined;
    recoveryStore(): PrimaryRecoveryUsageStore | null;
    recordProviderInvocation(fact: LocalProviderInvocationFact): Promise<void>;
    classifyFailure(result: Extract<CodexRunResult, { ok: false }>): {
      runtimeClosing: boolean;
      failureStatus: "failed" | "interrupted" | "stuck" | "paused";
    };
    pauseLifecycle(runId: string): Promise<void>;
    finishLifecycle(runId: string, status: "completed" | "failed" | "interrupted" | "stuck" | "paused"): Promise<void>;
    recordFailure(run: LocalPrimaryRunInput, result: Extract<CodexRunResult, { ok: false }>): Promise<void>;
    sourceDirectoryAvailable(sessionId: string): Promise<boolean>;
    executeChildSession(
      run: LocalPrimaryRunInput,
      result: Extract<CodexRunResult, { ok: true }>,
    ): Promise<LocalRunTerminalChildCard | null>;
    recordWorkspaceDiff(
      run: LocalPrimaryRunInput,
      preparation: LocalPreparedPrimaryRun,
      result: Extract<CodexRunResult, { ok: true }>,
    ): Promise<void>;
    recordTimelineCursor(run: LocalPrimaryRunInput, agentIdentityFingerprint: string, lastSeenIndex: number): Promise<void>;
    recordChildSessionCard(
      run: LocalPrimaryRunInput,
      card: LocalRunTerminalChildCard,
      result: Extract<CodexRunResult, { ok: true }>,
    ): Promise<void>;
    recordChildSessionCardError(sessionId: string, error: unknown): Promise<void>;
  }) {}

  async complete(
    run: LocalPrimaryRunInput,
    preparation: LocalPreparedPrimaryRun,
    provider: { result: CodexRunResult; observedExternalSessionId: string | null },
    onSuccessPersistenceError: (
      error: unknown,
      result: Extract<CodexRunResult, { ok: true }>,
    ) => Promise<void>,
  ): Promise<"failed" | "succeeded" | "succeeded-directory-unavailable"> {
    return await executeLocalRunTerminalFlow({
      sessionId: run.sessionId,
      runId: run.runId,
      runDir: preparation.resolvedRunDir,
      sourceMessageId: run.sourceMessage.id,
      role: run.role,
      sourceDisposition: "primary",
      executionContext: preparation.executionContext,
      recoveryPlan: preparation.recoveryPlan,
      observedExternalSessionId: provider.observedExternalSessionId,
      result: provider.result,
      gracefulResumePrepared: planPrimaryGracefulResume(this.input.activeRun(run.runId)),
      lastSeenIndex: planPrimaryLastSeenIndex(run.timeline),
    }, {
      nowIso: () => this.input.nowIso(),
      recordProviderInvocation: (fact) => this.input.recordProviderInvocation(fact),
      classifyFailure: (result) => this.input.classifyFailure(result),
      pauseLifecycle: () => this.input.pauseLifecycle(run.runId),
      finishLifecycle: (status) => this.input.finishLifecycle(run.runId, status),
      recordFailed: (result) => this.input.recordFailure(run, result),
      recordUsage: (cachedInputTokens) => this.recordUsage(run, cachedInputTokens),
      sourceDirectoryAvailable: () => this.input.sourceDirectoryAvailable(run.sessionId),
      executeChildSession: (result) => this.input.executeChildSession(run, result),
      recordWorkspaceDiff: (result) => this.input.recordWorkspaceDiff(run, preparation, result),
      recordSuccess: (kind, result) => this.recordSuccess(run, kind, result),
      onSuccessPersistenceError,
      recordTimelineCursor: (lastSeenIndex) => this.input.recordTimelineCursor(
        run,
        preparation.executionContext.agentIdentityFingerprint,
        lastSeenIndex,
      ),
      recordChildSessionCard: (card, result) => this.input.recordChildSessionCard(run, card, result),
      onChildSessionCardError: (error) => this.input.recordChildSessionCardError(run.sessionId, error),
      recordDirectoryWarning: (result) => this.input.storeCall("local-console-store-directory-unavailable", () =>
        this.input.store.recordSystemMessage({
          sessionId: run.sessionId,
          body: "项目文件夹不可用；隔离工作区已完成当前步骤，修复项目文件夹后才能继续。",
          systemEventKind: "other",
          runId: run.runId,
          runDir: result.runDir,
          error: "PROJECT_DIRECTORY_UNAVAILABLE",
          status: "failed",
          now: this.input.nowIso(),
        })),
    });
  }

  private async recordUsage(run: LocalPrimaryRunInput, cachedInputTokens: number | null): Promise<void> {
    const store = this.input.recoveryStore();
    const persistence = decidePrimaryRecoveryPersistence(store !== null);
    if (persistence.kind === "skip") return;
    await this.input.storeCall("local-console-store-record-codex-usage", () =>
      store!.recordCodexRunUsage({
        sessionId: run.sessionId,
        runId: run.runId,
        cachedInputTokens,
        recordedAt: this.input.nowIso(),
      }));
  }

  private async recordSuccess(
    run: LocalPrimaryRunInput,
    kind: "processed" | "direct-response" | "detached-response",
    result: Extract<CodexRunResult, { ok: true }>,
  ): Promise<void> {
    const persistence = decidePrimarySuccessPersistence(kind);
    if (persistence.kind === "processed") {
      await this.input.storeCall("local-console-store-record-tool-only-complete", () =>
        this.input.store.recordMessageProcessed({
          userMessageId: run.sourceMessage.id,
          sessionId: run.sessionId,
          runId: run.runId,
          runDir: result.runDir,
          now: this.input.nowIso(),
        }));
      return;
    }
    await this.input.storeCall("local-console-store-record-agent-response", () =>
      this.input.store.recordAgentResponse({
        userMessageId: run.sourceMessage.id,
        sessionId: run.sessionId,
        role: run.role,
        body: result.finalText,
        runId: run.runId,
        runDir: result.runDir,
        now: this.input.nowIso(),
      }));
  }
}
