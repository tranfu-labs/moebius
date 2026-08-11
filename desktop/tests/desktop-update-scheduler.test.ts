import { describe, expect, it, vi } from "vitest";

import {
  DesktopUpdateScheduler,
} from "../src/desktop-update-scheduler.js";
import {
  planUpdateSchedulerStart,
} from "../src/desktop-update-plan.js";

describe("desktop update scheduler", () => {
  it("registers one interval and one wake listener, then releases both", async () => {
    const check = vi.fn(async () => undefined);
    const resumeListeners = new Set<() => void>();
    const powerMonitor = {
      on: vi.fn((_event: "resume", listener: () => void) => {
        resumeListeners.add(listener);
        return powerMonitor;
      }),
      off: vi.fn((_event: "resume", listener: () => void) => {
        resumeListeners.delete(listener);
        return powerMonitor;
      }),
    };
    let intervalCallback: (() => void) | undefined;
    const clearInterval = vi.fn();
    const scheduler = new DesktopUpdateScheduler({
      check,
      powerMonitor,
      intervalMs: 123,
      setInterval: vi.fn((callback) => {
        intervalCallback = callback;
        return { unref: vi.fn() } as unknown as ReturnType<typeof setInterval>;
      }) as unknown as typeof setInterval,
      clearInterval,
    });

    expect(planUpdateSchedulerStart(false)).toBe("start");
    expect(planUpdateSchedulerStart(true)).toBe("skip");
    scheduler.start();
    scheduler.start();

    expect(powerMonitor.on).toHaveBeenCalledOnce();
    expect(resumeListeners.size).toBe(1);
    intervalCallback?.();
    [...resumeListeners][0]?.();
    await Promise.resolve();
    expect(check).toHaveBeenCalledTimes(2);

    scheduler.stop();
    scheduler.stop();
    expect(clearInterval).toHaveBeenCalledOnce();
    expect(powerMonitor.off).toHaveBeenCalledOnce();
    expect(resumeListeners.size).toBe(0);
    expect(scheduler.started).toBe(false);
  });
});
