import { describe, expect, it } from "vitest";

import {
  conversationDraftTabSourceKey,
  conversationTabSourceKey,
  createRightSidebarTabsStore,
  RIGHT_SIDEBAR_TABS_DOCUMENT_KEY,
  rightSidebarTabsKey,
} from "../src/console-page/right-sidebar-tabs-store.js";

describe("right sidebar tabs store", () => {
  it("keeps each session isolated and restores tabs across store instances", () => {
    const storage = new MemoryStorage();
    const firstRun = createRightSidebarTabsStore(storage);
    firstRun.write("session-a", {
      tabs: [{ id: "diff", type: "workspace-diff", title: "改动", sourceKey: null, closable: true }],
      activeTabId: "diff",
    });
    firstRun.write("session-b", {
      tabs: [{ id: "files", type: "project-files", title: "项目文件", sourceKey: null, closable: true }],
      activeTabId: "files",
    });

    const restarted = createRightSidebarTabsStore(storage);
    expect(restarted.read("session-a").tabs[0]?.type).toBe("workspace-diff");
    expect(restarted.read("session-b").tabs[0]?.type).toBe("project-files");
    expect(storage.getItem(RIGHT_SIDEBAR_TABS_DOCUMENT_KEY)).toContain("session-a");
    expect(storage.getItem(RIGHT_SIDEBAR_TABS_DOCUMENT_KEY)).toContain("session-b");
  });

  it("drops unknown persisted types and tolerates corrupt storage", () => {
    const storage = new MemoryStorage();
    storage.setItem(rightSidebarTabsKey("session-a"), JSON.stringify({
      tabs: [
        { id: "known", type: "project-files", title: "项目文件", sourceKey: null },
        { id: "future", type: "terminal", title: "终端", sourceKey: null },
      ],
      activeTabId: "future",
    }));
    storage.setItem(rightSidebarTabsKey("session-b"), "{");
    const store = createRightSidebarTabsStore(storage);

    expect(store.read("session-a")).toMatchObject({
      tabs: [{ id: "known", type: "project-files" }],
      activeTabId: "known",
    });
    expect(store.read("session-b")).toEqual({ tabs: [], activeTabId: null });
  });

  it("promotes a draft to a titled session atomically across restart", () => {
    const storage = new MemoryStorage();
    const store = createRightSidebarTabsStore(storage);
    store.write("source-a", {
      tabs: [{
        id: "draft",
        type: "conversation",
        title: "新会话",
        sourceKey: conversationDraftTabSourceKey("draft-a"),
        closable: true,
      }],
      activeTabId: "draft",
    });

    expect(store.promoteConversationDraft({
      draftId: "draft-a",
      sessionId: "analysis-a",
      title: "分析 Agent 运行耗时",
    })).toEqual(["source-a"]);

    const restarted = createRightSidebarTabsStore(storage);
    expect(restarted.read("source-a")).toEqual({
      tabs: [{
        id: "draft",
        type: "conversation",
        title: "分析 Agent 运行耗时",
        sourceKey: conversationTabSourceKey("analysis-a"),
        closable: true,
      }],
      activeTabId: "draft",
    });
  });

  it("removes a non-current archived sidebar chat from every host and preserves sibling selection", () => {
    const storage = new MemoryStorage();
    const store = createRightSidebarTabsStore(storage);
    store.write("source-a", {
      tabs: [
        {
          id: "analysis",
          type: "conversation",
          title: "分析",
          sourceKey: conversationTabSourceKey("analysis"),
          closable: true,
        },
        {
          id: "kept",
          type: "conversation",
          title: "保留的会话",
          sourceKey: conversationTabSourceKey("kept"),
          closable: true,
        },
      ],
      activeTabId: "kept",
    });
    store.write("source-b", {
      tabs: [{
        id: "analysis-again",
        type: "conversation",
        title: "分析",
        sourceKey: conversationTabSourceKey("analysis"),
        closable: true,
      }],
      activeTabId: "analysis-again",
    });

    store.removeSession("analysis");

    expect(store.read("source-a")).toMatchObject({
      tabs: [{ id: "kept", title: "保留的会话" }],
      activeTabId: "kept",
    });
    expect(store.read("source-b")).toEqual({ tabs: [], activeTabId: null });
  });
});

class MemoryStorage implements Storage {
  private readonly values = new Map<string, string>();
  get length(): number { return this.values.size; }
  clear(): void { this.values.clear(); }
  getItem(key: string): string | null { return this.values.get(key) ?? null; }
  key(index: number): string | null { return [...this.values.keys()][index] ?? null; }
  removeItem(key: string): void { this.values.delete(key); }
  setItem(key: string, value: string): void { this.values.set(key, value); }
}
