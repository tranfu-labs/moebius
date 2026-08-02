import { describe, expect, it } from "vitest";

import { planCodexRolloutPromptProjection } from "../src/local-console/codex-rollout-invocation-plan.js";

describe("Codex rollout invocation plan", () => {
  it("projects only trusted developer and user message roles", () => {
    expect(planCodexRolloutPromptProjection("developer", "developer prompt")).toEqual({
      developer: "developer prompt",
      user: null,
    });
    expect(planCodexRolloutPromptProjection("user", "user prompt")).toEqual({
      developer: null,
      user: "user prompt",
    });
    expect(planCodexRolloutPromptProjection("assistant", "ignored")).toEqual({
      developer: null,
      user: null,
    });
  });
});
