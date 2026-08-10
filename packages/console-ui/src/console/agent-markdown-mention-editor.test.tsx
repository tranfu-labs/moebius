import { fireEvent, render, screen, within } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  AgentMarkdownMentionEditor,
  findAgentMentionTrigger,
  insertAgentMention,
  matchingAgentMentionMembers,
  segmentAgentMentions,
  type AgentMarkdownChangeMarker,
  type AgentMentionMember,
} from "./agent-markdown-mention-editor";

const teamMembers: AgentMentionMember[] = [
  { slug: "manager", displayName: "开发经理" },
  { slug: "dev", displayName: "开发" },
  { slug: "qa", displayName: "测试" },
];

afterEach(() => {
  vi.restoreAllMocks();
});

describe("agent mention text model", () => {
  it("finds a slug trigger and inserts only literal @slug text", () => {
    expect(findAgentMentionTrigger("交棒给 @de", 7)).toEqual({ start: 4, end: 7, query: "de" });
    expect(insertAgentMention("交棒给 @de", 7, "dev")).toEqual({
      value: "交棒给 @dev ",
      cursor: 9,
    });
  });

  it("matches only the members supplied by the current team", () => {
    expect(matchingAgentMentionMembers(teamMembers, "d")).toEqual([
      { slug: "dev", displayName: "开发" },
    ]);
    expect(matchingAgentMentionMembers(teamMembers, "security")).toEqual([]);
  });

  it("decorates exact member references without changing the source text", () => {
    const source = "请 @dev 实现，邮件 dev@example.com 不处理，@developer 也不处理。";
    const segments = segmentAgentMentions(source, teamMembers);

    expect(segments).toContainEqual({
      kind: "mention",
      member: { slug: "dev", displayName: "开发" },
    });
    expect(segments.map((segment) => segment.kind === "text" ? segment.text : `@${segment.member.slug}`).join(""))
      .toBe(source);
  });
});

describe("AgentMarkdownMentionEditor", () => {
  it("renders mention references as literal @slug text and preserves the source across a rename", () => {
    const onValueChange = vi.fn();
    const { rerender } = render(
      <AgentMarkdownMentionEditor
        value="交棒给 @dev。"
        members={teamMembers}
        label="AGENT.md"
        onValueChange={onValueChange}
      />,
    );

    const editor = screen.getByRole("textbox", { name: "AGENT.md" });
    expect(editor).toHaveAttribute("data-raw-markdown", "交棒给 @dev。");
    // Mentions render as plain editable text (`@slug`) — the contentEditable
    // region must never contain non-editable nodes (Chromium detaches them on
    // edit and React's next commit crashes); copy lives on the editor-level
    // CopyableAgentSlug entry instead.
    expect(editor).toHaveTextContent("交棒给 @dev。");

    rerender(
      <AgentMarkdownMentionEditor
        value="交棒给 @dev。"
        members={teamMembers.map((member) => member.slug === "dev"
          ? { ...member, displayName: "软件工程师" }
          : member)}
        label="AGENT.md"
        onValueChange={onValueChange}
      />,
    );

    expect(editor).toHaveTextContent("交棒给 @dev。");
    expect(editor).toHaveAttribute("data-raw-markdown", "交棒给 @dev。");
    expect(onValueChange).not.toHaveBeenCalled();
  });

  it("shows current-team completion results with both name and slug and inserts raw text", () => {
    const onValueChange = vi.fn();
    render(
      <AgentMarkdownMentionEditor
        value="下一步 @d"
        members={teamMembers}
        label="AGENT.md"
        onValueChange={onValueChange}
      />,
    );

    const editor = screen.getByRole("textbox", { name: "AGENT.md" });
    placeCaretAtEnd(editor);
    fireEvent.focus(editor);
    fireEvent.keyUp(editor, { key: "d" });

    const listbox = screen.getByRole("listbox", { name: "团队成员提及补全" });
    const option = within(listbox).getByRole("option");
    expect(option).toHaveTextContent("开发");
    expect(option).toHaveTextContent("@dev");
    expect(within(listbox).queryByText("@security")).not.toBeInTheDocument();

    fireEvent.mouseDown(option);
    expect(onValueChange).toHaveBeenCalledWith("下一步 @dev ");
  });

  it("serializes decorated mentions back to plain @slug during editing", () => {
    const onValueChange = vi.fn();
    render(
      <AgentMarkdownMentionEditor
        value="交棒给 @dev"
        members={teamMembers}
        label="AGENT.md"
        onValueChange={onValueChange}
      />,
    );

    const editor = screen.getByRole("textbox", { name: "AGENT.md" });
    editor.append(document.createTextNode(" 完成"));
    fireEvent.input(editor);

    expect(onValueChange).toHaveBeenCalledWith("交棒给 @dev 完成");
  });

  it("restores the caret inside ordinary text after a controlled rerender", () => {
    function ControlledEditor(): JSX.Element {
      const [value, setValue] = useState("abcd");
      return (
        <AgentMarkdownMentionEditor
          value={value}
          members={teamMembers}
          label="AGENT.md"
          onValueChange={setValue}
        />
      );
    }
    render(<ControlledEditor />);

    const editor = screen.getByRole("textbox", { name: "AGENT.md" });
    const textNode = editor.firstChild;
    expect(textNode).not.toBeNull();
    textNode!.textContent = "abXcd";
    const range = document.createRange();
    range.setStart(textNode!, 3);
    range.collapse(true);
    window.getSelection()?.removeAllRanges();
    window.getSelection()?.addRange(range);
    fireEvent.input(editor);

    expect(editor).toHaveAttribute("data-raw-markdown", "abXcd");
    expect(window.getSelection()?.anchorOffset).toBe(3);
  });

  it("commits IME composition once through the real input event path", () => {
    const onValueChange = vi.fn();
    render(
      <AgentMarkdownMentionEditor
        value=""
        members={teamMembers}
        label="AGENT.md"
        onValueChange={onValueChange}
      />,
    );
    const editor = screen.getByRole("textbox", { name: "AGENT.md" });

    fireEvent.compositionStart(editor);
    fireEvent.input(editor, { target: { textContent: "中" } });
    fireEvent.input(editor, { target: { textContent: "中文" } });
    expect(onValueChange).not.toHaveBeenCalled();
    fireEvent.compositionEnd(editor, { data: "文" });

    expect(onValueChange).toHaveBeenCalledTimes(1);
    expect(onValueChange).toHaveBeenCalledWith("中文");
  });
});

describe("AgentMarkdownMentionEditor change markers", () => {
  it("keeps plain rendering when changeMarkers is omitted", () => {
    render(
      <AgentMarkdownMentionEditor
        value={"第一段\n\n第二段"}
        members={teamMembers}
        label="AGENT.md"
        onValueChange={vi.fn()}
      />,
    );
    expect(screen.queryByRole("button", { name: "展开" })).not.toBeInTheDocument();
  });

  it("renders a marker for its block, reveals authorship and expands the previous text", () => {
    render(
      <AgentMarkdownMentionEditor
        value={"第一段没有变化\n\n第二段被你改过"}
        members={teamMembers}
        label="AGENT.md"
        changeMarkers={[{
          blockIndex: 1,
          authorKind: "user",
          authorLabel: "你",
          timeLabel: "3 天前",
          previousText: "第二段原来的写法",
        }]}
        onValueChange={vi.fn()}
      />,
    );

    expect(screen.getByText("你 · 3 天前")).toBeInTheDocument();
    expect(screen.queryByText("第二段原来的写法")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "展开" }));
    expect(screen.getByText("第二段原来的写法")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "收起" }));
    expect(screen.queryByText("第二段原来的写法")).not.toBeInTheDocument();
  });

  it("gives the marker layer real size and pointer reach with a color-mix accent rail", () => {
    render(
      <AgentMarkdownMentionEditor
        value={"第一段没有变化\n\n第二段被你改过"}
        members={teamMembers}
        label="AGENT.md"
        changeMarkers={[{
          blockIndex: 1,
          authorKind: "user",
          authorLabel: "你",
          timeLabel: "3 天前",
          previousText: "第二段原来的写法",
        }]}
        onValueChange={vi.fn()}
      />,
    );

    // A zero-size layer made every descendant unreachable by a real pointer
    // (elementFromPoint hit nothing) and rendered the rail with zero height;
    // the layer must carry the block's height and stay hit-testable. jsdom
    // has no Range geometry, so the line-index estimate drives the overlay:
    // block 1 starts after two line breaks (48px) minus the 8px lead-in, and
    // one line of text (24px) plus the same lead-in.
    const layer = document.querySelector("[data-change-marker]");
    expect(layer).not.toBeNull();
    expect(layer).toHaveClass("pointer-events-auto");
    expect(layer).toHaveStyle({ top: "40px", height: "40px" });

    // `--accent` is a plain CSS variable: Tailwind never compiles `accent/50`
    // (no rule exists in the bundle), so the rail must derive its 50% tint
    // from the token via color-mix instead of a silent no-op class.
    const rail = document.querySelector("[data-change-marker-rail]");
    expect(rail?.className).toContain("color-mix(in_srgb,var(--accent)_50%,transparent)");
    expect(rail?.className).not.toContain("bg-accent/50");

    // Attribution stays hidden by default; hover on the rail band or focus
    // within the layer reveals it and makes the row pointer-reachable, so the
    // expand button is clickable by a real mouse once revealed.
    const row = document.querySelector("[data-change-marker-row]");
    expect(row?.className).toContain("opacity-0");
    expect(row?.className).toContain("group-hover/marker:opacity-100");
    expect(row?.className).toContain("group-hover/marker:pointer-events-auto");
    expect(row?.className).toContain("group-focus-within/marker:opacity-100");

    // Keyboard focus must produce a visible control: the row is revealed via
    // group-focus-within and the button itself carries a visible ring.
    const button = screen.getByRole("button", { name: "展开" });
    expect(button.className).toContain("focus-visible:ring-2");
    expect(button.className).toContain("focus-visible:ring-[color-mix(in_srgb,var(--accent)_40%,transparent)]");
  });

  it("keeps an expanded previous-text preview across a markers refresh", () => {
    const markers = (): AgentMarkdownChangeMarker[] => [{
      blockIndex: 1,
      authorKind: "user",
      authorLabel: "你",
      timeLabel: "3 天前",
      previousText: "第二段原来的写法",
    }];
    const { rerender } = render(
      <AgentMarkdownMentionEditor
        value={"第一段没有变化\n\n第二段被你改过"}
        members={teamMembers}
        label="AGENT.md"
        changeMarkers={markers()}
        onValueChange={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "展开" }));
    expect(screen.getByText("第二段原来的写法")).toBeInTheDocument();

    // The summary-settled refresh replaces the markers array with a fresh one
    // (same block index, possibly terminal summary); the expanded state lives
    // in the editor component, so the preview must survive the replacement.
    rerender(
      <AgentMarkdownMentionEditor
        value={"第一段没有变化\n\n第二段被你改过"}
        members={teamMembers}
        label="AGENT.md"
        changeMarkers={markers()}
        onValueChange={vi.fn()}
      />,
    );

    expect(screen.getByText("第二段原来的写法")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "收起" })).toBeInTheDocument();
  });

  it("does not show an expand toggle when a marker has no previous text", () => {
    render(
      <AgentMarkdownMentionEditor
        value="唯一一段，且没有标题结构"
        members={teamMembers}
        label="AGENT.md"
        changeMarkers={[{
          blockIndex: 0,
          authorKind: "official",
          authorLabel: "官方 v1.2",
          timeLabel: "这支团队的官方初始版本",
          previousText: null,
        }]}
        onValueChange={vi.fn()}
      />,
    );
    expect(screen.getByText("官方 v1.2 · 这支团队的官方初始版本")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "展开" })).not.toBeInTheDocument();
  });

  it("round-trips edits through block rendering without losing blank lines", () => {
    const onValueChange = vi.fn();
    render(
      <AgentMarkdownMentionEditor
        value={"第一段\n\n第二段"}
        members={teamMembers}
        label="AGENT.md"
        changeMarkers={[{ blockIndex: 0, authorKind: "user", authorLabel: "你", timeLabel: "刚刚", previousText: null }]}
        onValueChange={onValueChange}
      />,
    );
    const editor = screen.getByRole("textbox", { name: "AGENT.md" });
    fireEvent.input(editor, { target: { textContent: "第一段改过\n\n第二段" } });
    expect(onValueChange).toHaveBeenCalledWith("第一段改过\n\n第二段");
  });

  it("never serializes marker attribution, controls or previous-text into the Markdown while editing", () => {
    const onValueChange = vi.fn();
    render(
      <AgentMarkdownMentionEditor
        value={"第一段没有变化\n\n第二段被你改过"}
        members={teamMembers}
        label="AGENT.md"
        changeMarkers={[{
          blockIndex: 1,
          authorKind: "user",
          authorLabel: "你",
          timeLabel: "3 天前",
          previousText: "第二段原来的写法",
        }]}
        onValueChange={onValueChange}
      />,
    );
    const editor = screen.getByRole("textbox", { name: "AGENT.md" });
    // Expand the previous-text preview so its content is part of the DOM, then
    // edit a plain text node the way the browser would (the preview and the
    // attribution stay mounted — outside the contentEditable marker layer).
    fireEvent.click(screen.getByRole("button", { name: "展开" }));
    expect(screen.getByText("第二段原来的写法")).toBeInTheDocument();
    const textNode = editor.firstChild;
    expect(textNode).not.toBeNull();
    textNode!.textContent = "第一段真的没有变化";
    fireEvent.input(editor);

    const serialized = onValueChange.mock.calls[0]?.[0] as string;
    expect(serialized).not.toContain("你 · 3 天前");
    expect(serialized).not.toContain("展开");
    expect(serialized).not.toContain("收起");
    expect(serialized).not.toContain("第二段原来的写法");
  });
});

function placeCaretAtEnd(element: HTMLElement): void {
  const range = document.createRange();
  range.selectNodeContents(element);
  range.collapse(false);
  const selection = window.getSelection();
  selection?.removeAllRanges();
  selection?.addRange(range);
}
