export type DesktopShutdownIntent = "exit" | "install-update";

export function decideShutdownIntentConflict(
  current: DesktopShutdownIntent | null,
  next: DesktopShutdownIntent,
): boolean {
  return current !== null && current !== next;
}

export function decideInstallShutdownIntent(intent: DesktopShutdownIntent): boolean {
  return intent === "install-update";
}

export function decideRunningShutdownTasks(count: number): boolean {
  return count > 0;
}

export function resolveShutdownIntent(intent: DesktopShutdownIntent | null): DesktopShutdownIntent {
  return intent ?? "exit";
}
