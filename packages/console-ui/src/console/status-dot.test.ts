import { describe, expect, it } from "vitest";

import { deriveProjectStatusDot, deriveStatusDot, type StatusDotFacts } from "./status-dot";

const idle: StatusDotFacts = {
  unresolvedSystemEventKind: null,
  isNonContinuable: false,
  unreadSince: null,
  isRunning: false,
  hasPendingControlWork: false,
};

describe("conversation status dots", () => {
  it("uses red for the three unresolved exceptions and non-continuable state", () => {
    for (const kind of ["run-not-started", "run-stuck", "retry-exhausted"] as const) {
      expect(deriveStatusDot({ ...idle, unresolvedSystemEventKind: kind })).toBe("red");
    }
    expect(deriveStatusDot({ ...idle, isNonContinuable: true })).toBe("red");
  });

  it("uses the canonical local-console status without reinterpreting its source facts", () => {
    expect(deriveStatusDot({ ...idle, statusDot: "none", isNonContinuable: true })).toBe("none");
    expect(deriveStatusDot({ ...idle, statusDot: "red", isNonContinuable: false })).toBe("red");
  });

  it("uses blue only for unseen idle results with no pending control work", () => {
    expect(deriveStatusDot({ ...idle, unreadSince: "2026-07-22T00:00:00Z" })).toBe("blue");
    expect(deriveStatusDot({ ...idle, unreadSince: "x", hasPendingControlWork: true })).toBe("blink");
    expect(deriveStatusDot({ ...idle, unreadSince: "x", lastMessageMentionsAgent: true })).toBe("blue");
    expect(deriveStatusDot({ ...idle, unreadSince: "x", isRunning: true })).toBe("blink");
  });

  it("does not make stopped or normally completed conversations red", () => {
    expect(deriveStatusDot(idle)).toBe("none");
    expect(deriveStatusDot({ ...idle, lastMessageMentionsAgent: true })).toBe("none");
  });

  it("keeps red above blue above running for collapsed projects", () => {
    expect(deriveProjectStatusDot([
      { ...idle, isRunning: true },
      { ...idle, unreadSince: "x" },
      { ...idle, unresolvedSystemEventKind: "run-stuck" },
    ])).toBe("red");
    expect(deriveProjectStatusDot([{ ...idle, isRunning: true }, { ...idle, unreadSince: "x" }])).toBe("blue");
  });

  it("单点语义：收束后按需处理/未读/无点派生，进行中轮只显示闪烁", () => {
    const terminal = (outcome: "completed" | "awaiting-user" | "silent-closeout" | "no-new-content") => ({
      kind: "terminal" as const,
      roundId: 1,
      fact: { roundId: 1, outcome, terminalMessageId: null, occurredAt: "x" },
      silentSince: null,
    });
    expect(deriveStatusDot({ ...idle, roundState: terminal("awaiting-user") })).toBe("red");
    // silent-closeout 是兜底收束：不单独点亮（真实异常由 attention 机制承担；
    // 升级前被追溯落盘的 silent-closeout 因此不再把历史会话整片点亮）。
    expect(deriveStatusDot({ ...idle, roundState: terminal("silent-closeout") })).toBe("none");
    expect(deriveStatusDot({ ...idle, roundState: terminal("silent-closeout"), unreadSince: "x" })).toBe("blue");
    expect(deriveStatusDot({ ...idle, roundState: terminal("completed"), unreadSince: "x" })).toBe("blue");
    expect(deriveStatusDot({ ...idle, roundState: terminal("completed") })).toBe("none");
    expect(deriveStatusDot({ ...idle, roundState: terminal("no-new-content") })).toBe("none");
    expect(deriveStatusDot({
      ...idle,
      roundState: { kind: "in-progress", roundId: 1, fact: null, silentSince: null },
      isRunning: true,
    })).toBe("blink");
    // 新一轮开始后旧收束结论被清：in-progress 不显示蓝点
    expect(deriveStatusDot({
      ...idle,
      roundState: { kind: "in-progress", roundId: 2, fact: null, silentSince: null },
      unreadSince: "x",
      isRunning: true,
    })).toBe("blink");
  });
});
