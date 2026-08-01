import { resolveLocalUserMessageDispatch } from "./user-message-routing.js";
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
    if (this.input.hasActiveRun(sessionId) || this.input.hasScheduledWorker(sessionId)) return;
    const messages = await this.input.storeCall("local-console-store-list-before-context-promotion", () =>
      this.input.store.listMessages(sessionId));
    const workerPending = messages.some((message) =>
      message.speaker === "user"
      && (message.status === "pending" || message.status === "running")
      && message.dispatchLane === "worker");
    if (workerPending) return;
    await this.input.storeCall("local-console-store-apply-pending-session-context", () =>
      this.input.store.applyPendingSessionContext({ sessionId, now: this.input.nowIso() }));
    const awaiting = messages.filter((message) =>
      message.speaker === "user"
      && message.status === "pending"
      && message.dispatchLane === "awaiting-team");
    if (awaiting.length === 0) return;
    const resolveAwaiting = this.input.store.resolveAwaitingUserMessageDispatches;
    if (resolveAwaiting === undefined) {
      throw new Error("local console awaiting dispatch persistence capability unavailable");
    }
    const persistedSnapshot = await this.input.store.listSessionAgentTeamSnapshot?.(sessionId) ?? null;
    const agentNames = persistedSnapshot === null
      ? await this.input.listAgentNames(sessionId)
      : persistedSnapshot.members.map((member) => member.name);
    const primaryAgent = agentNames[0];
    if (primaryAgent === undefined) return;
    await this.input.storeCall("local-console-store-resolve-awaiting-dispatches", () =>
      resolveAwaiting.call(this.input.store, {
        sessionId,
        dispatches: awaiting.map((message) => ({
          messageId: message.id,
          ...resolveLocalUserMessageDispatch({
            body: message.body,
            availableAgentNames: agentNames,
            primaryAgent,
          }),
        })),
        now: this.input.nowIso(),
      }));
  }
}
