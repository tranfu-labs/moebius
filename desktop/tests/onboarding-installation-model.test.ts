import { describe, expect, it } from "vitest";

import type { OnboardingCliInstallSnapshot } from "../src/onboarding/cli-installer-contract.js";
import {
  createOnboardingInstallationModel,
  decideOnboardingInstallationSnapshot,
} from "../src/onboarding/onboarding-installation-model.js";

describe("onboarding installation model", () => {
  it("keeps a newer running snapshot when an older initial load resolves", () => {
    const running = decideOnboardingInstallationSnapshot(
      createOnboardingInstallationModel(),
      snapshot("codex", "running", 3),
    );
    const stale = decideOnboardingInstallationSnapshot(
      running.model,
      snapshot("codex", "idle", 1),
    );

    expect(running.accepted).toBe(true);
    expect(stale).toEqual({ accepted: false, becameSucceeded: false, model: running.model });
  });

  it("reports only an accepted running to succeeded transition", () => {
    const running = decideOnboardingInstallationSnapshot(
      createOnboardingInstallationModel(),
      snapshot("kimi", "running", 4),
    );
    const succeeded = decideOnboardingInstallationSnapshot(
      running.model,
      snapshot("kimi", "succeeded", 5),
    );
    const duplicate = decideOnboardingInstallationSnapshot(
      succeeded.model,
      snapshot("kimi", "succeeded", 5),
    );

    expect(succeeded.becameSucceeded).toBe(true);
    expect(duplicate.accepted).toBe(false);
  });
});

function snapshot(
  cli: OnboardingCliInstallSnapshot["cli"],
  status: OnboardingCliInstallSnapshot["status"],
  revision: number,
): OnboardingCliInstallSnapshot {
  return {
    cli,
    status,
    revision,
    stage: null,
    displayCommand: "trusted installer",
    startedAt: null,
    updatedAt: "2026-08-02T00:00:00.000Z",
  };
}
