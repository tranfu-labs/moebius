import { describe, expect, it } from "vitest";

import {
  createConsolePresentationRouteStore,
  ordinaryPresentationRoute,
  sidebarPresentationRoute,
} from "../src/console-page/presentation-route.js";

describe("console presentation route", () => {
  it("keeps sidebar chat selected while presenting its source in main content", () => {
    expect(sidebarPresentationRoute({
      sidebarProjectId: "project-b",
      sidebarSessionId: "analysis-b",
      originSessionId: "source-a",
      originAvailable: true,
    })).toEqual({
      version: 1,
      projectId: "project-b",
      selectedSessionId: "analysis-b",
      mainSessionId: "source-a",
      rightConversationSessionId: "analysis-b",
      hostSessionId: "source-a",
      notice: null,
    });
  });

  it("degrades an unavailable source to an ordinary main-content conversation and persists it", () => {
    const storage = new MemoryStorage();
    const store = createConsolePresentationRouteStore(storage);
    const route = sidebarPresentationRoute({
      sidebarProjectId: "project-b",
      sidebarSessionId: "analysis-b",
      originSessionId: "source-a",
      originAvailable: false,
    });
    store.write(route);
    expect(createConsolePresentationRouteStore(storage).read()).toEqual({
      ...route,
      mainSessionId: "analysis-b",
      rightConversationSessionId: null,
      hostSessionId: "analysis-b",
      notice: "source-unavailable",
    });
    expect(ordinaryPresentationRoute({ projectId: "project-a", sessionId: "source-a" }))
      .toMatchObject({ selectedSessionId: "source-a", mainSessionId: "source-a" });
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
