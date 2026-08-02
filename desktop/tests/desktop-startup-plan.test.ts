import { describe, expect, it } from "vitest";

import {
  planDesktopDockIcon,
  planDesktopSeedStatus,
} from "../src/desktop-startup-plan.js";

describe("desktop startup plan", () => {
  it("sets the development dock icon only on unpackaged macOS", () => {
    expect(planDesktopDockIcon({ platform: "darwin", isPackaged: false })).toBe("set");
    expect(planDesktopDockIcon({ platform: "darwin", isPackaged: true })).toBe("skip");
    expect(planDesktopDockIcon({ platform: "linux", isPackaged: false })).toBe("skip");
  });

  it("combines file and team seed outcomes", () => {
    expect(planDesktopSeedStatus({
      copiedFiles: 3,
      skippedFiles: 2,
      teamSeedStatus: "seeded",
    })).toEqual({ status: "ok", copied: 4, skipped: 2 });
    expect(planDesktopSeedStatus({
      copiedFiles: 3,
      skippedFiles: 2,
      teamSeedStatus: "skipped",
    })).toEqual({ status: "ok", copied: 3, skipped: 3 });
    expect(planDesktopSeedStatus({
      copiedFiles: 3,
      skippedFiles: 2,
      teamSeedStatus: "conflict",
    })).toEqual({ status: "ok", copied: 3, skipped: 2 });
  });
});
