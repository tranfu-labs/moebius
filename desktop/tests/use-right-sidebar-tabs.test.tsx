/** @vitest-environment jsdom */

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  readRightSidebarVisibilityPreference,
  readRightSidebarWidthPreference,
} from "../src/console-page/right-sidebar-preference.js";
import { createRightSidebarTabsStore } from "../src/console-page/right-sidebar-tabs-store.js";
import { createSidebarConversationDraftStore } from "../src/console-page/sidebar-conversation-drafts.js";
import {
  useRightSidebarTabs,
  type RightSidebarTabsBundle,
} from "../src/console-page/use-right-sidebar-tabs.js";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe("right sidebar tabs controller", () => {
  let host: HTMLDivElement;
  let root: Root;
  let latest: RightSidebarTabsBundle;
  let storage: MemoryStorage;
  let tabsStore: ReturnType<typeof createRightSidebarTabsStore>;
  let draftStore: ReturnType<typeof createSidebarConversationDraftStore>;

  beforeEach(() => {
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
    storage = new MemoryStorage();
    tabsStore = createRightSidebarTabsStore(storage);
    draftStore = createSidebarConversationDraftStore(storage);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    host.remove();
  });

  it("owns draft-backed tab changes, preferences, and host switching across parent rerenders", async () => {
    tabsStore.write("host-b", {
      tabs: [{ id: "files", type: "project-files", title: "项目文件", sourceKey: null, closable: true }],
      activeTabId: "files",
    });
    const firstCommit = vi.fn();
    await render("host-a", firstCommit);
    expect(latest.width).toBeNull();
    expect(latest.visibilityPreference).toBe("closed");

    act(() => latest.changeTabs({
      tabs: [{ id: "conversation", type: "conversation", title: "新会话", sourceKey: null, closable: true }],
      activeTabId: "conversation",
    }));
    expect(latest.state.tabs[0]?.sourceKey).toMatch(/^conversation-draft:/u);
    expect(draftStore.list()).toMatchObject([{
      hostSessionId: "host-a",
      originSessionId: "selected-a",
      context: {
        projectId: "project-a",
        workspaceMode: "worktree",
        teamKey: "system:general-assistant",
      },
    }]);
    expect(firstCommit).toHaveBeenCalledOnce();

    act(() => {
      latest.setOpen(true);
      latest.changeWidth(517);
    });
    expect(tabsStore.readHostState("host-a").visibilityPreference).toBe("open");
    expect(readRightSidebarVisibilityPreference(storage)).toBe("closed");
    expect(readRightSidebarWidthPreference(storage)).toBe(517);

    const replacementCommit = vi.fn();
    await render("host-b", replacementCommit);
    expect(latest.state).toMatchObject({
      tabs: [{ id: "files", type: "project-files" }],
      activeTabId: "files",
    });
    expect(latest.visibilityPreference).toBe("closed");
    act(() => latest.setOpen(true));
    expect(tabsStore.readHostState("host-b").visibilityPreference).toBe("open");
    expect(tabsStore.readHostState("host-a").visibilityPreference).toBe("open");

    act(() => latest.changeTabs({ tabs: [], activeTabId: null }));
    expect(firstCommit).toHaveBeenCalledOnce();
    expect(replacementCommit).not.toHaveBeenCalled();
    expect(tabsStore.read("host-b")).toEqual({ tabs: [], activeTabId: null });

    await render("host-a", vi.fn());
    expect(latest.visibilityPreference).toBe("open");
  });

  it("writes a visibility change to the host shown before its parent rerenders", async () => {
    tabsStore.write("host-b", {
      tabs: [{ id: "files", type: "project-files", title: "项目文件", sourceKey: null, closable: true }],
      activeTabId: "files",
    });
    await render("host-a", vi.fn());
    act(() => latest.setOpen(true));

    act(() => latest.showHost("host-b"));
    expect(latest.visibilityPreference).toBe("closed");
    act(() => latest.setOpen(false));

    expect(tabsStore.readHostState("host-a").visibilityPreference).toBe("open");
    expect(tabsStore.readHostState("host-b").visibilityPreference).toBe("closed");
  });

  async function render(hostSessionId: string, commitDrafts: ReturnType<typeof vi.fn>): Promise<void> {
    await act(async () => root.render(
      <Harness hostSessionId={hostSessionId} commitDrafts={commitDrafts} />,
    ));
  }

  function Harness({
    hostSessionId,
    commitDrafts,
  }: {
    hostSessionId: string;
    commitDrafts: ReturnType<typeof vi.fn>;
  }): null {
    latest = useRightSidebarTabs(
      storage,
      tabsStore,
      hostSessionId,
      { sessionId: "selected-a", projectId: "project-a", workspaceMode: "worktree" },
      "project-a",
      "system:general-assistant",
      draftStore,
      commitDrafts,
    );
    return null;
  }
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
