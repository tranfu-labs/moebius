import type { CodexRunResult } from "../codex.js";
import type { LocalRunSourceDisposition } from "./codex-resume.js";
import type { LocalExecutionRecoveryPlan, LocalProviderInvocationFact, LocalRunExecutionContextFact } from "./execution-context.js";
import { planLocalProviderInvocationTerminal } from "./provider-invocation-plan.js";
import {
  decideLocalFailedRunLifecycle,
  planLocalChildSessionCardPersistence,
  planLocalRunSuccessEffects,
  planLocalRunTerminalOutcome,
  planLocalRunUsage,
  type LocalRunSuccessResponseKind,
} from "./run-terminal-plan.js";

export interface LocalRunTerminalChildCard {
  sourceId: string;
  childSessionIds: string[];
}

export interface LocalRunTerminalFlowInput {
  sessionId: string;
  runId: string;
  runDir: string;
  sourceMessageId: number;
  role: string;
  sourceDisposition: LocalRunSourceDisposition;
  executionContext: LocalRunExecutionContextFact;
  recoveryPlan: Exclude<LocalExecutionRecoveryPlan, { kind: "unavailable" }>;
  observedExternalSessionId: string | null;
  result: CodexRunResult;
  gracefulResumePrepared: boolean;
  lastSeenIndex: number;
}

export interface LocalRunTerminalFlowPorts {
  nowIso(): string;
  recordProviderInvocation(fact: LocalProviderInvocationFact): Promise<void>;
  classifyFailure(result: Extract<CodexRunResult, { ok: false }>): {
    runtimeClosing: boolean;
    failureStatus: "failed" | "interrupted" | "stuck";
  };
  pauseLifecycle(): Promise<void>;
  finishLifecycle(status: "completed" | "failed" | "interrupted" | "stuck"): Promise<void>;
  recordFailed(result: Extract<CodexRunResult, { ok: false }>): Promise<void>;
  recordUsage(cachedInputTokens: number | null): Promise<void>;
  sourceDirectoryAvailable(): Promise<boolean>;
  executeChildSession(result: Extract<CodexRunResult, { ok: true }>): Promise<LocalRunTerminalChildCard | null>;
  recordWorkspaceDiff(result: Extract<CodexRunResult, { ok: true }>): Promise<void>;
  recordSuccess(kind: LocalRunSuccessResponseKind, result: Extract<CodexRunResult, { ok: true }>): Promise<void>;
  onSuccessPersistenceError(error: unknown, result: Extract<CodexRunResult, { ok: true }>): Promise<void>;
  recordTimelineCursor(lastSeenIndex: number): Promise<void>;
  recordChildSessionCard(card: LocalRunTerminalChildCard, result: Extract<CodexRunResult, { ok: true }>): Promise<void>;
  onChildSessionCardError(error: unknown): Promise<void>;
  recordDirectoryWarning(result: Extract<CodexRunResult, { ok: true }>): Promise<void>;
}

export async function executeLocalRunTerminalFlow(
  input: LocalRunTerminalFlowInput,
  ports: LocalRunTerminalFlowPorts,
): Promise<void> {
  await ports.recordProviderInvocation(planLocalProviderInvocationTerminal({
    sessionId: input.sessionId,
    runId: input.runId,
    runDir: input.runDir,
    role: input.role,
    executionContext: input.executionContext,
    recoveryPlan: input.recoveryPlan,
    observedExternalSessionId: input.observedExternalSessionId,
    resultOk: input.result.ok,
    recordedAt: ports.nowIso(),
  }));
  const terminalOutcome = planLocalRunTerminalOutcome(input.result);
  if (terminalOutcome.kind === "failed") {
    const classification = ports.classifyFailure(terminalOutcome.result);
    const lifecycle = decideLocalFailedRunLifecycle({
      ...classification,
      gracefulResumePrepared: input.gracefulResumePrepared,
    });
    if (lifecycle.kind === "pause") await ports.pauseLifecycle();
    else await ports.finishLifecycle(lifecycle.status);
    await ports.recordFailed(terminalOutcome.result);
    return;
  }

  await ports.finishLifecycle("completed");
  const usagePlan = planLocalRunUsage(input.executionContext.engine);
  if (usagePlan.kind === "record") {
    await ports.recordUsage(terminalOutcome.result.cachedInputTokens);
  }
  const sourceDirectoryAvailable = await ports.sourceDirectoryAvailable();
  const effects = planLocalRunSuccessEffects({
    sourceDisposition: input.sourceDisposition,
    role: input.role,
    terminalToolOnly: terminalOutcome.terminalToolOnly,
    sourceDirectoryAvailable,
  });
  const childSessionCard = effects.recordChildSession
    ? await ports.executeChildSession(terminalOutcome.result)
    : null;
  if (effects.recordWorkspaceDiff) await ports.recordWorkspaceDiff(terminalOutcome.result);
  try {
    await ports.recordSuccess(effects.responseKind, terminalOutcome.result);
    await ports.recordTimelineCursor(input.lastSeenIndex);
  } catch (error) {
    await ports.onSuccessPersistenceError(error, terminalOutcome.result);
    throw error;
  }
  const childCardPersistence = planLocalChildSessionCardPersistence(childSessionCard);
  if (childCardPersistence.kind === "record") {
    try {
      await ports.recordChildSessionCard(childCardPersistence.card, terminalOutcome.result);
    } catch (error) {
      await ports.onChildSessionCardError(error);
      throw error;
    }
  }
  if (effects.recordDirectoryWarning) await ports.recordDirectoryWarning(terminalOutcome.result);
}
