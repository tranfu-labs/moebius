import { describe, expect, it } from "vitest";

import {
  createOnboardingCliInstallState,
  planOnboardingCliInstallSnapshot,
} from "../src/onboarding/cli-installer-state.js";

describe("onboarding CLI installer state", () => {
  it("initializes each CLI independently and advances only the requested snapshot revision", () => {
    const state = createOnboardingCliInstallState({
      codex: "install codex",
      claude: "install claude",
      kimi: "install kimi",
    }, "2026-08-02T00:00:00.000Z");

    const runningCodex = planOnboardingCliInstallSnapshot(state.codex, {
      status: "running",
      stage: "installing",
      displayCommand: state.codex.displayCommand,
      startedAt: "2026-08-02T00:00:01.000Z",
      updatedAt: "2026-08-02T00:00:02.000Z",
    });

    expect(runningCodex).toMatchObject({
      cli: "codex",
      status: "running",
      stage: "installing",
      revision: 1,
      displayCommand: "install codex",
      startedAt: "2026-08-02T00:00:01.000Z",
    });
    expect(state.claude).toMatchObject({
      cli: "claude",
      status: "idle",
      revision: 0,
      displayCommand: "install claude",
    });
  });
});
