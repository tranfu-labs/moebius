import type {
  DesktopUpdateProvider,
  DesktopUpdateReadyStore,
  DesktopUpdateSkipStore,
  DesktopUpdateState,
  DesktopInstallConfirmation,
  DesktopInstallFailure,
} from "./desktop-update-contract.js";
import { DesktopInstallConfirmationBroker } from "./desktop-install-confirmation.js";
import { DesktopShutdownRuntime } from "./desktop-shutdown-runtime.js";
import { DesktopUpdateRuntime } from "./desktop-update-runtime.js";
import {
  DesktopUpdateScheduler,
  type DesktopUpdatePowerMonitor,
} from "./desktop-update-scheduler.js";

export function createDesktopUpdateShutdownWiring(input: {
  platform: NodeJS.Platform;
  arch: string;
  isPackaged: boolean;
  currentVersion: string;
  provider: DesktopUpdateProvider;
  readyStore: DesktopUpdateReadyStore;
  skipStore: DesktopUpdateSkipStore;
  powerMonitor: DesktopUpdatePowerMonitor;
  publishUpdateState(state: DesktopUpdateState): void;
  publishInstallConfirmation(request: DesktopInstallConfirmation): void;
  publishInstallFailure(failure: DesktopInstallFailure): void;
  startLocalConsole(): Promise<void>;
  recoverAfterInstallFailure(): void;
  closeLocalConsole(): Promise<void>;
  closeStateWorkers(): Promise<void>;
  quit(): void;
  reportCleanupBlocked(): Promise<void>;
  getRunningTaskCount(): number;
  cancelRunningTasks(): Promise<void>;
  confirmExit(runningTaskCount: number): Promise<boolean>;
}): {
  updateRuntime: DesktopUpdateRuntime;
  updateScheduler: DesktopUpdateScheduler;
  installConfirmation: DesktopInstallConfirmationBroker;
  shutdown: DesktopShutdownRuntime;
  onWillQuit(): void;
} {
  const installConfirmation = new DesktopInstallConfirmationBroker(input.publishInstallConfirmation);
  const updateRuntime = new DesktopUpdateRuntime({
    platform: input.platform,
    arch: input.arch,
    isPackaged: input.isPackaged,
    currentVersion: input.currentVersion,
    provider: input.provider,
    readyStore: input.readyStore,
    skipStore: input.skipStore,
    publish: input.publishUpdateState,
    onInstallFailure: async ({ version, context }) => {
      await input.startLocalConsole();
      input.recoverAfterInstallFailure();
      updateScheduler.start();
      input.publishInstallFailure({
        kind: "install",
        version,
        runningTaskCount: 0,
        hadRunningTasks: context.hadRunningTasks,
        tasksStopped: true,
        installStarted: true,
      });
    },
  });
  const updateScheduler = new DesktopUpdateScheduler({
    check: () => updateRuntime.check(),
    powerMonitor: input.powerMonitor,
  });
  const shutdown = new DesktopShutdownRuntime({
    closeLocalConsole: input.closeLocalConsole,
    closeStateWorkers: input.closeStateWorkers,
    quit: input.quit,
    reportCleanupBlocked: input.reportCleanupBlocked,
    getRunningTaskCount: input.getRunningTaskCount,
    cancelRunningTasks: input.cancelRunningTasks,
    confirmExit: input.confirmExit,
    confirmInstall: (runningTaskCount) => installConfirmation.request({
      version: updateRuntime.state.latestVersion ?? input.currentVersion,
      runningTaskCount,
    }),
    installUpdate: (context) => updateRuntime.install(context),
    getInstallVersion: () => updateRuntime.state.latestVersion ?? input.currentVersion,
    reportInstallFailure: async (failure) => {
      if (failure.kind === "task-stop") {
        await updateRuntime.remindLater();
      } else if (!failure.installStarted) {
        await updateRuntime.markInstallFailure();
      }
      input.publishInstallFailure(failure);
    },
    stopUpdates: () => updateScheduler.stop(),
    resumeUpdates: () => updateScheduler.start(),
  });
  return {
    updateRuntime,
    updateScheduler,
    installConfirmation,
    shutdown,
    onWillQuit: () => {
      updateScheduler.stop();
      installConfirmation.cancelAll();
    },
  };
}
