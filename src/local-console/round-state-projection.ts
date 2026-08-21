import {
  planRoundLastFact,
  planRoundMemoPrune,
  planRoundMemoReuse,
  planRoundProjectionScope,
  planRoundSessionDecision,
  planRoundStateOrDefault,
  planSessionRoundMerge,
  type LocalRoundState,
} from "./round-closeout-plan.js";
import type { LocalConsoleProjectSummary, LocalConsoleSessionSummary } from "./types.js";
import type { LocalRoundPersistedFact } from "./round-terminal-runtime.js";

/**
 * 轮次状态投影（application 单一 use case）：为全部可见会话计算 roundState 并写回摘要。
 *
 * 剪枝有两层：
 * 1. 会话级 memo（按投影作用域 + sessionId 键控）：判定输入未变且状态为 terminal 时
 *    直接复用；in-progress（含静默计时）状态在静默窗口内复用，窗口过期后重评以
 *    捕捉 silent-closeout。判定输入 = planRoundSessionDecision 使用的会话字段，
 *    任何内容活动（新消息等）都会推进 updated_at 使 memo 失效。
 * 2. 已收束且无新活动的会话复用既有结论（planRoundReuse），只有活跃/新活动
 *    会话才触发完整评估（可能落盘新收束事实并发布事件）。
 */

interface RoundProjectionMemo {
  decisionKey: string;
  evaluatedAtMs: number;
  state: LocalRoundState;
}

const roundProjectionMemo = new Map<string, RoundProjectionMemo>();

export async function projectRoundStates(
  projects: LocalConsoleProjectSummary[],
  ports: {
    evaluateRound?(sessionId: string, summary: LocalConsoleSessionSummary): Promise<LocalRoundState>;
    readLastRoundFact?(sessionId: string): Promise<LocalRoundPersistedFact | null>;
    /** memo 作用域（例如 store sqlitePath），防止不同 store 实例共享投影。 */
    roundProjectionScope?: string;
  },
): Promise<LocalConsoleProjectSummary[]> {
  const scope = planRoundProjectionScope(ports.roundProjectionScope);
  const roundStates = new Map<string, LocalRoundState>();
  const seen = new Set<string>();
  for (const project of projects) {
    for (const session of project.sessions) {
      seen.add(session.sessionId);
      roundStates.set(session.sessionId, await evaluateSessionRound(scope, session, ports));
    }
  }
  for (const key of roundProjectionMemo.keys()) {
    if (planRoundMemoPrune(key, scope, seen)) {
      roundProjectionMemo.delete(key);
    }
  }
  return projects.map((project) => ({
    ...project,
    sessions: project.sessions.map((session) =>
      planSessionRoundMerge(session, roundStates.get(session.sessionId))),
  }));
}

async function evaluateSessionRound(
  scope: string,
  session: LocalConsoleSessionSummary,
  ports: {
    evaluateRound?(sessionId: string, summary: LocalConsoleSessionSummary): Promise<LocalRoundState>;
    readLastRoundFact?(sessionId: string): Promise<LocalRoundPersistedFact | null>;
  },
): Promise<LocalRoundState> {
  const decisionKey = roundDecisionKey(session);
  const memoKey = `${scope}\u0000${session.sessionId}`;
  const memoDecision = planRoundMemoReuse(
    roundProjectionMemo.get(memoKey),
    decisionKey,
    Date.now(),
  );
  if (memoDecision.kind === "reuse") {
    return memoDecision.state;
  }
  const lastRound = planRoundLastFact(await ports.readLastRoundFact?.(session.sessionId));
  const decision = planRoundSessionDecision(lastRound, roundSummaryInput(session));
  if (decision.kind === "reuse") {
    roundProjectionMemo.set(memoKey, { decisionKey, evaluatedAtMs: Date.now(), state: decision.state });
    return decision.state;
  }
  const state = planRoundStateOrDefault(await ports.evaluateRound?.(session.sessionId, session));
  roundProjectionMemo.set(memoKey, { decisionKey, evaluatedAtMs: Date.now(), state });
  return state;
}

function roundDecisionKey(session: LocalConsoleSessionSummary): string {
  return JSON.stringify([
    session.updatedAt,
    session.runningCount,
    session.waitingCount,
    session.managedRunningCount,
    session.hasPendingControlWork,
    session.awaitsHumanReason,
  ]);
}

function roundSummaryInput(session: LocalConsoleSessionSummary): {
  updatedAt: string;
  runningCount?: number;
  waitingCount?: number;
  managedRunningCount?: number;
  hasPendingControlWork?: boolean;
  awaitsHumanReason?: string | null;
} {
  return {
    updatedAt: session.updatedAt,
    runningCount: session.runningCount,
    waitingCount: session.waitingCount,
    managedRunningCount: session.managedRunningCount,
    hasPendingControlWork: session.hasPendingControlWork,
    awaitsHumanReason: session.awaitsHumanReason,
  };
}
