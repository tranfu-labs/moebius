import { describe, expect, it } from "vitest";

import {
  parseTeamOnboardingOrchestrationJson,
  planLegacyOnboardingPreservation,
  readLegacyEmbeddedOnboardingOrchestration,
} from "../src/team-onboarding-orchestration-plan.js";

const memberOrder = ["manager", "developer"];
const relayBeats = [
  { speakerSlug: "manager", message: "拆解任务。" },
  { speakerSlug: "developer", message: "完成实现。" },
];

describe("team onboarding orchestration plan", () => {
  it("parses only complete relay beats owned by current members", () => {
    expect(parseTeamOnboardingOrchestrationJson(JSON.stringify({
      version: 1,
      relayBeats,
    }), memberOrder)).toEqual({ version: 1, relayBeats });

    expect(() => parseTeamOnboardingOrchestrationJson(JSON.stringify({
      version: 1,
      relayBeats: [{ speakerSlug: "reviewer", message: "越界发言。" }],
    }), memberOrder)).toThrow("relayBeats[0] is invalid");
  });

  it("distinguishes missing and invalid embedded relay data", () => {
    expect(readLegacyEmbeddedOnboardingOrchestration({ memberOrder }, memberOrder)).toEqual({
      status: "missing",
    });
    expect(readLegacyEmbeddedOnboardingOrchestration({
      memberOrder,
      relayBeats: [{ speakerSlug: "reviewer", message: "越界发言。" }],
    }, memberOrder)).toEqual({ status: "invalid" });
  });

  it("plans a legacy write only for a valid embedded orchestration", () => {
    expect(planLegacyOnboardingPreservation("{broken")).toEqual({ status: "skip" });
    expect(planLegacyOnboardingPreservation(JSON.stringify({ memberOrder }))).toEqual({ status: "skip" });
    expect(planLegacyOnboardingPreservation(JSON.stringify({ memberOrder, relayBeats }))).toEqual({
      status: "write",
      memberOrder,
      orchestration: { version: 1, relayBeats },
    });
  });
});
