import { describe, expect, it } from "vitest";

import {
  projectRightSidebarLayout,
  rightSidebarKeyboardWidth,
} from "./right-sidebar-layout";

describe("right sidebar layout", () => {
  it.each([
    { available: 1_200, layout: "split", width: 600, min: 480, max: 720 },
    { available: 960, layout: "split", width: 480, min: 480, max: 480 },
    { available: 959, layout: "overlay", width: 959, min: 959, max: 959 },
  ] as const)("projects the $available content-width boundary", (fixture) => {
    expect(projectRightSidebarLayout(fixture.available, null)).toEqual({
      layout: fixture.layout,
      width: fixture.width,
      minWidth: fixture.min,
      maxWidth: fixture.max,
    });
  });

  it("temporarily clamps a preference without changing the value used after expansion", () => {
    expect(projectRightSidebarLayout(1_000, 700).width).toBe(520);
    expect(projectRightSidebarLayout(1_200, 700).width).toBe(700);
  });

  it("applies keyboard steps and dynamic boundaries", () => {
    expect(rightSidebarKeyboardWidth(600, "ArrowLeft", false, 1_200)).toBe(616);
    expect(rightSidebarKeyboardWidth(600, "ArrowRight", true, 1_200)).toBe(536);
    expect(rightSidebarKeyboardWidth(600, "Home", false, 1_200)).toBe(480);
    expect(rightSidebarKeyboardWidth(600, "End", false, 1_200)).toBe(720);
    expect(rightSidebarKeyboardWidth(720, "ArrowLeft", false, 1_200)).toBe(720);
  });
});
