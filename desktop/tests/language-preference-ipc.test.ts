import { describe, expect, it, vi } from "vitest";

import {
  createLanguagePreferenceIpcHandlers,
  type LanguagePreferenceBroadcastTarget,
} from "../src/language-preference-ipc.js";
import {
  LANGUAGE_PREFERENCE_IPC_CHANNELS,
  type DesktopLocale,
} from "../src/language-preference-contract.js";

function broadcastTarget(destroyed = false): {
  target: LanguagePreferenceBroadcastTarget;
  send: ReturnType<typeof vi.fn>;
} {
  const send = vi.fn();
  return {
    target: {
      isDestroyed: () => destroyed,
      send,
    },
    send,
  };
}

describe("language preference IPC handlers", () => {
  it("rejects unsupported locales before persistence or broadcast", async () => {
    let activeLocale: DesktopLocale = "zh-CN";
    const persist = vi.fn();
    const first = broadcastTarget();
    const handlers = createLanguagePreferenceIpcHandlers({
      getActiveLocale: () => activeLocale,
      setActiveLocale: (locale) => {
        activeLocale = locale;
      },
      persist,
      getBroadcastTargets: () => [first.target],
    });

    await expect(handlers.save("fr")).rejects.toThrow("unsupported desktop locale");
    expect(activeLocale).toBe("zh-CN");
    expect(persist).not.toHaveBeenCalled();
    expect(first.send).not.toHaveBeenCalled();
  });

  it("keeps the active locale and does not broadcast when persistence fails", async () => {
    let activeLocale: DesktopLocale = "zh-CN";
    const persistenceError = new Error("disk is read-only");
    const first = broadcastTarget();
    const handlers = createLanguagePreferenceIpcHandlers({
      getActiveLocale: () => activeLocale,
      setActiveLocale: (locale) => {
        activeLocale = locale;
      },
      persist: vi.fn().mockRejectedValue(persistenceError),
      getBroadcastTargets: () => [first.target],
    });

    await expect(handlers.save("en")).rejects.toBe(persistenceError);
    expect(activeLocale).toBe("zh-CN");
    expect(first.send).not.toHaveBeenCalled();
  });

  it("broadcasts a successfully persisted locale to every live window", async () => {
    let activeLocale: DesktopLocale = "zh-CN";
    const first = broadcastTarget();
    const second = broadcastTarget();
    const destroyed = broadcastTarget(true);
    const persist = vi.fn().mockResolvedValue(undefined);
    const handlers = createLanguagePreferenceIpcHandlers({
      getActiveLocale: () => activeLocale,
      setActiveLocale: (locale) => {
        activeLocale = locale;
      },
      persist,
      getBroadcastTargets: () => [first.target, second.target, destroyed.target],
    });

    await expect(handlers.save("en")).resolves.toBe("en");
    expect(persist).toHaveBeenCalledWith("en");
    expect(activeLocale).toBe("en");
    expect(first.send).toHaveBeenCalledWith(LANGUAGE_PREFERENCE_IPC_CHANNELS.changed, "en");
    expect(second.send).toHaveBeenCalledWith(LANGUAGE_PREFERENCE_IPC_CHANNELS.changed, "en");
    expect(destroyed.send).not.toHaveBeenCalled();
  });
});
