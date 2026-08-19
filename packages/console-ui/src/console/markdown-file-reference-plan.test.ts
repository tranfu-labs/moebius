import { describe, expect, it } from "vitest";
import {
  collectMarkdownFileReferenceCandidates,
  parseMarkdownFileReference,
  scanBareFileReferenceSpans,
} from "./markdown-file-reference-plan.js";

describe("markdown file reference plan", () => {
  it("parses absolute references with optional line and column", () => {
    expect(parseMarkdownFileReference("/docs/plan.md:12:4")).toEqual({
      path: "/docs/plan.md",
      line: 12,
      column: 4,
      hasExplicitLine: true,
    });
    expect(parseMarkdownFileReference("/docs/plan.md:12")).toEqual({
      path: "/docs/plan.md",
      line: 12,
      column: null,
      hasExplicitLine: true,
    });
    expect(parseMarkdownFileReference("/docs/plan.md")).toEqual({
      path: "/docs/plan.md",
      line: 1,
      column: null,
      hasExplicitLine: false,
    });
    expect(parseMarkdownFileReference("https://example.com/remote.png")).toBeNull();
    expect(parseMarkdownFileReference("file:///etc/hosts")).toBeNull();
    expect(parseMarkdownFileReference("../relative.png")).toBeNull();
    expect(parseMarkdownFileReference("/a/../b.png")).toEqual({ path: "/b.png", line: 1, column: null, hasExplicitLine: false });
  });

  it("collects ordered, deduplicated candidates from links, inline code, and bare paths", () => {
    const markdown = [
      "请看 [示意图](/docs/diagram.png:10) 与 `/docs/icon.svg`。",
      "再看一次 /docs/diagram.png 和裸路径 /docs/chart.png。",
      "最后是引用 [表格][table-ref]。",
      "",
      "[table-ref]: /docs/table.png",
    ].join("\n");
    const candidates = collectMarkdownFileReferenceCandidates(markdown);
    expect(candidates.map((candidate) => candidate.path)).toEqual([
      "/docs/diagram.png",
      "/docs/icon.svg",
      "/docs/chart.png",
      "/docs/table.png",
    ]);
  });

  it("never treats code blocks, HTML, images, or remote URLs as local image candidates", () => {
    const markdown = [
      "```ts",
      'const asset = "/generated/asset.png";',
      "```",
      "",
      '<img src="/html/logo.png" alt="logo" />',
      "",
      "![alt](/markdown/image.png)",
      "",
      "[remote](https://example.com/remote.png)",
      "",
      "正文 /docs/real.png",
    ].join("\n");
    const candidates = collectMarkdownFileReferenceCandidates(markdown);
    expect(candidates.map((candidate) => candidate.path)).toEqual(["/docs/real.png"]);
  });

  it("applies the same bare path shape gates as the rendering plugin", () => {
    const strict = collectMarkdownFileReferenceCandidates("这里写/docs/图标.png。/docs/无扩展名。");
    expect(strict.map((candidate) => candidate.path)).toEqual(["/docs/图标.png"]);
    const loose = collectMarkdownFileReferenceCandidates("参见 /docs/plan.md");
    expect(loose.map((candidate) => candidate.path)).toEqual(["/docs/plan.md"]);
  });

  it("keeps explicit line references and reports raw spans in order", () => {
    expect(scanBareFileReferenceSpans("A /one/two.png:3 B")).toEqual([{
      start: 2,
      end: 16,
      rawPath: "/one/two.png:3",
      reference: { path: "/one/two.png", line: 3, column: null, hasExplicitLine: true },
    }]);
  });
});
