/** @vitest-environment jsdom */

import { act, renderHook } from "@testing-library/react";
import type { SessionTeamUpdateViewState } from "@moebius/console-ui";
import { describe, expect, it, vi } from "vitest";

import { useSessionTeamUpdate } from "../src/console-page/use-session-team-update.js";
import { decideSessionTeamUpdatePolling } from "../src/session-team-update-view-plan.js";

describe("session team update hook", () => {
  it("holds polling during mutation and after a failed update", () => {
    expect(decideSessionTeamUpdatePolling({ mutationInFlight: true, status: "loading" })).toBe("hold");
    expect(decideSessionTeamUpdatePolling({ mutationInFlight: false, status: "failed" })).toBe("hold");
    expect(decideSessionTeamUpdatePolling({ mutationInFlight: false, status: "waiting" })).toBe("poll");
  });

  it("does not restart a slow inspect for callback identity churn and ignores the old session response", async () => {
    const first = deferred<SessionTeamUpdateViewState>();
    const second = deferred<SessionTeamUpdateViewState>();
    const firstLoad = vi.fn(() => first.promise);
    const replacementLoad = vi.fn(() => first.promise);
    const secondLoad = vi.fn(() => second.promise);
    const mutate = vi.fn(async () => idle());
    const { result, rerender } = renderHook((props: {
      sessionId: string;
      load: typeof firstLoad;
    }) => useSessionTeamUpdate({
      apiBase: "http://127.0.0.1:8787",
      sessionId: props.sessionId,
      sessionRevision: "revision-1",
      load: props.load,
      mutate,
    }), { initialProps: { sessionId: "session-a", load: firstLoad } });

    expect(firstLoad).toHaveBeenCalledTimes(1);
    rerender({ sessionId: "session-a", load: replacementLoad });
    expect(replacementLoad).not.toHaveBeenCalled();

    rerender({ sessionId: "session-b", load: secondLoad });
    expect(secondLoad).toHaveBeenCalledTimes(1);
    await act(async () => second.resolve({
      status: "available",
      categories: [{ kind: "execution-profile", affectedMemberCount: 1 }],
      updateToken: "session-b-token",
    }));
    expect(result.current.state.updateToken).toBe("session-b-token");

    await act(async () => first.resolve({
      status: "available",
      categories: [{ kind: "agent-definition", affectedMemberCount: 1 }],
      updateToken: "stale-session-a-token",
    }));
    expect(result.current.state.updateToken).toBe("session-b-token");
  });

  it("keeps the frozen token visible when a mutation fails and does not repeat it after rerender", async () => {
    const load = vi.fn(async () => ({
      status: "available" as const,
      categories: [{ kind: "agent-definition" as const, affectedMemberCount: 1 }],
      updateToken: "frozen-token",
    }));
    const mutate = vi.fn(async () => { throw new Error("unavailable"); });
    const { result, rerender } = renderHook((props: { mutate: typeof mutate }) => useSessionTeamUpdate({
      apiBase: "http://127.0.0.1:8787",
      sessionId: "session-a",
      sessionRevision: "revision-1",
      load,
      mutate: props.mutate,
    }), { initialProps: { mutate } });
    await act(async () => Promise.resolve());

    await act(async () => result.current.apply());
    expect(result.current.state).toMatchObject({ status: "failed", updateToken: "frozen-token" });
    const replacementMutate = vi.fn(async () => idle());
    rerender({ mutate: replacementMutate as typeof mutate });
    expect(mutate).toHaveBeenCalledTimes(1);
    expect(replacementMutate).not.toHaveBeenCalled();
  });

  it("projects retry as loading immediately while retaining the frozen token", async () => {
    const mutation = deferred<SessionTeamUpdateViewState>();
    const load = vi.fn(async () => ({
      status: "failed" as const,
      categories: [{ kind: "agent-definition" as const, affectedMemberCount: 1 }],
      updateToken: "frozen-token",
      failure: { code: "FAILED", summary: "failed" },
    }));
    const { result } = renderHook(() => useSessionTeamUpdate({
      apiBase: "http://127.0.0.1:8787",
      sessionId: "session-a",
      sessionRevision: "revision-1",
      load,
      mutate: () => mutation.promise,
    }));
    await act(async () => Promise.resolve());

    act(() => result.current.retry());
    expect(result.current.state).toMatchObject({
      status: "loading",
      updateToken: "frozen-token",
      categories: [{ kind: "agent-definition", affectedMemberCount: 1 }],
    });

    await act(async () => mutation.resolve(idle()));
    expect(result.current.state).toEqual(idle());
  });
});

function idle(): SessionTeamUpdateViewState {
  return { status: "idle", categories: [] };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}
