import { describe, expect, it, vi } from "vitest";

import { finishOnboardingPresentation } from "../src/onboarding/onboarding-completion.js";

describe("finishOnboardingPresentation", () => {
  it("keeps replay completion separate from first-run persistence and team handoff", async () => {
    const onFirstRunComplete = vi.fn();
    const onReplayComplete = vi.fn();

    await finishOnboardingPresentation({
      mode: "replay",
      onReplayComplete,
    });

    expect(onReplayComplete).toHaveBeenCalledOnce();
    expect(onFirstRunComplete).not.toHaveBeenCalled();
  });

  it("passes the selected team only through first-run completion", async () => {
    const onFirstRunComplete = vi.fn();

    await finishOnboardingPresentation({
      mode: "first-run",
      teamKey: "system:development",
      onFirstRunComplete,
    });

    expect(onFirstRunComplete).toHaveBeenCalledWith("system:development");
  });
});
