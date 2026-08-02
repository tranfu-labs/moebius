export type DesktopShutdownRequestPlan =
  | "await-shutdown"
  | "await-coordination"
  | "coordinate-installers"
  | "shutdown";

export function planDesktopShutdownRequest(input: {
  shutdownComplete: boolean;
  shutdownPending: boolean;
  coordinationPending: boolean;
  hasRunningInstallers: boolean;
}): DesktopShutdownRequestPlan {
  if (input.shutdownComplete || input.shutdownPending) {
    return "await-shutdown";
  }
  if (input.coordinationPending) {
    return "await-coordination";
  }
  return input.hasRunningInstallers ? "coordinate-installers" : "shutdown";
}

export function planInstallerShutdownApproval(
  shouldCancelInstallers: boolean,
): "cancel-installers" | "stay-open" {
  return shouldCancelInstallers ? "cancel-installers" : "stay-open";
}

export function planInstallerAccess(
  isAvailable: boolean,
): "available" | "unavailable" {
  return isAvailable ? "available" : "unavailable";
}

export function planBeforeQuit(shutdownComplete: boolean): "allow" | "coordinate" {
  return shutdownComplete ? "allow" : "coordinate";
}

export function planLastWindowClosed(isQuitting: boolean): "ignore" | "coordinate" {
  return isQuitting ? "ignore" : "coordinate";
}
