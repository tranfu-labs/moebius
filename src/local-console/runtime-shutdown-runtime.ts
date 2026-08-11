import type { LocalActiveRunRegistry } from "./active-run-registry.js";
import {
  decideRuntimeShutdownAttempt,
  decideRuntimeShutdownAttemptRelease,
  decideRuntimeShutdownStart,
  decideShutdownDrain,
  planGracefulShutdownResume,
} from "./run-lifecycle-plan.js";
import type { LocalRuntimeWiringContext } from "./runtime-wiring-context.js";
import { decideRuntimeCapability } from "./runtime-domain.js";
import type { LocalConsoleStore } from "./types.js";

export class LocalRuntimeShutdownRuntime {
  #closed = false;
  #closePromise: Promise<void> | null = null;

  constructor(private readonly input: {
    context: LocalRuntimeWiringContext;
    store: LocalConsoleStore;
    activeRuns: LocalActiveRunRegistry;
    timeoutMs: number;
    isClosing(): boolean;
    beginClosing(): void;
    pendingWork(): boolean;
    workerWork(): boolean;
    beforeStoreClose?(): Promise<void>;
    randomId(): string;
    reportFailure(sessionId: string, runId: string, error: string): void;
    getRunningTaskCount(): number;
  }) {}

  async stopRunningTasks(): Promise<void> {
    for (const active of [...this.input.activeRuns.values()]) {
      active.controller.abort("desktop-install-stop");
    }
    const deadline = Date.now() + this.input.timeoutMs;
    while (this.input.getRunningTaskCount() > 0 && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
  }

  async close(): Promise<void> {
    const admission = decideRuntimeShutdownAttempt({ closed: this.#closed, attemptPending: this.#closePromise !== null });
    if (admission.kind === "done") return;
    const attempt = admission.kind === "join" ? this.#closePromise! : this.#performClose();
    if (admission.kind === "start") this.#closePromise = attempt;
    try {
      await attempt;
      this.#closed = true;
    } finally {
      const release = decideRuntimeShutdownAttemptRelease({
        closed: this.#closed,
        currentAttempt: this.#closePromise === attempt,
      });
      if (release.kind === "release") this.#closePromise = null;
    }
  }

  async #performClose(): Promise<void> {
    if (decideRuntimeShutdownStart(this.input.isClosing()).kind === "close") this.input.beginClosing();
    for (const active of [...this.input.activeRuns.values()]) {
      try {
        const resume = planGracefulShutdownResume({
          active,
          intentId: `graceful-shutdown:${active.runId}:${this.input.randomId()}`,
          createdAt: this.input.context.nowIso(),
        });
        if (resume.kind === "record") {
          const recoveryStore = this.input.context.storePorts.requireRecoveryFacts();
          await this.input.context.storePorts.call("local-console-store-record-graceful-resume", () =>
            recoveryStore.recordCodexResumeIntent(resume.intent));
          const capability = decideRuntimeCapability(this.input.store.releaseMessageForResume);
          if (capability.kind === "unavailable") {
            throw new Error("local console graceful resume persistence capability unavailable");
          }
          await this.input.context.storePorts.call("local-console-store-release-graceful-resume", () =>
            capability.capability.call(this.input.store, {
              userMessageId: active.userMessageId,
              sessionId: active.sessionId,
              sourceDisposition: active.sourceDisposition,
              targetRunId: active.runId,
              role: resume.intent.role,
              now: this.input.context.nowIso(),
            }));
          active.gracefulResumePrepared = true;
        }
      } catch (error) {
        const formatted = this.input.context.formatAndSetError(error);
        this.input.reportFailure(active.sessionId, active.runId, formatted);
      }
      active.controller.abort("runtime-closing");
    }
    const deadline = Date.now() + this.input.timeoutMs;
    while (decideShutdownDrain({
      pending: this.input.pendingWork(),
      workers: this.input.workerWork(),
      beforeDeadline: Date.now() < deadline,
    }).kind === "wait") {
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    await this.input.beforeStoreClose?.();
    await this.input.store.close();
  }
}
