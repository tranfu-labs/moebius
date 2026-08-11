import { readSessionFactLog } from "./session-fact-log.js";
import {
  LOCAL_ROUND_FACT_TYPE,
  planFactLogPath,
  planPersistCapability,
} from "./round-closeout-plan.js";
import { LocalRoundTerminalRuntime, type LocalRoundPersistedFact } from "./round-terminal-runtime.js";
import { LocalRoundTerminalBus } from "./round-terminal-event-bus.js";
import type { LocalRoundState } from "./round-closeout-plan.js";
import type { LocalConsoleStore } from "./types.js";

/**
 * 轮次装配（composition root 辅助）：创建收束 runtime 并把 round 端口绑定到
 * state-query 端口。持久化复用 store 的幂等事实写入；无能力时不落盘不发布。
 */
export function createRoundTerminalWiring(input: {
  store: LocalConsoleStore;
  nowIso(): string;
}): {
  bus: LocalRoundTerminalBus;
  runtime: LocalRoundTerminalRuntime;
  bindStateQueryPorts<T extends object>(base: T): T & {
    evaluateRound(sessionId: string): Promise<LocalRoundState>;
    readLastRoundFact(sessionId: string): Promise<LocalRoundPersistedFact | null>;
  };
} {
  const bus = new LocalRoundTerminalBus();
  const runtime = new LocalRoundTerminalRuntime({
    store: input.store,
    bus,
    nowIso: input.nowIso,
    readFactLog: (sessionId) => {
      const logPath = planFactLogPath(input.store.getSessionFactLogPath?.(sessionId));
      return logPath === null ? Promise.resolve(null) : readSessionFactLog(logPath, sessionId);
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
      evaluateRound: (sessionId: string) => runtime.evaluate(sessionId),
      readLastRoundFact: (sessionId: string) => runtime.readLastRoundFact(sessionId),
    }),
  };
}
