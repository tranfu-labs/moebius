import type { LocalActiveRunRegistry } from "./active-run-registry.js";
import {
  appendLocalClaudeTerminalTrace,
  decideLocalClaudeTerminalTraceAppend,
} from "./claude-terminal-trace.js";
import type { LocalExecutionRunner } from "./execution-driver.js";
import type { LocalRunLifecycleRuntime } from "./run-lifecycle-runtime.js";
import type { LocalConsoleStorePorts } from "./runtime-store-ports.js";
import type { LocalPrimaryProviderRuntime } from "./primary-provider-runtime.js";
import {
  decideLocalActiveRunTarget,
  planLocalProviderExecutionOptions,
} from "./provider-invocation-plan.js";
import { planProviderProcessStartedFact } from "./run-agent-audit-plan.js";

type PrimaryProviderPorts = ConstructorParameters<typeof LocalPrimaryProviderRuntime>[0];

export function createLocalPrimaryProviderPorts(input: {
  storePorts: Pick<LocalConsoleStorePorts,
    | "call"
    | "sessionFacts"
    | "recordProviderInvocation"
    | "recordProviderSessionObserved"
    | "recordAgentSessionLink"
    | "recordExecutionSessionLink"
    | "recordCodexThreadLink"
    | "recordProviderProcessStarted"
  >;
  executionRunner: LocalExecutionRunner;
  activeRuns: LocalActiveRunRegistry;
  lifecycle: LocalRunLifecycleRuntime;
  idleTimeoutMs: number | undefined;
  toolTimeoutMs: number | undefined;
  nowIso: PrimaryProviderPorts["nowIso"];
}): PrimaryProviderPorts {
  const { storePorts } = input;
  return {
    nowIso: input.nowIso,
    recordProviderInvocation: (fact) => storePorts.recordProviderInvocation(fact),
    runProvider: (preparation, callbacks) => input.executionRunner({
      prompt: preparation.prompt,
      runDir: preparation.providerRunDir,
      cwd: preparation.workspace.cwd,
      profile: preparation.executionContext.profile,
      mode: preparation.invocationPlan.providerMode,
      signal: preparation.controller.signal,
      ...planLocalProviderExecutionOptions({
        idleTimeoutMs: input.idleTimeoutMs,
        toolTimeoutMs: input.toolTimeoutMs,
        imagePaths: preparation.preparedAttachments.imagePaths,
      }),
      workspaceAccess: preparation.invocationPlan.workspaceAccess,
      managedProcess: { sessionId: preparation.activeRun.sessionId, providerRunId: preparation.activeRun.runId },
      ...callbacks,
    }),
    onVisibleAgentMarkdown: (run, text) => {
      const target = decideLocalActiveRunTarget(input.activeRuns.get(run.runId), run.sessionId);
      if (target.kind === "skip") return async () => undefined;
      target.active.liveMarkdown = text;
      input.activeRuns.touch(run.runId);
      input.lifecycle.updateAgentProgress(run.runId, text);
      const recordedAt = input.nowIso();
      return () => storePorts.call("local-console-store-record-progress", () =>
        storePorts.sessionFacts().recordProgressEvent({
          sessionId: run.sessionId,
          runId: run.runId,
          role: run.role,
          body: text,
          now: recordedAt,
        }));
    },
    onTerminalData: (runId, data) => {
      const target = decideLocalClaudeTerminalTraceAppend(input.activeRuns.get(runId));
      if (target.kind === "append") appendLocalClaudeTerminalTrace(target.trace, data);
    },
    onProcessStarted: async (runId) => {
      await input.lifecycle.markStarted(runId);
      const plan = planProviderProcessStartedFact({ active: input.activeRuns.get(runId), runId, startedAt: input.nowIso() });
      await ({
        skip: async () => undefined,
        record: async () => storePorts.recordProviderProcessStarted(plan.fact!),
      })[plan.kind]();
    },
    onStructuredActivity: (runId, event) => input.lifecycle.updateStructuredActivity(runId, event),
    onExecutionProgress: (runId, event) => input.lifecycle.updateExecutionProgress(runId, event),
    setActiveExternalSessionId: (sessionId, runId, externalSessionId) => {
      const target = decideLocalActiveRunTarget(input.activeRuns.get(runId), sessionId);
      if (target.kind === "update") {
        target.active.threadId = externalSessionId;
        input.activeRuns.touch(runId);
      }
    },
    recordProviderSessionObserved: (fact) => storePorts.recordProviderSessionObserved(fact),
    recordAgentSessionLink: (fact) => storePorts.recordAgentSessionLink(fact),
    recordExecutionSessionLink: (fact) => storePorts.recordExecutionSessionLink(fact),
    recordCodexThreadLink: (fact) => storePorts.recordCodexThreadLink(fact),
  };
}
