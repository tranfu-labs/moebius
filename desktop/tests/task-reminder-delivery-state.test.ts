import { describe, expect, it } from "vitest";
import { LocalRoundTerminalBus, type LocalRoundTerminalEvent } from "../../src/local-console/round-terminal-event-bus.js";
import { TaskReminderDeliveryRuntime } from "../src/task-reminder-delivery-runtime.js";
import {
  createTaskReminderDeliveryState,
  parseTaskReminderDeliveryState,
  readTaskReminderDeliveryState,
  saveTaskReminderDeliveryState,
  resolveTaskReminderDeliveryStatePath,
  type TaskReminderDeliveryStateDocument,
} from "../src/task-reminder-delivery-state.js";
import type { MacOsPermissionAdapter, MacOsNotificationPermissionSnapshot } from "../src/macos-permission-adapter.js";
import type { MacOsNotificationChannel, NotificationChannelResult } from "../src/notification-channel.js";
import type { PermissionModalState } from "../src/permission-modal-plan.js";

const notDetermined: MacOsNotificationPermissionSnapshot = {
  authorizationStatus: "notDetermined",
  alert: "notSupported",
  sound: "notSupported",
  badge: "notSupported",
  error: null,
};

function terminalEvent(roundId: number, outcome: LocalRoundTerminalEvent["outcome"] = "completed"): LocalRoundTerminalEvent {
  return {
    eventId: `session:round:terminal:s:${String(roundId)}`,
    sessionId: "s",
    roundId,
    outcome,
    terminalMessageId: 7,
    conversationTitle: "T",
    occurredAt: `2026-08-10T09:0${roundId}:00.000Z`,
  };
}

function createHarness(
  initialState: TaskReminderDeliveryStateDocument | null = null,
  permissionOverride: MacOsPermissionAdapter | null = null,
) {
  const bus = new LocalRoundTerminalBus();
  let state = initialState ?? createTaskReminderDeliveryState();
  const savedStates: TaskReminderDeliveryStateDocument[] = [];
  const permission: MacOsPermissionAdapter = permissionOverride ?? {
    read: async () => notDetermined,
    request: async () => notDetermined,
  };
  let shown: Array<{ sessionId: string; roundId: number; terminalMessageId: number | null }> = [];
  const channel = {
    onNotificationClick: () => () => undefined,
    show: (input: { sessionId: string; roundId: number; terminalMessageId: number | null; title: string; body: string }) => {
      shown.push(input);
      return { ok: true } satisfies NotificationChannelResult;
    },
    setDockBadge: () => undefined,
  } as unknown as MacOsNotificationChannel;
  const preference = { enabled: true };
  const runtime = new TaskReminderDeliveryRuntime({
    bus,
    permission,
    channel,
    preferenceEnabled: async () => preference.enabled,
    savePreference: async () => undefined,
    loadState: async () => state,
    saveState: async (next) => {
      state = next;
      savedStates.push(next);
    },
    openSystemSettings: async () => true,
    nowIso: () => "2026-08-10T09:05:00.000Z",
  });
  return { bus, runtime, savedStates, state: () => state, shown: () => shown, setEnabled: (v: boolean) => { preference.enabled = v; } };
}

describe("task-reminder-delivery-state 持久化", () => {
  it("损坏/缺失文件回退为空状态；合法文档被解析", async () => {
    expect(parseTaskReminderDeliveryState(null)).toEqual(createTaskReminderDeliveryState());
    expect(parseTaskReminderDeliveryState({ version: 99 })).toEqual(createTaskReminderDeliveryState());
      expect(parseTaskReminderDeliveryState({ version: 1, deliveredEventIds: ["e1", 3], modalEntries: [{ eventId: "e2", sessionId: "s", title: "T", outcome: "completed" }, { junk: true }], lastClicked: { sessionId: "s", roundId: 1, terminalMessageId: 2, clickedAt: "x" }, lastConsumedClickAt: "y" }))
      .toEqual({
        version: 1,
        deliveredEventIds: ["e1"],
        modalEntries: [{ eventId: "e2", sessionId: "s", title: "T", outcome: "completed" }],
        notificationTargets: {},
        lastClicked: { sessionId: "s", roundId: 1, terminalMessageId: 2, clickedAt: "x" },
        lastConsumedClickAt: "y",
      });
  });

  it("保留合法通知目标并过滤非法目标；旧状态缺省为空映射", () => {
    expect(parseTaskReminderDeliveryState({
      version: 1,
      deliveredEventIds: [],
      modalEntries: [],
      notificationTargets: {
        known: { sessionId: "s", roundId: 1, terminalMessageId: null },
        bad: { sessionId: "s", roundId: "1", terminalMessageId: null },
      },
      lastClicked: null,
      lastConsumedClickAt: null,
    }).notificationTargets).toEqual({
      known: { sessionId: "s", roundId: 1, terminalMessageId: null },
    });
    expect(parseTaskReminderDeliveryState({ version: 1 }).notificationTargets).toEqual({});
  });

  it("文件读写：临时目录落盘后可读回", async () => {
    const root = `/tmp/moebius-task-reminder-state-test-${process.pid}-${Date.now()}`;
    const state = { ...createTaskReminderDeliveryState(), deliveredEventIds: ["e1"] };
    await saveTaskReminderDeliveryState(root, state);
    const readBack = await readTaskReminderDeliveryState(root);
    expect(readBack.deliveredEventIds).toEqual(["e1"]);
    expect(resolveTaskReminderDeliveryStatePath(root).endsWith("task-reminder-delivery.json")).toBe(true);
    // 损坏文件回退空状态
    await import("node:fs/promises").then((fs) => fs.writeFile(resolveTaskReminderDeliveryStatePath(root), "{broken", "utf8"));
    expect((await readTaskReminderDeliveryState(root)).deliveredEventIds).toEqual([]);
  });
});

describe("task-reminder-delivery-runtime 重启恢复", () => {
  it("权限未通过 → 弹窗条目落盘；重建 runtime 恢复同一弹窗且不补发", async () => {
    const harness = createHarness();
    await harness.runtime.ready();
    harness.bus.emit(terminalEvent(1));
    await Promise.resolve();
    // 等待 handleTerminal 完成（事件循环两次让 async 链落定）
    await new Promise((resolve) => setTimeout(resolve, 0));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(harness.shown()).toEqual([]);
    const persisted = harness.state();
    expect(persisted.modalEntries).toHaveLength(1);
    expect(persisted.modalEntries[0]).toMatchObject({ eventId: "session:round:terminal:s:1", sessionId: "s" });
    expect(persisted.deliveredEventIds).toEqual(["session:round:terminal:s:1"]);

    // 重建 runtime（模拟应用重启），从同一状态恢复
    const restarted = createHarness(persisted);
    await restarted.runtime.ready();
    const snapshot = restarted.runtime.snapshot();
    expect(snapshot.modal).toMatchObject({ open: true, phase: "idle" });
    expect(snapshot.modal.entries).toHaveLength(1);
    // 同一事件重放 → 已投递 → 不再入队
    restarted.bus.emit(terminalEvent(1));
    await new Promise((resolve) => setTimeout(resolve, 0));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(restarted.runtime.snapshot().modal.entries).toHaveLength(1);
  });

  it("权限允许 → 通知提交并记录 delivered；重启后同一事件不补发", async () => {
    const authorized: MacOsPermissionAdapter = {
      read: async () => ({ ...notDetermined, authorizationStatus: "authorized", alert: "enabled", sound: "enabled", badge: "enabled" }),
      request: async () => ({ ...notDetermined, authorizationStatus: "authorized", alert: "enabled", sound: "enabled", badge: "enabled" }),
    };
    const harness = createHarness(null, authorized);
    await harness.runtime.ready();
    harness.bus.emit(terminalEvent(1));
    await new Promise((resolve) => setTimeout(resolve, 0));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(harness.shown()).toHaveLength(1);
    expect(harness.shown()[0]).toMatchObject({ sessionId: "s", roundId: 1, terminalMessageId: 7 });
    expect(harness.state().deliveredEventIds).toEqual(["session:round:terminal:s:1"]);
    // 重建 runtime（模拟重启），同一事件重放 → 已投递 → 不补发
    const restarted = createHarness(harness.state(), authorized);
    await restarted.runtime.ready();
    restarted.bus.emit(terminalEvent(1));
    await new Promise((resolve) => setTimeout(resolve, 0));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(restarted.shown()).toEqual([]);
  });

  it("通知点击载荷持久化：recordClick → pendingClick；consumeClick 后清空", async () => {
    const harness = createHarness();
    await harness.runtime.ready();
    expect(harness.runtime.pendingClick()).toBeNull();
    await harness.runtime.recordClick({ sessionId: "s", roundId: 1, terminalMessageId: 7 });
    expect(harness.runtime.pendingClick()).toEqual({ sessionId: "s", roundId: 1, terminalMessageId: 7 });
    // 崩溃/重启：新 runtime 从持久化载荷恢复
    const restarted = createHarness(harness.state());
    await restarted.runtime.ready();
    expect(restarted.runtime.pendingClick()).toEqual({ sessionId: "s", roundId: 1, terminalMessageId: 7 });
    await restarted.runtime.consumeClick();
    expect(restarted.runtime.pendingClick()).toBeNull();
  });

  it("applyModalAction 授权通过后弹窗条目清空并落盘", async () => {
    const harness = createHarness();
    await harness.runtime.ready();
    harness.bus.emit(terminalEvent(1));
    await new Promise((resolve) => setTimeout(resolve, 0));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(harness.runtime.snapshot().modal.open).toBe(true);
    const modal = await harness.runtime.applyModalAction({ kind: "request-finished", permissionAllowed: true });
    expect(modal).toMatchObject({ open: false, phase: "idle", entries: [] });
    expect(harness.state().modalEntries).toEqual([]);
  });

  it("ensurePermission：首次读取真实权限；总开关关闭时不读；已缓存不重复读", async () => {
    let reads = 0;
    const adapter: MacOsPermissionAdapter = {
      read: async () => {
        reads += 1;
        return notDetermined;
      },
      request: async () => notDetermined,
    };
    const harness = createHarness(null, adapter);
    await harness.runtime.ready();
    expect(harness.runtime.snapshot().lastPermission).toBeNull();
    harness.setEnabled(false);
    await harness.runtime.ensurePermission();
    expect(reads).toBe(0);
    harness.setEnabled(true);
    await harness.runtime.ensurePermission();
    expect(reads).toBe(1);
    expect(harness.runtime.snapshot().lastPermission?.authorizationStatus).toBe("notDetermined");
    await harness.runtime.ensurePermission();
    expect(reads).toBe(1);
  });

  it("request 失败后回读真实状态：已拒绝显示 denied 而非 unavailable", async () => {
    const denied: MacOsNotificationPermissionSnapshot = { ...notDetermined, authorizationStatus: "denied" };
    const adapter: MacOsPermissionAdapter = {
      read: async () => denied,
      request: async () => ({ ...notDetermined, error: "Notifications are not allowed for this application" }),
    };
    const harness = createHarness(null, adapter);
    await harness.runtime.ready();
    const modal = await harness.runtime.applyModalAction({ kind: "request" });
    expect(harness.runtime.snapshot().lastPermission).toEqual(denied);
    expect(modal).toMatchObject({ phase: "request-done" });
  });
});
