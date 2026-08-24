import type { CodexRunResult } from "../codex.js";
import type { ClaudeTuiTerminalData } from "../claude-tui-transport.js";
import type { ClaudeTuiNativePromptDecision } from "../claude.js";
import type { ExecutionProgressEvent } from "../execution-contract.js";
import type {
  LocalAgentSessionLinkFact,
  LocalExecutionSessionLinkFact,
  LocalProviderInvocationFact,
  LocalProviderSessionObservedFact,
} from "./execution-context.js";
import {
  executeLocalProviderInvocationFlow,
  type LocalProviderInvocationCallbacks,
} from "./provider-invocation-flow.js";
import type { LocalPreparedWorkerRun } from "./worker-preparation-runtime.js";
import type { LocalWorkerRunInput } from "./worker-dispatch-runtime.js";
import { decideWorkerProviderInvocation } from "./worker-runtime-plan.js";

export class LocalWorkerProviderRuntime {
  constructor(private readonly ports: {
    nowIso(): string;
    releaseIfStopping(input: LocalWorkerRunInput): Promise<boolean>;
    recordProviderInvocation(fact: LocalProviderInvocationFact): Promise<void>;
    runProvider(preparation: LocalPreparedWorkerRun, callbacks: LocalProviderInvocationCallbacks): Promise<CodexRunResult>;
    onVisibleAgentMarkdown(input: LocalWorkerRunInput, text: string): () => Promise<void>;
    onTerminalData(runId: string, data: ClaudeTuiTerminalData): void;
    onNativePrompt(runId: string, decision: ClaudeTuiNativePromptDecision): void;
    onProcessStarted(runId: string): void | Promise<void>;
    onStructuredActivity(runId: string, event: unknown): void;
    onExecutionProgress(runId: string, event: ExecutionProgressEvent): void;
    setActiveExternalSessionId(sessionId: string, runId: string, externalSessionId: string): void;
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
  }) {}

  async invoke(input: LocalWorkerRunInput, preparation: LocalPreparedWorkerRun): Promise<{
    kind: "stopped";
  } | {
    kind: "completed";
    result: CodexRunResult;
    observedExternalSessionId: string | null;
  }> {
    const invocation = await executeLocalProviderInvocationFlow({
      sessionId: input.sessionId,
      runId: input.runId,
      sourceMessageId: input.sourceMessage.id,
      role: input.role,
      runDir: preparation.runDir,
      continuingSameRun: preparation.continuingSameRun,
      executionContext: preparation.executionContext,
      invocationPlan: preparation.invocationPlan,
    }, {
      nowIso: () => this.ports.nowIso(),
      releaseIfStopping: () => this.ports.releaseIfStopping(input),
      recordProviderInvocation: (fact) => this.ports.recordProviderInvocation(fact),
      runProvider: (callbacks) => this.ports.runProvider(preparation, callbacks),
      onVisibleAgentMarkdown: (text) => this.ports.onVisibleAgentMarkdown(input, text),
      onTerminalData: (data) => this.ports.onTerminalData(input.runId, data),
      onNativePrompt: (decision) => this.ports.onNativePrompt(input.runId, decision),
      onProcessStarted: () => this.ports.onProcessStarted(input.runId),
      onStructuredActivity: (event) => this.ports.onStructuredActivity(input.runId, event),
      onExecutionProgress: (event) => this.ports.onExecutionProgress(input.runId, event),
      setActiveExternalSessionId: (externalSessionId) =>
        this.ports.setActiveExternalSessionId(input.sessionId, input.runId, externalSessionId),
      recordProviderSessionObserved: (fact) => this.ports.recordProviderSessionObserved(fact),
      recordAgentSessionLink: (fact) => this.ports.recordAgentSessionLink(fact),
      recordExecutionSessionLink: (fact) => this.ports.recordExecutionSessionLink(fact),
      recordCodexThreadLink: (fact) => this.ports.recordCodexThreadLink(fact),
    });
    const decision = decideWorkerProviderInvocation(invocation);
    return decision.kind === "stopped"
      ? { kind: "stopped" }
      : {
          kind: "completed",
          result: decision.invocation.result,
          observedExternalSessionId: decision.invocation.observedExternalSessionId,
        };
  }
}
