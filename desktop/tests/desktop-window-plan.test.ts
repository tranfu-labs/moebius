import { describe, expect, it } from "vitest";

import { planMainWindowClose } from "../src/desktop-window-plan.js";

describe("desktop main window close plan", () => {
  it("requests coordinated shutdown while an installer is active", () => {
    expect(planMainWindowClose({
      isQuitting: false,
      hasRunningInstallers: true,
    })).toBe("request-shutdown");
  });

  it("allows an ordinary close or an already coordinated quit", () => {
    expect(planMainWindowClose({
      isQuitting: false,
      hasRunningInstallers: false,
    })).toBe("allow");
    expect(planMainWindowClose({
      isQuitting: true,
      hasRunningInstallers: true,
    })).toBe("allow");
  });
});
