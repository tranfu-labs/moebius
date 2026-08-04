import { describe, expect, it, vi } from "vitest";

import {
  RIGHT_SIDEBAR_VISIBILITY_STORAGE_KEY,
  RIGHT_SIDEBAR_WIDTH_STORAGE_KEY,
  readRightSidebarVisibilityPreference,
  readRightSidebarWidthPreference,
  writeRightSidebarVisibilityPreference,
  writeRightSidebarWidthPreference,
} from "../src/console-page/right-sidebar-preference.js";

describe("right sidebar preferences", () => {
  it("defaults closed and restores only an explicit open choice", () => {
    expect(readRightSidebarVisibilityPreference({ getItem: () => null })).toBe("closed");
    expect(readRightSidebarVisibilityPreference({ getItem: () => "closed" })).toBe("closed");
    expect(readRightSidebarVisibilityPreference({ getItem: () => "unexpected" })).toBe("closed");
    expect(readRightSidebarVisibilityPreference({ getItem: () => "open" })).toBe("open");
  });

  it("distinguishes a missing preference and preserves legacy raw widths", () => {
    expect(readRightSidebarWidthPreference({ getItem: () => null })).toBeNull();
    expect(readRightSidebarWidthPreference({ getItem: () => "512" })).toBe(512);
    expect(readRightSidebarWidthPreference({ getItem: () => "420" })).toBe(420);
    expect(readRightSidebarWidthPreference({ getItem: () => "9999" })).toBe(9999);
    expect(readRightSidebarWidthPreference({ getItem: () => "-1" })).toBeNull();
    expect(readRightSidebarWidthPreference({ getItem: () => "not-a-number" })).toBeNull();
  });

  it("persists both preferences without allowing storage failures to break controls", () => {
    const setItem = vi.fn();
    writeRightSidebarVisibilityPreference({ setItem }, "open");
    writeRightSidebarWidthPreference({ setItem }, 512);
    expect(setItem).toHaveBeenCalledWith(RIGHT_SIDEBAR_VISIBILITY_STORAGE_KEY, "open");
    expect(setItem).toHaveBeenCalledWith(RIGHT_SIDEBAR_WIDTH_STORAGE_KEY, "512");

    expect(() => readRightSidebarVisibilityPreference({
      getItem: () => { throw new Error("blocked"); },
    })).not.toThrow();
    expect(() => writeRightSidebarWidthPreference({
      setItem: () => { throw new Error("full"); },
    }, 400)).not.toThrow();
  });
});
