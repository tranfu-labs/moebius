import type {
  DesktopUpdateFailureReason,
  DesktopUpdateState,
} from "./desktop-update-contract.js";

export function decideDesktopUpdateTarget(input: {
  isPackaged: boolean;
  platform: NodeJS.Platform;
  arch: string;
}): boolean {
  return input.isPackaged && input.platform === "darwin" && input.arch === "arm64";
}

export function planReadyMarker(
  marker: { version: string } | null,
  currentVersion: string,
): "restore" | "clear" | "check" {
  if (marker === null) {
    return "check";
  }
  return marker.version === currentVersion ? "clear" : "restore";
}

export function planReadyMarkerVersion(
  marker: { version: string } | null,
  currentVersion: string,
): string | undefined {
  return marker !== null && marker.version !== currentVersion ? marker.version : undefined;
}

export function planInstallWatchdogMs(value: number | undefined): number {
  return value ?? 15_000;
}

export function planInstallWatchdogAction(invoked: boolean): "recover" | "wait" {
  return invoked ? "recover" : "wait";
}

export function planShouldClearInstallWatchdog(timer: unknown): boolean {
  return timer !== null;
}

export function planUpdateCheckAdmission(state: DesktopUpdateState): "start" | "skip" {
  return state.status === "ready"
    || state.status === "installing"
    || state.status === "available"
    || state.status === "downloading"
    ? "skip"
    : "start";
}

export function planStartupAdmission(started: boolean): "start" | "skip" {
  return started ? "skip" : "start";
}

export function planCheckAdmission(pending: Promise<DesktopUpdateState> | null): "start" | "wait" {
  return pending === null ? "start" : "wait";
}

export function decidePublishLatest(state: DesktopUpdateState): boolean {
  return state.status === "checking";
}

export function planInstallationAdmission(state: DesktopUpdateState, invoked: boolean): boolean {
  return state.status === "ready" && !invoked;
}

export function resolveUpdateVersion(value: unknown, fallback: string): string {
  if (typeof value === "string" && value.trim() !== "") {
    return value;
  }
  if (typeof value !== "object" || value === null) {
    return fallback;
  }
  const version = (value as { version?: unknown }).version;
  return typeof version === "string" && version.trim() !== "" ? version : fallback;
}

export function normalizeUpdateProgress(value: unknown, previous: number): number {
  if (typeof value !== "object" || value === null) {
    return previous;
  }
  const percent = (value as { percent?: unknown }).percent;
  if (typeof percent !== "number" || !Number.isFinite(percent)) {
    return previous;
  }
  return Math.min(100, Math.max(previous, Math.min(100, Math.max(0, percent))));
}

export function planProgressBaseline(value: number | undefined): number {
  return value ?? 0;
}

export function planUpdateFailureReason(status: DesktopUpdateState["status"]): DesktopUpdateFailureReason {
  return status === "downloading" || status === "available" ? "download" : "unavailable";
}
