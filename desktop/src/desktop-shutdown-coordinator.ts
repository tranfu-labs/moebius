import {
  decideInstallShutdownIntent,
  decideInstallFailureKind,
  decideInstallReconfirmation,
  decideInstallWithRunningTasks,
  decideRunningShutdownTasks,
  type DesktopShutdownIntent,
} from "./desktop-shutdown-intent-plan.js";
import { planInstallerShutdownApproval } from "./desktop-shutdown-plan.js";
import type { DesktopInstallFailure } from "./desktop-update-contract.js";

export async function coordinateDesktopShutdown(input: {
  intent: DesktopShutdownIntent;
  runningTaskCount: number;
  getRunningTaskCount(): number;
  confirmExit(runningTaskCount: number): Promise<boolean>;
  confirmInstall(runningTaskCount: number): Promise<boolean>;
  cancelRunningTasks(): Promise<void>;
  getInstallVersion(): string;
  reportCleanupBlocked(): Promise<void>;
  reportInstallFailure(failure: DesktopInstallFailure): Promise<void>;
}): Promise<{ kind: "stay-open" } | { kind: "shutdown"; hadRunningTasks: boolean }> {
  const { approved, executionTaskCount } = await coordinateDesktopShutdownApproval(input);
  if (planInstallerShutdownApproval(approved) === "stay-open") {
    return { kind: "stay-open" };
  }
  const hadRunningTasks = decideRunningShutdownTasks(executionTaskCount);
  try {
    if (hadRunningTasks) await input.cancelRunningTasks();
  } catch {
    if (decideInstallShutdownIntent(input.intent)) {
      const runningTaskCount = input.getRunningTaskCount();
      const tasksStopped = !decideRunningShutdownTasks(runningTaskCount);
      await input.reportInstallFailure({
        kind: decideInstallFailureKind(true, tasksStopped),
        version: input.getInstallVersion(),
        runningTaskCount,
        hadRunningTasks: true,
        tasksStopped,
        installStarted: false,
      }).catch(() => undefined);
    } else {
      await input.reportCleanupBlocked().catch(() => undefined);
    }
    return { kind: "stay-open" };
  }
  if (decideInstallWithRunningTasks(input.intent, hadRunningTasks)) {
    const remainingTaskCount = input.getRunningTaskCount();
    if (decideRunningShutdownTasks(remainingTaskCount)) {
      await input.reportInstallFailure({
        kind: "task-stop",
        version: input.getInstallVersion(),
        runningTaskCount: remainingTaskCount,
        hadRunningTasks: true,
        tasksStopped: false,
        installStarted: false,
      }).catch(() => undefined);
      return { kind: "stay-open" };
    }
  }
  return { kind: "shutdown", hadRunningTasks };
}

async function coordinateDesktopShutdownApproval(input: {
  intent: DesktopShutdownIntent;
  runningTaskCount: number;
  getRunningTaskCount(): number;
  confirmExit(runningTaskCount: number): Promise<boolean>;
  confirmInstall(runningTaskCount: number): Promise<boolean>;
}): Promise<{ approved: boolean; executionTaskCount: number }> {
  const approved = decideInstallShutdownIntent(input.intent)
    ? await input.confirmInstall(input.runningTaskCount)
    : await input.confirmExit(input.runningTaskCount);
  let executionTaskCount = input.getRunningTaskCount();
  if (decideInstallReconfirmation({
    intent: input.intent,
    approved,
    initialRunningTaskCount: input.runningTaskCount,
    executionTaskCount,
  })) {
    const reapproved = await input.confirmInstall(executionTaskCount);
    executionTaskCount = input.getRunningTaskCount();
    return { approved: reapproved, executionTaskCount };
  }
  return { approved, executionTaskCount };
}
