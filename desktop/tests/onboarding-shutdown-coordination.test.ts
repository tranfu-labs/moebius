import { describe, expect, it } from "vitest";

import {
  installerCleanupBlockedDialogOptions,
} from "../src/onboarding/shutdown-coordination.js";

describe("onboarding installer shutdown coordination", () => {
  it("blocks exit with a safe retry-later message when process reaping is unconfirmed", () => {
    const options = installerCleanupBlockedDialogOptions();
    expect(options).toMatchObject({
      type: "error",
      buttons: ["留在应用"],
      defaultId: 0,
      cancelId: 0,
    });
    expect(`${options.title}${options.message}${options.detail}`).toContain("阻止退出");
    expect(JSON.stringify(options)).not.toMatch(/pid|stderr|token|\/Users\//i);
  });
});
