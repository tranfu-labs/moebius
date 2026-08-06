import type { Clipboard, IpcMain, Shell } from "electron";

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
import { registerProviderProfileIpc } from "./provider-profile-ipc.js";
import type { ProviderProfileService } from "./provider-profile-service.js";
import { translateDesktop } from "./i18n/index.js";

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
  });
  return registerProviderProfileIpc({ ipcMain: input.ipcMain, service: input.providerProfileService });
}
