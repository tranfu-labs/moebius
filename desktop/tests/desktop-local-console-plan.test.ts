import { describe, expect, it } from "vitest";

import { planLocalConsoleServerAccess } from "../src/desktop-local-console-plan.js";

describe("desktop local console plan", () => {
  it("distinguishes an available server from an unstarted server", () => {
    expect(planLocalConsoleServerAccess(true)).toBe("available");
    expect(planLocalConsoleServerAccess(false)).toBe("unavailable");
  });
});
