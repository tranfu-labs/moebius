import { describe, expect, it, vi } from "vitest";

import { DesktopShutdownRuntime } from "../src/desktop-shutdown-runtime.js";

function createRuntime(input: {
  installer?: {
    getRunningClis(): readonly ["codex"];
    cancelAll(): Promise<unknown>;
  } | null;
  confirm?: boolean;
}) {
  const closeLocalConsole = vi.fn(async () => undefined);
  const closeStateWorkers = vi.fn(async () => undefined);
  const quit = vi.fn();
  const reportCleanupBlocked = vi.fn(async () => undefined);
  const runtime = new DesktopShutdownRuntime({
    closeLocalConsole,
    closeStateWorkers,
    quit,
    getInstaller: () => input.installer ?? null,
    confirmInstallerCancellation: vi.fn(async () => input.confirm ?? false),
    reportCleanupBlocked,
  });
  return { runtime, closeLocalConsole, closeStateWorkers, quit, reportCleanupBlocked };
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
});
