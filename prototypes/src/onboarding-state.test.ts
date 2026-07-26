import { describe, expect, it } from "vitest";

import {
  DEVELOPMENT_TEAM,
  canContinue,
  chooseBuilderCli,
  initialOnboardingState,
  isCliReady,
  onboardingReducer,
  runningInstallations
} from "./onboarding-state.js";

describe("onboarding state", () => {
  it("lets either ready CLI pass the first-step hard gate", () => {
    const codexReady = initialOnboardingState("codex-ready");
    const kimiReady = initialOnboardingState("kimi-ready");
    const bothReady = initialOnboardingState("both-ready");
    const neitherReady = initialOnboardingState("both-missing");

    expect(canContinue(codexReady)).toBe(true);
    expect(canContinue(kimiReady)).toBe(true);
    expect(canContinue(bothReady)).toBe(true);
    expect(canContinue(neitherReady)).toBe(false);
    expect(onboardingReducer(neitherReady, { type: "continue" })).toBe(neitherReady);
  });

  it("preserves an existing ready result while a manual recheck runs", () => {
    let state = initialOnboardingState("codex-ready");
    state = onboardingReducer(state, { type: "start-recheck" });

    expect(state.environment.codex.status).toBe("checking");
    expect(isCliReady(state.environment.codex)).toBe(true);
    expect(canContinue(state)).toBe(true);

    state = onboardingReducer(state, {
      type: "set-cli",
      cli: "codex",
      value: { status: "unavailable" }
    });
    state = onboardingReducer(state, {
      type: "set-cli",
      cli: "kimi",
      value: { status: "ready" }
    });
    expect(canContinue(state)).toBe(true);
  });

  it("tracks independent single and dual installations with cancellation", () => {
    let state = initialOnboardingState("both-missing");
    state = onboardingReducer(state, { type: "start-install", cli: "codex" });
    expect(runningInstallations(state.environment)).toEqual(["codex"]);

    state = onboardingReducer(state, { type: "start-install", cli: "kimi" });
    expect(runningInstallations(state.environment)).toEqual(["codex", "kimi"]);

    state = onboardingReducer(state, { type: "cancel-install", cli: "codex" });
    expect(runningInstallations(state.environment)).toEqual(["kimi"]);
    expect(state.environment.codex.status).toBe("cancelled");
  });

  it("supports deterministic failure, retry, auto-check, and readiness", () => {
    let state = initialOnboardingState("install-recovery");
    expect(state.environment.kimi.status).toBe("failed");

    state = onboardingReducer(state, { type: "start-install", cli: "kimi" });
    expect(state.environment.kimi.status).toBe("installing");
    expect(state.environment.kimi.attempt).toBe(1);

    state = onboardingReducer(state, {
      type: "set-cli",
      cli: "kimi",
      value: { status: "checking" }
    });
    state = onboardingReducer(state, {
      type: "set-cli",
      cli: "kimi",
      value: { status: "ready" }
    });

    expect(state.environment.kimi.status).toBe("ready");
    expect(canContinue(state)).toBe(true);
  });

  it("chooses Kimi only when Codex is unavailable and otherwise prefers Codex", () => {
    expect(chooseBuilderCli(initialOnboardingState("kimi-ready").environment)).toBe("kimi");
    expect(chooseBuilderCli(initialOnboardingState("both-ready").environment)).toBe("codex");
    expect(chooseBuilderCli(initialOnboardingState("codex-ready").environment)).toBe("codex");
  });

  it("walks the happy path into a conversation with the selected team", () => {
    let state = initialOnboardingState();

    for (let index = 0; index < 4; index += 1) {
      state = onboardingReducer(state, { type: "continue" });
    }

    expect(state.view).toBe("conversation");
    expect(state.selectedTeam).toEqual(DEVELOPMENT_TEAM);
  });

  it("starts and replays the relay without changing the current step", () => {
    let state = initialOnboardingState();
    state = onboardingReducer(state, { type: "continue" });
    state = onboardingReducer(state, { type: "continue" });

    expect(state.view).toBe(3);
    expect(state.relayRun).toBe(1);

    state = onboardingReducer(state, { type: "replay-relay" });

    expect(state.view).toBe(3);
    expect(state.relayRun).toBe(2);
  });

  it("carries an AI-created team and its chosen CLI through completion", () => {
    const createdTeam = {
      id: "product-launch",
      name: "产品发布团队",
      primaryAgent: "发布负责人",
      members: ["内容策划", "渠道运营"],
      builderCli: "kimi" as const
    };
    let state = initialOnboardingState("kimi-ready");

    state = onboardingReducer(state, { type: "continue" });
    state = onboardingReducer(state, { type: "select-team", team: createdTeam });
    state = onboardingReducer(state, { type: "continue" });
    state = onboardingReducer(state, { type: "back" });

    expect(state.view).toBe(2);
    expect(state.selectedTeam).toEqual(createdTeam);

    for (let index = 0; index < 3; index += 1) {
      state = onboardingReducer(state, { type: "continue" });
    }

    expect(state.view).toBe("conversation");
    expect(state.selectedTeam.builderCli).toBe("kimi");
  });

  it("returns replay exit to the same main fixture and discards its team selection", () => {
    const temporaryTeam = {
      id: "temporary",
      name: "临时团队",
      primaryAgent: "临时负责人",
      members: ["临时成员"]
    };
    let state = initialOnboardingState("codex-ready", "replay");

    expect(state.view).toBe("main");
    state = onboardingReducer(state, { type: "enter-replay" });
    state = onboardingReducer(state, { type: "continue" });
    state = onboardingReducer(state, { type: "select-team", team: temporaryTeam });
    state = onboardingReducer(state, { type: "exit-replay" });

    expect(state.view).toBe("main");
    expect(state.selectedTeam).toEqual(DEVELOPMENT_TEAM);
  });
});
