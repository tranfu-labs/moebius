import {
  planRoundLastFact,
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
 * 剪枝：已收束且无新活动的会话复用既有结论（planRoundReuse），只有活跃/新活动
 * 会话才触发完整评估（可能落盘新收束事实并发布事件）。
 */
export async function projectRoundStates(
  projects: LocalConsoleProjectSummary[],
  ports: {
    evaluateRound?(sessionId: string): Promise<LocalRoundState>;
    readLastRoundFact?(sessionId: string): Promise<LocalRoundPersistedFact | null>;
  },
): Promise<LocalConsoleProjectSummary[]> {
  const roundStates = new Map<string, LocalRoundState>();
  for (const project of projects) {
    for (const session of project.sessions) {
      roundStates.set(session.sessionId, await evaluateSessionRound(session, ports));
    }
  }
  return projects.map((project) => ({
    ...project,
    sessions: project.sessions.map((session) =>
      planSessionRoundMerge(session, roundStates.get(session.sessionId))),
  }));
}

async function evaluateSessionRound(
  session: LocalConsoleSessionSummary,
  ports: {
    evaluateRound?(sessionId: string): Promise<LocalRoundState>;
    readLastRoundFact?(sessionId: string): Promise<LocalRoundPersistedFact | null>;
  },
): Promise<LocalRoundState> {
  const lastRound = planRoundLastFact(await ports.readLastRoundFact?.(session.sessionId));
  const decision = planRoundSessionDecision(lastRound, {
    updatedAt: session.updatedAt,
    runningCount: session.runningCount,
    waitingCount: session.waitingCount,
    managedRunningCount: session.managedRunningCount,
    hasPendingControlWork: session.hasPendingControlWork,
    awaitsHumanReason: session.awaitsHumanReason,
  });
  if (decision.kind === "reuse") {
    return decision.state;
  }
  return planRoundStateOrDefault(await ports.evaluateRound?.(session.sessionId));
}
