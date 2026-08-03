import { describe, expect, it, vi } from "vitest";

import {
  DesktopUpdateRuntime,
} from "../src/desktop-update-runtime.js";
import {
  planReadyMarker,
} from "../src/desktop-update-plan.js";
import type {
  DesktopUpdateProvider,
  DesktopUpdateReadyStore,
} from "../src/desktop-update-contract.js";

function createProvider() {
  const listeners = new Map<string, Array<(...args: unknown[]) => void>>();
  const provider: DesktopUpdateProvider = {
    autoDownload: false,
    autoInstallOnAppQuit: true,
    on(event, listener) {
      listeners.set(event, [...(listeners.get(event) ?? []), listener]);
      return provider;
    },
    checkForUpdates: vi.fn(async () => undefined),
    quitAndInstall: vi.fn(),
  };
  return {
    provider,
    emit(event: string, ...args: unknown[]) {
      for (const listener of listeners.get(event) ?? []) {
        listener(...args);
      }
    },
  };
}

function createStore(initial: { version: string } | null = null) {
  let marker = initial;
  const store: DesktopUpdateReadyStore = {
    read: vi.fn(async () => marker),
    write: vi.fn(async (next) => {
      marker = next;
    }),
    clear: vi.fn(async () => {
      marker = null;
    }),
  };
  return { store, readMarker: () => marker };
}

describe("desktop update runtime", () => {
  it("checks on startup, enables background download, bounds progress, and gates install", async () => {
    const fake = createProvider();
    const store = createStore();
    const published: string[] = [];
    const runtime = new DesktopUpdateRuntime({
      platform: "darwin",
      arch: "arm64",
      isPackaged: true,
      currentVersion: "0.1.4",
      provider: fake.provider,
      readyStore: store.store,
      publish: (state) => published.push(state.status),
    });

    await runtime.start();
    expect(fake.provider.autoDownload).toBe(true);
    expect(fake.provider.autoInstallOnAppQuit).toBe(false);
    expect(fake.provider.checkForUpdates).toHaveBeenCalledOnce();

    fake.emit("update-available", { version: "0.1.5" });
    fake.emit("download-progress", { percent: 42 });
    fake.emit("download-progress", { percent: 12 });
    expect(runtime.state).toMatchObject({ status: "downloading", latestVersion: "0.1.5", progress: 42 });

    fake.emit("update-downloaded", { version: "0.1.5" });
    await vi.waitFor(() => expect(runtime.state.status).toBe("ready"));
    expect(store.readMarker()).toEqual({ version: "0.1.5" });
    expect(published).toContain("ready");

    await runtime.install();
    await runtime.install();
    expect(fake.provider.quitAndInstall).toHaveBeenCalledOnce();
    expect(runtime.state.status).toBe("installing");
  });

  it("restores a ready package after ordinary restart without checking again", async () => {
    const fake = createProvider();
    const store = createStore({ version: "0.1.5" });
    const runtime = new DesktopUpdateRuntime({
      platform: "darwin",
      arch: "arm64",
      isPackaged: true,
      currentVersion: "0.1.4",
      provider: fake.provider,
      readyStore: store.store,
      publish: vi.fn(),
    });

    await runtime.start();

    expect(runtime.state).toMatchObject({ status: "ready", latestVersion: "0.1.5" });
    expect(fake.provider.checkForUpdates).not.toHaveBeenCalled();
  });

  it("clears a marker that belongs to the current version before checking again", async () => {
    const fake = createProvider();
    const store = createStore({ version: "0.1.5" });
    const runtime = new DesktopUpdateRuntime({
      platform: "darwin",
      arch: "arm64",
      isPackaged: true,
      currentVersion: "0.1.5",
      provider: fake.provider,
      readyStore: store.store,
      publish: vi.fn(),
    });

    expect(planReadyMarker({ version: "0.1.5" }, "0.1.5")).toBe("clear");
    await runtime.start();

    expect(store.store.clear).toHaveBeenCalledOnce();
    expect(fake.provider.checkForUpdates).toHaveBeenCalledOnce();
    expect(runtime.state.status).toBe("latest");
  });

  it("does not restart a check while a download is already in progress", async () => {
    const fake = createProvider();
    const runtime = new DesktopUpdateRuntime({
      platform: "darwin",
      arch: "arm64",
      isPackaged: true,
      currentVersion: "0.1.4",
      provider: fake.provider,
      readyStore: createStore().store,
      publish: vi.fn(),
    });

    await runtime.start();
    fake.emit("update-available", { version: "0.1.5" });
    await runtime.check();
    fake.emit("download-progress", { percent: 42 });
    await runtime.check();

    expect(fake.provider.checkForUpdates).toHaveBeenCalledOnce();
    expect(runtime.state).toMatchObject({ status: "downloading", progress: 42 });
  });

  it("recovers after quitAndInstall does not terminate the process", async () => {
    vi.useFakeTimers();
    try {
      const fake = createProvider();
      const store = createStore();
      const onInstallFailure = vi.fn(async () => undefined);
      const runtime = new DesktopUpdateRuntime({
        platform: "darwin",
        arch: "arm64",
        isPackaged: true,
        currentVersion: "0.1.4",
        provider: fake.provider,
        readyStore: store.store,
        publish: vi.fn(),
        onInstallFailure,
        installWatchdogMs: 100,
      });

      await runtime.start();
      fake.emit("update-available", { version: "0.1.5" });
      fake.emit("update-downloaded", { version: "0.1.5" });
      await vi.waitFor(() => expect(runtime.state.status).toBe("ready"));
      await runtime.install();
      // electron-updater may silently re-check instead of throwing when its cache is stale.
      fake.emit("checking-for-update");
      await vi.advanceTimersByTimeAsync(100);

      expect(runtime.state).toMatchObject({ status: "failed", reason: "install", latestVersion: "0.1.5" });
      expect(store.readMarker()).toEqual({ version: "0.1.5" });
      expect(onInstallFailure).toHaveBeenCalledOnce();
    } finally {
      vi.useRealTimers();
    }
  });

  it("fails closed outside the signed release target and on provider errors", async () => {
    const unsupported = createProvider();
    const unsupportedRuntime = new DesktopUpdateRuntime({
      platform: "darwin",
      arch: "x64",
      isPackaged: true,
      currentVersion: "0.1.4",
      provider: unsupported.provider,
      readyStore: createStore().store,
      publish: vi.fn(),
    });
    await unsupportedRuntime.start();
    expect(unsupported.provider.checkForUpdates).not.toHaveBeenCalled();

    const failed = createProvider();
    const runtime = new DesktopUpdateRuntime({
      platform: "darwin",
      arch: "arm64",
      isPackaged: true,
      currentVersion: "0.1.4",
      provider: failed.provider,
      readyStore: createStore().store,
      publish: vi.fn(),
    });
    await runtime.start();
    failed.emit("error", new Error("network detail must not escape"));
    expect(runtime.state).toMatchObject({ status: "failed", reason: "unavailable", currentVersion: "0.1.4" });
  });
});
