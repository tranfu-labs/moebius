import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { MarkdownMessage, safeMarkdownUrlTransform } from "./markdown-message";

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
      [{ path: "/Users/wing/private.txt", line: 1, column: null }],
      [{ path: "/tmp/private-run", line: 4, column: null }],
    ]);
    expect(screen.queryByRole("button", { name: "/home/user/secret" })).not.toBeInTheDocument();
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
});
