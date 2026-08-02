import {
  decidePendingAgentSource,
  decidePendingDispatchCapability,
  planAwaitingDispatchResolution,
  planPendingSessionContextPromotion,
} from "./pending-session-context-plan.js";
import type { LocalConsoleStore } from "./types.js";

export class LocalPendingSessionContextRuntime {
  constructor(private readonly input: {
    store: LocalConsoleStore;
    storeCall<T>(label: string, operation: () => Promise<T>): Promise<T>;
    nowIso(): string;
    hasActiveRun(sessionId: string): boolean;
    hasScheduledWorker(sessionId: string): boolean;
    listAgentNames(sessionId: string): Promise<string[]>;
  }) {}

  async applyWhenIdle(sessionId: string): Promise<void> {
    const messages = await this.input.storeCall("local-console-store-list-before-context-promotion", () =>
      this.input.store.listMessages(sessionId));
    const promotion = planPendingSessionContextPromotion({
      hasActiveRun: this.input.hasActiveRun(sessionId),
      hasScheduledWorker: this.input.hasScheduledWorker(sessionId),
      messages,
    });
    if (promotion.kind === "blocked") return;
    await this.input.storeCall("local-console-store-apply-pending-session-context", () =>
      this.input.store.applyPendingSessionContext({ sessionId, now: this.input.nowIso() }));
    if (promotion.kind === "promote-only") return;
    const resolveAwaiting = this.input.store.resolveAwaitingUserMessageDispatches;
    const capability = decidePendingDispatchCapability(resolveAwaiting !== undefined);
    if (capability.kind === "unavailable") {
      throw new Error("local console awaiting dispatch persistence capability unavailable");
    }
    const snapshot = await this.input.store.listSessionAgentTeamSnapshot?.(sessionId);
    const source = decidePendingAgentSource(snapshot);
    const agentNames = source.kind === "load"
      ? await this.input.listAgentNames(sessionId)
      : source.agentNames;
    const resolution = planAwaitingDispatchResolution(promotion.awaiting, agentNames);
    if (resolution.kind === "skip") return;
    await this.input.storeCall("local-console-store-resolve-awaiting-dispatches", () =>
      resolveAwaiting!.call(this.input.store, {
        sessionId,
        dispatches: resolution.dispatches,
        now: this.input.nowIso(),
      }));
  }
}
