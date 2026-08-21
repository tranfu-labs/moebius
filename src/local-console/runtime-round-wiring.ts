import { planPersistCapability } from "./round-closeout-plan.js";
import { LocalRoundTerminalRuntime, type LocalRoundPersistedFact } from "./round-terminal-runtime.js";
import { LocalRoundTerminalBus } from "./round-terminal-event-bus.js";
import { decideRuntimeCapability } from "./runtime-domain.js";
import type { LocalRoundState } from "./round-closeout-plan.js";
import type { LocalConsoleSessionSummary, LocalConsoleStore } from "./types.js";

/**
 * 轮次装配（composition root 辅助）：创建收束 runtime 并把 round 端口绑定到
 * state-query 端口。收束事实与一等收束信号经 store 的可重建 SQLite 投影读取
 * （store 内部在索引失配时回退事实日志并惰性重建）；持久化复用 store 的幂等
 * 事实写入；无能力时不落盘不发布。
 */
export function createRoundTerminalWiring(input: {
  store: LocalConsoleStore;
  nowIso(): string;
}): {
  bus: LocalRoundTerminalBus;
  runtime: LocalRoundTerminalRuntime;
  bindStateQueryPorts<T extends object>(base: T): T & {
    evaluateRound(sessionId: string, summary: LocalConsoleSessionSummary): Promise<LocalRoundState>;
    readLastRoundFact(sessionId: string): Promise<LocalRoundPersistedFact | null>;
  };
} {
  const bus = new LocalRoundTerminalBus();
  const runtime = new LocalRoundTerminalRuntime({
    store: input.store,
    bus,
    nowIso: input.nowIso,
    readRoundFacts: async (sessionId) => {
      const decision = decideRuntimeCapability(input.store.readRoundFacts);
      if (decision.kind === "unavailable") {
        return { lastRoundFact: null, lastPrimaryCloseout: null };
      }
      const facts = await decision.capability.call(input.store, sessionId);
      return {
        lastRoundFact: facts.lastRoundFact,
        lastPrimaryCloseout: facts.lastPrimaryCloseout,
      };
    },
    persistFact: (fact) => {
      const capability = planPersistCapability(input.store.recordRoundTerminal?.bind(input.store));
      if (capability.kind === "incapable") {
        return Promise.resolve(false);
      }
      return capability.persist(fact).then(() => true);
    },
  });
  return {
    bus,
    runtime,
    bindStateQueryPorts: (base) => ({
      ...base,
      evaluateRound: (sessionId: string, summary: LocalConsoleSessionSummary) => runtime.evaluate(sessionId, summary),
      readLastRoundFact: (sessionId: string) => runtime.readLastRoundFact(sessionId),
    }),
  };
}
