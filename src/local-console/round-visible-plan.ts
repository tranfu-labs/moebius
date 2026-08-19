import type { LocalRoundState } from "./round-closeout-plan.js";
import type { LocalConsoleProjectSummary, LocalConsoleSessionSummary, LocalConsoleSystemEventKind } from "./types.js";

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
  /** 需要用户处理（awaiting-user 结论；silent-closeout 不单独点亮，见 needsAttention 投影）。 */
  needsAttention: boolean;
  /** 非延续会话（项目不可用等）优先红点。 */
  isNonContinuable: boolean;
  hasUnacknowledgedAttention?: boolean;
  /** 三类未解决运行异常是 attention 的兼容输入；规范化状态由查询层优先提供。 */
  unresolvedSystemEventKind?: LocalConsoleSystemEventKind | null;
  /** 查询层已经完成规范化后的唯一展示状态；存在时禁止再次推断。 */
  canonicalStatusDot?: ConversationVisibleDot;
  /** 会话已归档（归档不显示点、不计 Dock）。 */
  archived?: boolean;
}

export function deriveVisibleDot(facts: VisibleDotFacts): ConversationVisibleDot {
  if (facts.archived === true) return "none";
  if (facts.canonicalStatusDot !== undefined) return facts.canonicalStatusDot;
  if (
    facts.hasUnacknowledgedAttention === true
    || (
      facts.hasUnacknowledgedAttention === undefined
      && (
        facts.isNonContinuable
        || facts.unresolvedSystemEventKind === "run-not-started"
        || facts.unresolvedSystemEventKind === "run-stuck"
        || facts.unresolvedSystemEventKind === "retry-exhausted"
      )
    )
  ) return "red";
  if (facts.roundState !== null && facts.roundState.kind === "terminal") {
    // 收束后：需要用户处理 → 红；有新结果未读 → 蓝；无点（已读/无内容）。
    if (facts.needsAttention) return "red";
    return facts.hasUnread ? "blue" : "none";
  }
  if (facts.isRunning) return "blink";
  if (facts.hasUnread) return "blue";
  return "none";
}

/**
 * 在所有会话事实合并完成后计算唯一的可见状态点。
 *
 * 该函数是 local-console 的规范化投影入口；侧栏、项目聚合和 Dock
 * 不应根据 continuation 或 attention 自行重新推断红点。
 */
export function projectCanonicalSessionStatus(
  session: Omit<
    Pick<
      LocalConsoleSessionSummary,
      | "roundState"
      | "unreadSince"
      | "manualUnreadAt"
      | "runningCount"
      | "hasPendingControlWork"
      | "awaitsHumanReason"
      | "continuation"
      | "hasUnacknowledgedAttention"
      | "unresolvedSystemEventKind"
    >,
    "continuation"
  > & { continuation?: { canContinue: boolean } | null },
): ConversationVisibleDot {
  const roundState = session.roundState ?? null;
  return deriveVisibleDot({
    roundState,
    hasUnread: (session.unreadSince ?? null) !== null || (session.manualUnreadAt ?? null) !== null,
    isRunning: (session.runningCount ?? 0) > 0 || session.hasPendingControlWork === true,
    needsAttention: session.awaitsHumanReason !== null
      || (
        roundState !== null
        && roundState.kind === "terminal"
        && roundState.fact?.outcome === "awaiting-user"
      ),
    isNonContinuable: session.continuation?.canContinue === false,
    hasUnacknowledgedAttention: session.hasUnacknowledgedAttention,
    unresolvedSystemEventKind: session.unresolvedSystemEventKind,
  });
}

/** 为全部可见会话写入规范化状态点；纯函数，可重复执行。 */
export function projectCanonicalSessionStatuses(
  projects: readonly LocalConsoleProjectSummary[],
): LocalConsoleProjectSummary[] {
  return projects.map((project) => ({
    ...project,
    sessions: project.sessions.map((session) => ({
      ...session,
      statusDot: projectCanonicalSessionStatus(session),
    })),
  }));
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
  sessions: readonly Pick<LocalConsoleSessionSummary, "sessionId" | "statusDot">[],
): number {
  return sessions.reduce(
    (count, session) => count + (session.statusDot === "red" || session.statusDot === "blue" ? 1 : 0),
    0,
  );
}
