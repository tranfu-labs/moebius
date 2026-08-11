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

export function decideInstallWithRunningTasks(
  intent: DesktopShutdownIntent,
  hasRunningTasks: boolean,
): boolean {
  return decideInstallShutdownIntent(intent) && hasRunningTasks;
}

export function decideInstallReconfirmation(input: {
  intent: DesktopShutdownIntent;
  approved: boolean;
  initialRunningTaskCount: number;
  executionTaskCount: number;
}): boolean {
  return input.approved
    && decideInstallShutdownIntent(input.intent)
    && input.initialRunningTaskCount === 0
    && input.executionTaskCount > 0;
}

export function decideInstallFailureKind(
  hadRunningTasks: boolean,
  tasksStopped: boolean,
): "task-stop" | "install" {
  return hadRunningTasks && !tasksStopped ? "task-stop" : "install";
}

export function resolveShutdownIntent(intent: DesktopShutdownIntent | null): DesktopShutdownIntent {
  return intent ?? "exit";
}
