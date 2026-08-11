import { describe, expect, it, vi } from "vitest";

import { DesktopShutdownRuntime } from "../src/desktop-shutdown-runtime.js";
import type { DesktopInstallFailure } from "../src/desktop-update-contract.js";

function createRuntime(input: {
  installer?: {
    getRunningClis(): readonly ["codex"];
    cancelAll(): Promise<unknown>;
  } | null;
  confirm?: boolean;
  runningTaskCount?: number;
  confirmExit?: boolean;
  confirmInstall?: boolean;
  installUpdate?: () => Promise<void>;
  cancelRunningTasks?: () => Promise<void>;
}) {
  const closeLocalConsole = vi.fn(async () => undefined);
  const closeStateWorkers = vi.fn(async () => undefined);
  const quit = vi.fn();
  const reportCleanupBlocked = vi.fn(async () => undefined);
  const confirmExit = vi.fn(async () => input.confirmExit ?? input.confirm ?? false);
  const confirmInstall = vi.fn(async () => input.confirmInstall ?? input.confirm ?? false);
  const cancelRunningTasks = vi.fn(input.cancelRunningTasks ?? (async () => {
    await input.installer?.cancelAll();
  }));
  const reportInstallFailure = vi.fn(async (_failure: DesktopInstallFailure) => undefined);
  const runtime = new DesktopShutdownRuntime({
    closeLocalConsole,
    closeStateWorkers,
    quit,
    reportCleanupBlocked,
    getRunningTaskCount: () => input.runningTaskCount ?? (input.installer?.getRunningClis().length ?? 0),
    cancelRunningTasks,
    confirmExit,
    confirmInstall,
    installUpdate: input.installUpdate ?? (async () => undefined),
    getInstallVersion: () => "0.5.0",
    reportInstallFailure,
  });
  return {
    runtime,
    closeLocalConsole,
    closeStateWorkers,
    quit,
    reportCleanupBlocked,
    confirmExit,
    confirmInstall,
    cancelRunningTasks,
    reportInstallFailure,
  };
}

describe("desktop shutdown runtime", () => {
  it("closes runtime resources exactly once across concurrent requests", async () => {
    const state = createRuntime({});
    await Promise.all([state.runtime.request(), state.runtime.request()]);
    expect(state.closeLocalConsole).toHaveBeenCalledOnce();
    expect(state.closeStateWorkers).toHaveBeenCalledOnce();
    expect(state.quit).toHaveBeenCalledOnce();
  });

  it("keeps the app open when the user declines installer cancellation", async () => {
    const cancelAll = vi.fn(async () => undefined);
    const state = createRuntime({
      installer: { getRunningClis: () => ["codex"], cancelAll },
      confirm: false,
    });
    await state.runtime.request();
    expect(cancelAll).not.toHaveBeenCalled();
    expect(state.closeLocalConsole).not.toHaveBeenCalled();
    expect(state.quit).not.toHaveBeenCalled();
  });

  it("reports failed installer cleanup without closing the app", async () => {
    const cancelAll = vi.fn(async () => {
      throw new Error("installer still running");
    });
    const state = createRuntime({
      installer: { getRunningClis: () => ["codex"], cancelAll },
      confirm: true,
    });
    await state.runtime.request();
    expect(state.reportCleanupBlocked).toHaveBeenCalledOnce();
    expect(state.closeLocalConsole).not.toHaveBeenCalled();
    expect(state.quit).not.toHaveBeenCalled();
  });

  it("quits without a confirmation when no task is running", async () => {
    const state = createRuntime({ runningTaskCount: 0 });

    await state.runtime.request();

    expect(state.confirmExit).not.toHaveBeenCalled();
    expect(state.closeLocalConsole).toHaveBeenCalledOnce();
    expect(state.quit).toHaveBeenCalledOnce();
  });

  it("resets the quit guard when runtime cleanup fails and permits a retry", async () => {
    const state = createRuntime({ runningTaskCount: 0 });
    state.closeLocalConsole.mockRejectedValueOnce(new Error("close failed"));

    await state.runtime.request();

    expect(state.reportCleanupBlocked).toHaveBeenCalledOnce();
    expect(state.runtime.isQuitting).toBe(false);
    expect(state.quit).not.toHaveBeenCalled();

    await state.runtime.request();

    expect(state.closeLocalConsole).toHaveBeenCalledTimes(2);
    expect(state.quit).toHaveBeenCalledOnce();
  });

  it("uses a separate install confirmation and invokes installation once after cleanup", async () => {
    const installUpdate = vi.fn(async () => undefined);
    const state = createRuntime({
      runningTaskCount: 0,
      confirmInstall: true,
      installUpdate,
    });

    await state.runtime.requestInstall();
    await state.runtime.requestInstall();

    expect(state.confirmInstall).toHaveBeenCalledOnce();
    expect(state.confirmExit).not.toHaveBeenCalled();
    expect(state.closeLocalConsole).toHaveBeenCalledOnce();
    expect(installUpdate).toHaveBeenCalledOnce();
    expect(state.quit).not.toHaveBeenCalled();
  });

  it("keeps the app open when the running-task exit guard is cancelled", async () => {
    const state = createRuntime({ runningTaskCount: 2, confirmExit: false });

    await state.runtime.request();

    expect(state.confirmExit).toHaveBeenCalledWith(2);
    expect(state.cancelRunningTasks).not.toHaveBeenCalled();
    expect(state.quit).not.toHaveBeenCalled();
  });

  it("re-reads tasks before installation when work starts after the first confirmation", async () => {
    let runningTaskCount = 0;
    const confirmInstall = vi.fn(async () => {
      runningTaskCount = confirmInstall.mock.calls.length === 1 ? 2 : runningTaskCount;
      return true;
    });
    const cancelRunningTasks = vi.fn(async () => {
      runningTaskCount = 0;
    });
    const closeLocalConsole = vi.fn(async () => undefined);
    const closeStateWorkers = vi.fn(async () => undefined);
    const installUpdate = vi.fn(async () => undefined);
    const runtime = new DesktopShutdownRuntime({
      closeLocalConsole,
      closeStateWorkers,
      quit: vi.fn(),
      reportCleanupBlocked: vi.fn(async () => undefined),
      getRunningTaskCount: () => runningTaskCount,
      cancelRunningTasks,
      confirmExit: vi.fn(async () => false),
      confirmInstall,
      installUpdate,
    });

    await runtime.requestInstall();

    expect(confirmInstall).toHaveBeenNthCalledWith(1, 0);
    expect(confirmInstall).toHaveBeenNthCalledWith(2, 2);
    expect(cancelRunningTasks).toHaveBeenCalledOnce();
    expect(installUpdate).toHaveBeenCalledWith({ hadRunningTasks: true });
  });

  it("reports a task-stop failure without closing the app or starting installation", async () => {
    const state = createRuntime({
      runningTaskCount: 2,
      confirmInstall: true,
      cancelRunningTasks: async () => undefined,
    });

    await state.runtime.requestInstall();

    expect(state.reportInstallFailure).toHaveBeenCalledWith({
      kind: "task-stop",
      version: "0.5.0",
      runningTaskCount: 2,
      hadRunningTasks: true,
      tasksStopped: false,
      installStarted: false,
    });
    expect(state.closeLocalConsole).not.toHaveBeenCalled();
    expect(state.quit).not.toHaveBeenCalled();
  });

  it("re-samples task count when retrying after a failed install attempt", async () => {
    let runningTaskCount = 0;
    const confirmInstall = vi.fn(async () => true);
    const installUpdate = vi.fn(async () => undefined);
    const cancelRunningTasks = vi.fn(async () => {
      runningTaskCount = 0;
    });
    const runtime = new DesktopShutdownRuntime({
      closeLocalConsole: vi.fn(async () => undefined),
      closeStateWorkers: vi.fn(async () => undefined),
      quit: vi.fn(),
      reportCleanupBlocked: vi.fn(async () => undefined),
      reportInstallFailure: vi.fn(async () => undefined),
      getInstallVersion: () => "0.5.0",
      getRunningTaskCount: () => runningTaskCount,
      cancelRunningTasks,
      confirmExit: vi.fn(async () => false),
      confirmInstall,
      installUpdate,
    });

    await runtime.requestInstall();
    runtime.recoverAfterInstallFailure();
    runningTaskCount = 2;
    await runtime.requestInstall();

    expect(confirmInstall).toHaveBeenNthCalledWith(1, 0);
    expect(confirmInstall).toHaveBeenNthCalledWith(2, 2);
    expect(cancelRunningTasks).toHaveBeenCalledOnce();
    expect(installUpdate).toHaveBeenLastCalledWith({ hadRunningTasks: true });
  });
});
