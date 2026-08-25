import { describe, expect, it } from "vitest";

import {
  conversationDraftTabSourceKey,
  conversationTabSourceKey,
  createRightSidebarTabsStore,
  LEGACY_RIGHT_SIDEBAR_TABS_DOCUMENT_KEY,
  RIGHT_SIDEBAR_TABS_DOCUMENT_KEY,
  rightSidebarTabsKey,
} from "../src/console-page/right-sidebar-tabs-store.js";
import { RIGHT_SIDEBAR_VISIBILITY_STORAGE_KEY } from "../src/console-page/right-sidebar-preference.js";

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

  it("migrates the legacy open preference only to the first active host", () => {
    const storage = new MemoryStorage();
    storage.setItem(LEGACY_RIGHT_SIDEBAR_TABS_DOCUMENT_KEY, JSON.stringify({
      version: 2,
      hosts: {
        "session-a": JSON.stringify({
          tabs: [{ id: "diff", type: "workspace-diff", title: "改动", sourceKey: null }],
          activeTabId: "diff",
        }),
        "session-b": JSON.stringify({
          tabs: [{ id: "files", type: "project-files", title: "项目文件", sourceKey: null }],
          activeTabId: "files",
        }),
      },
    }));
    storage.setItem(RIGHT_SIDEBAR_VISIBILITY_STORAGE_KEY, "open");

    const store = createRightSidebarTabsStore(storage);
    expect(store.readHostState("session-a")).toMatchObject({
      tabs: { activeTabId: "diff" },
      visibilityPreference: "open",
    });
    expect(store.readHostState("session-b")).toMatchObject({
      tabs: { activeTabId: "files" },
      visibilityPreference: "closed",
    });

    expect(storage.getItem(LEGACY_RIGHT_SIDEBAR_TABS_DOCUMENT_KEY)).not.toBeNull();
    expect(storage.getItem(RIGHT_SIDEBAR_VISIBILITY_STORAGE_KEY)).toBe("open");
    expect(JSON.parse(storage.getItem(RIGHT_SIDEBAR_TABS_DOCUMENT_KEY) ?? "{}"))
      .toMatchObject({
        version: 3,
        legacyVisibilityMigrated: true,
        hosts: {
          "session-a": { visibilityPreference: "open" },
          "session-b": { visibilityPreference: "closed" },
        },
      });
    expect(createRightSidebarTabsStore(storage).readHostState("session-a").visibilityPreference)
      .toBe("open");
  });

  it("keeps visibility with its host through tab writes, snapshots, restores, and cleanup", () => {
    const storage = new MemoryStorage();
    const store = createRightSidebarTabsStore(storage);
    store.writeVisibilityPreference("session-a", "open");
    store.write("session-a", {
      tabs: [{ id: "diff", type: "workspace-diff", title: "改动", sourceKey: null, closable: true }],
      activeTabId: "diff",
    });
    store.writeVisibilityPreference("session-b", "closed");

    const snapshot = store.snapshot?.();
    expect(snapshot).toMatchObject({
      version: 3,
      hosts: {
        "session-a": { visibilityPreference: "open" },
        "session-b": { visibilityPreference: "closed" },
      },
    });
    store.writeVisibilityPreference("session-a", "closed");
    store.clearHosts(["session-b"]);
    store.restore?.(snapshot!);

    const restarted = createRightSidebarTabsStore(storage);
    expect(restarted.readHostState("session-a")).toMatchObject({
      tabs: { activeTabId: "diff" },
      visibilityPreference: "open",
    });
    expect(restarted.readHostState("session-b").visibilityPreference).toBe("closed");

    restarted.clearHosts(["session-a"]);
    expect(createRightSidebarTabsStore(storage).readHostState("session-a").visibilityPreference)
      .toBe("closed");
  });

  it("keeps host state in memory when persistence is denied and retries it on a later write", () => {
    const storage = new MemoryStorage();
    const setItem = storage.setItem.bind(storage);
    let rejectWrites = true;
    storage.setItem = (key, value) => {
      if (rejectWrites) throw new Error("storage denied");
      setItem(key, value);
    };
    const store = createRightSidebarTabsStore(storage);

    store.writeVisibilityPreference("session-a", "open");
    store.write("session-a", {
      tabs: [{ id: "diff", type: "workspace-diff", title: "改动", sourceKey: null, closable: true }],
      activeTabId: "diff",
    });
    expect(store.readHostState("session-a")).toMatchObject({
      tabs: { activeTabId: "diff" },
      visibilityPreference: "open",
    });

    rejectWrites = false;
    store.writeVisibilityPreference("session-b", "open");

    const restarted = createRightSidebarTabsStore(storage);
    expect(restarted.readHostState("session-a")).toMatchObject({
      tabs: { activeTabId: "diff" },
      visibilityPreference: "open",
    });
    expect(restarted.readHostState("session-b").visibilityPreference).toBe("open");
  });

  it("restores the selected Markdown mode on a file-reference tab", () => {
    const storage = new MemoryStorage();
    const store = createRightSidebarTabsStore(storage);
    store.write("session-a", {
      tabs: [{
        id: "readme",
        type: "file-reference",
        title: "README.md",
        sourceKey: "file-reference:v2:session-a:%2Fworkspace%2FREADME.md:1::0",
        closable: true,
        fileMode: "source",
      }],
      activeTabId: "readme",
    });

    expect(createRightSidebarTabsStore(storage).read("session-a").tabs[0]).toMatchObject({
      type: "file-reference",
      fileMode: "source",
    });
  });

  it("restores per-path Markdown modes on a project-files tab", () => {
    const storage = new MemoryStorage();
    const store = createRightSidebarTabsStore(storage);
    store.write("session-a", {
      tabs: [{
        id: "files",
        type: "project-files",
        title: "项目文件",
        sourceKey: null,
        closable: true,
        projectFileModes: { "README.md": "source", "docs/guide.markdown": "preview" },
      }],
      activeTabId: "files",
    });

    expect(createRightSidebarTabsStore(storage).read("session-a").tabs[0]).toMatchObject({
      type: "project-files",
      projectFileModes: { "README.md": "source", "docs/guide.markdown": "preview" },
    });
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

  it("defaults malformed v3 host state to closed without reading a stale v2 document", () => {
    const storage = new MemoryStorage();
    storage.setItem(LEGACY_RIGHT_SIDEBAR_TABS_DOCUMENT_KEY, JSON.stringify({
      version: 2,
      hosts: {
        "session-a": JSON.stringify({
          tabs: [{ id: "legacy", type: "project-files", title: "项目文件", sourceKey: null }],
          activeTabId: "legacy",
        }),
      },
    }));
    storage.setItem(RIGHT_SIDEBAR_TABS_DOCUMENT_KEY, JSON.stringify({
      version: 3,
      legacyVisibilityMigrated: true,
      hosts: {
        "session-a": { tabs: "{", visibilityPreference: "open" },
        "session-b": { tabs: { tabs: [], activeTabId: null }, visibilityPreference: "unexpected" },
      },
    }));

    const store = createRightSidebarTabsStore(storage);
    expect(store.readHostState("session-a")).toEqual({
      tabs: { tabs: [], activeTabId: null },
      visibilityPreference: "open",
    });
    expect(store.readHostState("session-b").visibilityPreference).toBe("closed");
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
      conversationContext: "Moebius · feature/sidebar",
      conversationCreatedAt: "2026-07-30T09:15:00.000Z",
    })).toEqual(["source-a"]);

    const restarted = createRightSidebarTabsStore(storage);
    expect(restarted.read("source-a")).toEqual({
      tabs: [{
        id: "draft",
        type: "conversation",
        title: "分析 Agent 运行耗时",
        sourceKey: conversationTabSourceKey("analysis-a"),
        closable: true,
        conversationContext: "Moebius · feature/sidebar",
        conversationCreatedAt: "2026-07-30T09:15:00.000Z",
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

  it("renames one conversation in every visible or retained host without changing tab identity", () => {
    const storage = new MemoryStorage();
    const store = createRightSidebarTabsStore(storage);
    for (const hostId of ["visible-host", "retained-host"]) {
      store.write(hostId, {
        tabs: [{
          id: `${hostId}-tab`,
          type: "conversation",
          title: "原标题",
          sourceKey: conversationTabSourceKey("renamed-session"),
          closable: true,
        }],
        activeTabId: `${hostId}-tab`,
      });
    }

    expect(store.renameConversation("renamed-session", "新标题"))
      .toEqual(["visible-host", "retained-host"]);
    const restarted = createRightSidebarTabsStore(storage);
    expect(restarted.read("visible-host")).toMatchObject({
      tabs: [{ id: "visible-host-tab", title: "新标题" }],
      activeTabId: "visible-host-tab",
    });
    expect(restarted.read("retained-host")).toMatchObject({
      tabs: [{ id: "retained-host-tab", title: "新标题" }],
      activeTabId: "retained-host-tab",
    });
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
