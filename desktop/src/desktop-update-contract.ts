export const DESKTOP_UPDATE_IPC_CHANNELS = {
  state: "desktop-update:state",
  readState: "desktop-update:read-state",
  check: "desktop-update:check",
  install: "desktop-update:install",
} as const;

export type DesktopUpdateStatus =
  | "idle"
  | "checking"
  | "latest"
  | "available"
  | "downloading"
  | "ready"
  | "failed"
  | "installing";

export type DesktopUpdateFailureReason =
  | "timeout"
  | "unavailable"
  | "unsupported"
  | "download"
  | "install";

export interface DesktopUpdateState {
  status: DesktopUpdateStatus;
  currentVersion: string;
  latestVersion?: string;
  /** Legacy browser fallback metadata; automatic updates do not require it. */
  downloadUrl?: string;
  progress?: number;
  reason?: DesktopUpdateFailureReason;
}

export type DesktopUpdateEvent =
  | "checking-for-update"
  | "update-available"
  | "update-not-available"
  | "download-progress"
  | "update-downloaded"
  | "error";

export interface DesktopUpdateProvider {
  autoDownload: boolean;
  autoInstallOnAppQuit: boolean;
  on(event: DesktopUpdateEvent, listener: (...args: unknown[]) => void): this;
  checkForUpdates(): Promise<unknown>;
  quitAndInstall(): void;
}

export interface DesktopUpdateReadyStore {
  read(): Promise<{ version: string } | null>;
  write(marker: { version: string }): Promise<void>;
  clear(): Promise<void>;
}
