import type { LocalRoundState } from "./round-closeout-plan.js";
import type { LocalConsoleSessionSummary } from "./types.js";

/**
 * 单点可见提醒派生与 Dock 计数（纯 domain）。
 *
 * 用户裁决：#105–#106 —— 每段对话始终只有一个状态点；Dock 只统计当前可见的红点
 * 与蓝点（闪烁与无点不计）；折叠项目只显示一个最高优先级代表点。
 */

export type ConversationVisibleDot = "red" | "blue" | "blink" | "none";

export interface VisibleDotFacts {
  /** 会话轮次状态投影（roundState）；缺失时回退旧派生。 */
  roundState: LocalRoundState | null;
  /** 收束后未读（本轮结果未看）。 */
  hasUnread: boolean;
  /** 正在运行/待发射工作（进行中轮或活动工作）。 */
  isRunning: boolean;
  /** 需要用户处理（awaiting-user / silent-closeout 结论）。 */
  needsAttention: boolean;
  /** 非延续会话（项目不可用等）优先红点。 */
  isNonContinuable: boolean;
  hasUnacknowledgedAttention: boolean;
  /** 会话已归档（归档不显示点、不计 Dock）。 */
  archived?: boolean;
}

export function deriveVisibleDot(facts: VisibleDotFacts): ConversationVisibleDot {
  if (facts.archived === true) return "none";
  if (facts.hasUnacknowledgedAttention || facts.isNonContinuable) return "red";
  if (facts.roundState !== null && facts.roundState.kind === "terminal") {
    // 收束后：需要用户处理 → 红；有新结果未读 → 蓝；无点（已读/无内容）。
    if (facts.needsAttention) return "red";
    return facts.hasUnread ? "blue" : "none";
  }
  if (facts.isRunning) return "blink";
  if (facts.hasUnread) return "blue";
  return "none";
}

/** 折叠项目只显示一个最高优先级代表点（红 > 蓝 > 闪烁 > 无）。 */
export function deriveProjectVisibleDot(sessions: readonly VisibleDotFacts[]): ConversationVisibleDot {
  let highest: ConversationVisibleDot = "none";
  for (const session of sessions) {
    const status = deriveVisibleDot(session);
    if (status === "red") return "red";
    if (status === "blue") highest = "blue";
    else if (status === "blink" && highest === "none") highest = "blink";
  }
  return highest;
}

/**
 * Dock 只统计未归档会话中当前可见红点或蓝点的去重会话数；闪烁与无点不计。
 * 入参为当前可见（未归档）会话列表——归档会话已从侧边栏生命周期退出。
 */
export function countDockVisibleDots(
  sessions: readonly Pick<LocalConsoleSessionSummary, "sessionId" | "roundState">[],
  facts: ReadonlyMap<string, Pick<VisibleDotFacts, "hasUnread" | "isRunning" | "needsAttention" | "isNonContinuable" | "hasUnacknowledgedAttention">>,
): number {
  let count = 0;
  for (const session of sessions) {
    const perSession = facts.get(session.sessionId);
    if (perSession === undefined) continue;
    const dot = deriveVisibleDot({
      roundState: session.roundState ?? null,
      ...perSession,
    });
    if (dot === "red" || dot === "blue") count += 1;
  }
  return count;
}

/** Dock 会话事实投影（domain）：从会话摘要派生可见点输入，无 IO。 */
export function projectDockSessionFacts(session: {
  sessionId: string;
  unreadSince?: string | null;
  manualUnreadAt?: string | null;
  runningCount?: number;
  hasPendingControlWork?: boolean;
  awaitsHumanReason?: string | null;
  roundState?: LocalRoundState | null;
  continuation?: { canContinue: boolean } | null;
  hasUnacknowledgedAttention?: boolean;
}): {
  sessionId: string;
  facts: Pick<VisibleDotFacts, "hasUnread" | "isRunning" | "needsAttention" | "isNonContinuable" | "hasUnacknowledgedAttention">;
} {
  const roundState = session.roundState ?? null;
  return {
    sessionId: session.sessionId,
    facts: {
      hasUnread: (session.unreadSince ?? null) !== null || (session.manualUnreadAt ?? null) !== null,
      isRunning: (session.runningCount ?? 0) > 0 || session.hasPendingControlWork === true,
      needsAttention: session.awaitsHumanReason !== null
        || (roundState !== null
          && roundState.kind === "terminal"
          && (roundState.fact?.outcome === "awaiting-user" || roundState.fact?.outcome === "silent-closeout")),
      isNonContinuable: session.continuation !== null
        && session.continuation !== undefined
        && session.continuation.canContinue === false,
      hasUnacknowledgedAttention: session.hasUnacknowledgedAttention === true,
    },
  };
}
