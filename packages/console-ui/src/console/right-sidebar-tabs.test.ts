import { describe, expect, it } from "vitest";

import {
  EMPTY_RIGHT_SIDEBAR_TABS,
  RIGHT_SIDEBAR_BUILTIN_TAB_TITLES,
  RIGHT_SIDEBAR_SELECTABLE_TAB_TYPES,
  RIGHT_SIDEBAR_TAB_TYPES,
  addBlankRightSidebarTab,
  closeRightSidebarTab,
  convertBlankRightSidebarTab,
  createFileReferenceSourceKey,
  createRunOutputSourceKey,
  dedupeRunOutputTabsByStableStep,
  ensureRightSidebarTabsForOpen,
  openRightSidebarSourceTab,
  parseFileReferenceSourceKey,
  parseRunOutputSourceKey,
  parseRightSidebarTabsState,
  selectRightSidebarTab,
  serializeRightSidebarTabsState,
  updateRightSidebarProcessScroll,
  updateRightSidebarFileMode,
  updateRightSidebarProjectFileMode,
  type RightSidebarTabsState,
} from "./right-sidebar-tabs";

describe("right sidebar tab model", () => {
  it("keeps the complete tab enum separate from the three user-selectable types", () => {
    expect(RIGHT_SIDEBAR_TAB_TYPES).toEqual([
      "workspace-diff",
      "project-files",
      "file-reference",
      "run-output",
      "sub-session",
      "conversation",
      "blank",
    ]);
    expect(RIGHT_SIDEBAR_SELECTABLE_TAB_TYPES).toEqual([
      "conversation",
      "workspace-diff",
      "project-files",
    ]);
    expect(RIGHT_SIDEBAR_SELECTABLE_TAB_TYPES).not.toContain("run-output");
    expect(RIGHT_SIDEBAR_SELECTABLE_TAB_TYPES).not.toContain("sub-session");
  });

  it("round-trips a file reference source key without exposing it as a selectable type", () => {
    const sourceKey = createFileReferenceSourceKey("session:a", {
      path: "/Users/wing/My Project/spec.md",
      line: 292,
      column: 7,
      hasExplicitLine: true,
    });

    expect(parseFileReferenceSourceKey(sourceKey)).toEqual({
      sessionId: "session:a",
      path: "/Users/wing/My Project/spec.md",
      line: 292,
      column: 7,
      hasExplicitLine: true,
    });
    expect(RIGHT_SIDEBAR_SELECTABLE_TAB_TYPES).not.toContain("file-reference");
  });

  it("best-effort restores explicit locations from legacy file-reference keys", () => {
    expect(parseFileReferenceSourceKey("file-reference-v1:session-a:%2Fworkspace%2FREADME.md:42:")).toMatchObject({
      line: 42,
      column: null,
      hasExplicitLine: true,
    });
    expect(parseFileReferenceSourceKey("file-reference-v1:session-a:%2Fworkspace%2FREADME.md:1:3")).toMatchObject({
      line: 1,
      column: 3,
      hasExplicitLine: true,
    });
    expect(parseFileReferenceSourceKey("file-reference-v1:session-a:%2Fworkspace%2FREADME.md:1:")).toMatchObject({
      line: 1,
      column: null,
      hasExplicitLine: false,
    });
  });

  it("remembers Markdown display mode on the current file tab", () => {
    const opened = openRightSidebarSourceTab(EMPTY_RIGHT_SIDEBAR_TABS, {
      id: "readme",
      type: "file-reference",
      title: "README.md",
      sourceKey: createFileReferenceSourceKey("session-a", {
        path: "/workspace/README.md",
        line: 1,
        column: null,
        hasExplicitLine: false,
      }),
    });

    expect(updateRightSidebarFileMode(opened, "readme", "source").tabs[0]).toMatchObject({
      id: "readme",
      fileMode: "source",
    });
  });

  it("persists per-path Markdown modes inside the project-files tab", () => {
    const state: RightSidebarTabsState = {
      tabs: [{
        id: "files",
        type: "project-files",
        title: RIGHT_SIDEBAR_BUILTIN_TAB_TITLES.projectFiles,
        sourceKey: null,
        closable: true,
      }],
      activeTabId: "files",
    };
    const updated = updateRightSidebarProjectFileMode(state, "files", "README.md", "source");

    expect(parseRightSidebarTabsState(JSON.parse(serializeRightSidebarTabsState(updated))).tabs[0]).toMatchObject({
      projectFileModes: { "README.md": "source" },
    });
  });

  it("deduplicates source tabs while never deduplicating plus-created blank tabs", () => {
    const first = openRightSidebarSourceTab(EMPTY_RIGHT_SIDEBAR_TABS, {
      id: "diff-1",
      type: "workspace-diff",
      title: "改动",
      sourceKey: "workspace-diff:session-a",
    });
    const withBlank = addBlankRightSidebarTab(first, "blank-1");
    const withTwoBlanks = addBlankRightSidebarTab(withBlank, "blank-2");
    const reopened = openRightSidebarSourceTab(withTwoBlanks, {
      id: "diff-2",
      type: "workspace-diff",
      title: "另一个标题不会产生新标签",
      sourceKey: "workspace-diff:session-a",
    });

    expect(reopened.tabs.map((tab) => tab.id)).toEqual(["diff-1", "blank-1", "blank-2"]);
    expect(reopened.activeTabId).toBe("diff-1");
  });

  it("refreshes an existing conversation tab title from the canonical session source", () => {
    const stale = openRightSidebarSourceTab(EMPTY_RIGHT_SIDEBAR_TABS, {
      id: "conversation-a",
      type: "conversation",
      title: "新会话",
      sourceKey: "conversation:analysis-a",
    });
    const refreshed = openRightSidebarSourceTab(stale, {
      id: "conversation-a-again",
      type: "conversation",
      title: "分析 Agent 运行耗时",
      sourceKey: "conversation:analysis-a",
    });

    expect(refreshed).toEqual({
      tabs: [{
        id: "conversation-a",
        type: "conversation",
        title: "分析 Agent 运行耗时",
        sourceKey: "conversation:analysis-a",
        closable: true,
      }],
      activeTabId: "conversation-a",
    });
  });

  it("keeps new tab ids unique after restored tabs reuse the in-memory counter id", () => {
    const restored: RightSidebarTabsState = {
      tabs: [{
        id: "right-sidebar-tab-1",
        type: "project-files",
        title: "项目文件",
        sourceKey: null,
        closable: true,
      }],
      activeTabId: "right-sidebar-tab-1",
    };
    const withBlank = addBlankRightSidebarTab(restored, "right-sidebar-tab-1");
    const withSource = openRightSidebarSourceTab(withBlank, {
      id: "right-sidebar-tab-1",
      type: "workspace-diff",
      title: "改动",
      sourceKey: "workspace-diff:session-a",
    });

    expect(withSource.tabs.map((tab) => tab.id)).toEqual([
      "right-sidebar-tab-1",
      "right-sidebar-tab-1-2",
      "right-sidebar-tab-1-3",
    ]);
    expect(new Set(withSource.tabs.map((tab) => tab.id))).toHaveLength(3);
  });

  it("returns a zero-tab state after the last tab closes", () => {
    const initial = initialState();
    const closed = closeRightSidebarTab(initial, "initial-diff");

    expect(closed).toEqual(EMPTY_RIGHT_SIDEBAR_TABS);
  });

  it("converts only blank tabs and preserves the user's active tab during unrelated updates", () => {
    const state = addBlankRightSidebarTab(
      initialState("diff"),
      "blank",
    );
    const converted = convertBlankRightSidebarTab(state, "blank", "project-files");
    const userSelected = selectRightSidebarTab(converted, "diff");
    const contentRefresh = parseRightSidebarTabsState(JSON.parse(serializeRightSidebarTabsState(userSelected)));

    expect(converted.tabs[1]).toMatchObject({
      type: "project-files",
      title: RIGHT_SIDEBAR_BUILTIN_TAB_TITLES.projectFiles,
      sourceKey: null,
    });
    expect(contentRefresh.activeTabId).toBe("diff");
  });

  it("drops unknown or malformed persisted tabs instead of failing restoration", () => {
    expect(parseRightSidebarTabsState({
      tabs: [
        { id: "known", type: "project-files", title: "项目文件", sourceKey: null, closable: false },
        { id: "future", type: "terminal", title: "终端", sourceKey: null },
        { id: "", type: "blank", title: "坏数据", sourceKey: null },
      ],
      activeTabId: "future",
    })).toEqual({
      tabs: [{
        id: "known",
        type: "project-files",
        title: RIGHT_SIDEBAR_BUILTIN_TAB_TITLES.projectFiles,
        sourceKey: null,
        closable: true,
      }],
      activeTabId: "known",
    });
  });

  it("keeps zero tabs when the sidebar is reopened", () => {
    expect(ensureRightSidebarTabsForOpen(EMPTY_RIGHT_SIDEBAR_TABS, {
      id: "files",
      isGitRepository: false,
    })).toEqual(EMPTY_RIGHT_SIDEBAR_TABS);
  });

  it("keeps a process reading anchor only while the run tab remains open in memory", () => {
    const state = openRightSidebarSourceTab(EMPTY_RIGHT_SIDEBAR_TABS, {
      id: "run-tab",
      type: "run-output",
      title: "开发",
      sourceKey: "run:session-a:run-a",
    });
    const updated = updateRightSidebarProcessScroll(state, "run-tab", {
      anchorEventKey: "run-a:event-42",
      offsetPx: 18,
      followLatest: false,
    });
    expect(updated.tabs[0]?.processScroll).toEqual({
      anchorEventKey: "run-a:event-42",
      offsetPx: 18,
      followLatest: false,
    });
    const restored = parseRightSidebarTabsState(JSON.parse(serializeRightSidebarTabsState(updated)));
    expect(restored.tabs[0]?.processScroll).toBeUndefined();
    expect(updateRightSidebarProcessScroll(updated, "missing", {
      anchorEventKey: null,
      offsetPx: 0,
      followLatest: true,
    })).toEqual(updated);
  });

  it("reopens a closed process tab at the latest output", () => {
    const source = {
      id: "run-tab",
      type: "run-output" as const,
      title: "开发",
      sourceKey: "run-output:session-a:run-a",
    };
    const opened = openRightSidebarSourceTab(EMPTY_RIGHT_SIDEBAR_TABS, source);
    const scrolled = updateRightSidebarProcessScroll(opened, "run-tab", {
      anchorEventKey: "run-a:event-7",
      offsetPx: 24,
      followLatest: false,
    });
    const closed = closeRightSidebarTab(scrolled, "run-tab", "blank");
    const restored = parseRightSidebarTabsState(JSON.parse(serializeRightSidebarTabsState(closed)));
    const reopened = openRightSidebarSourceTab(restored, { ...source, id: "run-tab-again" });

    expect(reopened.tabs.at(-1)?.processScroll).toBeUndefined();
  });

  it("round-trips child-session and run ids without delimiter ambiguity", () => {
    const sourceKey = createRunOutputSourceKey(
      "local:project/child-session",
      "local-2026-07-23T02:03:04.000Z-run",
    );

    expect(parseRunOutputSourceKey(sourceKey)).toEqual({
      sessionId: "local:project/child-session",
      runId: "local-2026-07-23T02:03:04.000Z-run",
      stepId: null,
    });
    expect(parseRunOutputSourceKey("run-output:session-a:run:1", "session-a")).toEqual({
      sessionId: "session-a",
      runId: "run:1",
      stepId: null,
    });
  });

  it("deduplicates retry runs by the stable session and step identity", () => {
    const first = openRightSidebarSourceTab(EMPTY_RIGHT_SIDEBAR_TABS, {
      id: "run-tab-1",
      type: "run-output",
      title: "成员未知",
      sourceKey: createRunOutputSourceKey("session:a", "run:1", "message:42"),
    });
    const retried = openRightSidebarSourceTab(first, {
      id: "run-tab-2",
      type: "run-output",
      title: "开发",
      sourceKey: createRunOutputSourceKey("session:a", "run:2", "message:42"),
    });

    expect(retried.tabs).toHaveLength(1);
    expect(retried.tabs[0]).toMatchObject({
      id: "run-tab-1",
      title: "开发",
      sourceKey: createRunOutputSourceKey("session:a", "run:1", "message:42"),
    });
    expect(parseRunOutputSourceKey(retried.tabs[0]?.sourceKey ?? null)).toEqual({
      sessionId: "session:a",
      runId: "run:1",
      stepId: "message:42",
    });
  });

  it("upgrades a persisted run-key tab before a later retry is opened", () => {
    const restored = openRightSidebarSourceTab(EMPTY_RIGHT_SIDEBAR_TABS, {
      id: "restored-run-tab",
      type: "run-output",
      title: "成员未知",
      sourceKey: "run-output:session-a:run-1",
    });
    const upgraded = openRightSidebarSourceTab(restored, {
      id: "same-run-after-upgrade",
      type: "run-output",
      title: "开发",
      sourceKey: createRunOutputSourceKey("session-a", "run-1", "message:42"),
    });
    const retried = openRightSidebarSourceTab(upgraded, {
      id: "retry-run-tab",
      type: "run-output",
      title: "开发 2",
      sourceKey: createRunOutputSourceKey("session-a", "run-2", "message:42"),
    });

    expect(retried.tabs).toHaveLength(1);
    expect(retried.tabs[0]).toMatchObject({
      id: "restored-run-tab",
      title: "开发",
      sourceKey: createRunOutputSourceKey("session-a", "run-1", "message:42"),
    });
  });

  it("repairs already-persisted duplicate retry tabs and preserves the active reading state", () => {
    const repaired = dedupeRunOutputTabsByStableStep({
      tabs: [
        {
          id: "attempt-1-tab",
          type: "run-output",
          title: "成员未知",
          sourceKey: createRunOutputSourceKey("session-a", "run-1", "message:42"),
          closable: true,
        },
        {
          id: "attempt-2-tab",
          type: "run-output",
          title: "开发",
          sourceKey: createRunOutputSourceKey("session-a", "run-2", "message:42"),
          closable: true,
          processScroll: {
            anchorEventKey: "run-2:event-9",
            offsetPx: 12,
            followLatest: false,
          },
        },
      ],
      activeTabId: "attempt-2-tab",
    });

    expect(repaired).toEqual({
      tabs: [{
        id: "attempt-1-tab",
        type: "run-output",
        title: "开发",
        sourceKey: createRunOutputSourceKey("session-a", "run-1", "message:42"),
        closable: true,
        processScroll: {
          anchorEventKey: "run-2:event-9",
          offsetPx: 12,
          followLatest: false,
        },
      }],
      activeTabId: "attempt-1-tab",
    });
  });
});

function initialState(id = "initial-diff"): RightSidebarTabsState {
  return {
    tabs: [{
      id,
      type: "workspace-diff",
      title: RIGHT_SIDEBAR_BUILTIN_TAB_TITLES.workspaceDiff,
      sourceKey: null,
      closable: true,
    }],
    activeTabId: id,
  };
}
