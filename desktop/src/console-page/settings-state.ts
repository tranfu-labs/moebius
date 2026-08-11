import type {
  DesktopUpdateState,
  SettingsInstallFailure,
  SettingsInstallConfirmation,
  SettingsApplicationInfo,
  SettingsUpdateCheckResult,
  SettingsVersionCopyResult,
} from "../settings-contract.js";
import type { AgentExecutionProfile } from "@moebius/console-ui";
import {
  SETTINGS_RELEASES_URL,
  SETTINGS_REPOSITORY_URL,
  createSettingsFeedbackUrl,
} from "../settings-contract.js";

export type DesktopUpdateStatus = SettingsUpdateCheckResult["status"];
export type DesktopCopyStatus = "idle" | "copied" | "failed";

export interface DesktopDefaultAgentState {
  profile: AgentExecutionProfile;
  saveStatus: "idle" | "saving" | "failed";
  saveError: string | null;
}

export interface DesktopSettingsState {
  applicationInfo: SettingsApplicationInfo | null;
  updateStatus: DesktopUpdateStatus;
  latestVersion?: string;
  progress?: number;
  updateFailureReason?: DesktopUpdateState["reason"];
  skippedVersion?: string;
  remindLaterVersion?: string;
  updateRequestId: number | null;
  copyStatus: DesktopCopyStatus;
  copyRequestId: number | null;
  defaultAgent: DesktopDefaultAgentState | null;
  runningTaskCount: number | null;
  installConfirmation: SettingsInstallConfirmation | null;
  installFailure: SettingsInstallFailure | null;
}

export type DesktopSettingsAction =
  | { type: "application-info-loaded"; info: SettingsApplicationInfo }
  | { type: "update-started"; requestId: number }
  | { type: "update-state-received"; state: SettingsUpdateCheckResult }
  | { type: "update-finished"; requestId: number; result: SettingsUpdateCheckResult }
  | { type: "running-task-count-received"; count: number }
  | { type: "install-confirmation-received"; confirmation: SettingsInstallConfirmation }
  | { type: "install-confirmation-cleared"; requestId: number }
  | { type: "install-failure-received"; failure: SettingsInstallFailure }
  | { type: "install-failure-cleared" }
  | { type: "copy-started"; requestId: number }
  | { type: "copy-finished"; requestId: number; result: SettingsVersionCopyResult }
  | { type: "default-agent-loaded"; profile: AgentExecutionProfile }
  | { type: "default-agent-save-started" }
  | { type: "default-agent-save-finished"; profile: AgentExecutionProfile }
  | { type: "default-agent-save-failed"; error: string };

export const INITIAL_DESKTOP_SETTINGS_STATE: DesktopSettingsState = {
  applicationInfo: null,
  updateStatus: "idle",
  updateRequestId: null,
  copyStatus: "idle",
  copyRequestId: null,
  defaultAgent: null,
  runningTaskCount: null,
  installConfirmation: null,
  installFailure: null,
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
      progress: state.progress,
      updateFailureReason: state.updateFailureReason,
      skippedVersion: state.skippedVersion !== undefined
        && state.skippedVersion === state.latestVersion,
      copyStatus: state.copyStatus,
    },
    settingsExternalLinks: {
      releaseNotes: SETTINGS_RELEASES_URL,
      feedback: state.applicationInfo === null
        ? "https://github.com/tranfu-labs/moebius/issues/new"
        : createSettingsFeedbackUrl(state.applicationInfo),
      repository: SETTINGS_REPOSITORY_URL,
    },
    defaultAgent: state.defaultAgent === null
      ? undefined
      : {
          profile: state.defaultAgent.profile,
          saveStatus: state.defaultAgent.saveStatus,
          error: state.defaultAgent.saveError,
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
        progress: undefined,
        updateFailureReason: undefined,
        updateRequestId: action.requestId,
      };
    case "update-finished":
      if (state.updateRequestId !== action.requestId) {
        return state;
      }
      return applyUpdateState({ ...state, updateRequestId: null }, action.result);
    case "update-state-received":
      return applyUpdateState(state, action.state);
    case "running-task-count-received":
      return {
        ...state,
        runningTaskCount: Number.isFinite(action.count) && action.count >= 0
          ? Math.floor(action.count)
          : state.runningTaskCount,
      };
    case "install-confirmation-received":
      return { ...state, installConfirmation: action.confirmation };
    case "install-confirmation-cleared":
      return state.installConfirmation?.requestId === action.requestId
        ? { ...state, installConfirmation: null }
        : state;
    case "install-failure-received":
      return { ...state, installFailure: action.failure };
    case "install-failure-cleared":
      return state.installFailure === null ? state : { ...state, installFailure: null };
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
    case "default-agent-loaded":
      return {
        ...state,
        defaultAgent: {
          profile: action.profile,
          saveStatus: "idle",
          saveError: null,
        },
      };
    case "default-agent-save-started":
      if (state.defaultAgent === null || state.defaultAgent.saveStatus === "saving") {
        return state;
      }
      return {
        ...state,
        defaultAgent: { ...state.defaultAgent, saveStatus: "saving", saveError: null },
      };
    case "default-agent-save-finished":
      return {
        ...state,
        defaultAgent: {
          profile: action.profile,
          saveStatus: "idle",
          saveError: null,
        },
      };
    case "default-agent-save-failed":
      if (state.defaultAgent === null) {
        return state;
      }
      return {
        ...state,
        defaultAgent: { ...state.defaultAgent, saveStatus: "failed", saveError: action.error },
      };
  }
}

function applyUpdateState(
  state: DesktopSettingsState,
  update: SettingsUpdateCheckResult,
): DesktopSettingsState {
  return {
    ...state,
    updateStatus: update.status,
    latestVersion: update.latestVersion,
    progress: update.progress,
    updateFailureReason: update.reason,
    skippedVersion: update.skippedVersion,
    remindLaterVersion: update.remindLaterVersion,
  };
}
