import {
  SETTINGS_IPC_CHANNELS,
  createSettingsApplicationInfo,
  formatSettingsVersionInfo,
  type SettingsApplicationInfo,
  type SettingsUpdateCheckResult,
  type SettingsVersionCopyResult,
} from "./settings-contract.js";

export interface SettingsIpcMain {
  handle(channel: string, listener: (event: unknown) => unknown): void;
}

export interface RegisterSettingsIpcOptions {
  ipcMain: SettingsIpcMain;
  getVersion(): string;
  checkForUpdates(currentVersion: string): Promise<SettingsUpdateCheckResult>;
  clipboard: { writeText(value: string): void };
}

export function registerSettingsIpc(options: RegisterSettingsIpcOptions): void {
  options.ipcMain.handle(
    SETTINGS_IPC_CHANNELS.readApplicationInfo,
    (): SettingsApplicationInfo => createSettingsApplicationInfo(options.getVersion()),
  );
  options.ipcMain.handle(
    SETTINGS_IPC_CHANNELS.checkForUpdates,
    () => options.checkForUpdates(options.getVersion()),
  );
  options.ipcMain.handle(
    SETTINGS_IPC_CHANNELS.copyVersionInfo,
    (): SettingsVersionCopyResult => {
      try {
        options.clipboard.writeText(formatSettingsVersionInfo(
          createSettingsApplicationInfo(options.getVersion()),
        ));
        return { ok: true };
      } catch {
        return { ok: false, reason: "clipboard-unavailable" };
      }
    },
  );
}
