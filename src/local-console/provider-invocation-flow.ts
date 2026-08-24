import type { CodexRunResult } from "../codex.js";
import type { ClaudeTuiNativePromptDecision } from "../claude.js";
import type { ClaudeTuiTerminalData } from "../claude-tui-transport.js";
import type { ExecutionProgressEvent } from "../execution-contract.js";
import {
  decideLocalProviderCheckpoint,
  decideLocalProviderTrace,
  planLocalCodexLinkContextFingerprint,
  planLocalKimiProviderFallback,
  planLocalProviderInvocationStart,
  planLocalProviderSessionFacts,
  planProviderTracePath,
} from "./provider-invocation-plan.js";
import {
  type LocalAgentSessionLinkFact,
  type LocalExecutionSessionLinkFact,
  type LocalProviderInvocationFact,
  type LocalProviderSessionObservedFact,
  type LocalRunExecutionContextFact,
} from "./execution-context.js";
import type { LocalExecutionEngine } from "./execution-driver.js";
import type { LocalRunInvocationPlan } from "./run-invocation-plan.js";

export interface LocalProviderInvocationCallbacks {
  onVisibleAgentMarkdown(text: string): void;
  onTerminalData?(data: ClaudeTuiTerminalData): void;
  onNativePrompt?(decision: ClaudeTuiNativePromptDecision): void;
  onProcessStarted(): void | Promise<void>;
  onStructuredActivity(event: unknown): void;
  onExecutionProgress(event: ExecutionProgressEvent): void;
  onSessionStarted(input: { engine: LocalExecutionEngine; externalSessionId: string }): Promise<void>;
  onExecutionTraceReady(input: {
    engine: LocalExecutionEngine;
    externalSessionId: string;
    tracePath?: string;
  }): Promise<void>;
}

export interface LocalProviderInvocationFlowInput {
  sessionId: string;
  runId: string;
  sourceMessageId: number;
  role: string;
  runDir: string;
  continuingSameRun: boolean;
  executionContext: LocalRunExecutionContextFact;
  invocationPlan: Extract<LocalRunInvocationPlan, { kind: "ready" }>;
}

export interface LocalProviderInvocationFlowPorts {
  nowIso(): string;
  releaseIfStopping(): Promise<boolean>;
  recordProviderInvocation(fact: LocalProviderInvocationFact): Promise<void>;
  runProvider(callbacks: LocalProviderInvocationCallbacks): Promise<CodexRunResult>;
  onVisibleAgentMarkdown(text: string): () => Promise<void>;
  onTerminalData?(data: ClaudeTuiTerminalData): void;
  onNativePrompt?(decision: ClaudeTuiNativePromptDecision): void;
  onProcessStarted(): void | Promise<void>;
  onStructuredActivity(event: unknown): void;
  onExecutionProgress(event: ExecutionProgressEvent): void;
  setActiveExternalSessionId(externalSessionId: string): void;
  recordProviderSessionObserved(fact: LocalProviderSessionObservedFact): Promise<void>;
  recordAgentSessionLink(fact: LocalAgentSessionLinkFact): Promise<void>;
  recordExecutionSessionLink(fact: LocalExecutionSessionLinkFact): Promise<void>;
  recordCodexThreadLink(fact: {
    sessionId: string;
    runId: string;
    sourceMessageId: number;
    role: string;
    threadId: string;
    startedAt: string;
    contextFingerprint: string;
  }): Promise<void>;
}

export type LocalProviderInvocationFlowResult =
  | { kind: "stopped" }
  | {
      kind: "completed";
      result: CodexRunResult;
      observedExternalSessionId: string | null;
      executionTraceExternalSessionId: string | null;
    };

export async function executeLocalProviderInvocationFlow(
  input: LocalProviderInvocationFlowInput,
  ports: LocalProviderInvocationFlowPorts,
): Promise<LocalProviderInvocationFlowResult> {
  const beforeStart = decideLocalProviderCheckpoint(await ports.releaseIfStopping());
  if (beforeStart.kind === "stop") return { kind: "stopped" };
  await ports.recordProviderInvocation(planLocalProviderInvocationStart({
    sessionId: input.sessionId,
    runId: input.runId,
    runDir: input.runDir,
    role: input.role,
    executionContext: input.executionContext,
    invocationPlan: input.invocationPlan,
    recordedAt: ports.nowIso(),
  }));
  const afterStart = decideLocalProviderCheckpoint(await ports.releaseIfStopping());
  if (afterStart.kind === "stop") return { kind: "stopped" };

  let progressFactTail = Promise.resolve();
  let observedExternalSessionId: string | null = null;
  let executionTraceExternalSessionId: string | null = null;
  const sessionFactPlan = planLocalProviderSessionFacts(input.continuingSameRun);
  const result = await (async () => {
    try {
      return await ports.runProvider({
        onVisibleAgentMarkdown: (text) => {
          progressFactTail = progressFactTail.then(ports.onVisibleAgentMarkdown(text));
        },
        onTerminalData: (data) => ports.onTerminalData?.(data),
        onNativePrompt: ports.onNativePrompt,
        onProcessStarted: () => ports.onProcessStarted(),
        onStructuredActivity: (event) => ports.onStructuredActivity(event),
        onExecutionProgress: (event) => ports.onExecutionProgress(event),
        onSessionStarted: async ({ engine, externalSessionId }) => {
          observedExternalSessionId = externalSessionId;
          ports.setActiveExternalSessionId(externalSessionId);
          if (sessionFactPlan.kind === "skip") return;
          await ports.recordProviderSessionObserved({
            sessionId: input.sessionId,
            runId: input.runId,
            sourceMessageId: input.sourceMessageId,
            role: input.role,
            engine,
            externalSessionId,
            observedAt: ports.nowIso(),
            agentIdentityFingerprint: input.executionContext.agentIdentityFingerprint,
            contextFingerprint: input.executionContext.contextFingerprint,
          });
          await ports.recordAgentSessionLink({
            sessionId: input.sessionId,
            agentIdentityFingerprint: input.executionContext.agentIdentityFingerprint,
            role: input.role,
            engine,
            externalSessionId,
            profileFingerprint: input.executionContext.profileFingerprint,
            contextFingerprint: input.executionContext.contextFingerprint,
            linkedAt: ports.nowIso(),
          });
        },
        onExecutionTraceReady: async ({ engine, externalSessionId, tracePath }) => {
          const traceDecision = decideLocalProviderTrace({
            engine,
            externalSessionId,
            observedExternalSessionId,
            executionTraceExternalSessionId,
            continuingSameRun: input.continuingSameRun,
          });
          if (traceDecision.kind === "error") throw new Error(traceDecision.reason);
          executionTraceExternalSessionId = traceDecision.externalSessionId;
          if (traceDecision.recordExecutionLink) {
            await ports.recordExecutionSessionLink({
              sessionId: input.sessionId,
              runId: input.runId,
              sourceMessageId: input.sourceMessageId,
              role: input.role,
              engine,
              externalSessionId,
              ...planProviderTracePath(tracePath),
              startedAt: ports.nowIso(),
              profileFingerprint: input.executionContext.profileFingerprint,
              agentIdentityFingerprint: input.executionContext.agentIdentityFingerprint,
              contextFingerprint: input.executionContext.contextFingerprint,
            });
          }
          if (traceDecision.recordCodexLink) {
            await ports.recordCodexThreadLink({
              sessionId: input.sessionId,
              runId: input.runId,
              sourceMessageId: input.sourceMessageId,
              role: input.role,
              threadId: externalSessionId,
              startedAt: ports.nowIso(),
              contextFingerprint: planLocalCodexLinkContextFingerprint(input.executionContext),
            });
          }
        },
      });
    } finally {
      await progressFactTail;
    }
  })();

  const kimiFallback = planLocalKimiProviderFallback({
    result,
    engine: input.executionContext.engine,
    continuingSameRun: input.continuingSameRun,
    observedExternalSessionId,
    executionTraceExternalSessionId,
  });
  if (kimiFallback.kind === "record") {
    if (kimiFallback.recordObserved) {
      observedExternalSessionId = kimiFallback.externalSessionId;
      await ports.recordProviderSessionObserved({
        sessionId: input.sessionId,
        runId: input.runId,
        sourceMessageId: input.sourceMessageId,
        role: input.role,
        engine: input.executionContext.engine,
        externalSessionId: kimiFallback.externalSessionId,
        observedAt: ports.nowIso(),
        agentIdentityFingerprint: input.executionContext.agentIdentityFingerprint,
        contextFingerprint: input.executionContext.contextFingerprint,
      });
      await ports.recordAgentSessionLink({
        sessionId: input.sessionId,
        agentIdentityFingerprint: input.executionContext.agentIdentityFingerprint,
        role: input.role,
        engine: input.executionContext.engine,
        externalSessionId: kimiFallback.externalSessionId,
        profileFingerprint: input.executionContext.profileFingerprint,
        contextFingerprint: input.executionContext.contextFingerprint,
        linkedAt: ports.nowIso(),
      });
    }
    if (kimiFallback.recordExecutionLink) {
      executionTraceExternalSessionId = kimiFallback.externalSessionId;
      await ports.recordExecutionSessionLink({
        sessionId: input.sessionId,
        runId: input.runId,
        sourceMessageId: input.sourceMessageId,
        role: input.role,
        engine: input.executionContext.engine,
        externalSessionId: kimiFallback.externalSessionId,
        startedAt: ports.nowIso(),
        profileFingerprint: input.executionContext.profileFingerprint,
        agentIdentityFingerprint: input.executionContext.agentIdentityFingerprint,
        contextFingerprint: input.executionContext.contextFingerprint,
      });
    }
  }
  return { kind: "completed", result, observedExternalSessionId, executionTraceExternalSessionId };
}
