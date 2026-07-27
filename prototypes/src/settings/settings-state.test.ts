import { describe, expect, it } from "vitest";
import {
  createSettingsState,
  reduceSettingsState
} from "./settings-state.js";

describe("settings language state", () => {
  it("defaults to Simplified Chinese without a saved choice", () => {
    expect(createSettingsState()).toEqual({
      activeLocale: "zh-CN",
      pendingLocale: null,
      saveState: "idle"
    });
  });

  it("keeps the active language until persistence succeeds", () => {
    const saving = reduceSettingsState(createSettingsState(), {
      type: "select",
      locale: "en"
    });
    expect(saving).toMatchObject({
      activeLocale: "zh-CN",
      pendingLocale: "en",
      saveState: "saving"
    });

    const saved = reduceSettingsState(saving, {
      type: "saveSucceeded",
      locale: "en"
    });
    expect(saved).toEqual({
      activeLocale: "en",
      pendingLocale: null,
      saveState: "idle"
    });
  });

  it("retains the active language after failure and can retry", () => {
    const saving = reduceSettingsState(createSettingsState(), {
      type: "select",
      locale: "en"
    });
    const failed = reduceSettingsState(saving, {
      type: "saveFailed",
      locale: "en"
    });
    expect(failed).toMatchObject({
      activeLocale: "zh-CN",
      pendingLocale: "en",
      saveState: "failed"
    });
    expect(reduceSettingsState(failed, { type: "retry" }).saveState).toBe(
      "saving"
    );
  });

  it("ignores the current language, duplicate submits, and stale saves", () => {
    const initial = createSettingsState("en");
    expect(
      reduceSettingsState(initial, { type: "select", locale: "en" })
    ).toBe(initial);

    const saving = reduceSettingsState(initial, {
      type: "select",
      locale: "zh-CN"
    });
    expect(
      reduceSettingsState(saving, { type: "select", locale: "en" })
    ).toBe(saving);
    expect(
      reduceSettingsState(saving, {
        type: "saveSucceeded",
        locale: "en"
      })
    ).toBe(saving);
  });
});
