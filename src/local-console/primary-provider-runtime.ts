import type { CodexRunResult } from "../codex.js";
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
import type { LocalPreparedPrimaryRun, LocalPrimaryRunInput } from "./primary-preparation-runtime.js";
import { decidePrimaryProviderInvocation } from "./primary-runtime-plan.js";

export class LocalPrimaryProviderRuntime {
  constructor(private readonly ports: {
    nowIso(): string;
    recordProviderInvocation(fact: LocalProviderInvocationFact): Promise<void>;
    runProvider(preparation: LocalPreparedPrimaryRun, callbacks: LocalProviderInvocationCallbacks): Promise<CodexRunResult>;
    onVisibleAgentMarkdown(input: LocalPrimaryRunInput, text: string): () => Promise<void>;
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

  async invoke(input: LocalPrimaryRunInput, preparation: LocalPreparedPrimaryRun): Promise<{
    result: CodexRunResult;
    observedExternalSessionId: string | null;
  }> {
    const invocation = await executeLocalProviderInvocationFlow({
      sessionId: input.sessionId,
      runId: input.runId,
      sourceMessageId: input.sourceMessage.id,
      role: input.role,
      runDir: preparation.resolvedRunDir,
      continuingSameRun: preparation.continuingSameRun,
      executionContext: preparation.executionContext,
      invocationPlan: preparation.invocationPlan,
    }, {
      nowIso: () => this.ports.nowIso(),
      releaseIfStopping: async () => false,
      recordProviderInvocation: (fact) => this.ports.recordProviderInvocation(fact),
      runProvider: (callbacks) => this.ports.runProvider(preparation, callbacks),
      onVisibleAgentMarkdown: (text) => this.ports.onVisibleAgentMarkdown(input, text),
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
    const decision = decidePrimaryProviderInvocation(invocation);
    if (decision.kind === "invalid-stop") throw new Error("primary provider unexpectedly stopped before invocation");
    return {
      result: decision.invocation.result,
      observedExternalSessionId: decision.invocation.observedExternalSessionId,
    };
  }
}
