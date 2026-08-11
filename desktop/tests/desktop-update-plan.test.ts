import { describe, expect, it } from "vitest";

import type { DesktopUpdateState } from "../src/desktop-update-contract.js";
import {
  planDesktopUpdateReminder,
  planScheduledUpdateCheck,
  planUpdateInstallConfirmationDecision,
} from "../src/desktop-update-plan.js";

const baseState: DesktopUpdateState = {
  status: "ready",
  currentVersion: "0.4.3",
  latestVersion: "0.5.0",
};

describe("desktop update plans", () => {
  it("skips scheduled checks while a provider owns an update transition", () => {
    for (const status of ["available", "downloading", "ready", "installing"] as const) {
      expect(planScheduledUpdateCheck({ ...baseState, status })).toBe("skip");
    }
    expect(planScheduledUpdateCheck({ ...baseState, status: "latest" })).toBe("start");
    expect(planScheduledUpdateCheck({ ...baseState, status: "failed" })).toBe("start");
  });

  it("shows ready reminders only after task count is known and idle", () => {
    expect(planDesktopUpdateReminder({ state: baseState, runningTaskCount: null })).toBe("wait-for-idle");
    expect(planDesktopUpdateReminder({ state: baseState, runningTaskCount: 2 })).toBe("wait-for-idle");
    expect(planDesktopUpdateReminder({ state: baseState, runningTaskCount: 0 })).toBe("show");
    expect(planDesktopUpdateReminder({
      state: { ...baseState, skippedVersion: "0.5.0" },
      runningTaskCount: 0,
    })).toBe("suppressed");
    expect(planDesktopUpdateReminder({
      state: { ...baseState, remindLaterVersion: "0.5.0" },
      runningTaskCount: 0,
    })).toBe("suppressed");
    expect(planDesktopUpdateReminder({ state: { ...baseState, status: "latest" }, runningTaskCount: 0 })).toBe("hidden");
  });

  it.each(["cancel", "continue-working"] as const)(
    "suppresses the ready reminder after install confirmation %s across task changes",
    (decision) => {
      const confirmation = planUpdateInstallConfirmationDecision({ decision, version: "0.5.0" });
      expect(confirmation).toEqual({ approved: false, remindLaterVersion: "0.5.0" });

      const suppressedState = { ...baseState, remindLaterVersion: confirmation.remindLaterVersion };
      expect(planDesktopUpdateReminder({ state: suppressedState, runningTaskCount: 0 })).toBe("suppressed");
      expect(planDesktopUpdateReminder({ state: suppressedState, runningTaskCount: 1 })).toBe("suppressed");
      expect(planDesktopUpdateReminder({ state: suppressedState, runningTaskCount: 0 })).toBe("suppressed");
    },
  );

  it("keeps an explicit install decision independent from reminder dismissal", () => {
    expect(planUpdateInstallConfirmationDecision({ decision: "install", version: "0.5.0" })).toEqual({
      approved: true,
      remindLaterVersion: undefined,
    });
  });
});
