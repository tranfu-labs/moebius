import type { App } from "electron";
import { describe, expect, it, vi } from "vitest";

import { registerDesktopLifecycle } from "../src/desktop-lifecycle-register.js";

function createAppPort(hasLock: boolean) {
  const listeners = new Map<string, (...args: any[]) => void>();
  const quit = vi.fn();
  const app = {
    requestSingleInstanceLock: () => hasLock,
    quit,
    on: (event: string, listener: (...args: any[]) => void) => {
      listeners.set(event, listener);
      return app;
    },
    whenReady: () => Promise.resolve(),
  } as unknown as App;
  return { app, listeners, quit };
}

describe("desktop lifecycle registration", () => {
  it("fails closed when another desktop instance owns the lock", () => {
    const { app, quit } = createAppPort(false);
    registerDesktopLifecycle({
      app,
      focusMainWindow: vi.fn(),
      boot: vi.fn(async () => undefined),
      beforeQuit: vi.fn(),
      lastWindowClosed: vi.fn(),
    });
    expect(quit).toHaveBeenCalledOnce();
  });

  it("boots the owner and forwards lifecycle events", async () => {
    const { app, listeners } = createAppPort(true);
    const focusMainWindow = vi.fn();
    const boot = vi.fn(async () => undefined);
    const beforeQuit = vi.fn();
    const lastWindowClosed = vi.fn();
    registerDesktopLifecycle({ app, focusMainWindow, boot, beforeQuit, lastWindowClosed });

    await Promise.resolve();
    expect(boot).toHaveBeenCalledOnce();
    listeners.get("second-instance")?.();
    expect(focusMainWindow).toHaveBeenCalledOnce();
    const preventDefault = vi.fn();
    listeners.get("before-quit")?.({ preventDefault });
    expect(beforeQuit).toHaveBeenCalledWith(expect.any(Function));
    listeners.get("window-all-closed")?.();
    expect(lastWindowClosed).toHaveBeenCalledOnce();
  });
});
