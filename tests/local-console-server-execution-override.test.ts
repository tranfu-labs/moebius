import { describe, expect, it } from "vitest";

import { readExecutionOverride } from "../src/local-console/server.js";

describe("local console single-run execution override", () => {
  it("accepts a complete Pi identity and preserves the Provider profile reference", () => {
    expect(readExecutionOverride({
      executionOverride: {
        overrideId: "override-1",
        scope: "single-run",
        profile: {
          cli: "pi",
          providerId: "deepseek",
          providerProfileId: "deepseek-work",
          model: "deepseek-v4-pro",
          effort: "high",
        },
      },
    })).toEqual({
      overrideId: "override-1",
      scope: "single-run",
      profile: {
        cli: "pi",
        providerId: "deepseek",
        providerProfileId: "deepseek-work",
        model: "deepseek-v4-pro",
        effort: "high",
      },
    });
  });

  it("rejects Pi overrides that omit or change the fixed Provider identity", () => {
    expect(() => readExecutionOverride({
      executionOverride: {
        overrideId: "override-1",
        scope: "single-run",
        profile: { cli: "pi", providerId: "custom", model: "deepseek-v4-pro", effort: "high" },
      },
    })).toThrow(/providerId/u);
  });
});
