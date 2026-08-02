import { decidePendingWait } from "./pending-processing-plan.js";
import { LocalSessionIdleSignals } from "./session-idle-signals.js";

export class LocalPendingProcessingSignals {
  private readonly signals = new LocalSessionIdleSignals<ReturnType<typeof setTimeout>>();

  schedule(input: {
    sessionId: string;
    stopping(): boolean;
    closing(): boolean;
    onReady(): void;
    onStopped(): void;
    otherWork(): boolean;
  }): void {
    const admission = decidePendingWait({
      stopping: input.stopping(),
      closing: input.closing(),
      processing: false,
    });
    if (admission.kind !== "ready") return;
    let task!: ReturnType<typeof setTimeout>;
    task = setTimeout(() => {
      this.signals.remove(input.sessionId, task, true);
      const ready = decidePendingWait({
        stopping: input.stopping(),
        processing: false,
      });
      if (ready.kind === "ready") input.onReady();
      else if (ready.kind === "stop") input.onStopped();
      this.signals.notifyIfIdle(input.sessionId, input.otherWork());
    }, 25);
    this.signals.add(input.sessionId, task);
  }

  cancelAll(): string[] {
    return this.signals.cancelAll((task) => clearTimeout(task));
  }

  has(sessionId: string): boolean {
    return this.signals.has(sessionId);
  }

  async waitForIdle(sessionId: string, otherWork: boolean): Promise<void> {
    await this.signals.waitForIdle(sessionId, otherWork);
  }

  notifyIfIdle(sessionId: string, otherWork: boolean): void {
    this.signals.notifyIfIdle(sessionId, otherWork);
  }

  async waitForResult<R>(sessionId: string): Promise<R> {
    return await this.signals.waitForResult<R>(sessionId);
  }

  resolveResult<R>(sessionId: string, result: R): void {
    this.signals.resolveResult(sessionId, result);
  }

  resolveAllResults<R>(result: R): void {
    this.signals.resolveAllResults(result);
  }
}
