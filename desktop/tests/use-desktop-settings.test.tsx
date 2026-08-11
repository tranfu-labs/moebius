/** @vitest-environment jsdom */

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { waitForCondition } from "../../src/testing/wait.js";
import type { SettingsApplicationInfo, SettingsUpdateState } from "../src/settings-contract.js";
import {
  type DesktopSettingsPort,
  useDesktopSettingsBundle,
} from "../src/console-page/use-desktop-settings.js";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe("desktop settings bundle", () => {
  let host: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    host.remove();
  });

  it("keeps the newer application info when the parent port changes before an older read resolves", async () => {
    const older = deferred<SettingsApplicationInfo>();
    const newer = deferred<SettingsApplicationInfo>();
    const first: DesktopSettingsPort = { readApplicationInfo: () => older.promise };
    const second: DesktopSettingsPort = { readApplicationInfo: () => newer.promise };

    await act(async () => root.render(<SettingsHarness api={first} />));
    await act(async () => root.render(<SettingsHarness api={second} />));
    await act(async () => newer.resolve(applicationInfo("2.0.0")));
    await waitFor(() => host.textContent?.startsWith("2.0.0") === true);
    await act(async () => older.resolve(applicationInfo("1.0.0")));

    expect(host.textContent).toMatch(/^2\.0\.0/u);
  });

  it("ignores a late update event from the replaced port and accepts the current subscription", async () => {
    const listeners: Array<(state: SettingsUpdateState) => void> = [];
    const makePort = (): DesktopSettingsPort => ({
      readApplicationInfo: async () => applicationInfo("2.0.0"),
      onUpdateState: (listener) => {
        listeners.push(listener);
        return () => undefined;
      },
    });
    const first = makePort();
    const second = makePort();

    await act(async () => root.render(<SettingsHarness api={first} />));
    await act(async () => root.render(<SettingsHarness api={second} />));
    await waitFor(() => listeners.length === 2);
    const oldListener = listeners[0]!;
    const currentListener = listeners[1]!;
    await act(async () => {
      oldListener({ status: "ready", currentVersion: "2.0.0", latestVersion: "1.0.0" });
    });
    expect(host.textContent).toContain("idle");
    await act(async () => {
      currentListener({ status: "ready", currentVersion: "2.0.0", latestVersion: "2.1.0" });
    });
    await waitFor(() => host.textContent?.includes("ready") === true);
    expect(host.textContent).toContain("2.1.0");
  });

  it("does not let a slow task-count read from an old parent port reopen a reminder", async () => {
    const older = deferred<number>();
    const newer = deferred<number>();
    const first: DesktopSettingsPort = {
      readRunningTaskCount: () => older.promise,
    };
    const second: DesktopSettingsPort = {
      readRunningTaskCount: () => newer.promise,
    };

    await act(async () => root.render(<SettingsHarness api={first} />));
    await act(async () => root.render(<SettingsHarness api={second} />));
    await act(async () => newer.resolve(2));
    await waitFor(() => host.textContent?.endsWith(":2") === true);
    await act(async () => older.resolve(0));

    expect(host.textContent).toMatch(/:2$/u);
  });
});

function SettingsHarness({ api }: { api: DesktopSettingsPort }): JSX.Element {
  const bundle = useDesktopSettingsBundle(api);
  return <div>{bundle.settingsAbout.currentVersion}:{bundle.settingsAbout.updateStatus}:{bundle.settingsAbout.latestVersion ?? ""}:{bundle.runningTaskCount ?? "pending"}</div>;
}

function applicationInfo(version: string): SettingsApplicationInfo {
  return {
    version,
    platform: "Apple Silicon Mac",
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((accept) => {
    resolve = accept;
  });
  return { promise, resolve };
}

async function waitFor(predicate: () => boolean): Promise<void> {
  await waitForCondition(predicate, {
    describe: "desktop settings bundle state",
    snapshot: () => ({ text: document.body.textContent }),
    tick: async (ms) => act(async () => new Promise((resolve) => setTimeout(resolve, ms))),
  });
}
