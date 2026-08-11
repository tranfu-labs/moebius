import type { CodexRunResult } from "../codex.js";
import type { ActiveLocalRun } from "./active-run.js";
import type { LocalProviderInvocationFact } from "./execution-context.js";
import { executeLocalRunTerminalFlow, type LocalRunTerminalChildCard } from "./run-terminal-flow.js";
import { planTerminalRecord } from "./terminal-record-plan.js";
import type { LocalPreparedWorkerRun } from "./worker-preparation-runtime.js";
import type { LocalWorkerRunInput } from "./worker-dispatch-runtime.js";
import {
  decideWorkerDetachedCapability,
  decideWorkerOriginEffect,
  decideWorkerRecoveryPersistence,
  decideWorkerSuccessPersistence,
  planWorkerGracefulResume,
  planWorkerLastSeenIndex,
  planWorkerSourceDisposition,
} from "./worker-runtime-plan.js";
import type { LocalConsoleStore } from "./types.js";

interface WorkerRecoveryUsageStore {
  recordCodexRunUsage(input: {
    sessionId: string;
    runId: string;
    cachedInputTokens: number | null;
    recordedAt: string;
  }): Promise<void>;
}

export class LocalWorkerTerminalRuntime {
  constructor(private readonly input: {
    store: LocalConsoleStore;
    storeCall<T>(label: string, operation: () => Promise<T>): Promise<T>;
    nowIso(): string;
    activeRun(runId: string): ActiveLocalRun | undefined;
    recoveryStore(): WorkerRecoveryUsageStore | null;
    recordProviderInvocation(fact: LocalProviderInvocationFact): Promise<void>;
    classifyFailure(result: Extract<CodexRunResult, { ok: false }>): {
      runtimeClosing: boolean;
      failureStatus: "failed" | "interrupted" | "stuck" | "paused";
    };
    pauseLifecycle(runId: string): Promise<void>;
    finishLifecycle(runId: string, status: "completed" | "failed" | "interrupted" | "stuck" | "paused"): Promise<void>;
    recordDirectFailure(
      input: LocalWorkerRunInput,
      result: Extract<CodexRunResult, { ok: false }>,
      processSteps: readonly import("./run-activity.js").LocalRunActivity[],
    ): Promise<void>;
    recordDetachedFailure(
      input: LocalWorkerRunInput,
      result: Extract<CodexRunResult, { ok: false }>,
      processSteps: readonly import("./run-activity.js").LocalRunActivity[],
    ): Promise<void>;
    sourceDirectoryAvailable(sessionId: string): Promise<boolean>;
    executeChildSession(input: LocalWorkerRunInput, runDir: string, result: Extract<CodexRunResult, { ok: true }>): Promise<LocalRunTerminalChildCard | null>;
    recordWorkspaceDiff(input: LocalWorkerRunInput, preparation: LocalPreparedWorkerRun, result: Extract<CodexRunResult, { ok: true }>): Promise<void>;
    recordTimelineCursor(input: LocalWorkerRunInput, agentIdentityFingerprint: string, lastSeenIndex: number): Promise<void>;
    recordChildSessionCard(input: LocalWorkerRunInput, card: LocalRunTerminalChildCard, result: Extract<CodexRunResult, { ok: true }>): Promise<void>;
  }) {}

  async complete(input: LocalWorkerRunInput, preparation: LocalPreparedWorkerRun, provider: {
    result: CodexRunResult;
    observedExternalSessionId: string | null;
  }): Promise<"failed" | "succeeded" | "succeeded-directory-unavailable"> {
    // Freeze the accumulated steps once, before the lifecycle removes the run:
    // the trail is a property of the finished message, not a live stream. The
    // decision (which role, which steps) belongs to the domain, not to this runtime.
    const terminalRecord = planTerminalRecord({
      role: input.role,
      activeRun: this.input.activeRun(input.runId),
    });
    return await executeLocalRunTerminalFlow({
      sessionId: input.sessionId,
      runId: input.runId,
      runDir: preparation.runDir,
      sourceMessageId: input.sourceMessage.id,
      role: input.role,
      sourceDisposition: planWorkerSourceDisposition(input.origin),
      executionContext: preparation.executionContext,
      recoveryPlan: preparation.recoveryPlan,
      observedExternalSessionId: provider.observedExternalSessionId,
      result: provider.result,
      gracefulResumePrepared: planWorkerGracefulResume(this.input.activeRun(input.runId)),
      lastSeenIndex: planWorkerLastSeenIndex(input.timeline),
    }, {
      nowIso: () => this.input.nowIso(),
      recordProviderInvocation: (fact) => this.input.recordProviderInvocation(fact),
      classifyFailure: (result) => this.input.classifyFailure(result),
      pauseLifecycle: () => this.input.pauseLifecycle(input.runId),
      finishLifecycle: (status) => this.input.finishLifecycle(input.runId, status),
      recordFailed: (result) => this.recordFailure(input, result, terminalRecord.processSteps),
      recordUsage: (cachedInputTokens) => this.recordUsage(input, cachedInputTokens),
      sourceDirectoryAvailable: () => this.input.sourceDirectoryAvailable(input.sessionId),
      executeChildSession: (result) => this.input.executeChildSession(input, preparation.runDir, result),
      recordWorkspaceDiff: (result) => this.input.recordWorkspaceDiff(input, preparation, result),
      recordSuccess: (kind, result) => this.recordSuccess(input, kind, result, terminalRecord.processSteps),
      onSuccessPersistenceError: async () => undefined,
      recordTimelineCursor: (lastSeenIndex) => this.input.recordTimelineCursor(
        input,
        preparation.executionContext.agentIdentityFingerprint,
        lastSeenIndex,
      ),
      recordChildSessionCard: (card, result) => this.input.recordChildSessionCard(input, card, result),
      onChildSessionCardError: async () => undefined,
      recordDirectoryWarning: (result) => this.input.storeCall("local-console-store-worker-directory-unavailable", () =>
        this.input.store.recordSystemMessage({
          sessionId: input.sessionId,
          body: "项目文件夹不可用；隔离工作区已完成当前步骤，修复项目文件夹后才能继续。",
          systemEventKind: "other",
          runId: input.runId,
          runDir: result.runDir,
          error: "PROJECT_DIRECTORY_UNAVAILABLE",
          status: "failed",
          role: terminalRecord.role,
          processSteps: terminalRecord.processSteps,
          now: this.input.nowIso(),
        })),
    });
  }

  private async recordFailure(
    input: LocalWorkerRunInput,
    result: Extract<CodexRunResult, { ok: false }>,
    processSteps: readonly import("./run-activity.js").LocalRunActivity[],
  ): Promise<void> {
    const origin = decideWorkerOriginEffect(input.origin);
    if (origin.kind === "direct") await this.input.recordDirectFailure(input, result, processSteps);
    else await this.input.recordDetachedFailure(input, result, processSteps);
  }

  private async recordUsage(input: LocalWorkerRunInput, cachedInputTokens: number | null): Promise<void> {
    const store = this.input.recoveryStore();
    const persistence = decideWorkerRecoveryPersistence(store !== null);
    if (persistence.kind === "skip") return;
    await this.input.storeCall("local-console-store-record-worker-codex-usage", () => store!.recordCodexRunUsage({
      sessionId: input.sessionId,
      runId: input.runId,
      cachedInputTokens,
      recordedAt: this.input.nowIso(),
    }));
  }

  private async recordSuccess(
    input: LocalWorkerRunInput,
    kind: "processed" | "direct-response" | "detached-response",
    result: Extract<CodexRunResult, { ok: true }>,
    processSteps: readonly import("./run-activity.js").LocalRunActivity[],
  ): Promise<void> {
    const persistence = decideWorkerSuccessPersistence(kind);
    if (persistence.kind === "processed") {
      await this.input.storeCall("local-console-store-record-worker-tool-only-complete", () =>
        this.input.store.recordMessageProcessed(this.processedInput(input, result.runDir)));
      return;
    }
    if (persistence.kind === "direct") {
      await this.input.storeCall("local-console-store-record-direct-worker-response", () =>
        this.input.store.recordAgentResponse({
          ...this.processedInput(input, result.runDir),
          role: input.role,
          body: result.finalText,
          processSteps,
        }));
      return;
    }
    const capability = decideWorkerDetachedCapability(this.input.store.recordDetachedAgentResponse !== undefined);
    if (capability.kind === "missing") throw new Error("local console detached agent response store capability unavailable");
    await this.input.storeCall("local-console-store-record-worker-response", () =>
      this.input.store.recordDetachedAgentResponse!.call(this.input.store, {
        sessionId: input.sessionId,
        role: input.role,
        body: result.finalText,
        runId: input.runId,
        runDir: result.runDir,
        processSteps,
        now: this.input.nowIso(),
      }));
  }

  private processedInput(input: LocalWorkerRunInput, runDir: string) {
    return {
      userMessageId: input.sourceMessage.id,
      sessionId: input.sessionId,
      runId: input.runId,
      runDir,
      now: this.input.nowIso(),
    };
  }
}
