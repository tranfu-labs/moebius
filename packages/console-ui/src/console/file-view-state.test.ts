import { describe, expect, it } from "vitest";

import {
  decideInitialFileViewMode,
  isMarkdownFilePath,
  reduceFileReadState,
  reduceFileViewState,
} from "./file-view-state";

describe("file view state", () => {
  it("defaults bare workspace Markdown to preview and explicit locations to source", () => {
    expect(decideInitialFileViewMode({
      path: "README.md",
      scope: "workspace-file",
      hasExplicitLine: false,
    })).toBe("preview");
    expect(decideInitialFileViewMode({
      path: "README.md",
      scope: "workspace-file",
      hasExplicitLine: true,
    })).toBe("source");
  });

  it("starts refreshes from a clean snapshot and ignores stale success or failure", () => {
    const initial = {
      targetKey: "readme",
      generation: 1,
      loading: false,
      content: "V1" as string | null,
    };
    const refreshing = reduceFileReadState(initial, {
      type: "request-started",
      targetKey: "readme",
      generation: 2,
    });
    expect(refreshing).toEqual({ targetKey: "readme", generation: 2, loading: true, content: null });
    expect(reduceFileReadState(refreshing, {
      type: "request-succeeded",
      targetKey: "readme",
      generation: 1,
      content: "stale success",
    })).toBe(refreshing);
    expect(reduceFileReadState(refreshing, {
      type: "request-failed",
      targetKey: "other",
      generation: 2,
      content: "stale failure",
    })).toBe(refreshing);
    expect(reduceFileReadState(refreshing, {
      type: "request-succeeded",
      targetKey: "readme",
      generation: 2,
      content: "V2",
    })).toEqual({ targetKey: "readme", generation: 2, loading: false, content: "V2" });
  });

  it("keeps external previews and non-Markdown files in source mode", () => {
    expect(decideInitialFileViewMode({
      path: "/tmp/README.md",
      scope: "external-preview",
      hasExplicitLine: false,
      rememberedMode: "preview",
    })).toBe("source");
    expect(decideInitialFileViewMode({
      path: "src/app.ts",
      scope: "workspace-file",
      hasExplicitLine: false,
      rememberedMode: "preview",
    })).toBe("source");
    expect(isMarkdownFilePath("guide.MarkDown")).toBe(true);
  });

  it("uses a remembered mode only after the explicit-line first-open rule has been satisfied", () => {
    expect(decideInitialFileViewMode({
      path: "README.md",
      scope: "workspace-file",
      hasExplicitLine: true,
      rememberedMode: "preview",
    })).toBe("preview");

    const switched = reduceFileViewState(
      { targetKey: "readme:42", mode: "source", userSelected: false },
      { type: "mode-selected", mode: "preview" },
    );
    expect(switched).toEqual({ targetKey: "readme:42", mode: "preview", userSelected: true });
    expect(reduceFileViewState(switched, {
      type: "target-changed",
      targetKey: "guide",
      path: "guide.md",
      scope: "workspace-file",
      hasExplicitLine: false,
    })).toEqual({ targetKey: "guide", mode: "preview", userSelected: false });
  });
});
