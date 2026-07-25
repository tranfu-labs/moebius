import { describe, expect, it } from "vitest";

import {
  DEVELOPMENT_TEAM,
  canContinue,
  initialOnboardingState,
  onboardingReducer
} from "./onboarding-state.js";

describe("onboarding state", () => {
  it("blocks the first step while Codex is missing, unavailable, or checking", () => {
    const missing = initialOnboardingState("missing");
    const unavailable = initialOnboardingState("unavailable");
    const checking = initialOnboardingState("checking");

    expect(canContinue(missing)).toBe(false);
    expect(canContinue(unavailable)).toBe(false);
    expect(canContinue(checking)).toBe(false);
    expect(onboardingReducer(missing, { type: "continue" })).toBe(missing);
    expect(onboardingReducer(unavailable, { type: "continue" })).toBe(unavailable);
    expect(onboardingReducer(checking, { type: "continue" })).toBe(checking);
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

  it("carries an AI-created team through back navigation and completion", () => {
    const createdTeam = {
      id: "product-launch",
      name: "产品发布团队",
      primaryAgent: "发布负责人",
      members: ["内容策划", "渠道运营"]
    };
    let state = initialOnboardingState();

    state = onboardingReducer(state, { type: "continue" });
    state = onboardingReducer(state, {
      type: "select-team",
      team: createdTeam
    });
    state = onboardingReducer(state, { type: "continue" });
    state = onboardingReducer(state, { type: "back" });

    expect(state.view).toBe(2);
    expect(state.selectedTeam).toEqual(createdTeam);

    for (let index = 0; index < 3; index += 1) {
      state = onboardingReducer(state, { type: "continue" });
    }

    expect(state.view).toBe("conversation");
    expect(state.selectedTeam.name).toBe("产品发布团队");
  });

  it("moves back without losing the selected team and replays relay on return", () => {
    let state = initialOnboardingState();
    state = onboardingReducer(state, { type: "continue" });

    state = onboardingReducer(state, { type: "back" });
    expect(state.view).toBe(1);
    expect(state.selectedTeam).toEqual(DEVELOPMENT_TEAM);

    state = onboardingReducer(state, { type: "continue" });
    state = onboardingReducer(state, { type: "continue" });
    state = onboardingReducer(state, { type: "continue" });
    const relayRunBeforeReturn = state.relayRun;

    state = onboardingReducer(state, { type: "back" });
    expect(state.view).toBe(3);
    expect(state.relayRun).toBe(relayRunBeforeReturn + 1);
    expect(state.selectedTeam).toEqual(DEVELOPMENT_TEAM);
  });

  it("does not move back from the first step or completed conversation", () => {
    const first = initialOnboardingState();
    expect(onboardingReducer(first, { type: "back" })).toBe(first);

    let completed = first;
    for (let index = 0; index < 4; index += 1) {
      completed = onboardingReducer(completed, { type: "continue" });
    }
    expect(onboardingReducer(completed, { type: "back" })).toBe(completed);
  });

  it("lets recheck restore the hard gate without resetting the journey", () => {
    for (const environment of ["missing", "unavailable"] as const) {
      let state = initialOnboardingState(environment);
      state = onboardingReducer(state, {
        type: "set-environment",
        value: "checking"
      });
      state = onboardingReducer(state, {
        type: "set-environment",
        value: "ready"
      });

      expect(canContinue(state)).toBe(true);
      expect(onboardingReducer(state, { type: "continue" }).view).toBe(2);
    }
  });

  it("returns replay exit to the same main fixture and discards its team selection", () => {
    const temporaryTeam = {
      id: "temporary",
      name: "临时团队",
      primaryAgent: "临时负责人",
      members: ["临时成员"]
    };
    let state = initialOnboardingState("ready", "replay");

    expect(state.view).toBe("main");
    state = onboardingReducer(state, { type: "enter-replay" });
    state = onboardingReducer(state, { type: "continue" });
    state = onboardingReducer(state, { type: "select-team", team: temporaryTeam });
    state = onboardingReducer(state, { type: "exit-replay" });

    expect(state.view).toBe("main");
    expect(state.selectedTeam).toEqual(DEVELOPMENT_TEAM);
  });

  it("finishes replay through Start using without applying its temporary team", () => {
    const temporaryTeam = {
      id: "temporary",
      name: "临时团队",
      primaryAgent: "临时负责人",
      members: ["临时成员"]
    };
    let state = initialOnboardingState("ready", "replay");
    state = onboardingReducer(state, { type: "enter-replay" });
    state = onboardingReducer(state, { type: "continue" });
    state = onboardingReducer(state, { type: "select-team", team: temporaryTeam });
    state = onboardingReducer(state, { type: "continue" });
    state = onboardingReducer(state, { type: "continue" });
    state = onboardingReducer(state, { type: "continue" });

    expect(state.view).toBe("main");
    expect(state.selectedTeam).toEqual(DEVELOPMENT_TEAM);
  });
});
