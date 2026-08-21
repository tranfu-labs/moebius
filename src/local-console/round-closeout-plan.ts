/**
 * 轮次收束判定（纯 domain）。
 *
 * 输入是会话事实视图（由调用方从 store / 消息流组装），输出是下一轮次状态与需要执行的
 * 收束动作。本模块不接触文件、SQLite、进程或事件总线；静默计时与收束事实的落盘由
 * runtime 层负责。
 */

export type LocalRoundStateKind =
  | "not-started"
  | "in-progress"
  | "terminal";

export type LocalRoundTerminalOutcome =
  | "completed"
  | "awaiting-user"
  | "no-new-content"
  | "silent-closeout";

export interface LocalRoundFact {
  /** 单调递增的轮次序号；一轮 = 一次需要团队推进的用户动作。 */
  roundId: number;
  outcome: LocalRoundTerminalOutcome;
  terminalMessageId: number | null;
  occurredAt: string;
}

export interface LocalRoundState {
  kind: LocalRoundStateKind;
  /** 当前轮次（可能是进行中轮）。 */
  roundId: number;
  /** 收束结论；kind 为 terminal 时非空。 */
  fact: LocalRoundFact | null;
  /** 静默计时进行中（kind 为 in-progress 且满足静默条件时非空）。 */
  silentSince: string | null;
}

export interface LocalRoundViewInput {
  nowIso: string;
  /** 会话最后一条用户消息时间；null 表示尚无用户消息。 */
  lastUserMessageAt: string | null;
  /** 最后可见活动时间（Agent 消息、run 活动、待发射变化等）。 */
  lastActivityAt: string | null;
  /** 是否存在活动工作：running / waiting / 待发射 / 待接回。 */
  activeWork: boolean;
  /** 会话是否正在等待用户（awaitsHumanReason 非空）。 */
  awaitingHuman: boolean;
  /** 当前轮是否已有新的主理人回复内容。 */
  producedContent: boolean;
  /** 当前轮最新一条主理人/Agent 消息 id（producedContent 时非空），用于绑定收束事实。 */
  latestAgentMessageId: number | null;
  /**
   * 主理人不继续交棒的时刻；null 表示本轮还没有可判定的收束信号。
   * runtime 层从 run-lifecycle terminal 与消息流组装。
   */
  lastPrimaryFinishAt: string | null;
  /** 上一轮收束事实；null 表示从未收束。 */
  lastRound: LocalRoundFact | null;
  /** 静默窗口毫秒（默认 30_000）。 */
  silentWindowMs: number;
  /** 跨重启保留的已静默毫秒（上次会话中断时已累计的部分）。 */
  resumedSilentMs: number;
}

export type LocalRoundPlanResult =
  | { kind: "noop"; state: LocalRoundState }
  | { kind: "record-terminal"; state: LocalRoundState; fact: LocalRoundFact }
  | { kind: "start-silent"; state: LocalRoundState; silentSince: string }
  | { kind: "continue-silent"; state: LocalRoundState }
  | { kind: "cancel-silent"; state: LocalRoundState };

function isoToMs(value: string): number {
  return Date.parse(value);
}

function isAfter(value: string | null, reference: string | null): boolean {
  return value !== null && reference !== null && isoToMs(value) > isoToMs(reference);
}

/** 不早于比较：收束信号与上一轮收束事实同毫秒时仍属于当前轮。 */
function isNotBefore(value: string | null, reference: string | null): boolean {
  return value !== null && reference !== null && isoToMs(value) >= isoToMs(reference);
}

/** 判定新一轮是否开始：用户动作发生在上一轮收束之后。 */
export function planRoundStart(
  lastUserMessageAt: string | null,
  lastRound: LocalRoundFact | null,
): boolean {
  return isAfter(lastUserMessageAt, lastRound?.occurredAt ?? null);
}

/**
 * 核心纯函数：给定会话事实视图，推演下一轮次状态与动作。
 *
 * 优先级（高到低）：
 * 1. 无用户消息且从未收束 → not-started。
 * 2. 用户动作开始新一轮（清掉旧收束结论）→ in-progress。
 * 3. 有活动工作 → in-progress（清静默）。
 * 4. 主理人已收束（lastPrimaryFinishAt 晚于当前轮开始）→ 按内容与等待分类收束。
 * 5. 无活动工作且无待接回 → 静默计时：未开始则 start-silent；已满窗口则 silent-closeout；
 *    否则 continue-silent。
 * 6. 其他（等待用户但无收束信号、或主理人尚未完成）→ in-progress。
 */
export function planRoundCloseout(input: LocalRoundViewInput): LocalRoundPlanResult {
  const { nowIso, lastUserMessageAt } = input;

  if (lastUserMessageAt === null && input.lastRound === null) {
    return {
      kind: "noop",
      state: { kind: "not-started", roundId: 0, fact: null, silentSince: null },
    };
  }

  const nextRoundId = input.lastRound === null
    ? 1
    : planRoundStart(lastUserMessageAt, input.lastRound)
      ? input.lastRound.roundId + 1
      : input.lastRound.roundId;

  const roundStartAt = input.lastRound === null || nextRoundId > input.lastRound.roundId
    ? lastUserMessageAt
    : input.lastRound.occurredAt;

  const baseState: LocalRoundState = {
    kind: "in-progress",
    roundId: nextRoundId,
    fact: null,
    silentSince: null,
  };

  if (input.activeWork) {
    return { kind: "cancel-silent", state: baseState };
  }

  const primaryFinishedAfterRoundStart = isNotBefore(input.lastPrimaryFinishAt, roundStartAt);
  if (primaryFinishedAfterRoundStart && !input.awaitingHuman) {
    const outcome: LocalRoundTerminalOutcome = input.producedContent
      ? "completed"
      : "no-new-content";
    const fact: LocalRoundFact = {
      roundId: nextRoundId,
      outcome,
      terminalMessageId: input.producedContent ? input.latestAgentMessageId : null,
      occurredAt: input.lastPrimaryFinishAt!,
    };
    return { kind: "record-terminal", state: { ...baseState, kind: "terminal", fact }, fact };
  }

  if (primaryFinishedAfterRoundStart && input.awaitingHuman) {
    const fact: LocalRoundFact = {
      roundId: nextRoundId,
      outcome: "awaiting-user",
      terminalMessageId: input.producedContent ? input.latestAgentMessageId : null,
      occurredAt: input.lastPrimaryFinishAt!,
    };
    return { kind: "record-terminal", state: { ...baseState, kind: "terminal", fact }, fact };
  }

  // 静默兜底：无活动工作、无主理人收束信号、且会话不在等待用户时才计时。
  if (input.awaitingHuman) {
    return { kind: "noop", state: baseState };
  }

  const lastActivityAt = input.lastActivityAt ?? input.lastUserMessageAt;
  const roundStartMs = isoToMs(roundStartAt ?? lastUserMessageAt ?? nowIso);
  const activityMs = isoToMs(lastActivityAt ?? nowIso);
  const silentStart = new Date(Math.max(roundStartMs, activityMs)).toISOString();

  const elapsedMs = isoToMs(nowIso) - isoToMs(silentStart) + input.resumedSilentMs;
  if (elapsedMs >= input.silentWindowMs) {
    const fact: LocalRoundFact = {
      roundId: nextRoundId,
      outcome: "silent-closeout",
      terminalMessageId: null,
      occurredAt: nowIso,
    };
    return { kind: "record-terminal", state: { ...baseState, kind: "terminal", fact }, fact };
  }

  return {
    kind: "start-silent",
    state: { ...baseState, silentSince: silentStart },
    silentSince: silentStart,
  };
}
/** 与 {@link planRoundCloseout} 相同的静默窗口常量，供配置方引用。 */
export const LOCAL_ROUND_SILENT_WINDOW_MS = 30_000;

/** 收束事实日志类型标记（domain）。 */
export const LOCAL_ROUND_FACT_TYPE = "round_terminal";

/** 轮次投影 memo 判定（domain）：判定输入未变且结论可复用时直接返回既有状态。 */
export function planRoundMemoReuse(
  memo: {
    decisionKey: string;
    evaluatedAtMs: number;
    state: LocalRoundState;
  } | undefined,
  decisionKey: string,
  nowMs: number,
): { kind: "reuse"; state: LocalRoundState } | { kind: "evaluate" } {
  if (memo === undefined || memo.decisionKey !== decisionKey) {
    return { kind: "evaluate" };
  }
  if (memo.state.kind === "terminal") {
    return { kind: "reuse", state: memo.state };
  }
  if (nowMs - memo.evaluatedAtMs < LOCAL_ROUND_SILENT_WINDOW_MS) {
    return { kind: "reuse", state: memo.state };
  }
  return { kind: "evaluate" };
}

/** 轮次投影作用域判定（domain）：未指定作用域时使用全局默认，避免跨 store 共享。 */
export function planRoundProjectionScope(scope: string | undefined): string {
  return scope ?? "default";
}

/** 轮次投影 memo 剪枝判定（domain）：已消失会话的 memo 条目需要淘汰。 */
export function planRoundMemoPrune(
  memoKey: string,
  scope: string,
  seenSessionIds: ReadonlySet<string>,
): boolean {
  return memoKey.startsWith(`${scope}\u0000`) && !seenSessionIds.has(memoKey.slice(scope.length + 1));
}

/**
 * 主理人一等收束信号（domain）。
 *
 * 只在主控分发对一条主理人 Agent 消息做出 complete-source 判定（主理人完成且
 * 未点名下一位成员，即明确不继续交棒）时落盘；专业成员回复、交棒缝隙、待接回
 * 都不产生该事实。轮次收束只消费这个信号，不再从任意 Agent 消息推断。
 */
export const LOCAL_PRIMARY_CLOSEOUT_FACT_TYPE = "primary_closeout";

/** 事件 id 前缀（domain）。 */
export const LOCAL_ROUND_EVENT_ID_PREFIX = "session:round:terminal";

/** 主理人完成且明确不继续交棒的一等信号（domain）。 */
export interface LocalPrimaryCloseoutFact {
  /** 触发该信号的主理人 Agent 消息 id。 */
  messageId: number;
  /** 主理人角色 slug。 */
  role: string;
  /** 判定时刻（即主理人完成时刻）。 */
  occurredAt: string;
}

export interface LocalRoundSummaryFacts {
  /** 会话摘要的最近更新时刻（收束后无新活动时可复用既有结论）。 */
  updatedAt: string;
  runningCount?: number;
  waitingCount?: number;
  managedRunningCount?: number;
  hasPendingControlWork?: boolean;
  awaitsHumanReason?: string | null;
}

/**
 * 剪枝判定（domain）：收束后无新活动、无待处理工作时直接复用既有收束状态，
 * 避免每次查询重读消息流。返回复用或完整评估。
 */
export function planRoundReuse(
  lastRound: LocalRoundFact,
  summary: LocalRoundSummaryFacts,
): { kind: "reuse"; state: LocalRoundState } | { kind: "evaluate" } {
  const idle = (summary.runningCount ?? 0) === 0
    && (summary.waitingCount ?? 0) === 0
    && (summary.managedRunningCount ?? 0) === 0
    && summary.hasPendingControlWork !== true
    && (summary.awaitsHumanReason ?? null) === null;
  const noNewActivity = Date.parse(summary.updatedAt) <= Date.parse(lastRound.occurredAt);
  if (idle && noNewActivity) {
    return { kind: "reuse", state: { kind: "terminal", roundId: lastRound.roundId, fact: lastRound, silentSince: null } };
  }
  return { kind: "evaluate" };
}

/** 会话级轮次判定（domain）：无收束事实时直接进入完整评估。 */
export function planRoundSessionDecision(
  lastRound: LocalRoundFact | null,
  summary: LocalRoundSummaryFacts,
): { kind: "reuse"; state: LocalRoundState } | { kind: "evaluate" } {
  if (lastRound === null) {
    return { kind: "evaluate" };
  }
  return planRoundReuse(lastRound, summary);
}

/** 会话查找（domain）。 */
export function planSessionSummary<T extends { sessionId: string }>(
  sessions: readonly T[],
  sessionId: string,
): T | null {
  return sessions.find((candidate) => candidate.sessionId === sessionId) ?? null;
}

/** 持久化结果判定（domain）：真实落盘后才允许发布事件。 */
export function planPersistOutcome(persisted: boolean): { kind: "published" } | { kind: "silent" } {
  return persisted ? { kind: "published" } : { kind: "silent" };
}

/** 事实日志路径判定（domain）。 */
export function planFactLogPath(logPath: string | undefined): string | null {
  return logPath ?? null;
}

/** 持久化能力判定（domain）。 */
export function planPersistCapability(
  persist: ((input: {
    sessionId: string;
    roundId: number;
    outcome: LocalRoundTerminalOutcome;
    terminalMessageId: number | null;
    conversationTitle: string;
    occurredAt: string;
  }) => Promise<void>) | undefined,
): { kind: "capable"; persist: NonNullable<typeof persist> } | { kind: "incapable" } {
  return persist === undefined ? { kind: "incapable" } : { kind: "capable", persist };
}

/** 落盘判定（domain）：同一 roundId 的收束事实已存在时不再重复落盘/发布。 */
export function planRoundPersist(
  existing: LocalRoundFact | null,
  fact: LocalRoundFact,
): { kind: "persist" } | { kind: "skip" } {
  if (existing !== null && existing.roundId >= fact.roundId) {
    return { kind: "skip" };
  }
  return { kind: "persist" };
}

/**
 * 重评权威投影（domain）：落盘被跳过的重评（同 roundId 已有事实）必须返回既有
 * 事实的 terminal 状态，绝不把重评新结论（如静默兜底的 silent-closeout）当状态
 * 返回——否则 UI 会出现与事实日志不一致的 red。无既有事实时回退传入状态。
 */
export function planRoundExistingState(
  existing: LocalRoundFact | null,
  fallback: LocalRoundState,
): LocalRoundState {
  if (existing === null) {
    return fallback;
  }
  return { kind: "terminal", roundId: existing.roundId, fact: existing, silentSince: null };
}

/** 可选值规整（domain）：undefined 归一为 null。 */
export function planRoundLastFact<T>(value: T | null | undefined): T | null {
  return value ?? null;
}

/** 默认状态回退（domain）：无评估能力时返回 not-started。 */
export function planRoundStateOrDefault(state: LocalRoundState | null | undefined): LocalRoundState {
  return state ?? { kind: "not-started", roundId: 0, fact: null, silentSince: null };
}

/** 合并判定（domain）：无投影时保留原摘要，否则写回 roundState。 */
export function planSessionRoundMerge<T extends { sessionId: string }>(
  session: T,
  roundState: LocalRoundState | undefined,
): T & { roundState?: LocalRoundState | null } {
  return roundState === undefined ? session : { ...session, roundState };
}

/** 会话摘要最新更新时间（domain 派生）。 */
export function planSummaryLastActivity(summary: { updatedAt: string } | null): string | null {
  return summary === null ? null : summary.updatedAt;
}

/** 活跃工作判定（domain）：运行/等待/托管运行/待发射控制工作任一存在即活跃。 */
export function planActiveWork(summary: {
  runningCount?: number;
  waitingCount?: number;
  managedRunningCount?: number;
  hasPendingControlWork?: boolean;
} | null): boolean {
  if (summary === null) return false;
  return (summary.runningCount ?? 0) > 0
    || (summary.waitingCount ?? 0) > 0
    || (summary.managedRunningCount ?? 0) > 0
    || summary.hasPendingControlWork === true;
}

/** 等待用户判定（domain）。 */
export function planAwaitingHuman(summary: { awaitsHumanReason?: string | null } | null): boolean {
  return summary !== null && summary.awaitsHumanReason !== null && summary.awaitsHumanReason !== undefined;
}

/** 收束事实解析（domain）：校验并归一化事实日志行。 */
export function parseRoundPersistedFact(
  value: unknown,
  sessionId: string,
  factType: string,
): LocalRoundFact & { sessionId: string; conversationTitle: string } | null {
  if (typeof value !== "object" || value === null) return null;
  const event = value as { type?: unknown; sessionId?: unknown; payload?: unknown };
  if (event.type !== factType || event.sessionId !== sessionId) return null;
  if (typeof event.payload !== "object" || event.payload === null) return null;
  const candidate = event.payload as Partial<LocalRoundFact & { conversationTitle?: unknown }>;
  if (
    typeof candidate.roundId !== "number"
    || typeof candidate.outcome !== "string"
    || typeof candidate.occurredAt !== "string"
  ) {
    return null;
  }
  return {
    roundId: candidate.roundId,
    outcome: candidate.outcome as LocalRoundTerminalOutcome,
    terminalMessageId: typeof candidate.terminalMessageId === "number" ? candidate.terminalMessageId : null,
    sessionId,
    conversationTitle: typeof candidate.conversationTitle === "string" ? candidate.conversationTitle : "",
    occurredAt: candidate.occurredAt,
  };
}

/** 最新收束事实挑选（domain）。 */
export function planLatestRoundFact(
  current: (LocalRoundFact & { sessionId: string; conversationTitle: string }) | null,
  candidate: (LocalRoundFact & { sessionId: string; conversationTitle: string }) | null,
): (LocalRoundFact & { sessionId: string; conversationTitle: string }) | null {
  if (candidate === null) return current;
  if (current === null || candidate.roundId > current.roundId) return candidate;
  return current;
}

/** 主理人收束信号解析（domain）：校验并归一化事实日志行。 */
export function parsePrimaryCloseoutFact(
  value: unknown,
  sessionId: string,
  factType: string,
): LocalPrimaryCloseoutFact | null {
  if (typeof value !== "object" || value === null) return null;
  const event = value as { type?: unknown; sessionId?: unknown; payload?: unknown };
  if (event.type !== factType || event.sessionId !== sessionId) return null;
  if (typeof event.payload !== "object" || event.payload === null) return null;
  const candidate = event.payload as Partial<LocalPrimaryCloseoutFact>;
  if (
    typeof candidate.messageId !== "number"
    || typeof candidate.role !== "string"
    || candidate.role.length === 0
    || typeof candidate.occurredAt !== "string"
  ) {
    return null;
  }
  return {
    messageId: candidate.messageId,
    role: candidate.role,
    occurredAt: candidate.occurredAt,
  };
}

/** 最新主理人收束信号挑选（domain）：按完成时刻取新，同一时刻按消息 id 取新。 */
export function planLatestPrimaryCloseout(
  current: LocalPrimaryCloseoutFact | null,
  candidate: LocalPrimaryCloseoutFact | null,
): LocalPrimaryCloseoutFact | null {
  if (candidate === null) return current;
  if (current === null) return candidate;
  const currentMs = Date.parse(current.occurredAt);
  const candidateMs = Date.parse(candidate.occurredAt);
  if (candidateMs > currentMs) return candidate;
  if (candidateMs === currentMs && candidate.messageId > current.messageId) return candidate;
  return current;
}

/** 主理人收束信号日志投影（domain）：解析全部行并返回最新信号。 */
export function planLatestPrimaryCloseoutFromLog(
  snapshot: { values: readonly unknown[] } | null,
  sessionId: string,
  factType: string,
): LocalPrimaryCloseoutFact | null {
  if (snapshot === null) return null;
  let last: LocalPrimaryCloseoutFact | null = null;
  for (const value of snapshot.values) {
    last = planLatestPrimaryCloseout(last, parsePrimaryCloseoutFact(value, sessionId, factType));
  }
  return last;
}

/** 事实日志投影（domain）：解析全部行并返回最新收束事实。 */
export function planLatestRoundFactFromLog(
  snapshot: { values: readonly unknown[] } | null,
  sessionId: string,
  factType: string,
): (LocalRoundFact & { sessionId: string; conversationTitle: string }) | null {
  if (snapshot === null) return null;
  let last: (LocalRoundFact & { sessionId: string; conversationTitle: string }) | null = null;
  for (const value of snapshot.values) {
    const fact = parseRoundPersistedFact(value, sessionId, factType);
    last = planLatestRoundFact(last, fact);
  }
  return last;
}

/** 摘要标题（domain 派生）。 */
export function planSummaryTitle(summary: { title: string } | null): string {
  return summary?.title ?? "";
}

/**
 * 轮次视图组装（domain）：从消息流、会话摘要与一等收束信号派生纯 domain 输入。
 * 无 IO；消息流与事实日志读取由调用方完成。
 *
 * 主理人收束（lastPrimaryFinishAt / producedContent / latestAgentMessageId）只
 * 消费 {@link LocalPrimaryCloseoutFact}（主理人完成且明确不继续交棒），不再从任意
 * Agent 消息推断；专业成员回复与交棒缝隙因此保持 in-progress。
 */
export function buildRoundView(
  messages: readonly { speaker: string; id: number; createdAt: string; updatedAt: string }[],
  summary: {
    runningCount?: number;
    waitingCount?: number;
    managedRunningCount?: number;
    hasPendingControlWork?: boolean;
    awaitsHumanReason?: string | null;
    title: string;
    updatedAt: string;
  } | null,
  lastRound: LocalRoundFact | null,
  nowIso: string,
  primaryCloseout: LocalPrimaryCloseoutFact | null,
): LocalRoundViewInput {
  const visible = messages.filter((message) => planRoundSpeaker(message.speaker));
  const lastUserMessage = [...visible].reverse().find((message) => message.speaker === "user");
  // 一等收束信号与上一轮收束事实同毫秒（primary_closeout 与 round_terminal 在
  // 同一判定时刻成对落盘）时仍属于当前轮；严格早于上一轮收束的旧信号不算。
  const closeoutInRound = primaryCloseout !== null
    && (lastRound === null || isNotBefore(primaryCloseout.occurredAt, lastRound.occurredAt));

  return {
    nowIso,
    lastUserMessageAt: lastUserMessage?.createdAt ?? null,
    lastActivityAt: planLatestActivityAt(visible),
    activeWork: planActiveWork(summary),
    awaitingHuman: planAwaitingHuman(summary),
    producedContent: closeoutInRound,
    latestAgentMessageId: closeoutInRound ? primaryCloseout!.messageId : null,
    lastPrimaryFinishAt: primaryCloseout?.occurredAt ?? null,
    lastRound,
    silentWindowMs: LOCAL_ROUND_SILENT_WINDOW_MS,
    resumedSilentMs: 0,
  };
}

/** 发言者可见性（domain）：只统计用户与 Agent 消息。 */
export function planRoundSpeaker(speaker: string): boolean {
  return speaker === "user" || speaker === "agent";
}

/** 最后活动时刻（domain）：消息创建/更新时间的最大值。 */
export function planLatestActivityAt(
  messages: readonly { createdAt: string; updatedAt: string }[],
): string | null {
  let latest: string | null = null;
  for (const message of messages) {
    const candidates = [message.createdAt, message.updatedAt];
    for (const candidate of candidates) {
      if (latest === null || Date.parse(candidate) > Date.parse(latest)) {
        latest = candidate;
      }
    }
  }
  return latest;
}
