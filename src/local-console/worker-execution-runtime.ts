import type { ActiveLocalRun } from "./active-run.js";
import type { LocalWorkerRunInput } from "./worker-dispatch-runtime.js";
import type { LocalWorkerPreparationRuntime } from "./worker-preparation-runtime.js";
import type { LocalWorkerProviderRuntime } from "./worker-provider-runtime.js";
import type { LocalWorkerTerminalRuntime } from "./worker-terminal-runtime.js";
import {
  decideWorkerOriginEffect,
  decideWorkerPreparedRun,
  decideWorkerProviderInvocation,
  decideWorkerStopHandling,
  decideWorkerTerminalContinuation,
  planWorkerFinalization,
} from "./worker-runtime-plan.js";

export class LocalWorkerExecutionRuntime {
  constructor(private readonly input: {
    preparation: LocalWorkerPreparationRuntime;
    provider: LocalWorkerProviderRuntime;
    terminal: LocalWorkerTerminalRuntime;
    stopping(sessionId: string): boolean;
    releaseClaim(input: LocalWorkerRunInput): Promise<void>;
    formatError(error: unknown): string;
    setError(error: string | null): void;
    recordDirectFailure(input: LocalWorkerRunInput, runDir: string, error: string): Promise<void>;
    recordDetachedFailure(input: LocalWorkerRunInput, runDir: string, error: string): Promise<void>;
    activeRun(runId: string): ActiveLocalRun | undefined;
    pauseLifecycle(runId: string): Promise<void>;
    failLifecycle(runId: string): Promise<void>;
    deleteActiveRun(runId: string): void;
    invalidateWorkspace(cwd: string): void;
  }) {}

  async run(input: LocalWorkerRunInput): Promise<void> {
    const stop = decideWorkerStopHandling({
      stopping: this.input.stopping(input.sessionId),
      origin: input.origin,
    });
    if (stop.kind === "release-and-stop") await this.input.releaseClaim(input);
    if (stop.kind !== "continue") return;

    const preparationDecision = decideWorkerPreparedRun(await this.input.preparation.prepare(input));
    if (preparationDecision.kind === "settled") return;
    const preparation = preparationDecision.preparation;
    try {
      const providerDecision = decideWorkerProviderInvocation(await this.input.provider.invoke(input, preparation));
      if (providerDecision.kind === "stopped") return;
      const provider = providerDecision.invocation;
      const terminal = decideWorkerTerminalContinuation(
        await this.input.terminal.complete(input, preparation, provider),
      );
      if (terminal.kind === "stop") return;
      this.input.setError(null);
    } catch (error) {
      const reason = this.input.formatError(error);
      this.input.setError(reason);
      try {
        const origin = decideWorkerOriginEffect(input.origin);
        if (origin.kind === "direct") await this.input.recordDirectFailure(input, preparation.runDir, reason);
        else await this.input.recordDetachedFailure(input, preparation.runDir, reason);
      } catch {
        // The original store failure remains the useful error.
      }
      throw error;
    } finally {
      const finalization = planWorkerFinalization(this.input.activeRun(input.runId));
      try {
        if (finalization.lifecycle === "pause") await this.input.pauseLifecycle(input.runId);
        else if (finalization.lifecycle === "fail") await this.input.failLifecycle(input.runId);
      } catch (error) {
        this.input.setError(this.input.formatError(error));
      }
      this.input.deleteActiveRun(input.runId);
      if (finalization.cwd !== null) this.input.invalidateWorkspace(finalization.cwd);
    }
  }
}
