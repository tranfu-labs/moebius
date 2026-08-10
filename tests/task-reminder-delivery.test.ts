import { describe, expect, it } from "vitest";
import {
  createPermissionModalState,
  planPermissionModalAction,
} from "../desktop/src/permission-modal-plan.js";
import {
  decidePermissionAllowed,
  planChannelStatus,
  planModalBridge,
  planNotificationBody,
  planPreferenceGate,
  planTerminalDelivery,
  planPreferenceSaveOutcome,
} from "../desktop/src/task-reminder-delivery-plan.js";
import { deriveVisibleDot, countDockVisibleDots, projectDockSessionFacts } from "../src/local-console/round-visible-plan.js";

describe("permission-modal-plan", () => {
  const entry = (sessionId: string, title: string, outcome: "completed" | "awaiting-user" | "no-new-content" | "silent-closeout" = "completed", eventId = `e-${sessionId}`) => ({ sessionId, title, outcome, eventId });

  it("打开弹窗按形成顺序合并多段对话并去重", () => {
    let state = createPermissionModalState();
    state = planPermissionModalAction(state, { kind: "open", entry: entry("a", "A") });
    state = planPermissionModalAction(state, { kind: "open", entry: entry("b", "B", "awaiting-user") });
    state = planPermissionModalAction(state, { kind: "open", entry: entry("a", "A") });
    expect(state.open).toBe(true);
    expect(state.entries.map((item) => item.sessionId)).toEqual(["a", "b"]);
    expect(state.entries[0]!.eventId).toBe("e-a");
  });

  it("授权通过关闭弹窗且不补发；未通过进入 request-done", () => {
    const state = planPermissionModalAction(
      { open: true, phase: "idle", entries: [entry("a", "A")], saveFailed: false },
      { kind: "request-finished", permissionAllowed: true },
    );
    expect(state.open).toBe(false);
    const denied = planPermissionModalAction(
      { open: true, phase: "idle", entries: [entry("a", "A")], saveFailed: false },
      { kind: "request-finished", permissionAllowed: false },
    );
    expect(denied).toMatchObject({ open: true, phase: "request-done" });
  });

  it("关闭任务提醒保存失败时保持弹窗并标记失败", () => {
    const state = planPermissionModalAction(
      { open: true, phase: "closing-save", entries: [], saveFailed: false },
      { kind: "close-save-failed" },
    );
    expect(state).toMatchObject({ open: true, phase: "closing-save-failed", saveFailed: true });
  });
});

describe("task-reminder-delivery-plan", () => {
  const authorized = { authorizationStatus: "authorized" as const, alert: "enabled" as const, sound: "enabled" as const, badge: "enabled" as const, error: null };
  const denied = { ...authorized, authorizationStatus: "denied" as const };
  const error = { ...authorized, error: "boom" };

  it("总开关关闭或已投递时 skip（不读权限、不弹窗、不提交）", () => {
    const event = { sessionId: "s", roundId: 1, outcome: "completed" as const, conversationTitle: "T", eventId: "e", terminalMessageId: 1, occurredAt: "x" };
    expect(planPreferenceGate(true, true)).toEqual({ kind: "skip" });
    expect(planPreferenceGate(false, false)).toEqual({ kind: "skip" });
    expect(planPreferenceGate(false, true)).toEqual({ kind: "pass" });
    expect(planTerminalDelivery({ alreadyDelivered: true, enabled: true, permission: authorized, event }).kind).toBe("skip");
    expect(planTerminalDelivery({ alreadyDelivered: false, enabled: false, permission: authorized, event }).kind).toBe("skip");
  });

  it("权限错误或未通过 → 弹窗承接；允许 → 通知", () => {
    const event = { sessionId: "s", roundId: 1, outcome: "completed" as const, conversationTitle: "T", eventId: "e", terminalMessageId: 1, occurredAt: "x" };
    expect(planTerminalDelivery({ alreadyDelivered: false, enabled: true, permission: error, event }).kind).toBe("modal");
    expect(planTerminalDelivery({ alreadyDelivered: false, enabled: true, permission: denied, event }).kind).toBe("modal");
    const notify = planTerminalDelivery({ alreadyDelivered: false, enabled: true, permission: authorized, event });
    expect(notify).toMatchObject({ kind: "notify", body: "T：已完成" });
    expect(planNotificationBody("awaiting-user")).toBe("正在等待你处理");
    expect(decidePermissionAllowed(authorized)).toBe(true);
    expect(decidePermissionAllowed(denied)).toBe(false);
  });

  it("通道状态与保存结果分类", () => {
    expect(planChannelStatus(error, true)).toBe("anomaly");
    expect(planChannelStatus(authorized, false)).toBe("unknown");
    expect(planChannelStatus(authorized, true)).toBe("ok");
    expect(planChannelStatus(denied, true)).toBe("anomaly");
    expect(planPreferenceSaveOutcome(true)).toEqual({ kind: "saved" });
    expect(planPreferenceSaveOutcome(false)).toEqual({ kind: "failed" });
    expect(planModalBridge({ kind: "request" })).toEqual({ kind: "bridge-request" });
    expect(planModalBridge({ kind: "open-settings" })).toEqual({ kind: "direct" });
  });
});

describe("round-visible-plan dock", () => {
  it("Dock 只统计当前可见红/蓝点；闪烁与无点不计", () => {
    const terminal = (roundId: number, outcome: "completed" | "awaiting-user") => ({
      kind: "terminal" as const,
      roundId,
      fact: { roundId, outcome, terminalMessageId: null, occurredAt: "x" },
      silentSince: null,
    });
    const sessions = [
      { sessionId: "a", roundState: terminal(1, "awaiting-user") }, // 红
      { sessionId: "b", roundState: terminal(1, "completed") }, // 蓝（未读）
      { sessionId: "c", roundState: { kind: "in-progress" as const, roundId: 1, fact: null, silentSince: null } }, // 闪
      { sessionId: "d", roundState: null },
    ];
    const facts = new Map([
      ["a", projectDockSessionFacts({ sessionId: "a", roundState: sessions[0].roundState }).facts],
      ["b", projectDockSessionFacts({ sessionId: "b", roundState: sessions[1].roundState }).facts],
      ["c", projectDockSessionFacts({ sessionId: "c", roundState: sessions[2].roundState }).facts],
      ["d", projectDockSessionFacts({ sessionId: "d", roundState: null }).facts],
    ]);
    expect(countDockVisibleDots(sessions, facts)).toBe(2);
    expect(deriveVisibleDot({ roundState: terminal(1, "awaiting-user"), hasUnread: false, isRunning: false, needsAttention: true, isNonContinuable: false, hasUnacknowledgedAttention: false })).toBe("red");
    expect(deriveVisibleDot({ roundState: terminal(1, "completed"), hasUnread: true, isRunning: false, needsAttention: false, isNonContinuable: false, hasUnacknowledgedAttention: false })).toBe("blue");
  });
});
