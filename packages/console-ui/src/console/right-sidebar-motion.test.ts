import { describe, expect, it } from "vitest";

import {
  RIGHT_SIDEBAR_TOGGLE_DURATION_MS,
  rightSidebarToggleComplete,
  rightSidebarToggleProgressAt,
  startRightSidebarToggleMotion,
} from "./right-sidebar-motion";

describe("right sidebar toggle motion", () => {
  it("uses 150ms for a complete path", () => {
    expect(startRightSidebarToggleMotion(0, 1, 100)).toEqual({
      from: 0,
      to: 1,
      startedAt: 100,
      duration: RIGHT_SIDEBAR_TOGGLE_DURATION_MS,
    });
  });

  it("reverses from the current progress with proportional remaining time", () => {
    const closing = startRightSidebarToggleMotion(1, 0, 0)!;
    const current = rightSidebarToggleProgressAt(closing, 60);
    const reopening = startRightSidebarToggleMotion(current, 1, 60)!;

    expect(current).toBeGreaterThan(0);
    expect(current).toBeLessThan(1);
    expect(reopening.from).toBe(current);
    expect(reopening.duration).toBeCloseTo((1 - current) * 150, 5);
    expect(rightSidebarToggleComplete(reopening, 60 + reopening.duration)).toBe(true);
  });
});
