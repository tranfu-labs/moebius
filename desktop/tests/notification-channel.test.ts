import { describe, expect, it, vi } from "vitest";

const notificationHarness = vi.hoisted(() => ({
  created: [] as Array<{
    options: Record<string, unknown>;
    listeners: Map<string, Array<(...args: unknown[]) => void>>;
    emit(event: string, ...args: unknown[]): void;
  }>,
  history: [] as Array<{
    id: string;
    clickListeners: Array<(...args: unknown[]) => void>;
    on(event: string, listener: (...args: unknown[]) => void): void;
    emitClick(): void;
  }>,
  getHistoryCalls: 0,
  historyError: null as Error | null,
  supported: true,
}));

vi.mock("electron/main", () => ({
  Notification: class {
    static isSupported(): boolean {
      return notificationHarness.supported;
    }

    static async getHistory(): Promise<typeof notificationHarness.history> {
      notificationHarness.getHistoryCalls += 1;
      if (notificationHarness.historyError !== null) {
        throw notificationHarness.historyError;
      }
      return notificationHarness.history;
    }

    readonly id: string;
    private readonly listeners = new Map<string, Array<(...args: unknown[]) => void>>();

    constructor(options: Record<string, unknown>) {
      this.id = String(options.id ?? "");
      const record = {
        options,
        listeners: this.listeners,
        emit: (event: string, ...args: unknown[]) => {
          for (const listener of this.listeners.get(event) ?? []) {
            listener(...args);
          }
        },
      };
      notificationHarness.created.push(record);
    }

    on(event: string, listener: (...args: unknown[]) => void): this {
      const listeners = this.listeners.get(event) ?? [];
      listeners.push(listener);
      this.listeners.set(event, listeners);
      return this;
    }

    show(): void {
      // 测试显式触发 show/failed；模拟 OS 不在构造时自动回调。
    }
  },
  app: { dock: { setBadge: vi.fn() } },
}));

import {
  NOTIFICATION_SUBMIT_TIMEOUT_MS,
  MacOsNotificationChannel,
} from "../src/notification-channel.js";

function createHistoryNotification(id: string) {
  const clickListeners: Array<(...args: unknown[]) => void> = [];
  const notification = {
    id,
    clickListeners,
    on(event: string, listener: (...args: unknown[]) => void): void {
      if (event === "click") clickListeners.push(listener);
    },
    emitClick(): void {
      for (const listener of [...clickListeners]) listener({});
    },
  };
  notificationHarness.history.push(notification);
  return notification;
}

describe("MacOsNotificationChannel", () => {
  it("show 传递稳定 id/groupId，并保持 show 与 failed 互斥结算", async () => {
    notificationHarness.created.length = 0;
    notificationHarness.supported = true;
    const channel = new MacOsNotificationChannel("darwin");
    const showPromise = channel.show({
      sessionId: "s",
      roundId: 1,
      terminalMessageId: 2,
      title: "Moebius",
      body: "body",
      notificationId: "notification-1",
      groupId: "moebius-task-reminder",
    });
    const notification = notificationHarness.created[0];
    notification.emit("show", {});
    notification.emit("failed", {}, "late failure");

    await expect(showPromise).resolves.toEqual({ ok: true });
    expect(notification.options).toMatchObject({
      id: "notification-1",
      groupId: "moebius-task-reminder",
      title: "Moebius",
      body: "body",
    });
  });

  it("failed 结算为异常，超时在没有 OS 事件时闭合", async () => {
    notificationHarness.created.length = 0;
    const failedChannel = new MacOsNotificationChannel("darwin");
    const failedPromise = failedChannel.show({
      sessionId: "s",
      roundId: 1,
      terminalMessageId: null,
      title: "Moebius",
      body: "body",
      notificationId: "notification-failed",
      groupId: "moebius-task-reminder",
    });
    notificationHarness.created[0].emit("failed", {}, "rejected");
    await expect(failedPromise).resolves.toEqual({ ok: false, reason: "failed" });

    vi.useFakeTimers();
    try {
      const timeoutChannel = new MacOsNotificationChannel("darwin");
      const timeoutPromise = timeoutChannel.show({
        sessionId: "s",
        roundId: 1,
        terminalMessageId: null,
        title: "Moebius",
        body: "body",
        notificationId: "notification-timeout",
        groupId: "moebius-task-reminder",
      });
      await vi.advanceTimersByTimeAsync(NOTIFICATION_SUBMIT_TIMEOUT_MS);
      await expect(timeoutPromise).resolves.toEqual({ ok: false, reason: "timeout" });
    } finally {
      vi.useRealTimers();
    }
  });

  it("历史查询只执行一次、同一对象只挂一次 listener，并转发 id", async () => {
    notificationHarness.history.length = 0;
    notificationHarness.getHistoryCalls = 0;
    notificationHarness.historyError = null;
    const known = createHistoryNotification("known");
    const unknown = createHistoryNotification("unknown");
    const channel = new MacOsNotificationChannel("darwin");
    const clicks: string[] = [];
    channel.onNotificationHistoryClick((notificationId) => clicks.push(notificationId));

    await channel.restoreHistory(new Set(["known"]));
    await channel.restoreHistory();
    expect(notificationHarness.getHistoryCalls).toBe(1);
    expect(known.clickListeners).toHaveLength(1);
    expect(unknown.clickListeners).toHaveLength(0);

    known.emitClick();
    expect(clicks).toEqual(["known"]);
  });

  it("历史查询失败时安全降级，不产生伪造点击", async () => {
    notificationHarness.history.length = 0;
    notificationHarness.getHistoryCalls = 0;
    notificationHarness.historyError = new Error("history unavailable");
    const channel = new MacOsNotificationChannel("darwin");
    const click = vi.fn();
    channel.onNotificationHistoryClick(click);

    await expect(channel.restoreHistory()).resolves.toBeUndefined();
    expect(notificationHarness.getHistoryCalls).toBe(1);
    expect(click).not.toHaveBeenCalled();
    notificationHarness.historyError = null;
  });
});
