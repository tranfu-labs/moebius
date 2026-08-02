import { describe, expect, it } from "vitest";
import type {
  OperatorMessage,
  OperatorSession,
  OperatorSubSessionViewState,
} from "@moebius/console-ui";

import {
  planActiveSubSessionMessages,
  planAnalysisNavigation,
  planAnalysisPanelEntries,
  planConsolePresentationState,
  planSubSessionViewsWithPreviews,
  planUpdatingConversationTabIds,
} from "../src/console-page/console-presentation-model.js";

describe("console analysis presentation model", () => {
  it("orders child entries and disambiguates duplicate titles without changing unique titles", () => {
    const sessions = [
      session("root", "Root"),
      session("old", "Same", { parent: "root", createdAt: "2026-08-01T10:00:00.000Z" }),
      session("new", "Same", { parent: "root", createdAt: "2026-08-02T10:00:00.000Z" }),
      session("unique", "Unique", { parent: "root", createdAt: "2026-08-03T10:00:00.000Z" }),
    ];

    const entries = planAnalysisPanelEntries(sessions, "root", "en-US");

    expect(entries.map((entry) => entry.sessionId)).toEqual(["unique", "new", "old"]);
    expect(entries[0]).toEqual({ sessionId: "unique", title: "Unique" });
    expect(entries[1]?.createdLabel).toBeTruthy();
    expect(entries[2]?.createdLabel).toBeTruthy();
  });

  it("distinguishes direct roots, hosted children, stale panel entries, and broken ancestry", () => {
    const sessions = [
      session("root", "Root"),
      session("child", "Child", { parent: "root" }),
      session("cycle-a", "Cycle A", { parent: "cycle-b" }),
      session("cycle-b", "Cycle B", { parent: "cycle-a" }),
    ];

    expect(planAnalysisNavigation(sessions, "other", {
      kind: "reference",
      sessionId: "root",
    })).toMatchObject({ kind: "direct", root: { sessionId: "root" } });
    expect(planAnalysisNavigation(sessions, "other", {
      kind: "panel-entry",
      parentSessionId: "root",
      sessionId: "child",
    })).toMatchObject({
      kind: "sidebar",
      root: { sessionId: "root" },
      target: { sessionId: "child" },
      selectRoot: true,
      focusTab: true,
    });
    expect(planAnalysisNavigation(sessions, "root", {
      kind: "panel-entry",
      parentSessionId: "wrong",
      sessionId: "child",
    })).toEqual({ kind: "error", reason: "source-missing" });
    expect(planAnalysisNavigation(sessions, "root", {
      kind: "reference",
      sessionId: "cycle-a",
    })).toEqual({ kind: "error", reason: "open-failed" });
  });
});

describe("console shell presentation model", () => {
  it("maps unavailable, loading, and ready shell data without manufacturing remote state", () => {
    expect(planConsolePresentationState(null, null)).toMatchObject({
      projectListState: "loading",
      selectedSession: null,
      activeRuns: [],
    });
    expect(planConsolePresentationState(null, "offline").projectListState).toBe("error");
    const activeRun = { runId: "run-1" } as never;
    const state = {
      project: { projectId: "project-a" },
      projects: [{ projectId: "project-a" }],
      selectedSession: session("session-a", "Session"),
      messages: [{ id: 1 }],
      activeRun,
      sqlitePath: "/tmp/state.sqlite",
    } as never;

    expect(planConsolePresentationState(state, null)).toMatchObject({
      projectListState: "ready",
      activeRuns: [activeRun],
      sqlitePath: "/tmp/state.sqlite",
    });
  });

  it("replaces only the active ready sub-session messages with attachment previews", () => {
    const original = [{ messageId: 1 }] as unknown as OperatorMessage[];
    const previews = [{ messageId: 1, body: "previewed" }] as unknown as OperatorMessage[];
    const views: Record<string, OperatorSubSessionViewState> = {
      ready: { status: "ready", view: { messages: original } as never },
      loading: { status: "loading" },
    };

    expect(planActiveSubSessionMessages(null, views)).toEqual([]);
    expect(planActiveSubSessionMessages("loading", views)).toEqual([]);
    expect(planActiveSubSessionMessages("ready", views)).toBe(original);
    expect(planSubSessionViewsWithPreviews("loading", views, previews)).toBe(views);
    expect(planSubSessionViewsWithPreviews("ready", views, previews)).toEqual({
      ...views,
      ready: { status: "ready", view: { messages: previews } },
    });
  });

  it("combines unresolved and actively renamed conversation tabs", () => {
    const resolved = {
      state: {
        activeTabId: "conversation-a",
        tabs: [
          { id: "conversation-a", type: "conversation", title: "A", sourceKey: "conversation:a" },
          { id: "process-a", type: "process", title: "Process", sourceKey: "run:a" },
        ],
      },
      unresolvedTabIds: ["conversation-missing"],
    } as never;

    expect(planUpdatingConversationTabIds(resolved, new Set(["a"]))).toEqual([
      "conversation-missing",
      "conversation-a",
    ]);
    expect(planUpdatingConversationTabIds(resolved, new Set())).toEqual(["conversation-missing"]);
  });
});

function session(
  sessionId: string,
  title: string,
  options: { parent?: string; createdAt?: string } = {},
): OperatorSession {
  return {
    sessionId,
    projectId: "project-a",
    analysisParentSessionId: options.parent ?? null,
    workspaceMode: "direct",
    workspacePendingMode: null,
    title,
    status: "idle",
    awaitsHumanReason: null,
    unreadSince: null,
    runningCount: 0,
    waitingCount: 0,
    stuckCount: 0,
    errorCount: 0,
    interruptedCount: 0,
    createdAt: options.createdAt ?? "2026-08-01T00:00:00.000Z",
    updatedAt: options.createdAt ?? "2026-08-01T00:00:00.000Z",
  };
}
