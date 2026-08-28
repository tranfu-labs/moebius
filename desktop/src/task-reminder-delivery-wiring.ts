import path from "node:path";
import { app, type Shell } from "electron";

import { countDockVisibleDots } from "../../src/local-console/round-visible-plan.js";
import type { LocalConsoleRuntime } from "../../src/local-console/runtime.js";
import type { DesktopLocalConsoleRuntime } from "./desktop-local-console-runtime.js";
import {
  createMacOsPermissionAdapter,
  deriveRunningBundleId,
  type MacOsNotificationPermissionSnapshot,
} from "./macos-permission-adapter.js";
import { MacOsNotificationChannel } from "./notification-channel.js";
import { TaskReminderDeliveryRuntime } from "./task-reminder-delivery-runtime.js";
import type { TaskReminderDeliveryPorts } from "./task-reminder-ipc.js";
import { readTaskReminderPreference, saveTaskReminderPreference } from "./task-reminder-preference.js";
import {
  readTaskReminderDeliveryState,
  recordTaskReminderDeliveryClick,
  saveTaskReminderDeliveryState,
} from "./task-reminder-delivery-state.js";
import {
  planClickConsumption,
  planPendingClick,
  type TaskReminderClickTarget,
} from "./task-reminder-delivery-plan.js";
import { decodeTaskReminderNotificationId } from "./task-reminder-notification-identity.js";

const DEVELOPMENT_PERMISSION_EXECUTABLE = new URL(
  "../native/build/MoebiusPermissionBridge.app/Contents/MacOS/macos-notification-permission",
  import.meta.url,
).pathname;
const DEVELOPMENT_PERMISSION_EXECUTABLE_ELECTRON = new URL(
  "../native/build/MoebiusPermissionBridge.dev.app/Contents/MacOS/macos-notification-permission",
  import.meta.url,
).pathname;
const DEV_HOST_BUNDLE_ID = "com.github.Electron";

/** 权限桥变体选择：按宿主 bundle 身份选同身份的签名变体（QA #135 FQA-03）。 */
function resolvePermissionExecutable(): string {
  if (app.isPackaged) {
    return path.join(
      process.resourcesPath,
      "native",
      "MoebiusPermissionBridge.app",
      "Contents",
      "MacOS",
      "macos-notification-permission",
    );
  }
  return deriveRunningBundleId() === DEV_HOST_BUNDLE_ID
    ? DEVELOPMENT_PERMISSION_EXECUTABLE_ELECTRON
    : DEVELOPMENT_PERMISSION_EXECUTABLE;
}

export function createTaskReminderDeliveryPorts(input: {
  dataRoot: string;
  localConsole: DesktopLocalConsoleRuntime;
  shell: Shell;
}): {
  ports: TaskReminderDeliveryPorts;
  refreshDock(): Promise<number>;
  /** 幂等：内核就绪后由主进程主动接线（创建投递器并订阅终局事件），不再依赖渲染端首次读取。 */
  ensureTaskReminderDelivery(): void;
  /** app ready 后、local-console 启动前恢复通知中心历史。 */
  restoreTaskReminderHistory(): Promise<void>;
  onNotificationClick(listener: (payload: {
    sessionId: string;
    roundId: number;
    terminalMessageId: number | null;
  }) => void): void;
} {
  let deliveryRuntime: TaskReminderDeliveryRuntime | null = null;
  const channel = new MacOsNotificationChannel();
  const notificationClickListeners = new Set<(payload: TaskReminderClickTarget) => void>();
  const stateChangedListeners = new Set<() => void>();

  const recordClickBeforeRuntime = async (payload: TaskReminderClickTarget): Promise<void> => {
    await recordTaskReminderDeliveryClick(input.dataRoot, payload, new Date().toISOString());
  };

  const dispatchNotificationClick = (payload: TaskReminderClickTarget): void => {
    if (notificationClickListeners.size === 0) {
      // 冷启动时 IPC listener 可能还未注册；持久化状态本身就是 renderer 的启动队列。
      void recordClickBeforeRuntime(payload).catch((error: unknown) => {
        console.error(`task-reminder early click save failed: ${String(error)}`);
      });
      return;
    }
    for (const listener of [...notificationClickListeners]) {
      try {
        listener(payload);
      } catch (error) {
        console.error(`task-reminder notification click dispatch failed: ${String(error)}`);
      }
    }
  };

  const handleHistoryClick = async (notificationId: string): Promise<void> => {
    const state = await readTaskReminderDeliveryState(input.dataRoot);
    const target = state.notificationTargets[notificationId];
    if (target === undefined || decodeTaskReminderNotificationId(notificationId) === null) {
      console.error(`task-reminder history notification has unknown id: ${notificationId}`);
      return;
    }
    dispatchNotificationClick(target);
  };

  // 在 local-console/runtime 创建前就注册历史对象监听；历史查询由 app ready 后显式触发。
  channel.onNotificationClick(dispatchNotificationClick);
  channel.onNotificationHistoryClick((notificationId) => {
    void handleHistoryClick(notificationId).catch((error: unknown) => {
      console.error(`task-reminder history click handling failed: ${String(error)}`);
    });
  });
  const ensureRuntime = (): TaskReminderDeliveryRuntime | null => {
    if (deliveryRuntime !== null) return deliveryRuntime;
    const runtime = input.localConsole.pathSource as LocalConsoleRuntime | null;
    if (runtime === null) return null;
    deliveryRuntime = new TaskReminderDeliveryRuntime({
      bus: runtime.roundWiring.bus,
      permission: createMacOsPermissionAdapter({ executablePath: resolvePermissionExecutable() }),
      channel,
      preferenceEnabled: () => readTaskReminderPreference(input.dataRoot),
      savePreference: (enabled) => saveTaskReminderPreference(input.dataRoot, enabled),
      loadState: () => readTaskReminderDeliveryState(input.dataRoot),
      saveState: (state) => saveTaskReminderDeliveryState(input.dataRoot, state),
      openSystemSettings: () => openSystemSettings(),
      nowIso: () => new Date().toISOString(),
    });
    deliveryRuntime.onStateChanged(() => {
      for (const listener of [...stateChangedListeners]) {
        try {
          listener();
        } catch (error) {
          console.error(`task-reminder state-changed listener failed: ${String(error)}`);
        }
      }
    });
    void deliveryRuntime.ready();
    runtime.roundWiring.bus.on(() => {
      void refreshDock();
    });
    return deliveryRuntime;
  };

  const refreshDock = async (): Promise<number> => {
    const runtime = input.localConsole.pathSource as LocalConsoleRuntime | null;
    if (runtime === null) {
      return 0;
    }
    try {
      const state = await runtime.state();
      const sessions = state.projects.flatMap((project) => project.sessions);
      // 会话状态查询已由规范化投影写入 statusDot（#220），Dock 直接计数即可。
      const count = countDockVisibleDots(sessions);
      channel.setDockBadge(count);
      return count;
    } catch (error) {
      console.error(`task-reminder dock refresh failed: ${String(error)}`);
      return 0;
    }
  };

  const openSystemSettings = async (): Promise<boolean> => {
    const url = "x-apple.systempreferences:com.apple.preference.notifications";
    try {
      await input.shell.openExternal(url);
      return true;
    } catch (error) {
      console.error(`task-reminder open-system-settings failed: ${String(error)}`);
      return false;
    }
  };

  const ports: TaskReminderDeliveryPorts = {
    async readState() {
      const runtime = ensureRuntime();
      const enabled = await readTaskReminderPreference(input.dataRoot);
      const dockCount = await refreshDock();
      if (runtime === null) {
        // local console 尚未就绪：权限读取不依赖 local console（桥是独立进程），
        // 直接读一次真实权限（总开关关闭时不读），避免设置页/Onboarding 首屏在
        // 冷启动早期错误显示「尚未开启」。runtime 创建后 ensurePermission 会再读
        // 并缓存，幂等。
        const permission = enabled
          ? await createMacOsPermissionAdapter({ executablePath: resolvePermissionExecutable() }).read()
            .catch((): MacOsNotificationPermissionSnapshot | null => null)
          : null;
        const persistedState = await readTaskReminderDeliveryState(input.dataRoot);
        return {
          enabled,
          permission,
          channelStatus: "unknown" as const,
          modal: {
            open: false,
            phase: "idle" as const,
            entries: [],
            saveFailed: false,
          },
          dockCount,
          pendingClick: planPendingClick(
            persistedState.lastClicked,
            persistedState.lastConsumedClickAt,
          ),
        };
      }
      await runtime.ready();
      await runtime.ensurePermission();
      const snapshot = runtime.snapshot();
      return {
        enabled,
        permission: snapshot.lastPermission,
        channelStatus: snapshot.channelStatus,
        modal: snapshot.modal,
        dockCount,
        pendingClick: runtime.pendingClick(),
      };
    },
    async setEnabled(enabled) {
      try {
        await saveTaskReminderPreference(input.dataRoot, enabled);
        await refreshDock();
        return { ok: true };
      } catch (error) {
        console.error(`task-reminder set-enabled failed: ${String(error)}`);
        return { ok: false };
      }
    },
    async applyModalAction(action) {
      const runtime = ensureRuntime();
      if (runtime === null) {
        return { ok: false, state: null };
      }
      const state = await runtime.applyModalAction(action);
      await refreshDock();
      return { ok: true, state };
    },
    async recheckChannel() {
      const runtime = ensureRuntime();
      if (runtime === null) {
        return "unknown";
      }
      const status = await runtime.recheckChannel();
      await refreshDock();
      return status;
    },
    async openSystemSettings() {
      return { ok: await openSystemSettings() };
    },
    async recordClick(payload) {
      const runtime = ensureRuntime();
      if (runtime !== null) {
        await runtime.recordClick(payload);
      } else {
        await recordClickBeforeRuntime(payload);
      }
    },
    async consumeClick() {
      const runtime = ensureRuntime();
      if (runtime !== null) {
        await runtime.consumeClick();
        return;
      }
      const state = await readTaskReminderDeliveryState(input.dataRoot);
      const consumedAt = planClickConsumption(state.lastClicked);
      if (consumedAt !== null) {
        await saveTaskReminderDeliveryState(input.dataRoot, {
          ...state,
          lastConsumedClickAt: consumedAt,
        });
      }
    },
    onStateChanged(listener) {
      stateChangedListeners.add(listener);
      return () => {
        stateChangedListeners.delete(listener);
      };
    },
    refreshDock: () => refreshDock(),
  };

  return {
    ports,
    refreshDock,
    ensureTaskReminderDelivery: () => {
      ensureRuntime();
    },
    restoreTaskReminderHistory: async () => {
      const state = await readTaskReminderDeliveryState(input.dataRoot);
      const knownNotificationIds = new Set(
        Object.keys(state.notificationTargets).filter((notificationId) =>
          decodeTaskReminderNotificationId(notificationId) !== null),
      );
      await channel.restoreHistory(knownNotificationIds);
    },
    onNotificationClick: (listener) => {
      notificationClickListeners.add(listener);
    },
  };
}

/**
 * 修复 A：把「启动本地内核」与「内核就绪后由主进程主动接线投递器」合成一个调用点，
 * 启动与更新恢复两条路径共用；接线不再依赖渲染端首次读取（消除订阅竞态）。
 */
export function createTaskReminderStartLocalConsole(input: {
  localConsole: DesktopLocalConsoleRuntime;
  ensureTaskReminderDelivery(): void;
}): () => Promise<void> {
  return async () => {
    await input.localConsole.start();
    input.ensureTaskReminderDelivery();
  };
}
