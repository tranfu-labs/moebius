export type ConversationStatusDot = "red" | "blue" | "blink" | "none";

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
