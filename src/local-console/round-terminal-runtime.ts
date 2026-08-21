import {
  buildRoundView,
  LOCAL_ROUND_EVENT_ID_PREFIX,
  planPersistOutcome,
  planRoundCloseout,
  planRoundExistingState,
  planRoundPersist,
  planSummaryTitle,
  type LocalPrimaryCloseoutFact,
  type LocalRoundFact,
  type LocalRoundPlanResult,
  type LocalRoundState,
  type LocalRoundViewInput,
} from "./round-closeout-plan.js";
import { LocalRoundTerminalBus, type LocalRoundTerminalEvent } from "./round-terminal-event-bus.js";
import type { LocalConsoleSessionSummary, LocalConsoleStore } from "./types.js";

export type LocalRoundPersistedFact = LocalRoundFact & { sessionId: string; conversationTitle: string };

export interface LocalRoundRuntimePorts {
  store: LocalConsoleStore;
  bus: LocalRoundTerminalBus;
  nowIso(): string;
  /**
   * 读取会话最新轮次收束事实与一等收束信号。
   *
   * 实现方 MUST 优先使用可重建的 SQLite 派生投影，索引缺失或失配时才回退事实
   * 日志；事实日志始终是唯一事实源。
   */
  readRoundFacts(sessionId: string): Promise<{
    lastRoundFact: LocalRoundPersistedFact | null;
    lastPrimaryCloseout: LocalPrimaryCloseoutFact | null;
  }>;
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
 * 会话摘要由调用方传入（state 投影已经持有），避免每次评估重读整份会话列表。
 */
export class LocalRoundTerminalRuntime {
  constructor(private readonly ports: LocalRoundRuntimePorts) {}

  async readLastRoundFact(sessionId: string): Promise<LocalRoundPersistedFact | null> {
    const facts = await this.ports.readRoundFacts(sessionId);
    return facts.lastRoundFact;
  }

  async readPrimaryCloseout(sessionId: string): Promise<LocalPrimaryCloseoutFact | null> {
    const facts = await this.ports.readRoundFacts(sessionId);
    return facts.lastPrimaryCloseout;
  }

  async buildView(
    sessionId: string,
    summary: LocalConsoleSessionSummary,
  ): Promise<LocalRoundViewInput> {
    const [messages, facts] = await Promise.all([
      this.ports.store.listMessages(sessionId),
      this.ports.readRoundFacts(sessionId),
    ]);
    return buildRoundView(messages, summary, facts.lastRoundFact, this.ports.nowIso(), facts.lastPrimaryCloseout);
  }

  async evaluate(sessionId: string, summary: LocalConsoleSessionSummary): Promise<LocalRoundState> {
    const view = await this.buildView(sessionId, summary);
    const plan = planRoundCloseout(view);
    if (plan.kind === "record-terminal") {
      const existing = await this.readLastRoundFact(sessionId);
      const persistPlan = planRoundPersist(existing, plan.fact);
      if (persistPlan.kind === "skip") {
        // 同一 roundId 已有收束结论：绝不把重评产生的（静默兜底等）新结论当状态
        // 返回——否则 UI 会看到与事实日志不一致的 red（persist 被跳过的 silent
        // -closeout）。既有事实的 terminal 状态才是唯一权威投影。
        return planRoundExistingState(existing, plan.state);
      }
      await this.persist(sessionId, plan, existing, summary);
    }
    return plan.state;
  }

  private async persist(
    sessionId: string,
    plan: Extract<LocalRoundPlanResult, { kind: "record-terminal" }>,
    existing: LocalRoundPersistedFact | null,
    summary: LocalConsoleSessionSummary,
  ): Promise<void> {
    const persistPlan = planRoundPersist(existing, plan.fact);
    if (persistPlan.kind === "skip") {
      return;
    }
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
