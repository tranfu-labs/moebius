import { describe, expect, it } from "vitest";

import {
  createLanguageState,
  planInitialDesktopLocale,
  planLanguagePersistence,
  planLanguageRetry,
  reduceLanguageState,
} from "../src/console-page/language-state.js";

describe("desktop language state", () => {
  it("does not commit a selected locale until persistence succeeds", () => {
    const saving = reduceLanguageState(
      createLanguageState("zh-CN"),
      { type: "select", locale: "en", requestId: 1 },
    );
    expect(saving).toMatchObject({
      activeLocale: "zh-CN",
      pendingLocale: "en",
      status: "saving",
    });

    const saved = reduceLanguageState(saving, { type: "saved", locale: "en", requestId: 1 });
    expect(saved).toMatchObject({
      activeLocale: "en",
      pendingLocale: null,
      status: "idle",
    });
  });

  it("keeps the active locale and retry target after failure", () => {
    const saving = reduceLanguageState(
      createLanguageState("zh-CN"),
      { type: "select", locale: "en", requestId: 1 },
    );
    expect(reduceLanguageState(saving, { type: "failed", requestId: 1 })).toMatchObject({
      activeLocale: "zh-CN",
      pendingLocale: "en",
      status: "failed",
    });
  });

  it("ignores stale save responses and accepts cross-window broadcasts", () => {
    const second = reduceLanguageState(
      createLanguageState("zh-CN"),
      { type: "select", locale: "en", requestId: 2 },
    );
    expect(reduceLanguageState(second, { type: "failed", requestId: 1 })).toBe(second);
    expect(reduceLanguageState(second, { type: "external", locale: "en" })).toMatchObject({
      activeLocale: "en",
      status: "idle",
    });
  });

  it("plans the initial, persistence, and retry boundaries without renderer IO", () => {
    expect(planInitialDesktopLocale("?locale=en")).toBe("en");
    expect(planInitialDesktopLocale("?locale=fr")).toBe("zh-CN");
    expect(planLanguagePersistence(false)).toBe("commit-local");
    expect(planLanguagePersistence(true)).toBe("persist");
    expect(planLanguageRetry({
      ...createLanguageState("zh-CN"),
      pendingLocale: "en",
      status: "failed",
    })).toBe("en");
  });
});
