import { describe, expect, it } from "vitest";
import {
  buildRoundView,
  planLatestPrimaryCloseout,
  planLatestPrimaryCloseoutFromLog,
  parsePrimaryCloseoutFact,
  planRoundCloseout,
  planRoundStart,
  LOCAL_PRIMARY_CLOSEOUT_FACT_TYPE,
  LOCAL_ROUND_SILENT_WINDOW_MS,
  type LocalPrimaryCloseoutFact,
  type LocalRoundFact,
  type LocalRoundViewInput,
} from "../src/local-console/round-closeout-plan.js";

const T0 = "2026-08-10T09:00:00.000Z";
const SILENT = LOCAL_ROUND_SILENT_WINDOW_MS;

function baseView(overrides: Partial<LocalRoundViewInput> = {}): LocalRoundViewInput {
  return {
    nowIso: T0,
    lastUserMessageAt: T0,
    lastActivityAt: T0,
    activeWork: false,
    awaitingHuman: false,
    producedContent: false,
    latestAgentMessageId: null,
    lastPrimaryFinishAt: null,
    lastRound: null,
    silentWindowMs: SILENT,
    resumedSilentMs: 0,
    ...overrides,
  };
}

function fact(roundId: number, occurredAt: string, outcome: LocalRoundFact["outcome"] = "completed"): LocalRoundFact {
  return { roundId, outcome, terminalMessageId: 42, occurredAt };
}

describe("round-closeout-plan", () => {
  it("没有用户消息且从未收束时是 not-started", () => {
    const result = planRoundCloseout(baseView({ lastUserMessageAt: null }));
    expect(result).toEqual({
      kind: "noop",
      state: { kind: "not-started", roundId: 0, fact: null, silentSince: null },
    });
  });

  it("主理人收束且有新内容 → completed，并绑定终局消息 id", () => {
    const result = planRoundCloseout(baseView({
      producedContent: true,
      latestAgentMessageId: 7,
      lastPrimaryFinishAt: "2026-08-10T09:05:00.000Z",
    }));
    expect(result).toMatchObject({
      kind: "record-terminal",
      fact: { roundId: 1, outcome: "completed", terminalMessageId: 7 },
    });
  });

  it("主理人收束且等待用户 → awaiting-user", () => {
    const result = planRoundCloseout(baseView({
      awaitingHuman: true,
      producedContent: true,
      latestAgentMessageId: 9,
      lastPrimaryFinishAt: "2026-08-10T09:05:00.000Z",
    }));
    expect(result).toMatchObject({
      kind: "record-terminal",
      fact: { roundId: 1, outcome: "awaiting-user", terminalMessageId: 9 },
    });
  });

  it("主理人收束但无新内容 → no-new-content，无终局消息", () => {
    const result = planRoundCloseout(baseView({
      producedContent: false,
      lastPrimaryFinishAt: "2026-08-10T09:05:00.000Z",
    }));
    expect(result).toMatchObject({
      kind: "record-terminal",
      fact: { roundId: 1, outcome: "no-new-content", terminalMessageId: null },
    });
  });

  it("收束后用户再次发送 → 新一轮开始，roundId 递增且旧结论清除", () => {
    const lastRound = fact(1, "2026-08-10T09:05:00.000Z");
    const result = planRoundCloseout(baseView({
      lastUserMessageAt: "2026-08-10T09:10:00.000Z",
      lastActivityAt: "2026-08-10T09:10:00.000Z",
      lastPrimaryFinishAt: null,
      lastRound,
    }));
    expect(result).toMatchObject({ kind: "start-silent", state: { kind: "in-progress", roundId: 2 } });
  });

  it("活动工作存在时取消静默并保持进行中", () => {
    const result = planRoundCloseout(baseView({
      activeWork: true,
      lastPrimaryFinishAt: null,
    }));
    expect(result).toEqual({
      kind: "cancel-silent",
      state: { kind: "in-progress", roundId: 1, fact: null, silentSince: null },
    });
  });

  it("连续静默满 30 秒 → silent-closeout", () => {
    const result = planRoundCloseout(baseView({
      nowIso: "2026-08-10T09:00:31.000Z",
      lastActivityAt: T0,
      lastUserMessageAt: T0,
      lastPrimaryFinishAt: null,
    }));
    expect(result).toMatchObject({
      kind: "record-terminal",
      fact: { roundId: 1, outcome: "silent-closeout", occurredAt: "2026-08-10T09:00:31.000Z" },
    });
  });

  it("静默未满 30 秒 → start-silent，静默起点为最后活动", () => {
    const result = planRoundCloseout(baseView({
      nowIso: "2026-08-10T09:00:20.000Z",
      lastActivityAt: T0,
      lastUserMessageAt: T0,
    }));
    expect(result).toMatchObject({ kind: "start-silent", silentSince: T0 });
  });

  it("等待用户时不走静默兜底", () => {
    const result = planRoundCloseout(baseView({
      nowIso: "2026-08-10T09:01:00.000Z",
      awaitingHuman: true,
      lastPrimaryFinishAt: null,
    }));
    expect(result).toMatchObject({ kind: "noop", state: { kind: "in-progress" } });
  });

  it("planRoundStart：用户消息晚于上次收束才算新一轮", () => {
    expect(planRoundStart("2026-08-10T09:10:00.000Z", fact(1, "2026-08-10T09:05:00.000Z"))).toBe(true);
    expect(planRoundStart("2026-08-10T09:04:00.000Z", fact(1, "2026-08-10T09:05:00.000Z"))).toBe(false);
    expect(planRoundStart("2026-08-10T09:10:00.000Z", null)).toBe(false);
  });
});

describe("round-closeout-plan 交棒五场景（一等收束信号）", () => {
  const T0 = "2026-08-10T09:00:00.000Z";
  const summary = () => ({
    runningCount: 0,
    waitingCount: 0,
    managedRunningCount: 0,
    hasPendingControlWork: false,
    awaitsHumanReason: null,
    title: "T",
    updatedAt: T0,
  });
  const message = (
    id: number,
    speaker: "user" | "agent",
    at: string,
    overrides: { role?: string | null; createdAt?: string } = {},
  ) => ({
    speaker,
    id,
    role: overrides.role ?? (speaker === "agent" ? "implementation-lead" : null),
    createdAt: overrides.createdAt ?? at,
    updatedAt: at,
  });
  const closeout = (messageId: number, occurredAt: string): LocalPrimaryCloseoutFact =>
    ({ messageId, role: "implementation-lead", occurredAt });

  const evaluate = (
    messages: ReturnType<typeof message>[],
    primaryCloseout: LocalPrimaryCloseoutFact | null,
    lastRound: LocalRoundFact | null = null,
    nowIso = "2026-08-10T09:05:00.000Z",
  ) => {
    const view = buildRoundView(messages, summary(), lastRound, nowIso, primaryCloseout);
    return { view, plan: planRoundCloseout(view) };
  };

  it("专业成员回复：主理人交棒后专业成员回复，无收束信号 → in-progress，不生成事实", () => {
    const messages = [
      message(1, "user", T0),
      message(2, "agent", "2026-08-10T09:01:00.000Z", { role: "implementation-lead" }),
      message(3, "agent", "2026-08-10T09:02:00.000Z", { role: "qa" }),
    ];
    const { view, plan } = evaluate(messages, null, null, "2026-08-10T09:02:10.000Z");
    expect(view.lastPrimaryFinishAt).toBeNull();
    expect(view.latestAgentMessageId).toBeNull();
    expect(view.producedContent).toBe(false);
    expect(plan).toMatchObject({ kind: "start-silent", state: { kind: "in-progress", roundId: 1 } });
    expect(plan.kind).not.toBe("record-terminal");
  });

  it("主理人待接回：专业成员完成后主理人尚未接回 → in-progress，不生成事实", () => {
    const messages = [
      message(1, "user", T0),
      message(2, "agent", "2026-08-10T09:01:00.000Z", { role: "implementation-lead" }),
      message(3, "agent", "2026-08-10T09:02:00.000Z", { role: "dev" }),
    ];
    const { view, plan } = evaluate(messages, null, null, "2026-08-10T09:02:10.000Z");
    expect(view.lastPrimaryFinishAt).toBeNull();
    expect(plan).toMatchObject({ kind: "start-silent", state: { kind: "in-progress", roundId: 1 } });
  });

  it("短暂空队列：交棒缝隙无活动工作但无收束信号 → 只进入静默计时，不生成事实", () => {
    const messages = [
      message(1, "user", T0),
      message(2, "agent", "2026-08-10T09:01:00.000Z", { role: "qa" }),
    ];
    const { view, plan } = evaluate(messages, null, null, "2026-08-10T09:01:20.000Z");
    expect(view.lastPrimaryFinishAt).toBeNull();
    expect(plan).toEqual({
      kind: "start-silent",
      state: { kind: "in-progress", roundId: 1, fact: null, silentSince: "2026-08-10T09:01:00.000Z" },
      silentSince: "2026-08-10T09:01:00.000Z",
    });
  });

  it("成员结束后继续推进：专业成员完成后主理人接回并继续产出 → 主理人最终消息才收束", () => {
    const messages = [
      message(1, "user", T0),
      message(2, "agent", "2026-08-10T09:01:00.000Z", { role: "implementation-lead" }),
      message(3, "agent", "2026-08-10T09:02:00.000Z", { role: "dev" }),
      message(4, "agent", "2026-08-10T09:03:00.000Z", { role: "implementation-lead" }),
    ];
    // 专业成员回复后（主理人未完成）：in-progress。
    const during = evaluate(messages, null, null, "2026-08-10T09:03:10.000Z");
    expect(during.plan).toMatchObject({ kind: "start-silent", state: { kind: "in-progress" } });
    // 主理人最终消息完成且不继续交棒 → 一等信号出现 → completed，绑定主理人消息 id。
    const done = evaluate(messages, closeout(4, "2026-08-10T09:03:00.000Z"), null, "2026-08-10T09:03:10.000Z");
    expect(done.plan).toMatchObject({
      kind: "record-terminal",
      fact: { roundId: 1, outcome: "completed", terminalMessageId: 4 },
    });
  });

  it("真正主理人收束：主理人完成且不交棒 → completed，终局消息为主理人消息", () => {
    const messages = [
      message(1, "user", T0),
      message(2, "agent", "2026-08-10T09:01:00.000Z", { role: "implementation-lead" }),
    ];
    const { view, plan } = evaluate(messages, closeout(2, "2026-08-10T09:01:00.000Z"));
    expect(view.producedContent).toBe(true);
    expect(view.latestAgentMessageId).toBe(2);
    expect(plan).toMatchObject({
      kind: "record-terminal",
      fact: { roundId: 1, outcome: "completed", terminalMessageId: 2, occurredAt: "2026-08-10T09:01:00.000Z" },
    });
  });

  it("主理人收束信号早于上一轮收束 → 不算本轮收束，保持 in-progress", () => {
    const lastRound = fact(1, "2026-08-10T09:05:00.000Z");
    const messages = [message(4, "user", "2026-08-10T09:10:00.000Z")];
    const { view, plan } = evaluate(messages, closeout(3, "2026-08-10T09:04:00.000Z"), lastRound, "2026-08-10T09:10:20.000Z");
    expect(view.lastPrimaryFinishAt).toBe("2026-08-10T09:04:00.000Z");
    expect(plan).toMatchObject({ kind: "start-silent", state: { kind: "in-progress", roundId: 2 } });
  });
});

describe("primary-closeout 事实解析与投影", () => {
  const factLine = (messageId: number, occurredAt: string) => ({
    version: 1,
    eventId: `e${String(messageId)}`,
    sessionId: "s",
    type: LOCAL_PRIMARY_CLOSEOUT_FACT_TYPE,
    recordedAt: occurredAt,
    payload: { messageId, role: "implementation-lead", occurredAt },
    messageUpserts: [],
  });

  it("解析合法行并拒绝错类型/错会话/坏负载", () => {
    const good = parsePrimaryCloseoutFact(factLine(7, "2026-08-10T09:01:00.000Z"), "s", LOCAL_PRIMARY_CLOSEOUT_FACT_TYPE);
    expect(good).toEqual({ messageId: 7, role: "implementation-lead", occurredAt: "2026-08-10T09:01:00.000Z" });
    expect(parsePrimaryCloseoutFact(factLine(7, "x"), "other", LOCAL_PRIMARY_CLOSEOUT_FACT_TYPE)).toBeNull();
    expect(parsePrimaryCloseoutFact({ ...factLine(7, "x"), type: "round_terminal" }, "s", LOCAL_PRIMARY_CLOSEOUT_FACT_TYPE)).toBeNull();
    expect(parsePrimaryCloseoutFact({ ...factLine(7, "x"), payload: { messageId: "bad" } }, "s", LOCAL_PRIMARY_CLOSEOUT_FACT_TYPE)).toBeNull();
    expect(parsePrimaryCloseoutFact(null, "s", LOCAL_PRIMARY_CLOSEOUT_FACT_TYPE)).toBeNull();
  });

  it("投影按完成时刻取最新，同一时刻按消息 id 取新", () => {
    expect(planLatestPrimaryCloseout(null, null)).toBeNull();
    const older = { messageId: 5, role: "implementation-lead", occurredAt: "2026-08-10T09:01:00.000Z" };
    const newer = { messageId: 9, role: "implementation-lead", occurredAt: "2026-08-10T09:02:00.000Z" };
    expect(planLatestPrimaryCloseout(older, newer)).toBe(newer);
    expect(planLatestPrimaryCloseout(newer, older)).toBe(newer);
    const sameTimeNewer = { ...older, messageId: 8 };
    expect(planLatestPrimaryCloseout(older, sameTimeNewer)).toBe(sameTimeNewer);
    const snapshot = { values: [factLine(5, "2026-08-10T09:01:00.000Z"), factLine(9, "2026-08-10T09:02:00.000Z"), "junk"] };
    expect(planLatestPrimaryCloseoutFromLog(snapshot, "s", LOCAL_PRIMARY_CLOSEOUT_FACT_TYPE)).toEqual(newer);
    expect(planLatestPrimaryCloseoutFromLog(null, "s", LOCAL_PRIMARY_CLOSEOUT_FACT_TYPE)).toBeNull();
    expect(planLatestPrimaryCloseoutFromLog({ values: [] }, "s", LOCAL_PRIMARY_CLOSEOUT_FACT_TYPE)).toBeNull();
  });
});
