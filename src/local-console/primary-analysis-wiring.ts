import type { LocalActiveRunRegistry } from "./active-run-registry.js";
import type { LocalExecutionRunner } from "./execution-driver.js";
import type { LocalRunLifecycleRuntime } from "./run-lifecycle-runtime.js";
import { buildConfirmedPlanExecutionPrompt } from "./session-analysis-gate.js";
import { MANAGED_PROCESS_RUNTIME_CONTRACT } from "./prompt.js";
import type { LocalPrimaryAnalysisRuntime } from "./primary-analysis-runtime.js";
import { decideLocalActiveRunTarget, planLocalProviderExecutionOptions } from "./provider-invocation-plan.js";
import { decidePrimaryResumedSession } from "./primary-runtime-plan.js";

type PrimaryAnalysisPorts = ConstructorParameters<typeof LocalPrimaryAnalysisRuntime>[0];

export function createLocalPrimaryAnalysisPorts(input: {
  executionRunner: LocalExecutionRunner;
  activeRuns: LocalActiveRunRegistry;
  lifecycle: LocalRunLifecycleRuntime;
  idleTimeoutMs: number | undefined;
  toolTimeoutMs: number | undefined;
  updateGate: PrimaryAnalysisPorts["updateGate"];
}): PrimaryAnalysisPorts {
  return {
    updateGate: input.updateGate,
    resumeConfirmed: async ({ run, preparation, confirmedVersion, externalSessionId }) =>
      await input.executionRunner({
        prompt: `${buildConfirmedPlanExecutionPrompt(confirmedVersion)}\n\n${MANAGED_PROCESS_RUNTIME_CONTRACT}`,
        runDir: preparation.providerRunDir,
        cwd: preparation.workspace.cwd,
        profile: preparation.executionContext.profile,
        mode: { kind: "resume", externalSessionId },
        signal: preparation.controller.signal,
        workspaceAccess: "read-write",
        managedProcess: { sessionId: run.sessionId, providerRunId: run.runId },
        ...planLocalProviderExecutionOptions({
          idleTimeoutMs: input.idleTimeoutMs,
          toolTimeoutMs: input.toolTimeoutMs,
          imagePaths: [],
        }),
        onVisibleAgentMarkdown: (text) => {
          const target = decideLocalActiveRunTarget(input.activeRuns.get(run.runId), run.sessionId);
          if (target.kind === "skip") return;
          target.active.liveMarkdown = text;
          input.lifecycle.updateAgentProgress(run.runId, text);
        },
        onStructuredActivity: (event) => input.lifecycle.updateStructuredActivity(run.runId, event),
        onExecutionProgress: (event) => input.lifecycle.updateExecutionProgress(run.runId, event),
        onSessionStarted: async ({ externalSessionId: resumedSessionId }) => {
          const decision = decidePrimaryResumedSession(resumedSessionId, externalSessionId);
          if (decision.kind === "reject") {
            throw new Error("analysis-write-lease-provider-session-mismatch");
          }
        },
      }),
  };
}
