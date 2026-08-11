import {
  decideHandoffDispatchRecording,
  decideHandoffStaleness,
  decideWorkerReplyStalenessCheck,
  type LocalHandoffDispatchFactInput,
} from "./control-dispatch.js";
import type { LocalConsoleMessage, LocalConsoleStore } from "./types.js";

/**
 * 派工世代运行时：主 Agent 每次派工记录递增 generation 事实；
 * 被更新派工覆盖的旧派工，其晚到回复在继续推动接力前被判定失效。
 */
export class LocalHandoffDispatchRuntime {
  constructor(private readonly input: {
    store: LocalConsoleStore;
    storeCall<T>(label: string, operation: () => Promise<T>): Promise<T>;
  }) {}

  async record(input: LocalHandoffDispatchFactInput): Promise<void> {
    const recording = decideHandoffDispatchRecording({ record: this.input.store.recordHandoffDispatch });
    if (recording.kind === "record") {
      await this.input.storeCall("local-console-store-record-handoff-dispatch", () =>
        recording.record.call(this.input.store, input));
    }
  }

  async isStaleReply(input: {
    sessionId: string;
    message: Pick<LocalConsoleMessage, "speaker" | "role" | "runId">;
    primaryAgent: string | null;
    actionKind: string;
  }): Promise<boolean> {
    const check = decideWorkerReplyStalenessCheck({
      speaker: input.message.speaker,
      role: input.message.role,
      primaryAgent: input.primaryAgent,
      runId: input.message.runId,
      actionKind: input.actionKind,
      handoffStateAvailable: this.input.store.readHandoffDispatchState !== undefined,
    });
    if (check.kind === "skip") return false;
    const state = await this.input.storeCall("local-console-store-read-handoff-dispatch-state", () =>
      this.input.store.readHandoffDispatchState!.call(this.input.store, {
        sessionId: input.sessionId,
        role: check.role,
        runId: check.runId,
      }));
    return decideHandoffStaleness(state).kind === "stale";
  }
}
