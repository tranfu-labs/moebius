import { describe, expect, it } from "vitest";

import type { OnboardingCliReadinessSnapshot } from "../src/onboarding/cli-readiness-contract.js";
import {
  createOnboardingReadinessModel,
  decideOnboardingReadinessCheckCurrent,
  decideOnboardingReadinessSnapshot,
  planOnboardingReadinessCheck,
} from "../src/onboarding/onboarding-readiness-model.js";

describe("onboarding readiness controller", () => {
  it("rejects an older initial readiness result after a newer PATH recheck", () => {
    const initial = createOnboardingReadinessModel();
    const first = planOnboardingReadinessCheck(initial, "codex");
    const recheck = planOnboardingReadinessCheck(first.model, "codex");

    expect(decideOnboardingReadinessCheckCurrent(recheck.model, "codex", first.sequence)).toBe(false);
    expect(decideOnboardingReadinessCheckCurrent(recheck.model, "codex", recheck.sequence)).toBe(true);
  });

  it("merges newer per-CLI results without accepting an older full snapshot", () => {
    let model = createOnboardingReadinessModel();
    for (const snapshot of [
      readinessSnapshot("codex", "missing", 3),
      readinessSnapshot("claude", "missing", 3),
      readinessSnapshot("kimi", "ready", 3),
    ]) {
      const decision = decideOnboardingReadinessSnapshot(model, snapshot);
      expect(decision.accepted).toBe(true);
      model = decision.model;
    }

    const acceptedBeforeStaleSnapshot = model.accepted;
    for (const snapshot of [
      readinessSnapshot("codex", "ready", 1),
      readinessSnapshot("claude", "missing", 1),
      readinessSnapshot("kimi", "missing", 1),
    ]) {
      const decision = decideOnboardingReadinessSnapshot(model, snapshot);
      expect(decision.accepted).toBe(false);
      expect(decision.model).toBe(model);
    }
    expect(model.accepted).toEqual(acceptedBeforeStaleSnapshot);
  });
});

function readinessSnapshot(
  cli: OnboardingCliReadinessSnapshot["cli"],
  status: OnboardingCliReadinessSnapshot["status"],
  revision: number,
): OnboardingCliReadinessSnapshot {
  return {
    cli,
    status,
    revision,
    code: status === "ready" ? "ready" : "cli-missing",
    version: status === "ready" ? `${cli} latest` : null,
    checkedAt: "2026-08-02T00:00:00.000Z",
  };
}
