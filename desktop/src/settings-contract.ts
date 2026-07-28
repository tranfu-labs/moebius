export const SETTINGS_IPC_CHANNELS = {
  readApplicationInfo: "settings:read-application-info",
  checkForUpdates: "settings:check-for-updates",
  copyVersionInfo: "settings:copy-version-info",
} as const;

export const SETTINGS_PLATFORM_LABEL = "Apple Silicon Mac";
export const SETTINGS_RELEASES_URL = "https://github.com/tranfu-labs/moebius/releases";
export const SETTINGS_REPOSITORY_URL = "https://github.com/tranfu-labs/moebius";

export interface SettingsApplicationInfo {
  version: string;
  platform: typeof SETTINGS_PLATFORM_LABEL;
}

export type SettingsUpdateFailureReason = "timeout" | "unavailable";

export type SettingsUpdateCheckResult =
  | {
    status: "latest";
    currentVersion: string;
    latestVersion: string;
  }
  | {
    status: "available";
    currentVersion: string;
    latestVersion: string;
    downloadUrl: string;
  }
  | {
    status: "failed";
    currentVersion: string;
    reason: SettingsUpdateFailureReason;
  };

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
