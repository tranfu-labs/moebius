// @vitest-environment jsdom
import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type {
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
