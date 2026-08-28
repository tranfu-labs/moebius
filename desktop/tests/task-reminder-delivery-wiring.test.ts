import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Shell } from "electron";
import type { LocalConsoleRuntime } from "../../src/local-console/runtime.js";
import type { LocalRoundTerminalEvent } from "../../src/local-console/round-terminal-event-bus.js";
import { waitForValue } from "../../src/testing/wait.js";
import type { DesktopLocalConsoleRuntime } from "../src/desktop-local-console-runtime.js";
import {
  createTaskReminderDeliveryPorts,
  createTaskReminderStartLocalConsole,
} from "../src/task-reminder-delivery-wiring.js";
import {
  createTaskReminderDeliveryState,
  saveTaskReminderDeliveryState,
} from "../src/task-reminder-delivery-state.js";
import { createTaskReminderNotificationId } from "../src/task-reminder-notification-identity.js";

// electron / electron/main 是打包运行时内置模块，vitest（node）不可解析，必须 mock。
vi.mock("electron", () => ({
  app: { isPackaged: false },
  ipcMain: {},
  clipboard: {},
  shell: {},
  powerMonitor: {},
}));
vi.mock("electron/main", () => ({
  Notification: class {},
  app: { isPackaged: false, dock: { setBadge() {} } },
}));

const channelHolder = vi.hoisted(() => ({
  instance: null as null | {
    showCalls: Array<{
      sessionId: string;
      roundId: number;
      terminalMessageId: number | null;
      title: string;
      body: string;
      notificationId: string;
      groupId: string;
    }>;
    setDockBadgeCalls: Array<number | null>;
    showResult: { ok: true } | { ok: false; reason: "failed" | "unsupported" | "timeout" };
    notificationClickListener: ((payload: {
      sessionId: string;
      roundId: number;
      terminalMessageId: number | null;
    }) => void) | null;
    historyClickListener: ((notificationId: string) => void) | null;
    restoreHistoryCalls: number;
    emitHistoryClick(notificationId: string): void;
  },
}));

vi.mock("../src/notification-channel.js", () => ({
  MacOsNotificationChannel: class {
    showCalls: Array<{
      sessionId: string;
      roundId: number;
      terminalMessageId: number | null;
      title: string;
      body: string;
      notificationId: string;
      groupId: string;
    }> = [];
    setDockBadgeCalls: Array<number | null> = [];
    showResult: { ok: true } | { ok: false; reason: "failed" | "unsupported" | "timeout" } = { ok: true };
    notificationClickListener: ((payload: {
      sessionId: string;
      roundId: number;
      terminalMessageId: number | null;
    }) => void) | null = null;
    historyClickListener: ((notificationId: string) => void) | null = null;
    restoreHistoryCalls = 0;
    constructor() {
      channelHolder.instance = this;
    }
    show(input: {
      sessionId: string;
      roundId: number;
      terminalMessageId: number | null;
      title: string;
      body: string;
      notificationId: string;
      groupId: string;
    }): { ok: true } | { ok: false; reason: "failed" | "unsupported" | "timeout" } {
      this.showCalls.push(input);
      return this.showResult;
    }
    onNotificationClick(listener: (payload: {
      sessionId: string;
      roundId: number;
      terminalMessageId: number | null;
    }) => void): () => void {
      this.notificationClickListener = listener;
      return () => undefined;
    }
    onNotificationHistoryClick(listener: (notificationId: string) => void): () => void {
      this.historyClickListener = listener;
      return () => undefined;
    }
    restoreHistory(_knownNotificationIds?: ReadonlySet<string>): Promise<void> {
      this.restoreHistoryCalls += 1;
      return Promise.resolve();
    }
    emitHistoryClick(notificationId: string): void {
      this.historyClickListener?.(notificationId);
    }
    setDockBadge(count: number | null): void {
      this.setDockBadgeCalls.push(count);
    }
  },
}));

vi.mock("../src/macos-permission-adapter.js", () => ({
  createMacOsPermissionAdapter: () => ({
    read: async () => ({
      authorizationStatus: "authorized" as const,
      alert: "enabled" as const,
      sound: "enabled" as const,
      badge: "enabled" as const,
      error: null,
    }),
    request: async () => ({
      authorizationStatus: "authorized" as const,
      alert: "enabled" as const,
      sound: "enabled" as const,
      badge: "enabled" as const,
      error: null,
    }),
  }),
  deriveRunningBundleId: () => null,
}));

function createFakeBus(): {
  on(listener: (event: LocalRoundTerminalEvent) => void): () => void;
  emit(event: LocalRoundTerminalEvent): void;
  listenerCount(): number;
} {
  const listeners = new Set<(event: LocalRoundTerminalEvent) => void>();
  return {
    on(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    emit(event) {
      for (const listener of [...listeners]) {
        listener(event);
      }
    },
    listenerCount() {
      return listeners.size;
    },
  };
}

const TERMINAL_EVENT: LocalRoundTerminalEvent = {
  eventId: "session:round:terminal:session-1:1",
  sessionId: "session-1",
  roundId: 1,
  outcome: "completed",
  terminalMessageId: 10,
  conversationTitle: "测试对话",
  occurredAt: "2026-08-19T10:00:00.000Z",
};

describe("task-reminder delivery wiring（修复 A：内核就绪后主进程主动接线）", () => {
  let dataRoot: string;
  let bus: ReturnType<typeof createFakeBus>;

  beforeEach(() => {
    dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), "moebius-task-reminder-wiring-"));
    bus = createFakeBus();
    channelHolder.instance = null;
  });

  function createPorts(localConsole: { pathSource: unknown }) {
    return createTaskReminderDeliveryPorts({
      dataRoot,
      localConsole: localConsole as unknown as DesktopLocalConsoleRuntime,
      shell: {} as Shell,
    });
  }

  it("接线工厂：先启动内核、成功后再接线投递器", async () => {
    const calls: string[] = [];
    const wiring = createTaskReminderStartLocalConsole({
      localConsole: { start: async () => { calls.push("start"); } } as unknown as DesktopLocalConsoleRuntime,
      ensureTaskReminderDelivery: () => { calls.push("wire"); },
    });
    await wiring();
    expect(calls).toEqual(["start", "wire"]);
  });

  it("内核未就绪时接线为 no-op，readState 返回未就绪兜底形状", async () => {
    const { ports, ensureTaskReminderDelivery } = createPorts({ pathSource: null });
    ensureTaskReminderDelivery();
    ensureTaskReminderDelivery();
    expect(bus.listenerCount()).toBe(0);

    const state = await ports.readState();
    expect(state.enabled).toBe(true);
    expect(state.channelStatus).toBe("unknown");
    expect(state.modal.open).toBe(false);
    expect(state.dockCount).toBe(0);
    expect(state.pendingClick).toBeNull();
  });

  it("历史恢复只查询一次：未知 id 不产生点击，已知 id 在内核未就绪时持久化并可消费", async () => {
    const persisted = {
      ...createTaskReminderDeliveryState(),
      notificationTargets: {
        [createTaskReminderNotificationId("event-known")]: {
          sessionId: "session-1",
          roundId: 3,
          terminalMessageId: 12,
        },
      },
    };
    await saveTaskReminderDeliveryState(dataRoot, persisted);
    const { ports, restoreTaskReminderHistory } = createPorts({ pathSource: null });
    await restoreTaskReminderHistory();
    const channel = channelHolder.instance;
    expect(channel?.restoreHistoryCalls).toBe(1);
    expect(channel?.historyClickListener).not.toBeNull();

    channel?.emitHistoryClick("unknown");
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect((await ports.readState()).pendingClick).toBeNull();

    channel?.emitHistoryClick(createTaskReminderNotificationId("event-known"));
    await waitForValue(
      async () => (await ports.readState()).pendingClick ?? undefined,
      { describe: "persisted history click", kind: "io" },
    );
    expect((await ports.readState()).pendingClick).toEqual({
      sessionId: "session-1",
      roundId: 3,
      terminalMessageId: 12,
    });
    await ports.consumeClick();
    expect((await ports.readState()).pendingClick).toBeNull();
  });

  it("内核就绪后接线幂等：创建一次投递器并订阅总线", () => {
    const runtime = { roundWiring: { bus }, state: async () => ({ projects: [] }) };
    const { ensureTaskReminderDelivery } = createPorts({
      pathSource: runtime as unknown as LocalConsoleRuntime,
    });
    ensureTaskReminderDelivery();
    ensureTaskReminderDelivery();
    // 投递器订阅 + Dock 刷新订阅各一个，重复接线不叠加。
    expect(bus.listenerCount()).toBe(2);
  });

  it("冷启动时序：先 readState（未就绪）后内核就绪，接线后终局事件直达通知通道", async () => {
    let currentRuntime: unknown = null;
    const localConsole = {
      get pathSource(): unknown {
        return currentRuntime;
      },
    };
    const { ports, ensureTaskReminderDelivery } = createPorts(localConsole);

    // 冷启动：页面首次读取时内核尚未就绪 → 不订阅。
    await ports.readState();
    expect(bus.listenerCount()).toBe(0);

    // 内核就绪后主进程主动接线。
    currentRuntime = { roundWiring: { bus }, state: async () => ({ projects: [] }) };
    ensureTaskReminderDelivery();
    expect(bus.listenerCount()).toBe(2);

    // 终局事件 → 投递器 → 通知通道；投递状态持久化。
    bus.emit(TERMINAL_EVENT);
    const channel = await waitForValue(
      () => channelHolder.instance?.showCalls[0],
      { describe: "task-reminder channel show call", kind: "logic" },
    );
    expect(channel).toMatchObject({
      sessionId: "session-1",
      roundId: 1,
      terminalMessageId: 10,
      title: "Moebius",
      notificationId: "moebius-task-reminder-session%3Around%3Aterminal%3Asession-1%3A1",
      groupId: "moebius-task-reminder",
    });
    expect(channel.body).toContain("测试对话");
    expect(channel.body).toContain("已完成");

    const persisted = JSON.parse(
      fs.readFileSync(path.join(dataRoot, ".state", "task-reminder-delivery.json"), "utf8"),
    ) as { deliveredEventIds: string[] };
    expect(persisted.deliveredEventIds).toContain(TERMINAL_EVENT.eventId);

    // 已投递去重：同一事件再次发布不重复提交。
    bus.emit(TERMINAL_EVENT);
    await waitForValue(
      () => (channelHolder.instance?.showCalls.length === 1 ? true : undefined),
      { describe: "task-reminder dedupe keeps single show", kind: "logic" },
    );
  });

  it("接线后 readState 返回投递器真实快照（通道状态 ok）", async () => {
    const runtime = { roundWiring: { bus }, state: async () => ({ projects: [] }) };
    const { ports, ensureTaskReminderDelivery } = createPorts({
      pathSource: runtime as unknown as LocalConsoleRuntime,
    });
    ensureTaskReminderDelivery();
    bus.emit(TERMINAL_EVENT);
    await waitForValue(
      () => (channelHolder.instance?.showCalls.length === 1 ? true : undefined),
      { describe: "task-reminder channel show call", kind: "logic" },
    );
    const state = await ports.readState();
    expect(state.enabled).toBe(true);
    expect(state.channelStatus).toBe("ok");
    expect(state.permission?.authorizationStatus).toBe("authorized");
    expect(state.modal.open).toBe(false);
  });
});
