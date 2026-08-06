import { describe, expect, it } from "vitest";
import {
  createByokPrototypeState,
  reduceByokPrototypeState
} from "./state.js";

describe("BYOK prototype state", () => {
  it("completes the three-stage validation before making a profile ready", () => {
    let state = createByokPrototypeState();
    state = reduceByokPrototypeState(state, {
      type: "start-validation",
      name: "工作档案",
      model: "deepseek-chat"
    });
    expect(state.provider.exists).toBe(false);
    expect(state.validation).toBe("reply");

    state = reduceByokPrototypeState(state, { type: "advance-validation" });
    expect(state.validation).toBe("tools");
    state = reduceByokPrototypeState(state, { type: "advance-validation" });
    expect(state.validation).toBe("saving");
    state = reduceByokPrototypeState(state, { type: "advance-validation" });

    expect(state.validation).toBe("idle");
    expect(state.provider).toMatchObject({ exists: true, status: "ready" });
  });

  it("keeps a failed validation out of the ready profile list and can retry", () => {
    let state = createByokPrototypeState();
    state = reduceByokPrototypeState(state, { type: "fail-next-validation" });
    state = reduceByokPrototypeState(state, {
      type: "start-validation",
      name: "工作档案",
      model: "deepseek-chat"
    });
    state = reduceByokPrototypeState(state, { type: "advance-validation" });
    state = reduceByokPrototypeState(state, { type: "advance-validation" });

    expect(state.validation).toBe("failed");
    expect(state.provider.exists).toBe(false);
    expect(
      reduceByokPrototypeState(state, { type: "retry-validation" }).validation
    ).toBe("reply");
  });

  it("updates all affected team members together", () => {
    let state = createByokPrototypeState();
    state = reduceByokPrototypeState(state, { type: "start-team-update" });
    expect(state.teamUpdateState).toBe("saving");
    state = reduceByokPrototypeState(state, { type: "team-update-succeeded" });
    expect(state).toMatchObject({ teamBound: true, teamUpdateState: "idle" });
  });

  it("permanently migrates the current conversation without changing scenes", () => {
    let state = createByokPrototypeState();
    state = reduceByokPrototypeState(state, {
      type: "conversation-fixture",
      fixture: "model-removed"
    });
    state = reduceByokPrototypeState(state, {
      type: "migration-succeeded",
      model: "deepseek-chat"
    });
    expect(state.scene).toBe("onboarding");
    expect(state.conversationFixture).toBe("migrated");
    expect(state.provider.defaultModel).toBe("deepseek-chat");
  });
});
