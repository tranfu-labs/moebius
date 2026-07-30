import { describe, expect, it, vi } from "vitest";

import {
  SETTINGS_IPC_CHANNELS,
  type SettingsUpdateCheckResult,
} from "../src/settings-contract.js";
import { registerSettingsIpc } from "../src/settings-ipc.js";

describe("settings IPC", () => {
  it("exposes fixed app info, structured update results, and fixed clipboard content", async () => {
    const handlers = new Map<string, (event: unknown) => unknown>();
    const writeText = vi.fn();
    const updateResult: SettingsUpdateCheckResult = {
      status: "available",
      currentVersion: "0.1.4",
      latestVersion: "0.1.5",
      downloadUrl: "https://github.com/tranfu-labs/moebius/releases/tag/v0.1.5",
    };
    const checkForUpdates = vi.fn(async () => updateResult);
    registerSettingsIpc({
      ipcMain: {
        handle(channel, listener) {
          handlers.set(channel, listener);
        },
      },
      getVersion: () => "0.1.4",
      checkForUpdates,
      clipboard: { writeText },
    });

    expect(handlers.get(SETTINGS_IPC_CHANNELS.readApplicationInfo)?.(undefined)).toEqual({
      version: "0.1.4",
      platform: "Apple Silicon Mac",
    });
    await expect(handlers.get(SETTINGS_IPC_CHANNELS.checkForUpdates)?.(undefined))
      .resolves.toEqual(updateResult);
    expect(checkForUpdates).toHaveBeenCalledWith("0.1.4");
    expect(handlers.get(SETTINGS_IPC_CHANNELS.copyVersionInfo)?.(undefined)).toEqual({ ok: true });
    expect(writeText).toHaveBeenCalledWith("Moebius 0.1.4 · Apple Silicon Mac");
  });

  it("returns a stable clipboard failure without exposing the exception", () => {
    const handlers = new Map<string, (event: unknown) => unknown>();
    registerSettingsIpc({
      ipcMain: {
        handle(channel, listener) {
          handlers.set(channel, listener);
        },
      },
      getVersion: () => "0.1.4",
      checkForUpdates: async () => ({
        status: "latest",
        currentVersion: "0.1.4",
        latestVersion: "0.1.4",
      }),
      clipboard: {
        writeText() {
          throw new Error("secret clipboard detail");
        },
      },
    });

    expect(handlers.get(SETTINGS_IPC_CHANNELS.copyVersionInfo)?.(undefined)).toEqual({
      ok: false,
      reason: "clipboard-unavailable",
    });
  });
});
