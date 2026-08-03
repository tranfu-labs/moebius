import { describe, expect, it, vi } from "vitest";
import {
  INITIAL_DESKTOP_SETTINGS_STATE,
  reduceDesktopSettings,
} from "../src/console-page/settings-state.js";
import { SingleInFlightSettingsRequest } from "../src/console-page/settings-request-controller.js";

describe("desktop settings state", () => {
  it("retains update results for the application session", () => {
    const checking = reduceDesktopSettings(INITIAL_DESKTOP_SETTINGS_STATE, {
      type: "update-started",
      requestId: 1,
    });
    const available = reduceDesktopSettings(checking, {
      type: "update-finished",
      requestId: 1,
      result: {
        status: "available",
        currentVersion: "0.1.4",
        latestVersion: "0.1.5",
      },
    });

    expect(available).toMatchObject({
      updateStatus: "available",
      latestVersion: "0.1.5",
      updateRequestId: null,
    });
  });

  it("ignores duplicate starts and stale asynchronous results", () => {
    const checking = reduceDesktopSettings(INITIAL_DESKTOP_SETTINGS_STATE, {
      type: "update-started",
      requestId: 4,
    });
    expect(reduceDesktopSettings(checking, {
      type: "update-started",
      requestId: 5,
    })).toBe(checking);
    expect(reduceDesktopSettings(checking, {
      type: "update-finished",
      requestId: 3,
      result: {
        status: "latest",
        currentVersion: "0.1.4",
        latestVersion: "0.1.4",
      },
    })).toBe(checking);
  });

  it("projects failures and clipboard outcomes into retryable states", () => {
    const checking = reduceDesktopSettings(INITIAL_DESKTOP_SETTINGS_STATE, {
      type: "update-started",
      requestId: 1,
    });
    const failed = reduceDesktopSettings(checking, {
      type: "update-finished",
      requestId: 1,
      result: { status: "failed", currentVersion: "0.1.4", reason: "timeout" },
    });
    const copying = reduceDesktopSettings(failed, { type: "copy-started", requestId: 2 });
    const copyFailed = reduceDesktopSettings(copying, {
      type: "copy-finished",
      requestId: 2,
      result: { ok: false, reason: "clipboard-unavailable" },
    });

    expect(copyFailed).toMatchObject({
      updateStatus: "failed",
      updateRequestId: null,
      copyStatus: "failed",
      copyRequestId: null,
    });
  });

  it("deduplicates slow requests and reopens the gate after settlement", async () => {
    let finishFirst: (() => void) | undefined;
    const first = new Promise<void>((resolve) => {
      finishFirst = resolve;
    });
    const gate = new SingleInFlightSettingsRequest();
    let starts = 0;

    expect(gate.start(async () => {
      starts += 1;
      await first;
    })).toBe(true);
    expect(gate.start(async () => {
      starts += 1;
    })).toBe(false);
    await Promise.resolve();
    expect(starts).toBe(1);
    expect(gate.isRunning).toBe(true);

    finishFirst?.();
    await first;
    await vi.waitFor(() => expect(gate.isRunning).toBe(false));
    expect(gate.start(async () => {
      starts += 1;
    })).toBe(true);
    await Promise.resolve();
    expect(starts).toBe(2);
  });

  it("allows retry after a rejected request", async () => {
    const gate = new SingleInFlightSettingsRequest();
    expect(gate.start(async () => {
      throw new Error("network unavailable");
    })).toBe(true);
    await vi.waitFor(() => expect(gate.isRunning).toBe(false));
    expect(gate.start(async () => undefined)).toBe(true);
  });
});
