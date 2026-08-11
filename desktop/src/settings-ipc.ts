import {
  SETTINGS_IPC_CHANNELS,
  createSettingsApplicationInfo,
  formatSettingsVersionInfo,
  type SettingsApplicationInfo,
  type SettingsInstallConfirmationResponse,
  type SettingsUpdateCheckResult,
  type SettingsUpdateState,
  type SettingsVersionCopyResult,
} from "./settings-contract.js";

export interface SettingsIpcMain {
  handle(channel: string, listener: (...args: unknown[]) => unknown): void;
}

export interface RegisterSettingsIpcOptions {
  ipcMain: SettingsIpcMain;
  getVersion(): string;
  checkForUpdates(currentVersion: string): Promise<SettingsUpdateCheckResult>;
  readUpdateState?(): SettingsUpdateState;
  installUpdate?(): Promise<void>;
  readRunningTaskCount?(): number;
  remindLater?(): Promise<SettingsUpdateState>;
  skipVersion?(): Promise<SettingsUpdateState>;
  respondInstallConfirmation?(requestId: number, approved: boolean): void;
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
    SETTINGS_IPC_CHANNELS.readUpdateState,
    (): SettingsUpdateState => options.readUpdateState?.() ?? {
      status: "idle",
      currentVersion: options.getVersion(),
    },
  );
  options.ipcMain.handle(
    SETTINGS_IPC_CHANNELS.installUpdate,
    () => options.installUpdate?.(),
  );
  options.ipcMain.handle(
    SETTINGS_IPC_CHANNELS.readRunningTaskCount,
    (): number => options.readRunningTaskCount?.() ?? 0,
  );
  options.ipcMain.handle(
    SETTINGS_IPC_CHANNELS.remindLater,
    () => options.remindLater?.() ?? options.readUpdateState?.() ?? {
      status: "idle",
      currentVersion: options.getVersion(),
    } satisfies SettingsUpdateState,
  );
  options.ipcMain.handle(
    SETTINGS_IPC_CHANNELS.skipVersion,
    () => options.skipVersion?.() ?? options.readUpdateState?.() ?? {
      status: "idle",
      currentVersion: options.getVersion(),
    } satisfies SettingsUpdateState,
  );
  options.ipcMain.handle(
    SETTINGS_IPC_CHANNELS.respondInstallConfirmation,
    (_event, raw: unknown) => {
      const response = readInstallConfirmationResponse(raw);
      if (response !== null) {
        options.respondInstallConfirmation?.(response.requestId, response.approved);
      }
    },
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

function readInstallConfirmationResponse(raw: unknown): SettingsInstallConfirmationResponse | null {
  if (typeof raw !== "object" || raw === null) {
    return null;
  }
  const value = raw as { requestId?: unknown; approved?: unknown };
  return typeof value.requestId === "number"
    && Number.isSafeInteger(value.requestId)
    && typeof value.approved === "boolean"
    ? { requestId: value.requestId, approved: value.approved }
    : null;
}
