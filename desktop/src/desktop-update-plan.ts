import type {
  DesktopUpdateFailureReason,
  DesktopUpdateState,
} from "./desktop-update-contract.js";

export const DESKTOP_UPDATE_CHECK_INTERVAL_MS = 4 * 60 * 60 * 1_000;

export type DesktopUpdateStatePatch = Partial<DesktopUpdateState> & Pick<DesktopUpdateState, "status">;

export function planDesktopUpdateState(input: {
  currentState: DesktopUpdateState;
  next: DesktopUpdateStatePatch;
  currentVersion: string;
  skippedVersion: string | null;
  remindLaterVersion: string | null;
}): DesktopUpdateState {
  const nextState = {
    ...input.currentState,
    ...input.next,
    currentVersion: input.currentVersion,
  };
  const readyVersion = planReadyUpdateVersion(nextState);
  return {
    ...nextState,
    skippedVersion: planMatchingSuppression(readyVersion, input.skippedVersion),
    remindLaterVersion: planMatchingSuppression(readyVersion, input.remindLaterVersion),
  };
}

export function planReadyUpdateVersion(state: DesktopUpdateState): string | undefined {
  return state.status === "ready" ? state.latestVersion : undefined;
}

function planMatchingSuppression(readyVersion: string | undefined, suppressedVersion: string | null): string | undefined {
  return readyVersion !== undefined && suppressedVersion === readyVersion ? readyVersion : undefined;
}

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
  return compareDesktopUpdateVersions(marker.version, currentVersion) === 1 ? "restore" : "clear";
}

export function planReadyMarkerVersion(
  marker: { version: string } | null,
  currentVersion: string,
): string | undefined {
  return marker !== null && planReadyMarker(marker, currentVersion) === "restore"
    ? marker.version
    : undefined;
}

export type DesktopUpdateInstallConfirmationDecision = "cancel" | "continue-working" | "install";

export function planUpdateInstallConfirmationDecision(input: {
  decision: DesktopUpdateInstallConfirmationDecision;
  version: string;
}): { approved: boolean; remindLaterVersion: string | undefined } {
  const approved = input.decision === "install";
  return {
    approved,
    remindLaterVersion: approved ? undefined : input.version,
  };
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

export function planScheduledUpdateCheck(state: DesktopUpdateState): "start" | "skip" {
  return planUpdateCheckAdmission(state);
}

export function planUpdateSchedulerStart(started: boolean): "start" | "skip" {
  return started ? "skip" : "start";
}

export type DesktopUpdateReminderPlan = "show" | "wait-for-idle" | "suppressed" | "hidden";

export function planDesktopUpdateReminder(input: {
  state: DesktopUpdateState;
  runningTaskCount: number | null;
}): DesktopUpdateReminderPlan {
  if (input.state.status !== "ready" || input.state.latestVersion === undefined) {
    return "hidden";
  }
  if (
    input.state.skippedVersion === input.state.latestVersion
    || input.state.remindLaterVersion === input.state.latestVersion
  ) {
    return "suppressed";
  }
  return input.runningTaskCount === null || input.runningTaskCount > 0
    ? "wait-for-idle"
    : "show";
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
  const retryableInstallFailure = state.status === "failed" && state.reason === "install";
  return (state.status === "ready" || retryableInstallFailure) && !invoked;
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

type ParsedDesktopUpdateVersion = {
  major: string;
  minor: string;
  patch: string;
  prerelease: string[] | null;
};

function parseDesktopUpdateVersion(value: string): ParsedDesktopUpdateVersion | null {
  const match = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/.exec(value);
  if (match === null) {
    return null;
  }
  const prerelease = match[4]?.split(".") ?? null;
  if (prerelease?.some((identifier) => /^\d+$/.test(identifier) && identifier.length > 1 && identifier.startsWith("0"))) {
    return null;
  }
  return {
    major: match[1]!,
    minor: match[2]!,
    patch: match[3]!,
    prerelease,
  };
}

function compareDesktopUpdateVersions(left: string, right: string): -1 | 0 | 1 | null {
  const parsedLeft = parseDesktopUpdateVersion(left);
  const parsedRight = parseDesktopUpdateVersion(right);
  if (parsedLeft === null || parsedRight === null) {
    return null;
  }
  for (const [leftPart, rightPart] of [
    [parsedLeft.major, parsedRight.major],
    [parsedLeft.minor, parsedRight.minor],
    [parsedLeft.patch, parsedRight.patch],
  ] as const) {
    const comparison = compareNumericIdentifiers(leftPart, rightPart);
    if (comparison !== 0) {
      return comparison;
    }
  }
  return comparePrereleaseIdentifiers(parsedLeft.prerelease, parsedRight.prerelease);
}

function compareNumericIdentifiers(left: string, right: string): -1 | 0 | 1 {
  if (left.length !== right.length) {
    return left.length < right.length ? -1 : 1;
  }
  if (left === right) {
    return 0;
  }
  return left < right ? -1 : 1;
}

function comparePrereleaseIdentifiers(left: string[] | null, right: string[] | null): -1 | 0 | 1 {
  if (left === null || right === null) {
    if (left === right) return 0;
    return left === null ? 1 : -1;
  }
  const count = Math.max(left.length, right.length);
  for (let index = 0; index < count; index += 1) {
    const leftIdentifier = left[index];
    const rightIdentifier = right[index];
    if (leftIdentifier === undefined || rightIdentifier === undefined) {
      return leftIdentifier === undefined ? -1 : 1;
    }
    const leftNumeric = /^\d+$/.test(leftIdentifier);
    const rightNumeric = /^\d+$/.test(rightIdentifier);
    if (leftNumeric && rightNumeric) {
      const comparison = compareNumericIdentifiers(leftIdentifier, rightIdentifier);
      if (comparison !== 0) return comparison;
      continue;
    }
    if (leftNumeric !== rightNumeric) {
      return leftNumeric ? -1 : 1;
    }
    if (leftIdentifier !== rightIdentifier) {
      return leftIdentifier < rightIdentifier ? -1 : 1;
    }
  }
  return 0;
}
