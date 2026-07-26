import { describe, expect, it } from "vitest";

import {
  currentActivity,
  formatDuration,
  initialPrototypeState,
  prototypeReducer
} from "./agent-conversation-state.js";

describe("agent conversation prototype state", () => {
  it("formats short and long durations without ambiguous bare times", () => {
    expect(formatDuration(0)).toBe("00:00");
    expect(formatDuration(84)).toBe("01:24");
    expect(formatDuration(3599)).toBe("59:59");
    expect(formatDuration(3738)).toBe("1:02:18");
  });

  it("keeps the activity cursor moving forward when a newer concurrent tool completes", () => {
    let state = initialPrototypeState();
    state = prototypeReducer(state, { type: "advance-event" });
    expect(currentActivity(state).id).toBe("test-started");

    state = prototypeReducer(state, { type: "advance-event" });
    expect(currentActivity(state).id).toBe("test-completed");
    expect(currentActivity(state).action).toBe("已完成命令");

    state = prototypeReducer(state, { type: "tick" });
    expect(currentActivity(state).id).toBe("test-completed");
    expect(state.activityCursor).toBe(30);
  });

  it("freezes a paused run and resumes the same attempt", () => {
    let state = initialPrototypeState();
    state = prototypeReducer(state, { type: "pause" });
    const frozen = state.elapsedSeconds;
    state = prototypeReducer(state, { type: "tick" });
    expect(state.elapsedSeconds).toBe(frozen);
    expect(state.attempts).toHaveLength(2);

    state = prototypeReducer(state, { type: "continue" });
    state = prototypeReducer(state, { type: "tick" });
    expect(state.elapsedSeconds).toBe(frozen + 1);
    expect(state.attempts).toHaveLength(2);
  });

  it("creates a new independently timed attempt only after explicit retry", () => {
    let state = initialPrototypeState();
    state = prototypeReducer(state, { type: "stop" });
    expect(state.status).toBe("stopped");
    expect(state.attempts[1]?.elapsedSeconds).toBe(84);

    state = prototypeReducer(state, { type: "retry" });
    expect(state.status).toBe("running");
    expect(state.elapsedSeconds).toBe(0);
    expect(state.attempts).toHaveLength(3);
    expect(state.attempts[2]).toMatchObject({
      number: 3,
      status: "running",
      elapsedSeconds: 0
    });
  });

  it("does not automatically rerun when recovery validation fails", () => {
    let state = initialPrototypeState();
    state = prototypeReducer(state, { type: "pause" });
    state = prototypeReducer(state, { type: "recovery-failed" });
    expect(state.status).toBe("unable");
    expect(state.attempts).toHaveLength(2);

    state = prototypeReducer(state, { type: "retry" });
    expect(state.status).toBe("running");
    expect(state.attempts).toHaveLength(3);
  });
});
