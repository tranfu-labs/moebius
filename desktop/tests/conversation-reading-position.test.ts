import { describe, expect, it } from "vitest";

import {
  createConversationReadingPositionStore,
  planRetainedConversationSessionIds,
} from "../src/console-page/conversation-reading-position.js";

describe("conversation reading position store", () => {
  it("isolates message anchors by root session", () => {
    const storage = memoryStorage();
    const store = createConversationReadingPositionStore(storage);
    store.write("session-a", 12);
    store.write("session-b", 44);
    expect(store.read("session-a")).toBe(12);
    expect(store.read("session-b")).toBe(44);
  });

  it("drops malformed state without blocking later writes", () => {
    const storage = memoryStorage();
    storage.setItem(
      "moebius.console.conversation-reading-positions",
      "{broken",
    );
    const store = createConversationReadingPositionStore(storage);
    expect(store.read("session-a")).toBeNull();
    store.write("session-a", 8);
    expect(store.read("session-a")).toBe(8);
  });

  it("removes positions for deleted sessions", () => {
    const storage = memoryStorage();
    const store = createConversationReadingPositionStore(storage);
    store.write("keep", 4);
    store.write("remove", 9);
    store.retain(["keep"]);
    expect(store.read("keep")).toBe(4);
    expect(store.read("remove")).toBeNull();
  });

  it("retains reading anchors only for root conversations", () => {
    expect(planRetainedConversationSessionIds({
      projects: [{ sessions: [
        { sessionId: "root", parentSessionId: null, analysisParentSessionId: null },
        { sessionId: "child", parentSessionId: "root", analysisParentSessionId: null },
        { sessionId: "analysis", parentSessionId: null, analysisParentSessionId: "root" },
      ] }],
    })).toEqual(["root"]);
    expect(planRetainedConversationSessionIds(null)).toEqual([]);
  });
});

function memoryStorage() {
  const values = new Map<string, string>();
  return {
    getItem(key: string) {
      return values.get(key) ?? null;
    },
    setItem(key: string, value: string) {
      values.set(key, value);
    },
    removeItem(key: string) {
      values.delete(key);
    },
  };
}
