import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { Clipboard, IpcMain, Shell } from "electron";
import { describe, expect, it, vi } from "vitest";

import { registerDesktopCoreIpc } from "../src/desktop-core-ipc-register.js";
import { SETTINGS_IPC_CHANNELS } from "../src/settings-contract.js";

const desktopRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

describe("status page update entry", () => {
  it("removes the migrated update action and its deprecated IPC surface", async () => {
    const [html, statusScript, preload, main] = await Promise.all([
      fs.readFile(path.join(desktopRoot, "src/status-page/index.html"), "utf8"),
      fs.readFile(path.join(desktopRoot, "src/status-page/status.js"), "utf8"),
      fs.readFile(path.join(desktopRoot, "src/preload.ts"), "utf8"),
      fs.readFile(path.join(desktopRoot, "src/main.ts"), "utf8"),
    ]);

    expect(html).not.toContain("check-updates");
    expect(statusScript).not.toContain("checkUpdates");
    expect(preload).not.toContain("checkUpdates");
    expect(main).not.toContain("action:check-updates");
  });

  it("registers the migrated settings update capability through desktop IPC", async () => {
    const handlers = new Map<string, (...args: unknown[]) => unknown>();
    const checkForUpdates = vi.fn(async (currentVersion: string) => ({
      status: "latest" as const,
      currentVersion,
      latestVersion: currentVersion,
    }));
    registerDesktopCoreIpc({
      ipcMain: {
        handle(channel: string, listener: (...args: never[]) => unknown) {
          handlers.set(channel, listener as (...args: unknown[]) => unknown);
        },
      } as unknown as IpcMain,
      clipboard: { writeText: vi.fn() } as unknown as Clipboard,
      shell: {
        showItemInFolder: vi.fn(),
        openPath: vi.fn(async () => ""),
        openExternal: vi.fn(async () => undefined),
      } as unknown as Shell,
      openStatusPage: vi.fn(),
      refreshDoctor: vi.fn(async () => undefined),
      getLocalConsoleUrl: () => null,
      getAttachmentCapability: () => null,
      getPathSource: () => null,
      selectDirectory: vi.fn(async () => null),
      openProjectTitle: () => "Open project",
      repairProjectTitle: () => "Repair project",
      selectLocationLabel: () => "Select location",
      dataRoot: "/tmp/moebius-test-data",
      getVersion: () => "0.2.0",
      checkForUpdates,
    });

    expect(handlers.has(SETTINGS_IPC_CHANNELS.readApplicationInfo)).toBe(true);
    expect(handlers.has(SETTINGS_IPC_CHANNELS.checkForUpdates)).toBe(true);
    expect(handlers.has(SETTINGS_IPC_CHANNELS.copyVersionInfo)).toBe(true);
    await handlers.get(SETTINGS_IPC_CHANNELS.checkForUpdates)?.({});
    expect(checkForUpdates).toHaveBeenCalledWith("0.2.0");
  });
});
