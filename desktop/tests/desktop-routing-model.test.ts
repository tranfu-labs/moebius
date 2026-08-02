import { describe, expect, it } from "vitest";

import {
  planDesktopRoute,
  planOnboardingCompletion,
  planOnboardingStatusRead,
  planPendingAgentTeamKey,
  planReplayPresentation,
  planReplayReturnFocus,
} from "../src/console-page/desktop-routing-model.js";

describe("desktop routing model", () => {
  it("maps onboarding persistence facts to one route outcome", () => {
    expect(planDesktopRoute(null)).toBe("loading");
    expect(planDesktopRoute(false)).toBe("onboarding");
    expect(planDesktopRoute(true)).toBe("console");
    expect(planOnboardingStatusRead(false)).toBe("assume-complete");
    expect(planOnboardingStatusRead(true)).toBe("read");
    expect(planOnboardingCompletion(undefined)).toBe("reject");
    expect(planOnboardingCompletion(true)).toBe("continue");
  });

  it("accepts only a non-empty pending team key from navigation state", () => {
    expect(planPendingAgentTeamKey({ pendingAgentTeamKey: "system:development" }))
      .toBe("system:development");
    expect(planPendingAgentTeamKey({ pendingAgentTeamKey: " " })).toBeNull();
    expect(planPendingAgentTeamKey([])).toBeNull();
  });

  it("keeps replay visibility and focus ownership explicit", () => {
    const focusTarget = { focus: () => undefined };
    expect(planReplayPresentation(false)).toBe("show-console");
    expect(planReplayPresentation(true)).toBe("show-onboarding");
    expect(planReplayReturnFocus(true, focusTarget)).toBe(focusTarget);
    expect(planReplayReturnFocus(false, focusTarget)).toBeNull();
  });
});
