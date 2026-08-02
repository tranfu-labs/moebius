/** @vitest-environment jsdom */

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { OperatorSession } from "@moebius/console-ui";

import type { SessionSearchResult } from "../src/console-page/conversation-search-model.js";
import {
  useConversationSearch,
  type ConversationSearchPort,
} from "../src/console-page/use-conversation-search.js";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

type SearchBundle = ReturnType<typeof useConversationSearch>;

describe("conversation search controller", () => {
  let host: HTMLDivElement;
  let root: Root;
  let latest: SearchBundle;

  beforeEach(() => {
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    host.remove();
  });

  it("keeps only the latest condition across parent rerenders, failures, and close cancellation", async () => {
    const first = deferred<SessionSearchResult[]>();
    const second = deferred<SessionSearchResult[]>();
    await render(port(() => first.promise));
    act(() => latest.executeSearch({ query: "first", includeArchived: false }));

    await render(port(() => second.promise));
    act(() => latest.executeSearch({ query: "second", includeArchived: true }));
    await act(async () => second.resolve([result("second", "Second")]));
    expect(latest.searchState).toMatchObject({ status: "ready", conditionKey: "second\u0000true" });
    expect(latest.searchResults.map((item) => item.title)).toEqual(["Second"]);

    await act(async () => first.resolve([result("first", "Stale")]));
    expect(latest.searchResults.map((item) => item.title)).toEqual(["Second"]);

    await render(port(async () => Promise.reject(new Error("search offline"))));
    await act(async () => {
      latest.executeSearch({ query: "failure", includeArchived: false });
      await Promise.resolve();
    });
    expect(latest.searchState).toMatchObject({ status: "error", error: "search offline" });

    const late = deferred<SessionSearchResult[]>();
    await render(port(() => late.promise));
    act(() => latest.executeSearch({ query: "close", includeArchived: false }));
    act(() => latest.closeSearch());
    await act(async () => late.resolve([result("late", "Too late")]));
    expect(latest.searchState).toMatchObject({ status: "idle", results: [] });
  });

  async function render(searchPort: ConversationSearchPort): Promise<void> {
    await act(async () => root.render(<Harness port={searchPort} />));
  }

  function Harness(props: { port: ConversationSearchPort }): null {
    latest = useConversationSearch({ apiBase: "http://console.test", port: props.port });
    return null;
  }
});

function port(search: ConversationSearchPort["search"]): ConversationSearchPort {
  return { search };
}

function result(sessionId: string, title: string): SessionSearchResult {
  return {
    session: session(sessionId, title),
    project: { projectId: "local", title: "Local" },
    archived: false,
    originAvailable: true,
  };
}

function session(sessionId: string, title: string): OperatorSession {
  return {
    sessionId,
    projectId: "local",
    parentSessionId: null,
    originSessionId: null,
    entryTemplate: null,
    writePolicy: "normal",
    agentTeamOwnership: "system",
    agentTeamId: "general-assistant",
    agentTeamHealth: "usable",
    agentTeamHealthReason: null,
    analysisRecordAvailable: true,
    workspaceMode: "worktree",
    workspacePendingMode: null,
    workspaceUnavailableReason: null,
    branchName: "feature/search",
    title,
    status: "idle",
    awaitsHumanReason: null,
    unreadSince: null,
    unresolvedSystemEventKind: null,
    lastMessageMentionsAgent: false,
    hasPendingControlWork: false,
    runningCount: 0,
    waitingCount: 0,
    stuckCount: 0,
    errorCount: 0,
    interruptedCount: 0,
    childCount: 0,
    pinnedAt: null,
    createdAt: "2026-08-02T00:00:00.000Z",
    updatedAt: "2026-08-02T00:00:00.000Z",
  };
}

function deferred<T>(): { promise: Promise<T>; resolve(value: T): void } {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}
