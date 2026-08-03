import type {
  DesktopUpdateFailureReason,
  DesktopUpdateState,
} from "./desktop-update-contract.js";

export type { DesktopUpdateFailureReason, DesktopUpdateState } from "./desktop-update-contract.js";

export const SETTINGS_IPC_CHANNELS = {
  readApplicationInfo: "settings:read-application-info",
  checkForUpdates: "settings:check-for-updates",
  readUpdateState: "settings:read-update-state",
  installUpdate: "settings:install-update",
  updateState: "settings:update-state",
  copyVersionInfo: "settings:copy-version-info",
} as const;

export const SETTINGS_PLATFORM_LABEL = "Apple Silicon Mac";
export const SETTINGS_RELEASES_URL = "https://github.com/tranfu-labs/moebius/releases";
export const SETTINGS_REPOSITORY_URL = "https://github.com/tranfu-labs/moebius";

export interface SettingsApplicationInfo {
  version: string;
  platform: typeof SETTINGS_PLATFORM_LABEL;
}

export type SettingsUpdateFailureReason = DesktopUpdateFailureReason;
export type SettingsUpdateCheckResult = DesktopUpdateState;
export type SettingsUpdateState = DesktopUpdateState;

export type SettingsVersionCopyResult =
  | { ok: true }
  | { ok: false; reason: "clipboard-unavailable" };

export function createSettingsApplicationInfo(version: string): SettingsApplicationInfo {
  return {
    version,
    platform: SETTINGS_PLATFORM_LABEL,
  };
}

export function formatSettingsVersionInfo(info: SettingsApplicationInfo): string {
  return `Moebius ${info.version} · ${info.platform}`;
}

export function createSettingsFeedbackUrl(info: SettingsApplicationInfo): string {
  const url = new URL("https://github.com/tranfu-labs/moebius/issues/new");
  url.searchParams.set("body", formatSettingsVersionInfo(info));
  return url.href;
}
