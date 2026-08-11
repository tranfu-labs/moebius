import {
  decideInstallFailureKind,
  decideInstallShutdownIntent,
  decideRunningShutdownTasks,
  type DesktopShutdownIntent,
} from "./desktop-shutdown-intent-plan.js";
import type {
  DesktopInstallAttemptContext,
  DesktopInstallFailure,
} from "./desktop-update-contract.js";

export async function performDesktopShutdown(input: {
  intent: DesktopShutdownIntent;
  context: DesktopInstallAttemptContext;
  stopUpdates(): void;
  resumeUpdates(): void;
  closeLocalConsole(): Promise<void>;
  closeStateWorkers(): Promise<void>;
  markShutdownComplete(): void;
  recoverAfterInstallFailure(): void;
  installUpdate(context: DesktopInstallAttemptContext): Promise<void>;
  quit(): void;
  getRunningTaskCount(): number;
  getInstallVersion(): string;
  reportCleanupBlocked(): Promise<void>;
  reportInstallFailure(failure: DesktopInstallFailure): Promise<void>;
}): Promise<void> {
  try {
    input.stopUpdates();
    await input.closeLocalConsole();
    await input.closeStateWorkers();
    input.markShutdownComplete();
    if (decideInstallShutdownIntent(input.intent)) {
      await input.installUpdate(input.context);
    } else {
      input.quit();
    }
  } catch {
    input.recoverAfterInstallFailure();
    input.resumeUpdates();
    if (decideInstallShutdownIntent(input.intent)) {
      const runningTaskCount = input.getRunningTaskCount();
      const tasksStopped = !decideRunningShutdownTasks(runningTaskCount);
      await input.reportInstallFailure({
        kind: decideInstallFailureKind(input.context.hadRunningTasks, tasksStopped),
        version: input.getInstallVersion(),
        runningTaskCount,
        hadRunningTasks: input.context.hadRunningTasks,
        tasksStopped,
        installStarted: false,
      }).catch(() => undefined);
    } else {
      await input.reportCleanupBlocked().catch(() => undefined);
    }
  }
}
