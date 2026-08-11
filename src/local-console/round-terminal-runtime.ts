import {
  buildRoundView,
  LOCAL_PRIMARY_CLOSEOUT_FACT_TYPE,
  LOCAL_ROUND_EVENT_ID_PREFIX,
  LOCAL_ROUND_FACT_TYPE,
  planLatestPrimaryCloseoutFromLog,
  planLatestRoundFactFromLog,
  planPersistOutcome,
  planRoundCloseout,
  planRoundPersist,
  planSessionSummary,
  planSummaryTitle,
  type LocalPrimaryCloseoutFact,
  type LocalRoundFact,
  type LocalRoundPlanResult,
  type LocalRoundState,
  type LocalRoundViewInput,
} from "./round-closeout-plan.js";
import { LocalRoundTerminalBus, type LocalRoundTerminalEvent } from "./round-terminal-event-bus.js";
import type { LocalConsoleStore } from "./types.js";

export type LocalRoundPersistedFact = LocalRoundFact & { sessionId: string; conversationTitle: string };

export interface RoundFactLogSnapshot {
  values: readonly unknown[];
}

export interface LocalRoundRuntimePorts {
  store: LocalConsoleStore;
  bus: LocalRoundTerminalBus;
  nowIso(): string;
  readFactLog(sessionId: string): Promise<RoundFactLogSnapshot | null>;
  /** 落盘收束事实；返回是否真实持久化（false 时不发布事件）。 */
  persistFact(input: {
    sessionId: string;
    roundId: number;
    outcome: LocalRoundFact["outcome"];
    terminalMessageId: number | null;
    conversationTitle: string;
    occurredAt: string;
  }): Promise<boolean>;
}

/**
 * 轮次收束 runtime（application）：组装会话事实视图 → 纯 domain 判定 → 收束事实落盘
 * （经注入的持久化端口，复用 store 幂等写入）→ 事件总线发布。
 *
 * 评估是幂等的：同一 roundId 的收束事实已存在时直接返回既有状态，不重复落盘/发布。
 */
export class LocalRoundTerminalRuntime {
  constructor(private readonly ports: LocalRoundRuntimePorts) {}

  async readLastRoundFact(sessionId: string): Promise<LocalRoundPersistedFact | null> {
    const snapshot = await this.ports.readFactLog(sessionId);
    return planLatestRoundFactFromLog(snapshot, sessionId, LOCAL_ROUND_FACT_TYPE);
  }

  async readPrimaryCloseout(sessionId: string): Promise<LocalPrimaryCloseoutFact | null> {
    const snapshot = await this.ports.readFactLog(sessionId);
    return planLatestPrimaryCloseoutFromLog(snapshot, sessionId, LOCAL_PRIMARY_CLOSEOUT_FACT_TYPE);
  }

  async buildView(sessionId: string): Promise<LocalRoundViewInput> {
    const [messages, summary, lastRound, primaryCloseout] = await Promise.all([
      this.ports.store.listMessages(sessionId),
      this.ports.store.listSessions().then((sessions) => planSessionSummary(sessions, sessionId)),
      this.readLastRoundFact(sessionId),
      this.readPrimaryCloseout(sessionId),
    ]);
    return buildRoundView(messages, summary, lastRound, this.ports.nowIso(), primaryCloseout);
  }

  async evaluate(sessionId: string): Promise<LocalRoundState> {
    const view = await this.buildView(sessionId);
    const plan = planRoundCloseout(view);
    if (plan.kind === "record-terminal") {
      await this.persist(sessionId, plan);
    }
    return plan.state;
  }

  private async persist(sessionId: string, plan: Extract<LocalRoundPlanResult, { kind: "record-terminal" }>): Promise<void> {
    const existing = await this.readLastRoundFact(sessionId);
    const persistPlan = planRoundPersist(existing, plan.fact);
    if (persistPlan.kind === "skip") {
      return;
    }
    const summary = await this.ports.store.listSessions().then((sessions) => planSessionSummary(sessions, sessionId));
    const conversationTitle = planSummaryTitle(summary);
    const persisted = await this.ports.persistFact({
      sessionId,
      roundId: plan.fact.roundId,
      outcome: plan.fact.outcome,
      terminalMessageId: plan.fact.terminalMessageId,
      conversationTitle,
      occurredAt: plan.fact.occurredAt,
    });
    const outcome = planPersistOutcome(persisted);
    if (outcome.kind === "silent") {
      return;
    }
    const event: LocalRoundTerminalEvent = {
      eventId: `${LOCAL_ROUND_EVENT_ID_PREFIX}:${sessionId}:${String(plan.fact.roundId)}`,
      sessionId,
      roundId: plan.fact.roundId,
      outcome: plan.fact.outcome,
      terminalMessageId: plan.fact.terminalMessageId,
      conversationTitle,
      occurredAt: plan.fact.occurredAt,
    };
    this.ports.bus.emit(event);
  }
}
