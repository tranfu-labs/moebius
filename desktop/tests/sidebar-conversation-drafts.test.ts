import { describe, expect, it } from "vitest";

import {
  createSidebarConversationDraft,
  createSidebarConversationDraftStore,
  sidebarConversationDraftHasUserChanges,
} from "../src/console-page/sidebar-conversation-drafts.js";

describe("sidebar conversation draft store", () => {
  it("persists static fragments and merges only the matching unsent analysis draft", () => {
    const storage = new MemoryStorage();
    const store = createSidebarConversationDraftStore(storage);
    const draft = createSidebarConversationDraft({
      draftId: "draft-a",
      hostSessionId: "source-a",
      originSessionId: "source-a",
      entryTemplate: "session-analysis",
      context: {
        projectId: "project-a",
        workspaceMode: "worktree",
        teamKey: "system:general-assistant",
      },
      now: "2026-07-29T00:00:00.000Z",
    });
    store.write({
      ...draft,
      textFragments: [
        { id: "fragment-a", label: "文本片段 1", text: "会话 A 对应 Codex B" },
      ],
    });

    const restarted = createSidebarConversationDraftStore(storage);
    expect(restarted.findMergeable({
      hostSessionId: "source-a",
      originSessionId: "source-a",
      initialProjectId: "project-a",
      initialWorkspaceMode: "worktree",
      entryTemplate: "session-analysis",
    })).toMatchObject({
      draftId: "draft-a",
      textFragments: [{ id: "fragment-a", text: "会话 A 对应 Codex B" }],
    });
    expect(restarted.findMergeable({
      hostSessionId: "source-b",
      originSessionId: "source-b",
      initialProjectId: "project-a",
      initialWorkspaceMode: "worktree",
      entryTemplate: "session-analysis",
    })).toBeNull();
  });

  it("asks to discard only when the final draft differs from its system defaults", () => {
    const draft = createSidebarConversationDraft({
      draftId: "draft-a",
      hostSessionId: "source-a",
      originSessionId: null,
      entryTemplate: null,
      context: {
        projectId: "project-a",
        workspaceMode: "direct",
        teamKey: "system:general-assistant",
      },
      now: "2026-07-29T00:00:00.000Z",
    });
    expect(sidebarConversationDraftHasUserChanges(draft)).toBe(false);
    expect(sidebarConversationDraftHasUserChanges({
      ...draft,
      context: { ...draft.context, teamKey: "user:custom" },
    })).toBe(true);
    expect(sidebarConversationDraftHasUserChanges({
      ...draft,
      context: { ...draft.context, teamKey: "system:general-assistant" },
    })).toBe(false);
    expect(sidebarConversationDraftHasUserChanges({
      ...draft,
      textFragments: [{ id: "f", label: "文本片段 1", text: "线索" }],
    })).toBe(true);
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
