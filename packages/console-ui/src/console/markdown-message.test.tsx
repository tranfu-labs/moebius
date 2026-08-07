import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { MarkdownMessage, safeMarkdownUrlTransform } from "./markdown-message";
import type { MarkdownFileReference } from "./markdown-internal-reference";

describe("MarkdownMessage", () => {
  it("renders user and agent Markdown with GFM structure", () => {
    render(
      <MarkdownMessage
        content={[
          "# 标题",
          "",
          "**加粗**、`inline` 与 ~~删除~~",
          "",
          "> 引用",
          "",
          "| 能力 | 状态 |",
          "| --- | --- |",
          "| Markdown | 完成 |",
          "",
          "- [x] 任务列表",
        ].join("\n")}
      />,
    );

    expect(screen.getByRole("heading", { name: "标题" })).toBeInTheDocument();
    expect(screen.getByText("加粗")).toHaveAttribute("data-streamdown", "strong");
    expect(screen.getByText("inline").tagName).toBe("CODE");
    expect(screen.getByRole("table")).toHaveTextContent("Markdown");
    expect(screen.getByRole("checkbox")).toBeChecked();
  });

  it("sanitizes raw HTML and blocks dangerous URL schemes", () => {
    const { container } = render(
      <MarkdownMessage
        content={'<script>alert(1)</script>\n\n<iframe src="https://example.com"></iframe>\n\n<img src="data:image/png;base64,x" onerror="alert(2)">\n\n[危险](javascript:alert(3)) [本地](file:///tmp/a)'}
      />,
    );

    expect(container.querySelector("script")).toBeNull();
    expect(container.querySelector("iframe")).toBeNull();
    expect(container.querySelector("img")).toBeNull();
    expect(container.querySelector('[href^="javascript:"]')).toBeNull();
    expect(container.querySelector('[href^="file:"]')).toBeNull();
    expect(container).toHaveTextContent("危险");
    expect(container).toHaveTextContent("本地");
  });

  it("preserves machine text and opens bare or inline-code absolute paths", () => {
    const onOpenFileReference = vi.fn();
    const { container } = render(
      <MarkdownMessage
        content={[
          "正文 /Users/wing/private.txt，Send a direct message before handoff.",
          "",
          "`/tmp/private-run:4`",
          "",
          "```text",
          "cwd=/home/user/secret runId=run-secret worktree",
          "```",
          "",
          "<span>/opt/moebius/output.txt</span>",
        ].join("\n")}
        onOpenFileReference={onOpenFileReference}
      />,
    );

    expect(container).toHaveTextContent("/Users/wing/private.txt");
    expect(container).toHaveTextContent("Send a direct message before handoff.");
    expect(container).toHaveTextContent("cwd=/home/user/secret runId=run-secret worktree");
    expect(container).toHaveTextContent("/opt/moebius/output.txt");

    fireEvent.click(screen.getByRole("button", { name: "/Users/wing/private.txt" }));
    fireEvent.click(screen.getByRole("button", { name: "/tmp/private-run:4" }));
    expect(onOpenFileReference.mock.calls).toEqual([
      [{ path: "/Users/wing/private.txt", line: 1, column: null, hasExplicitLine: false }],
      [{ path: "/tmp/private-run", line: 4, column: null, hasExplicitLine: true }],
    ]);
    expect(screen.queryByRole("button", { name: "/home/user/secret" })).not.toBeInTheDocument();
  });

  it("keeps root-only targets as text while later paths and mentions stay interactive", () => {
    const onOpenFileReference = vi.fn();
    const onOpenTeamMember = vi.fn();
    render(
      <MarkdownMessage
        content={[
          "单独 /",
          "",
          "A / B",
          "",
          "`/`",
          "",
          "[根目标](/)",
          "",
          "目录 /tmp，无扩展名 /tmp/moebius-output，尚未创建 /tmp/not-created-yet:2:3，请 @implementer 复核。",
        ].join("\n")}
        memberIdentities={[{ slug: "implementer", displayName: "实现者" }]}
        onOpenFileReference={onOpenFileReference}
        onOpenTeamMember={onOpenTeamMember}
      />,
    );

    expect(screen.getByText("单独 /", { exact: true })).toBeVisible();
    expect(screen.getByText("A / B", { exact: true })).toBeVisible();
    expect(screen.getByText("/", { selector: "code" })).toBeVisible();
    expect(screen.queryByRole("button", { name: "/" })).not.toBeInTheDocument();
    expect(screen.getByText("根目标", { exact: true })).toBeVisible();
    expect(screen.queryByRole("button", { name: "根目标" })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "/tmp" }));
    fireEvent.click(screen.getByRole("button", { name: "/tmp/moebius-output" }));
    fireEvent.click(screen.getByRole("button", { name: "/tmp/not-created-yet:2:3" }));
    fireEvent.click(screen.getByRole("button", { name: "@实现者" }));

    expect(onOpenFileReference.mock.calls).toEqual([
      [{ path: "/tmp", line: 1, column: null, hasExplicitLine: false }],
      [{ path: "/tmp/moebius-output", line: 1, column: null, hasExplicitLine: false }],
      [{ path: "/tmp/not-created-yet", line: 2, column: 3, hasExplicitLine: true }],
    ]);
    expect(onOpenTeamMember).toHaveBeenCalledWith("implementer");
  });

  it("uses the normalized path rather than the raw target to qualify file references", () => {
    const onOpenFileReference = vi.fn();
    render(
      <MarkdownMessage
        content={[
          "[根行号](/:2)",
          "[点路径](/./)",
          "[父级归根](/tmp/..)",
          "[规范化有效](/tmp/../var/log)",
        ].join(" ")}
        onOpenFileReference={onOpenFileReference}
      />,
    );

    for (const label of ["根行号", "点路径", "父级归根"]) {
      expect(screen.getByText(label, { exact: true })).toBeVisible();
      expect(screen.queryByRole("button", { name: label })).not.toBeInTheDocument();
    }

    fireEvent.click(screen.getByRole("button", { name: "规范化有效" }));
    expect(onOpenFileReference).toHaveBeenCalledOnce();
    expect(onOpenFileReference).toHaveBeenCalledWith({
      path: "/var/log",
      line: 1,
      column: null,
      hasExplicitLine: false,
    });
  });

  it("confirms a safe external link and never calls window.open", () => {
    const onOpenExternalLink = vi.fn();
    const windowOpen = vi.spyOn(window, "open").mockImplementation(() => null);
    render(
      <MarkdownMessage
        content="[官方文档](https://example.com/docs?q=1)"
        onOpenExternalLink={onOpenExternalLink}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "官方文档" }));
    expect(screen.getByRole("dialog", { name: "确认打开外部链接" })).toHaveTextContent("https://example.com/docs?q=1");
    fireEvent.click(screen.getByRole("button", { name: /打开链接/u }));

    expect(onOpenExternalLink).toHaveBeenCalledWith("https://example.com/docs?q=1");
    expect(windowOpen).not.toHaveBeenCalled();
    windowOpen.mockRestore();
  });

  it("keeps safe URL transformation limited to supported link and image protocols", () => {
    expect(safeMarkdownUrlTransform("https://example.com/a.png", "src")).toBe("https://example.com/a.png");
    expect(safeMarkdownUrlTransform("mailto:user@example.com", "href")).toBe("mailto:user@example.com");
    expect(safeMarkdownUrlTransform("#note-1", "href")).toBe("#note-1");
    expect(safeMarkdownUrlTransform("data:image/png;base64,x", "src")).toBeNull();
    expect(safeMarkdownUrlTransform("blob:https://example.com/id", "src")).toBeNull();
    expect(safeMarkdownUrlTransform("https://example.com", "poster")).toBeNull();
  });

  it("opens an absolute Markdown file target through the internal callback", () => {
    const onOpenFileReference = vi.fn();
    const onOpenExternalLink = vi.fn();
    render(
      <MarkdownMessage
        content="[会话记录 (line 292)](/Users/wing/.codex/sessions/day/rollout.jsonl:292:7)"
        onOpenFileReference={onOpenFileReference}
        onOpenExternalLink={onOpenExternalLink}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "会话记录 (line 292)" }));

    expect(onOpenFileReference).toHaveBeenCalledWith({
      path: "/Users/wing/.codex/sessions/day/rollout.jsonl",
      line: 292,
      column: 7,
      hasExplicitLine: true,
    });
    expect(onOpenExternalLink).not.toHaveBeenCalled();
    expect(screen.queryByRole("dialog", { name: "确认打开外部链接" })).not.toBeInTheDocument();
  });

  it("routes public moebius conversation references internally and rejects malformed targets", () => {
    const onOpenConversationReference = vi.fn();
    const onOpenExternalLink = vi.fn();
    render(
      <MarkdownMessage
        content={[
          "[目标消息](moebius-ref:message/local%3Asource/17)",
          "[坏引用](moebius-ref:message/local%3Asource/not-a-number)",
        ].join(" ")}
        onOpenConversationReference={onOpenConversationReference}
        onOpenExternalLink={onOpenExternalLink}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "目标消息" }));

    expect(onOpenConversationReference).toHaveBeenCalledWith({
      scope: "message",
      sessionId: "local:source",
      messageId: 17,
    });
    expect(screen.getByText("坏引用")).not.toHaveAttribute("href");
    expect(onOpenExternalLink).not.toHaveBeenCalled();
  });

  it("only treats parsed Markdown link nodes as conversation references", () => {
    const onOpenConversationReference = vi.fn();
    render(
      <MarkdownMessage
        content={[
          "\\[转义文本](moebius-ref:conversation/escaped)",
          "`[代码](moebius-ref:conversation/code)`",
          "![图片](moebius-ref:conversation/image)",
          "<span data-reference=\"[HTML 属性](moebius-ref:conversation/html)\">普通文本</span>",
          "[有效引用](moebius-ref:conversation/source)",
        ].join("\n\n")}
        onOpenConversationReference={onOpenConversationReference}
      />,
    );

    expect(screen.getByRole("button", { name: "有效引用" })).toBeVisible();
    expect(screen.queryByRole("button", { name: /转义文本|代码|图片|HTML 属性/u })).not.toBeInTheDocument();
  });

  it("keeps sentence punctuation outside a bare path and blocks file URLs", () => {
    const onOpenFileReference = vi.fn();
    render(
      <MarkdownMessage
        content={"产物位于 /tmp/report(1).txt:12:3，请查看；file:///tmp/blocked.txt 不可打开。"}
        onOpenFileReference={onOpenFileReference}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "/tmp/report(1).txt:12:3" }));
    expect(onOpenFileReference).toHaveBeenCalledWith({
      path: "/tmp/report(1).txt",
      line: 12,
      column: 3,
      hasExplicitLine: true,
    });
    expect(screen.getByText((_text, element) =>
      element?.tagName === "P"
      && element.textContent === "产物位于 /tmp/report(1).txt:12:3，请查看；file:///tmp/blocked.txt 不可打开。")).toBeVisible();
    expect(screen.queryByRole("button", { name: /blocked/u })).not.toBeInTheDocument();
  });

  it.each([
    ["伪装文件", "https://file-reference.moebius.invalid/open?path=%2Ftmp%2Fa&line=1"],
    ["伪装成员", "https://member-mention.moebius.invalid/open/implementer"],
  ])("keeps user-authored internal-looking HTTPS links in the external flow: %s", (label, url) => {
    const onOpenExternalLink = vi.fn();
    const onOpenFileReference = vi.fn();
    const onOpenTeamMember = vi.fn();
    render(
      <MarkdownMessage
        content={`[${label}](${url})`}
        onOpenExternalLink={onOpenExternalLink}
        onOpenFileReference={onOpenFileReference}
        memberIdentities={[{ slug: "implementer", displayName: "实现者" }]}
        onOpenTeamMember={onOpenTeamMember}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: label }));

    expect(screen.getByRole("dialog", { name: "确认打开外部链接" })).toHaveTextContent(url);
    expect(onOpenFileReference).not.toHaveBeenCalled();
    expect(onOpenTeamMember).not.toHaveBeenCalled();
  });

  it("renders known member mentions with display names and leaves unknown or code mentions alone", () => {
    const onOpenTeamMember = vi.fn();
    render(
      <MarkdownMessage
        content={"请 @implementer 接手，@unknown 保持原样，`@implementer` 不变。\n\n[已有链接 @implementer](https://example.com)"}
        memberIdentities={[{ slug: "implementer", displayName: "实现者" }]}
        onOpenTeamMember={onOpenTeamMember}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "@实现者" }));

    expect(onOpenTeamMember).toHaveBeenCalledWith("implementer");
    expect(screen.getByText((content) => content.includes("@unknown"))).toBeInTheDocument();
    expect(screen.getByText("@implementer", { selector: "code" })).toBeInTheDocument();
    expect(screen.getByText("已有链接 @implementer")).toBeInTheDocument();
  });

  it("uses the runtime ASCII mention boundary next to Chinese text", () => {
    const onOpenTeamMember = vi.fn();
    render(
      <MarkdownMessage
        content="请@implementer接手"
        memberIdentities={[{ slug: "implementer", displayName: "实现者" }]}
        onOpenTeamMember={onOpenTeamMember}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "@实现者" }));

    expect(onOpenTeamMember).toHaveBeenCalledWith("implementer");
    expect(screen.getByText((_text, element) =>
      element?.tagName === "P" && element.textContent === "请@实现者接手")).toBeInTheDocument();
  });

  it.each<[string, string, MarkdownFileReference]>([
    ["工程文件在/工程/笔记.md", "/工程/笔记.md", { path: "/工程/笔记.md", line: 1, column: null, hasExplicitLine: false }],
    ["产物在/Users/wing/app.ts", "/Users/wing/app.ts", { path: "/Users/wing/app.ts", line: 1, column: null, hasExplicitLine: false }],
    ["见/src/index.ts:42", "/src/index.ts:42", { path: "/src/index.ts", line: 42, column: null, hasExplicitLine: true }],
    ["产物在 /Users/wing/app.ts 里", "/Users/wing/app.ts", { path: "/Users/wing/app.ts", line: 1, column: null, hasExplicitLine: false }],
    ["见 /src/index.ts:42:7", "/src/index.ts:42:7", { path: "/src/index.ts", line: 42, column: 7, hasExplicitLine: true }],
    ["路径是 /a/b.ts。", "/a/b.ts", { path: "/a/b.ts", line: 1, column: null, hasExplicitLine: false }],
    ["[说明](/docs/a.md)", "说明", { path: "/docs/a.md", line: 1, column: null, hasExplicitLine: false }],
  ])("links the bare absolute path in %s", (content, buttonName, expected) => {
    const onOpenFileReference = vi.fn();
    render(
      <MarkdownMessage
        content={content}
        onOpenFileReference={onOpenFileReference}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: buttonName }));

    expect(onOpenFileReference).toHaveBeenCalledOnce();
    expect(onOpenFileReference).toHaveBeenCalledWith(expected);
  });

  it("links every absolute path in a command line", () => {
    const onOpenFileReference = vi.fn();
    render(
      <MarkdownMessage
        content="rm -rf /tmp/cache && node /app/x.js"
        onOpenFileReference={onOpenFileReference}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "/tmp/cache" }));
    fireEvent.click(screen.getByRole("button", { name: "/app/x.js" }));

    expect(onOpenFileReference.mock.calls).toEqual([
      [{ path: "/tmp/cache", line: 1, column: null, hasExplicitLine: false }],
      [{ path: "/app/x.js", line: 1, column: null, hasExplicitLine: false }],
    ]);
  });

  it.each([
    "在我构建过程中被另一个正在运行的进程/会话实时修改（i18n 文件",
    "成本/收益如何计算",
    "性能/价格 权衡",
    "成本/收益ROI计算",
    "正则 /\\d+/ 匹配数字",
    "参考 https：/example.com/a",
    "家目录 ~/projects/x",
    "取 /2 作为系数",
    "（1 /2）作为系数",
  ])("keeps the natural-language slash in %s as plain text", (content) => {
    render(
      <MarkdownMessage
        content={content}
        onOpenFileReference={vi.fn()}
      />,
    );

    expect(screen.getByText(content, { exact: true })).toBeVisible();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("keeps a slash inside emphasis as plain text", () => {
    render(
      <MarkdownMessage
        content="*强调/强调*"
        onOpenFileReference={vi.fn()}
      />,
    );

    expect(screen.getByText("强调/强调")).toBeVisible();
    expect(screen.queryByRole("button", { name: "/强调" })).not.toBeInTheDocument();
  });

  it("keeps full-width parentheses outside a bare path", () => {
    const onOpenFileReference = vi.fn();
    render(
      <MarkdownMessage
        content="/tmp/a（备份）"
        onOpenFileReference={onOpenFileReference}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "/tmp/a" }));

    expect(onOpenFileReference).toHaveBeenCalledOnce();
    expect(onOpenFileReference).toHaveBeenCalledWith({
      path: "/tmp/a",
      line: 1,
      column: null,
      hasExplicitLine: false,
    });
    expect(screen.getByText((_text, element) =>
      element?.tagName === "P" && element.textContent === "/tmp/a（备份）")).toBeVisible();
  });

  it("keeps dates, fractions and HTTPS URLs outside file-reference detection", () => {
    const onOpenFileReference = vi.fn();
    const onOpenExternalLink = vi.fn();
    render(
      <MarkdownMessage
        content="日期 2026/08/07 与分数 1/2、(1/2)，外链 https://example.com/a"
        onOpenFileReference={onOpenFileReference}
        onOpenExternalLink={onOpenExternalLink}
      />,
    );

    expect(screen.getByText((_text, element) =>
      element?.tagName === "P"
      && element.textContent === "日期 2026/08/07 与分数 1/2、(1/2)，外链 https://example.com/a")).toBeVisible();
    expect(screen.queryByRole("button", { name: /^\// })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "https://example.com/a" }));
    fireEvent.click(screen.getByRole("button", { name: /打开链接/u }));

    expect(onOpenFileReference).not.toHaveBeenCalled();
    expect(onOpenExternalLink).toHaveBeenCalledWith("https://example.com/a");
  });
});
