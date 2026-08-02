import { describe, expect, it } from "vitest";

import {
  conversationDraftTabSourceKey,
  conversationTabSourceKey,
  decidePromoteConversationDraft,
  decideRemoveConversation,
  type RightSidebarTabsByHost,
} from "../src/console-page/right-sidebar-tabs-model.js";

describe("right sidebar tabs model", () => {
  it("promotes only matching drafts while preserving each host selection", () => {
    const hosts = tabsByHost({
      "host-a": ["draft-a", "kept"],
      "host-b": ["draft-a"],
      "host-c": ["other-draft"],
    });

    const decision = decidePromoteConversationDraft(hosts, {
      draftId: "draft-a",
      sessionId: "session-a",
      title: "分析结果",
      conversationContext: "Moebius · main",
    });

    expect(decision.updatedHostIds).toEqual(["host-a", "host-b"]);
    expect(decision.hosts["host-a"]).toMatchObject({
      activeTabId: "draft-a",
      tabs: [
        { sourceKey: conversationTabSourceKey("session-a"), title: "分析结果" },
        { sourceKey: conversationDraftTabSourceKey("kept") },
      ],
    });
    expect(decision.hosts["host-c"]).toBe(hosts["host-c"]);
  });

  it("removes a conversation host and falls back only when the removed tab was active", () => {
    const hosts: RightSidebarTabsByHost = {
      removed: { tabs: [], activeTabId: null },
      "active-host": {
        tabs: [conversationTab("removed"), conversationTab("kept")],
        activeTabId: "removed",
      },
      "sibling-host": {
        tabs: [conversationTab("removed"), conversationTab("kept")],
        activeTabId: "kept",
      },
    };

    const result = decideRemoveConversation(hosts, "removed");

    expect(result.removed).toBeUndefined();
    expect(result["active-host"]).toMatchObject({
      tabs: [{ id: "kept" }],
      activeTabId: "kept",
    });
    expect(result["sibling-host"]).toMatchObject({
      tabs: [{ id: "kept" }],
      activeTabId: "kept",
    });
  });
});

function tabsByHost(entries: Record<string, readonly string[]>): RightSidebarTabsByHost {
  return Object.fromEntries(Object.entries(entries).map(([hostId, draftIds]) => [
    hostId,
    {
      tabs: draftIds.map((draftId) => ({
        id: draftId,
        type: "conversation" as const,
        title: draftId,
        sourceKey: conversationDraftTabSourceKey(draftId),
        closable: true as const,
      })),
      activeTabId: draftIds[0] ?? null,
    },
  ]));
}

function conversationTab(sessionId: string) {
  return {
    id: sessionId,
    type: "conversation" as const,
    title: sessionId,
    sourceKey: conversationTabSourceKey(sessionId),
    closable: true as const,
  };
}
