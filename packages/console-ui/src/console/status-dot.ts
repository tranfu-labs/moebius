export type ConversationStatusDot = "red" | "blue" | "blink" | "none";

export interface OperatorRoundFact {
  roundId: number;
  outcome: "completed" | "awaiting-user" | "no-new-content" | "silent-closeout";
  terminalMessageId: number | null;
  occurredAt: string;
}

export interface OperatorRoundState {
  kind: "not-started" | "in-progress" | "terminal";
  roundId: number;
  fact: OperatorRoundFact | null;
  silentSince: string | null;
}

export interface StatusDotFacts {
  /** Legacy field retained only for source compatibility; it never affects the dot. */
  awaitsHumanReason?: string | null;
  unresolvedSystemEventKind?: "run-not-started" | "run-stuck" | "retry-exhausted" | null;
  isNonContinuable?: boolean;
  unreadSince: string | null;
  manualUnreadAt?: string | null;
  hasUnread?: boolean;
  hasUnacknowledgedAttention?: boolean;
  isRunning: boolean;
  hasPendingControlWork?: boolean;
  /** Legacy field retained only for source compatibility; it never affects the dot. */
  lastMessageMentionsAgent?: boolean;
  /** 轮次状态投影；存在时单点语义优先（与 Dock 计数同源，见 round-visible-plan）。 */
  roundState?: OperatorRoundState | null;
}

/**
 * 收束后需要用户处理。
 *
 * 只保留 awaiting-user：silent-closeout 是兜底收束（无一等收束信号时的静置
 * 结论），升级前被追溯落盘的 silent-closeout 不能把历史会话整片点亮；真实
 * 异常会话的红点由 attention / unresolvedSystemEventKind 机制承担。
 */
export function planRoundNeedsAttention(roundState: OperatorRoundState | null | undefined): boolean {
  return roundState !== null
    && roundState !== undefined
    && roundState.kind === "terminal"
    && roundState.fact?.outcome === "awaiting-user";
}

export function deriveStatusDot(facts: StatusDotFacts): ConversationStatusDot {
  if (
    facts.hasUnacknowledgedAttention === true
    || (
      facts.hasUnacknowledgedAttention === undefined
      && ((facts.unresolvedSystemEventKind ?? null) !== null || facts.isNonContinuable === true)
    )
  ) {
    return "red";
  }
  if (facts.roundState !== null && facts.roundState !== undefined && facts.roundState.kind === "terminal") {
    // 收束后：需要用户处理 → 红；有新结果未读 → 蓝；无点（已读/无内容）。
    if (planRoundNeedsAttention(facts.roundState)) {
      return "red";
    }
    const hasUnread = facts.hasUnread
      ?? ((facts.unreadSince ?? null) !== null || (facts.manualUnreadAt ?? null) !== null);
    return hasUnread ? "blue" : "none";
  }
  const isRunning = facts.isRunning || facts.hasPendingControlWork === true;
  const hasUnread = facts.hasUnread
    ?? ((facts.unreadSince ?? null) !== null || (facts.manualUnreadAt ?? null) !== null);
  if (!isRunning && hasUnread) {
    return "blue";
  }
  if (isRunning) {
    return "blink";
  }
  return "none";
}

export function deriveProjectStatusDot(sessions: readonly StatusDotFacts[]): ConversationStatusDot {
  let highest: ConversationStatusDot = "none";
  for (const session of sessions) {
    const status = deriveStatusDot(session);
    if (status === "red") return "red";
    if (status === "blue") highest = "blue";
    else if (status === "blink" && highest === "none") highest = "blink";
  }
  return highest;
}
