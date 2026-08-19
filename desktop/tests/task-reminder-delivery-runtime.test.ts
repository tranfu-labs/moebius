import { describe, expect, it, vi } from "vitest";

import type { LocalRoundTerminalBus, LocalRoundTerminalEvent } from "../../src/local-console/round-terminal-event-bus.js";
import { waitForValue } from "../../src/testing/wait.js";
import type {
  MacOsNotificationPermissionSnapshot,
  MacOsPermissionAdapter,
} from "../src/macos-permission-adapter.js";
import type { MacOsNotificationChannel, NotificationChannelResult } from "../src/notification-channel.js";
import type { TaskReminderDeliveryPersistedState } from "../src/task-reminder-delivery-plan.js";
import { TaskReminderDeliveryRuntime } from "../src/task-reminder-delivery-runtime.js";

const AUTHORIZED: MacOsNotificationPermissionSnapshot = {
  authorizationStatus: "authorized",
  alert: "enabled",
  sound: "enabled",
  badge: "enabled",
  error: null,
};

const TERMINAL: LocalRoundTerminalEvent = {
  eventId: "session:round:terminal:session-1:1",
  sessionId: "session-1",
  roundId: 1,
  outcome: "completed",
  terminalMessageId: 10,
  conversationTitle: "测试对话",
  occurredAt: "2026-08-19T10:00:00.000Z",
};

interface ShowCallInput {
  sessionId: string;
  roundId: number;
  terminalMessageId: number | null;
  title: string;
  body: string;
}

function createHarness(input: {
  enabled?: boolean;
  permission?: MacOsNotificationPermissionSnapshot;
  channelResult?: NotificationChannelResult;
  openSystemSettingsResult?: boolean;
} = {}): {
  runtime: TaskReminderDeliveryRuntime;
  emit(event: LocalRoundTerminalEvent): void;
  showCalls(): ShowCallInput[];
  saved(): TaskReminderDeliveryPersistedState | null;
} {
  const listeners = new Set<(event: LocalRoundTerminalEvent) => void>();
  const showCalls: ShowCallInput[] = [];
  let saved: TaskReminderDeliveryPersistedState | null = null;
  const channel = {
    async show(call: ShowCallInput): Promise<NotificationChannelResult> {
      showCalls.push(call);
      return input.channelResult ?? { ok: true };
    },
  };
  const runtime = new TaskReminderDeliveryRuntime({
    bus: {
      on(listener: (event: LocalRoundTerminalEvent) => void) {
        listeners.add(listener);
        return () => {
          listeners.delete(listener);
        };
      },
    } as unknown as LocalRoundTerminalBus,
    permission: {
      read: async () => input.permission ?? AUTHORIZED,
      request: async () => input.permission ?? AUTHORIZED,
    } as unknown as MacOsPermissionAdapter,
    channel: channel as unknown as MacOsNotificationChannel,
    preferenceEnabled: async () => input.enabled ?? true,
    savePreference: async () => undefined,
    loadState: async () => ({
      version: 1,
      deliveredEventIds: [],
      modalEntries: [],
      lastClicked: null,
      lastConsumedClickAt: null,
    }),
    saveState: async (state: TaskReminderDeliveryPersistedState) => {
      saved = state;
    },
    openSystemSettings: async () => input.openSystemSettingsResult ?? true,
    nowIso: () => "2026-08-19T10:00:00.000Z",
  });
  return {
    runtime,
    emit(event) {
      for (const listener of [...listeners]) {
        listener(event);
      }
    },
    showCalls: () => showCalls,
    saved: () => saved,
  };
}

describe("task-reminder delivery runtime（修复 B：通道结果三态反馈）", () => {
  it("提交成功（show）：通道状态 ok，弹窗关闭，投递事件落盘", async () => {
    const harness = createHarness();
    await harness.runtime.ready();
    harness.emit(TERMINAL);
    await waitForValue(
      () => (harness.showCalls().length === 1 ? true : undefined),
      { describe: "channel show call", kind: "logic" },
    );
    const snapshot = harness.runtime.snapshot();
    expect(snapshot.channelStatus).toBe("ok");
    expect(snapshot.modal.open).toBe(false);
    expect(harness.showCalls()[0]).toMatchObject({
      sessionId: "session-1",
      roundId: 1,
      terminalMessageId: 10,
      title: "Moebius",
    });
    expect(harness.showCalls()[0].body).toContain("测试对话");
    expect(harness.saved()?.deliveredEventIds).toContain(TERMINAL.eventId);
  });

  it("提交失败（failed）：通道状态异常，弹窗承接本次终局并持久化", async () => {
    const harness = createHarness({ channelResult: { ok: false, reason: "failed" } });
    await harness.runtime.ready();
    harness.emit(TERMINAL);
    await waitForValue(
      () => (harness.runtime.snapshot().channelStatus === "anomaly" ? true : undefined),
      { describe: "channel anomaly after failed", kind: "logic" },
    );
    const snapshot = harness.runtime.snapshot();
    expect(snapshot.modal.open).toBe(true);
    expect(snapshot.modal.entries).toContainEqual({
      eventId: TERMINAL.eventId,
      sessionId: "session-1",
      title: "测试对话",
      outcome: "completed",
    });
    expect(harness.saved()?.modalEntries).toHaveLength(1);
  });

  it("提交超时（timeout，被 usernoted 拒绝时无任何事件）：同样判定异常并弹窗承接", async () => {
    const harness = createHarness({ channelResult: { ok: false, reason: "timeout" } });
    await harness.runtime.ready();
    harness.emit(TERMINAL);
    await waitForValue(
      () => (harness.runtime.snapshot().channelStatus === "anomaly" ? true : undefined),
      { describe: "channel anomaly after timeout", kind: "logic" },
    );
    expect(harness.runtime.snapshot().modal.open).toBe(true);
  });

  it("总开关关闭：不读权限、不提交、不落盘", async () => {
    const harness = createHarness({ enabled: false });
    await harness.runtime.ready();
    harness.emit(TERMINAL);
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(harness.showCalls()).toHaveLength(0);
    expect(harness.saved()).toBeNull();
    expect(harness.runtime.snapshot().channelStatus).toBe("unknown");
  });

  it("同一事件已投递：去重，不重复提交", async () => {
    const harness = createHarness();
    await harness.runtime.ready();
    harness.emit(TERMINAL);
    await waitForValue(
      () => (harness.showCalls().length === 1 ? true : undefined),
      { describe: "first channel show call", kind: "logic" },
    );
    harness.emit(TERMINAL);
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(harness.showCalls()).toHaveLength(1);
  });

  it("权限未通过（denied）：不提交通知，弹窗承接", async () => {
    const harness = createHarness({
      permission: { ...AUTHORIZED, authorizationStatus: "denied" },
    });
    await harness.runtime.ready();
    harness.emit(TERMINAL);
    await waitForValue(
      () => (harness.runtime.snapshot().modal.open ? true : undefined),
      { describe: "modal open after denied permission", kind: "logic" },
    );
    expect(harness.showCalls()).toHaveLength(0);
  });

  it("权限读取失败（桥错误）：不提交通知，弹窗承接", async () => {
    const harness = createHarness({
      permission: { authorizationStatus: "unknown", alert: "unknown", sound: "unknown", badge: "unknown", error: "macos-permission-bridge-error:boom" },
    });
    await harness.runtime.ready();
    harness.emit(TERMINAL);
    await waitForValue(
      () => (harness.runtime.snapshot().modal.open ? true : undefined),
      { describe: "modal open after permission error", kind: "logic" },
    );
    expect(harness.showCalls()).toHaveLength(0);
  });

  it("投递状态变化推送：终局处理（弹窗承接）后通知订阅者", async () => {
    const harness = createHarness({ channelResult: { ok: false, reason: "timeout" } });
    const listener = vi.fn();
    harness.runtime.onStateChanged(listener);
    await harness.runtime.ready();
    harness.emit(TERMINAL);
    await waitForValue(
      () => (harness.runtime.snapshot().modal.open ? true : undefined),
      { describe: "modal open after timeout", kind: "logic" },
    );
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("投递状态变化推送：弹窗操作后通知订阅者", async () => {
    const harness = createHarness({ channelResult: { ok: false, reason: "timeout" } });
    const listener = vi.fn();
    harness.runtime.onStateChanged(listener);
    await harness.runtime.ready();
    harness.emit(TERMINAL);
    await waitForValue(
      () => (harness.runtime.snapshot().modal.open ? true : undefined),
      { describe: "modal open before modal action", kind: "logic" },
    );
    listener.mockClear();
    await harness.runtime.applyModalAction({ kind: "close-notifications" });
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("重新检测以最近提交结果为准：提交异常后权限读 allowed 仍显示异常（合成值不冒充已恢复）", async () => {
    const harness = createHarness({ channelResult: { ok: false, reason: "timeout" } });
    await harness.runtime.ready();
    harness.emit(TERMINAL);
    await waitForValue(
      () => (harness.runtime.snapshot().channelStatus === "anomaly" ? true : undefined),
      { describe: "channel anomaly after timeout", kind: "logic" },
    );
    // 桥读取仍返回合成 authorized，但通道状态必须保持异常。
    expect(await harness.runtime.recheckChannel()).toBe("anomaly");
    expect(harness.runtime.snapshot().channelStatus).toBe("anomaly");
  });

  it("提交成功后重新检测恢复 ok", async () => {
    const harness = createHarness();
    await harness.runtime.ready();
    harness.emit(TERMINAL);
    await waitForValue(
      () => (harness.runtime.snapshot().channelStatus === "ok" ? true : undefined),
      { describe: "channel ok after show", kind: "logic" },
    );
    expect(await harness.runtime.recheckChannel()).toBe("ok");
  });

  it("最近提交异常时「开启系统通知」改走打开系统设置（不发起伪成功授权）", async () => {
    const harness = createHarness({ channelResult: { ok: false, reason: "timeout" } });
    await harness.runtime.ready();
    harness.emit(TERMINAL);
    await waitForValue(
      () => (harness.runtime.snapshot().modal.open ? true : undefined),
      { describe: "modal open after timeout", kind: "logic" },
    );
    const state = await harness.runtime.applyModalAction({ kind: "request" });
    expect(state.phase).toBe("opened");
    expect(harness.runtime.snapshot().modal.phase).toBe("opened");
  });

  it("通知点击载荷：记录后可恢复定位，消费后清空", async () => {
    const harness = createHarness();
    await harness.runtime.ready();
    expect(harness.runtime.pendingClick()).toBeNull();
    await harness.runtime.recordClick({ sessionId: "session-1", roundId: 1, terminalMessageId: 10 });
    expect(harness.runtime.pendingClick()).toEqual({ sessionId: "session-1", roundId: 1, terminalMessageId: 10 });
    expect(harness.saved()?.lastClicked?.sessionId).toBe("session-1");
    await harness.runtime.consumeClick();
    expect(harness.runtime.pendingClick()).toBeNull();
  });
});
