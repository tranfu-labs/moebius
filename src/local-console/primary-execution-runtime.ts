import type { ActiveLocalRun } from "./active-run.js";
import type { LocalPrimaryAnalysisRuntime } from "./primary-analysis-runtime.js";
import type { LocalPrimaryDispatchRuntime } from "./primary-dispatch-runtime.js";
import type { LocalPrimaryPreparationRuntime } from "./primary-preparation-runtime.js";
import type { LocalPrimaryProviderRuntime } from "./primary-provider-runtime.js";
import {
  decidePrimaryDispatchContinuation,
  decidePrimaryExecutionPreparation,
  decidePrimaryTerminalContinuation,
  planPrimaryFailurePersistence,
  planPrimaryFinalization,
} from "./primary-runtime-plan.js";
import type { LocalPrimaryTerminalRuntime } from "./primary-terminal-runtime.js";
import type { LocalConsoleMessage, LocalConsoleSessionWorkspaceSource } from "./types.js";

export class LocalPrimaryExecutionRuntime {
  constructor(private readonly input: {
    dispatch: LocalPrimaryDispatchRuntime;
    preparation: LocalPrimaryPreparationRuntime;
    provider: LocalPrimaryProviderRuntime;
    analysis: LocalPrimaryAnalysisRuntime;
    terminal: LocalPrimaryTerminalRuntime;
    formatError(error: unknown): string;
    setError(error: string | null): void;
    report(event: string, error: string): void;
    recordFailure(message: LocalConsoleMessage, sessionId: string, runId: string, runDir: string | null, error: string): Promise<void>;
    recordCompletionFailure(message: LocalConsoleMessage, sessionId: string, runId: string, runDir: string | null, error: string): Promise<void>;
    activeRun(runId: string | null): ActiveLocalRun | undefined;
    pauseLifecycle(runId: string): Promise<void>;
    failLifecycle(runId: string): Promise<void>;
    deleteActiveRun(runId: string): void;
    applyPendingContext(sessionId: string): Promise<void>;
    invalidateWorkspace(cwd: string): void;
    flushWorkspaceCleanup(): Promise<void>;
  }) {}

  async run(
    sessionId: string,
    workspaceSource: LocalConsoleSessionWorkspaceSource,
  ): Promise<"continue" | "stop"> {
    let activeMessage: LocalConsoleMessage | null = null;
    let activeRunId: string | null = null;
    let activeRunDir: string | null = null;
    try {
      const dispatch = decidePrimaryDispatchContinuation(await this.input.dispatch.claim(
        sessionId,
        workspaceSource,
        (message, runId) => {
          activeMessage = message;
          activeRunId = runId;
        },
        () => {
          activeMessage = null;
          activeRunId = null;
          activeRunDir = null;
        },
      ));
      if (dispatch.kind === "stop") return "stop";
      if (dispatch.kind === "continue") return "continue";
      const run = dispatch.outcome.run;
      const preparation = decidePrimaryExecutionPreparation(await this.input.preparation.prepare(
        run,
        (runDir) => { activeRunDir = runDir; },
      ));
      if (preparation.kind === "stop") return "stop";
      const ready = preparation.preparation;
      const provider = await this.input.provider.invoke(run, ready);
      const result = await this.input.analysis.apply({
        run,
        preparation: ready,
        result: provider.result,
        observedExternalSessionId: provider.observedExternalSessionId,
      });
      const terminal = decidePrimaryTerminalContinuation(await this.input.terminal.complete(
        run,
        ready,
        { result, observedExternalSessionId: provider.observedExternalSessionId },
        async (error, successResult) => {
          await this.input.recordCompletionFailure(
            run.sourceMessage,
            run.sessionId,
            run.runId,
            successResult.runDir,
            this.input.formatError(error),
          );
          activeMessage = null;
          activeRunDir = null;
        },
      ));
      if (terminal.kind === "stop") return "stop";
      this.input.setError(null);
      return "continue";
    } catch (error) {
      const reason = this.input.formatError(error);
      this.input.setError(reason);
      const persistence = planPrimaryFailurePersistence<LocalConsoleMessage>({
        message: activeMessage,
        runId: activeRunId,
        runDir: activeRunDir,
      });
      if (persistence.kind === "record") {
        await this.input.recordFailure(
          persistence.message,
          sessionId,
          persistence.runId,
          persistence.runDir,
          reason,
        );
      }
      this.input.report("local-console-processing-failed", reason);
      return "stop";
    } finally {
      const finalization = planPrimaryFinalization({
        runId: activeRunId,
        active: this.input.activeRun(activeRunId),
      });
      if (finalization.kind === "finalize") {
        try {
          if (finalization.lifecycle === "pause") await this.input.pauseLifecycle(finalization.runId);
          if (finalization.lifecycle === "fail") await this.input.failLifecycle(finalization.runId);
        } catch (error) {
          this.input.setError(this.input.formatError(error));
        }
        this.input.deleteActiveRun(finalization.runId);
        if (finalization.cwd !== null) this.input.invalidateWorkspace(finalization.cwd);
      }
      try {
        await this.input.applyPendingContext(sessionId);
      } finally {
        await this.input.flushWorkspaceCleanup();
      }
    }
  }
}
