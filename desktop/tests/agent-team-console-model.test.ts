import { describe, expect, it } from "vitest";

import {
  planAgentTeamBuilderDraftSource,
  planBuilderOperation,
  planBuilderRetry,
  planSelectedBuilderTeamId,
} from "../src/console-page/agent-team-console-model.js";

describe("agent team console model", () => {
  it("plans builder ownership without renderer or preload dependencies", () => {
    expect(planAgentTeamBuilderDraftSource("active", "stored")).toBe("current");
    expect(planAgentTeamBuilderDraftSource(null, "safe-id")).toBe("stored");
    expect(planAgentTeamBuilderDraftSource(null, "unsafe id")).toBe("create");
    expect(planBuilderOperation(false)).toBe("unavailable");
    expect(planBuilderRetry(false)).toBe("start");
    expect(planSelectedBuilderTeamId({
      builderCli: null,
      phase: "selected",
      messages: [],
      proposal: null,
      proposalRevision: null,
      error: null,
      actions: [],
      selectedTeamId: "launch-team",
    })).toBe("launch-team");
  });
});
