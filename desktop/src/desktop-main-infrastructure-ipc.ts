import path from "node:path";
import { app, type Clipboard, type IpcMain, type Shell } from "electron";

import { checkCodex } from "./env-doctor.js";
import { registerDesktopCoreIpc } from "./desktop-core-ipc-register.js";
import type { DesktopLocalConsoleRuntime } from "./desktop-local-console-runtime.js";
import type { DesktopShutdownRuntime } from "./desktop-shutdown-runtime.js";
import type { DesktopUpdateRuntime } from "./desktop-update-runtime.js";
import type { DesktopWindowRuntime } from "./desktop-window-runtime.js";
import type { DesktopStatusSnapshot } from "./status.js";
import { registerLanguagePreferenceIpc } from "./language-preference-ipc.js";
import { saveLanguagePreference } from "./language-preference.js";
import type { DesktopLocale } from "./language-preference-contract.js";
import type { SettingsUpdateState } from "./settings-contract.js";
import { registerProviderProfileIpc } from "./provider-profile-ipc.js";
import type { ProviderProfileService } from "./provider-profile-service.js";
import { translateDesktop } from "./i18n/index.js";
import { registerTaskReminderIpc, type TaskReminderDeliveryPorts } from "./task-reminder-ipc.js";
import { createMacOsPermissionAdapter, deriveRunningBundleId, type MacOsNotificationPermissionSnapshot } from "./macos-permission-adapter.js";
import { MacOsNotificationChannel } from "./notification-channel.js";
import { TaskReminderDeliveryRuntime } from "./task-reminder-delivery-runtime.js";
import { readTaskReminderPreference, saveTaskReminderPreference } from "./task-reminder-preference.js";
import {
  readTaskReminderDeliveryState,
  saveTaskReminderDeliveryState,
} from "./task-reminder-delivery-state.js";
import { countDockVisibleDots, projectDockSessionFacts } from "../../src/local-console/round-visible-plan.js";
import type { LocalConsoleRuntime } from "../../src/local-console/runtime.js";

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

function createTaskReminderDeliveryPorts(input: {
  dataRoot: string;
  localConsole: DesktopLocalConsoleRuntime;
  shell: Shell;
}): {
  ports: TaskReminderDeliveryPorts;
  refreshDock(): Promise<number>;
  onNotificationClick(listener: (payload: {
    sessionId: string;
    roundId: number;
    terminalMessageId: number | null;
  }) => void): void;
} {
  let deliveryRuntime: TaskReminderDeliveryRuntime | null = null;
  let channel: MacOsNotificationChannel | null = null;

  const ensureRuntime = (): TaskReminderDeliveryRuntime | null => {
    if (deliveryRuntime !== null) return deliveryRuntime;
    const runtime = input.localConsole.pathSource as LocalConsoleRuntime | null;
    if (runtime === null) return null;
    channel = new MacOsNotificationChannel({ nowIso: () => new Date().toISOString() });
    deliveryRuntime = new TaskReminderDeliveryRuntime({
      bus: runtime.roundWiring.bus,
      permission: createMacOsPermissionAdapter({ executablePath: resolvePermissionExecutable() }),
      channel,
      preferenceEnabled: () => readTaskReminderPreference(input.dataRoot),
      savePreference: (enabled) => saveTaskReminderPreference(input.dataRoot, enabled),
      loadState: () => readTaskReminderDeliveryState(input.dataRoot),
      saveState: (state) => saveTaskReminderDeliveryState(input.dataRoot, state),
      nowIso: () => new Date().toISOString(),
    });
    void deliveryRuntime.ready();
    runtime.roundWiring.bus.on(() => {
      void refreshDock();
    });
    return deliveryRuntime;
  };

  const refreshDock = async (): Promise<number> => {
    const runtime = input.localConsole.pathSource as LocalConsoleRuntime | null;
    if (runtime === null || channel === null) {
      return 0;
    }
    try {
      const state = await runtime.state();
      const sessions = state.projects.flatMap((project) => project.sessions);
      const facts = new Map(sessions.map((session) => {
        const projected = projectDockSessionFacts(session);
        return [projected.sessionId, projected.facts];
      }));
      const count = countDockVisibleDots(sessions, facts);
      channel.setDockBadge(count);
      return count;
    } catch (error) {
      console.error(`task-reminder dock refresh failed: ${String(error)}`);
      return 0;
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
          pendingClick: null,
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
      const url = "x-apple.systempreferences:com.apple.preference.notifications";
      try {
        await input.shell.openExternal(url);
        return { ok: true };
      } catch (error) {
        console.error(`task-reminder open-system-settings failed: ${String(error)}`);
        return { ok: false };
      }
    },
    async recordClick(payload) {
      const runtime = ensureRuntime();
      if (runtime !== null) {
        await runtime.recordClick(payload);
      }
    },
    async consumeClick() {
      const runtime = ensureRuntime();
      if (runtime !== null) {
        await runtime.consumeClick();
      }
    },
  };

  return {
    ports,
    refreshDock,
    onNotificationClick: (listener) => {
      if (channel === null) {
        ensureRuntime();
      }
      channel?.onNotificationClick(listener);
    },
  };
}

export function registerDesktopMainInfrastructureIpc(input: {
  ipcMain: IpcMain;
  clipboard: Clipboard;
  shell: Shell;
  windows: DesktopWindowRuntime;
  localConsole: DesktopLocalConsoleRuntime;
  updateRuntime: DesktopUpdateRuntime;
  shutdown: DesktopShutdownRuntime;
  providerProfileService: ProviderProfileService;
  status: DesktopStatusSnapshot;
  dataRoot: string;
  getLocale: () => DesktopLocale;
  setLocale: (locale: DesktopLocale) => void;
  appVersion: string;
  getRunningTaskCount: () => number;
  remindLater: () => Promise<SettingsUpdateState>;
  skipVersion: () => Promise<SettingsUpdateState>;
  respondInstallConfirmation: (requestId: number, approved: boolean) => void;
}): { getRunningTaskCount(): number; cancelAll(): void } {
  registerLanguagePreferenceIpc({
    ipcMain: input.ipcMain,
    dependencies: {
      getActiveLocale: input.getLocale,
      setActiveLocale: input.setLocale,
      persist: (locale) => saveLanguagePreference(input.dataRoot, locale),
      getBroadcastTargets: () => input.windows.getBroadcastTargets(),
    },
  });
  const taskReminderDelivery = createTaskReminderDeliveryPorts({
    dataRoot: input.dataRoot,
    localConsole: input.localConsole,
    shell: input.shell,
  });
  registerTaskReminderIpc({
    ipcMain: input.ipcMain,
    windows: input.windows,
    shell: input.shell,
    delivery: taskReminderDelivery.ports,
    onNotificationClick: taskReminderDelivery.onNotificationClick,
  });
  registerDesktopCoreIpc({
    ipcMain: input.ipcMain,
    clipboard: input.clipboard,
    shell: input.shell,
    openStatusPage: () => input.windows.openStatusPage(),
    refreshDoctor: async () => {
      input.status.doctor = null;
      input.windows.publishStatus();
      input.status.doctor = { codex: await checkCodex() };
      input.windows.publishStatus();
    },
    getLocalConsoleUrl: () => input.localConsole.url,
    getAttachmentCapability: () => input.localConsole.attachmentCapability,
    getPathSource: () => input.localConsole.pathSource,
    selectDirectory: (options) => input.windows.selectDirectory(options),
    openProjectTitle: () => translateDesktop(input.getLocale(), "dialog.openProject"),
    repairProjectTitle: () => translateDesktop(input.getLocale(), "dialog.repairProject"),
    selectLocationLabel: () => translateDesktop(input.getLocale(), "dialog.selectLocation"),
    dataRoot: input.dataRoot,
    getVersion: () => input.appVersion,
    checkForUpdates: () => input.updateRuntime.check(),
    readUpdateState: () => input.updateRuntime.state,
    installUpdate: () => input.shutdown.requestInstall(),
    readRunningTaskCount: input.getRunningTaskCount,
    remindLater: () => input.remindLater(),
    skipVersion: () => input.skipVersion(),
    respondInstallConfirmation: input.respondInstallConfirmation,
  });
  return registerProviderProfileIpc({ ipcMain: input.ipcMain, service: input.providerProfileService });
}
