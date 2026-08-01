import type {
  SettingsApplicationInfo,
  SettingsUpdateCheckResult,
  SettingsVersionCopyResult,
} from "../settings-contract.js";
import {
  SETTINGS_RELEASES_URL,
  SETTINGS_REPOSITORY_URL,
  createSettingsFeedbackUrl,
} from "../settings-contract.js";

export type DesktopUpdateStatus = "idle" | "checking" | "latest" | "available" | "failed";
export type DesktopCopyStatus = "idle" | "copied" | "failed";

export interface DesktopSettingsState {
  applicationInfo: SettingsApplicationInfo | null;
  updateStatus: DesktopUpdateStatus;
  latestVersion?: string;
  downloadUrl?: string;
  updateRequestId: number | null;
  copyStatus: DesktopCopyStatus;
  copyRequestId: number | null;
}

export type DesktopSettingsAction =
  | { type: "application-info-loaded"; info: SettingsApplicationInfo }
  | { type: "update-started"; requestId: number }
  | { type: "update-finished"; requestId: number; result: SettingsUpdateCheckResult }
  | { type: "copy-started"; requestId: number }
  | { type: "copy-finished"; requestId: number; result: SettingsVersionCopyResult };

export const INITIAL_DESKTOP_SETTINGS_STATE: DesktopSettingsState = {
  applicationInfo: null,
  updateStatus: "idle",
  updateRequestId: null,
  copyStatus: "idle",
  copyRequestId: null,
};

export function decideSettingsRequestAdmission(isRunning: boolean): {
  kind: "start";
} | { kind: "skip" } {
  return isRunning ? { kind: "skip" } : { kind: "start" };
}

export function decideSettingsPortAvailability(available: boolean): {
  kind: "available";
} | { kind: "unavailable" } {
  return available ? { kind: "available" } : { kind: "unavailable" };
}

export function planDesktopSettingsView(state: DesktopSettingsState) {
  return {
    settingsAbout: {
      currentVersion: state.applicationInfo?.version ?? "—",
      updateStatus: state.updateStatus,
      latestVersion: state.latestVersion,
      downloadUrl: state.downloadUrl,
      copyStatus: state.copyStatus,
    },
    settingsExternalLinks: {
      releaseNotes: SETTINGS_RELEASES_URL,
      feedback: state.applicationInfo === null
        ? "https://github.com/tranfu-labs/moebius/issues/new"
        : createSettingsFeedbackUrl(state.applicationInfo),
      repository: SETTINGS_REPOSITORY_URL,
    },
  };
}

export function reduceDesktopSettings(
  state: DesktopSettingsState,
  action: DesktopSettingsAction,
): DesktopSettingsState {
  switch (action.type) {
    case "application-info-loaded":
      return { ...state, applicationInfo: action.info };
    case "update-started":
      if (state.updateRequestId !== null) {
        return state;
      }
      return {
        ...state,
        updateStatus: "checking",
        latestVersion: undefined,
        downloadUrl: undefined,
        updateRequestId: action.requestId,
      };
    case "update-finished":
      if (state.updateRequestId !== action.requestId) {
        return state;
      }
      if (action.result.status === "available") {
        return {
          ...state,
          updateStatus: "available",
          latestVersion: action.result.latestVersion,
          downloadUrl: action.result.downloadUrl,
          updateRequestId: null,
        };
      }
      if (action.result.status === "latest") {
        return {
          ...state,
          updateStatus: "latest",
          latestVersion: action.result.latestVersion,
          downloadUrl: undefined,
          updateRequestId: null,
        };
      }
      return {
        ...state,
        updateStatus: "failed",
        latestVersion: undefined,
        downloadUrl: undefined,
        updateRequestId: null,
      };
    case "copy-started":
      if (state.copyRequestId !== null) {
        return state;
      }
      return { ...state, copyStatus: "idle", copyRequestId: action.requestId };
    case "copy-finished":
      if (state.copyRequestId !== action.requestId) {
        return state;
      }
      return {
        ...state,
        copyStatus: action.result.ok ? "copied" : "failed",
        copyRequestId: null,
      };
  }
}
