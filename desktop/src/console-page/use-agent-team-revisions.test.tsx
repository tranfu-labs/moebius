// @vitest-environment jsdom
import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type {
  AgentMarkdownRevisionSummarySettledPayload,
  AgentTeamMemberRevisionsResponse,
  AgentTeamMemberRevisionRestoreResponse,
} from "../team-ipc-contract.js";
import type { AgentTeamCatalogBundle } from "./use-agent-team-catalog.js";
import {
  useAgentTeamRevisions,
  type AgentTeamRevisionsPort,
} from "./use-agent-team-revisions.js";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((onResolve, onReject) => {
    resolve = onResolve;
    reject = onReject;
  });
  return { promise, resolve, reject };
}

const revisionsResponse = (
  summary: string | null,
  summaryStatus: "pending" | "ready" | "unavailable" = summary === null ? "unavailable" : "ready",
): AgentTeamMemberRevisionsResponse => ({
  recentChange: {
    summary,
    summaryStatus,
    authorLabel: "你",
    timeLabel: "2026-08-01T00:00:00.000Z",
  },
  changeMarkers: [],
  timeline: [{
    revisionId: `rev-${summary ?? "none"}`,
    authorKind: "user",
    authorLabel: null,
    summary,
    summaryStatus,
    timeLabel: "2026-08-01T00:00:00.000Z",
    isEarliest: true,
  }],
});

function catalog(): AgentTeamCatalogBundle {
  return {
    state: {
      status: "ready",
      teams: [{
        teamKey: "system:development",
        id: "development",
        ownership: "system",
        name: "开发团队",
        description: null,
        primaryAgentSlug: "dev-manager",
        memberOrder: ["dev-manager"],
        members: [{ slug: "dev-manager", displayName: "开发经理", description: "" }],
        status: "usable",
        canCreateConversation: true,
      }],
    },
    setState: vi.fn(),
    refresh: vi.fn(),
    lastUsedTeamKey: null,
    selection: null,
  } as unknown as AgentTeamCatalogBundle;
}

function port(overrides: Partial<AgentTeamRevisionsPort> = {}): AgentTeamRevisionsPort {
  return {
    listAgentTeamMemberRevisions: vi.fn(async () => revisionsResponse("第一条")),
    restoreAgentTeamMemberRevision: vi.fn(async (): Promise<AgentTeamMemberRevisionRestoreResponse> => ({
      agentMarkdown: "# 开发经理\n",
      revision: {
        revisionId: "restored",
        authorKind: "user",
        authorLabel: null,
        summary: null,
        summaryStatus: "pending",
        timeLabel: "2026-08-02T00:00:00.000Z",
        isEarliest: false,
      },
    })),
    ...overrides,
  };
}

describe("useAgentTeamRevisions", () => {
  it("loads revisions for a member and renders the latest summary", async () => {
    const api = port();
    const { result } = renderHook(() => useAgentTeamRevisions({
      api,
      catalog: catalog(),
      t: ((key: string) => key) as never,
    }));

    act(() => result.current.loadRevisions("system:development", "dev-manager"));
    await waitFor(() => expect(result.current.revisions["system:development"]?.["dev-manager"]?.recentChange?.summary)
      .toBe("第一条"));
  });

  it("drops a slow stale response after a refresh has committed newer state", async () => {
    const slow = deferred<AgentTeamMemberRevisionsResponse>();
    const api = port({
      listAgentTeamMemberRevisions: vi.fn()
        .mockImplementationOnce(async () => await slow.promise)
        .mockResolvedValueOnce(revisionsResponse("新的摘要")),
    });
    const { result } = renderHook(() => useAgentTeamRevisions({
      api,
      catalog: catalog(),
      t: ((key: string) => key) as never,
    }));

    act(() => result.current.loadRevisions("system:development", "dev-manager"));
    act(() => result.current.refreshRevisions("system:development", "dev-manager"));
    await waitFor(() => expect(result.current.revisions["system:development"]?.["dev-manager"]?.recentChange?.summary)
      .toBe("新的摘要"));

    await act(async () => slow.resolve(revisionsResponse("旧的慢响应")));

    expect(result.current.revisions["system:development"]?.["dev-manager"]?.recentChange?.summary)
      .toBe("新的摘要");
  });

  it("refresh after save reloads instead of reusing the cached entry", async () => {
    const list = vi.fn()
      .mockResolvedValueOnce(revisionsResponse("第一条"))
      .mockResolvedValueOnce(revisionsResponse("保存后的摘要"));
    const api = port({ listAgentTeamMemberRevisions: list });
    const { result } = renderHook(() => useAgentTeamRevisions({
      api,
      catalog: catalog(),
      t: ((key: string) => key) as never,
    }));

    act(() => result.current.loadRevisions("system:development", "dev-manager"));
    await waitFor(() => expect(result.current.revisions["system:development"]?.["dev-manager"]?.recentChange?.summary)
      .toBe("第一条"));

    act(() => result.current.refreshRevisions("system:development", "dev-manager"));
    await waitFor(() => expect(list).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(result.current.revisions["system:development"]?.["dev-manager"]?.recentChange?.summary)
      .toBe("保存后的摘要"));
  });

  it("restores a revision and refreshes the timeline", async () => {
    const restore = vi.fn(async (): Promise<AgentTeamMemberRevisionRestoreResponse> => ({
      agentMarkdown: "# 开发经理\n",
      revision: {
        revisionId: "restored",
        authorKind: "user",
        authorLabel: null,
        summary: null,
        summaryStatus: "pending",
        timeLabel: "2026-08-02T00:00:00.000Z",
        isEarliest: false,
      },
    }));
    const list = vi.fn()
      .mockResolvedValueOnce(revisionsResponse("第一条"))
      .mockResolvedValueOnce(revisionsResponse("回退后的摘要"));
    const api = port({ restoreAgentTeamMemberRevision: restore, listAgentTeamMemberRevisions: list });
    const { result } = renderHook(() => useAgentTeamRevisions({
      api,
      catalog: catalog(),
      t: ((key: string) => key) as never,
    }));

    act(() => result.current.loadRevisions("system:development", "dev-manager"));
    await waitFor(() => expect(list).toHaveBeenCalledTimes(1));

    let restored!: { agentMarkdown: string };
    await act(async () => {
      restored = await result.current.restoreRevision("system:development", "dev-manager", "rev-old");
    });
    expect(restored.agentMarkdown).toBe("# 开发经理\n");
    expect(restore).toHaveBeenCalledWith({
      teamId: "development",
      ownership: "system",
      memberSlug: "dev-manager",
      revisionId: "rev-old",
    });
    await waitFor(() => expect(list).toHaveBeenCalledTimes(2));
  });

  it("ignores a failed revision read without breaking editing", async () => {
    const api = port({
      listAgentTeamMemberRevisions: vi.fn().mockRejectedValue(new Error("boom")),
    });
    const { result } = renderHook(() => useAgentTeamRevisions({
      api,
      catalog: catalog(),
      t: ((key: string) => key) as never,
    }));

    act(() => result.current.loadRevisions("system:development", "dev-manager"));
    await act(async () => {
      await Promise.resolve();
    });
    expect(result.current.revisions["system:development"]?.["dev-manager"] ?? null).toBeNull();
  });
});

function settledResponse(
  revisionId: string,
  summaryStatus: "pending" | "ready" | "unavailable",
  timeLabel = "2026-08-01T00:00:00.000Z",
): AgentTeamMemberRevisionsResponse {
  return {
    recentChange: {
      summary: summaryStatus === "ready" ? "摘要就绪" : null,
      summaryStatus,
      authorLabel: "你",
      timeLabel,
    },
    changeMarkers: [],
    timeline: [{
      revisionId,
      authorKind: "user",
      authorLabel: null,
      summary: summaryStatus === "ready" ? "摘要就绪" : null,
      summaryStatus,
      timeLabel,
      isEarliest: true,
    }],
  };
}

function captureSubscription() {
  const listeners: Array<(payload: AgentMarkdownRevisionSummarySettledPayload) => void> = [];
  const subscribe = vi.fn((
    listener: (payload: AgentMarkdownRevisionSummarySettledPayload) => void,
  ) => {
    listeners.push(listener);
    return () => {
      const index = listeners.indexOf(listener);
      if (index >= 0) listeners.splice(index, 1);
    };
  });
  return { subscribe, listeners };
}

const settledPayload = (
  revisionId: string,
  createdAt = "2026-08-01T00:00:00.000Z",
): AgentMarkdownRevisionSummarySettledPayload => ({
  teamStableId: "development",
  memberSlug: "dev-manager",
  revisionId,
  createdAt,
});

describe("useAgentTeamRevisions summary-settled refresh", () => {
  it("refreshes the open member in place on settle and is idempotent for repeated delivery", async () => {
    const { subscribe, listeners } = captureSubscription();
    const list = vi.fn()
      .mockResolvedValueOnce(settledResponse("rev-1", "pending"))
      .mockResolvedValueOnce(settledResponse("rev-1", "unavailable"));
    const api = port({ listAgentTeamMemberRevisions: list });
    const { result } = renderHook(() => useAgentTeamRevisions({
      api,
      catalog: catalog(),
      t: ((key: string) => key) as never,
      subscribeRevisionSummarySettled: subscribe,
    }));

    act(() => result.current.loadRevisions("system:development", "dev-manager"));
    await waitFor(() => expect(
      result.current.revisions["system:development"]?.["dev-manager"]?.recentChange?.summaryStatus,
    ).toBe("pending"));
    expect(listeners).toHaveLength(1);

    // The settle push refreshes the member; the terminal response replaces the
    // pending one in place.
    await act(async () => {
      listeners[0]!(settledPayload("rev-1"));
    });
    await waitFor(() => expect(
      result.current.revisions["system:development"]?.["dev-manager"]?.recentChange?.summaryStatus,
    ).toBe("unavailable"));
    expect(list).toHaveBeenCalledTimes(2);

    // Redelivering the same terminal event must NOT refresh: no new list call
    // and the committed state object stays identical (same identity — the
    // 655b940b loop lesson: identical terminal state must never produce a new
    // state object).
    const entryBefore = result.current.revisions["system:development"]?.["dev-manager"];
    await act(async () => {
      listeners[0]!(settledPayload("rev-1"));
    });
    await act(async () => {
      await Promise.resolve();
    });
    expect(list).toHaveBeenCalledTimes(2);
    expect(result.current.revisions["system:development"]?.["dev-manager"]).toBe(entryBefore);
  });

  it("ignores a settled event for a member that was never loaded", async () => {
    const { subscribe, listeners } = captureSubscription();
    const list = vi.fn().mockResolvedValue(settledResponse("rev-1", "ready"));
    const api = port({ listAgentTeamMemberRevisions: list });
    renderHook(() => useAgentTeamRevisions({
      api,
      catalog: catalog(),
      t: ((key: string) => key) as never,
      subscribeRevisionSummarySettled: subscribe,
    }));

    await act(async () => {
      listeners[0]!(settledPayload("rev-1"));
    });
    await act(async () => {
      await Promise.resolve();
    });
    expect(list).not.toHaveBeenCalled();
  });

  it("ignores a settled event for an older revision when a newer one is shown", async () => {
    const { subscribe, listeners } = captureSubscription();
    const list = vi.fn().mockResolvedValue(settledResponse("rev-2", "pending", "2026-08-02T00:00:00.000Z"));
    const api = port({ listAgentTeamMemberRevisions: list });
    const { result } = renderHook(() => useAgentTeamRevisions({
      api,
      catalog: catalog(),
      t: ((key: string) => key) as never,
      subscribeRevisionSummarySettled: subscribe,
    }));

    act(() => result.current.loadRevisions("system:development", "dev-manager"));
    await waitFor(() => expect(
      result.current.revisions["system:development"]?.["dev-manager"]?.recentChange?.summaryStatus,
    ).toBe("pending"));

    // An event whose revision is OLDER than the loaded latest is stale: the
    // newer revision's own job will emit its own event.
    await act(async () => {
      listeners[0]!(settledPayload("rev-1", "2026-08-01T00:00:00.000Z"));
    });
    await act(async () => {
      await Promise.resolve();
    });
    expect(list).toHaveBeenCalledTimes(1);
  });

  it("refreshes when the settled event is newer than the loaded view (stale in-flight refresh)", async () => {
    const { subscribe, listeners } = captureSubscription();
    const list = vi.fn()
      .mockResolvedValueOnce(settledResponse("rev-1", "unavailable", "2026-08-01T00:00:00.000Z"))
      .mockResolvedValueOnce(settledResponse("rev-2", "unavailable", "2026-08-02T00:00:00.000Z"));
    const api = port({ listAgentTeamMemberRevisions: list });
    const { result } = renderHook(() => useAgentTeamRevisions({
      api,
      catalog: catalog(),
      t: ((key: string) => key) as never,
      subscribeRevisionSummarySettled: subscribe,
    }));

    act(() => result.current.loadRevisions("system:development", "dev-manager"));
    await waitFor(() => expect(
      result.current.revisions["system:development"]?.["dev-manager"]?.timeline[0]?.revisionId,
    ).toBe("rev-1"));

    // The save flow starts a refresh for rev-2 whose response has not landed:
    // the loaded view still shows rev-1. The terminal event for rev-2 arrives
    // in that window — it must NOT be dropped as "superseded" (that would
    // leave the line pending forever); the newer createdAt triggers a refresh
    // whose response carries the current (terminal) state.
    await act(async () => {
      listeners[0]!(settledPayload("rev-2", "2026-08-02T00:00:00.000Z"));
    });
    await waitFor(() => expect(
      result.current.revisions["system:development"]?.["dev-manager"]?.timeline[0]?.revisionId,
    ).toBe("rev-2"));
    expect(list).toHaveBeenCalledTimes(2);
    expect(result.current.revisions["system:development"]?.["dev-manager"]?.recentChange?.summaryStatus)
      .toBe("unavailable");
  });

  it("keeps the previous response mounted while a refresh reloads (no flash)", async () => {
    const slow = deferred<AgentTeamMemberRevisionsResponse>();
    const list = vi.fn()
      .mockResolvedValueOnce(settledResponse("rev-1", "pending"))
      .mockImplementationOnce(async () => await slow.promise);
    const api = port({ listAgentTeamMemberRevisions: list });
    const { result } = renderHook(() => useAgentTeamRevisions({
      api,
      catalog: catalog(),
      t: ((key: string) => key) as never,
    }));

    act(() => result.current.loadRevisions("system:development", "dev-manager"));
    await waitFor(() => expect(
      result.current.revisions["system:development"]?.["dev-manager"]?.recentChange?.summaryStatus,
    ).toBe("pending"));

    act(() => result.current.refreshRevisions("system:development", "dev-manager"));
    // The entry must NOT go null while the reload is in flight: the markers,
    // the "最近变化" line and the expanded timeline stay mounted.
    expect(result.current.revisions["system:development"]?.["dev-manager"]?.recentChange?.summaryStatus)
      .toBe("pending");

    await act(async () => {
      slow.resolve(settledResponse("rev-1", "ready"));
    });
    await waitFor(() => expect(
      result.current.revisions["system:development"]?.["dev-manager"]?.recentChange?.summaryStatus,
    ).toBe("ready"));
  });

  it("drops a stale event-triggered response after a newer refresh committed", async () => {
    const slow = deferred<AgentTeamMemberRevisionsResponse>();
    const { subscribe, listeners } = captureSubscription();
    const list = vi.fn()
      .mockResolvedValueOnce(settledResponse("rev-1", "pending"))
      .mockImplementationOnce(async () => await slow.promise)
      .mockResolvedValueOnce(settledResponse("rev-2", "pending"));
    const api = port({ listAgentTeamMemberRevisions: list });
    const { result } = renderHook(() => useAgentTeamRevisions({
      api,
      catalog: catalog(),
      t: ((key: string) => key) as never,
      subscribeRevisionSummarySettled: subscribe,
    }));

    act(() => result.current.loadRevisions("system:development", "dev-manager"));
    await waitFor(() => expect(
      result.current.revisions["system:development"]?.["dev-manager"]?.recentChange?.summaryStatus,
    ).toBe("pending"));

    // The settle event starts a slow refresh; a newer save refresh commits
    // first (generation bump), so the late event response must not overwrite.
    act(() => listeners[0]!(settledPayload("rev-1")));
    act(() => result.current.refreshRevisions("system:development", "dev-manager"));
    await waitFor(() => expect(
      result.current.revisions["system:development"]?.["dev-manager"]?.timeline[0]?.revisionId,
    ).toBe("rev-2"));
    expect(list).toHaveBeenCalledTimes(3);

    await act(async () => {
      slow.resolve(settledResponse("rev-1", "unavailable"));
    });
    expect(result.current.revisions["system:development"]?.["dev-manager"]?.timeline[0]?.revisionId)
      .toBe("rev-2");
    expect(result.current.revisions["system:development"]?.["dev-manager"]?.recentChange?.summaryStatus)
      .toBe("pending");
  });
});
