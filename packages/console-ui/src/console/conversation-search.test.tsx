import "@testing-library/jest-dom/vitest";

import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { ConversationSearch } from "@/console/conversation-search";

describe("ConversationSearch", () => {
  it("keeps empty queries neutral and submits normalized non-empty input", () => {
    const onSearch = vi.fn();
    renderSearch({ onSearch });
    expect(screen.getByText("输入关键词后搜索，不会自动列出全部会话。")).toBeVisible();
    fireEvent.change(screen.getByRole("textbox", { name: "搜索关键词" }), { target: { value: "   " } });
    expect(screen.getByRole("button", { name: "搜索" })).toBeDisabled();
    fireEvent.change(screen.getByRole("textbox", { name: "搜索关键词" }), { target: { value: " Agent " } });
    fireEvent.click(screen.getByRole("button", { name: "搜索" }));
    expect(onSearch).toHaveBeenCalledWith({ query: " Agent ", includeArchived: false });
  });

  it("does not let an old loading state block a changed query and hides stale results", () => {
    const onSearch = vi.fn();
    const { rerender } = renderSearch({ onSearch });
    const input = screen.getByRole("textbox", { name: "搜索关键词" });
    fireEvent.change(input, { target: { value: "旧条件" } });
    fireEvent.click(screen.getByRole("button", { name: "搜索" }));
    rerender(component({ onSearch, status: "loading" }));
    expect(screen.getByRole("button", { name: "搜索" })).toBeDisabled();

    fireEvent.change(input, { target: { value: "新条件" } });
    expect(screen.getByRole("button", { name: "搜索" })).toBeEnabled();
    expect(screen.getByText("按“搜索”执行当前条件。")).toBeVisible();

    const replacementSearch = vi.fn();
    rerender(component({
      onSearch: replacementSearch,
      status: "ready",
      results: [{
        sessionId: "old-result",
        projectId: "project",
        projectTitle: "项目 A",
        title: "旧条件结果",
        archived: false,
      }],
    }));
    expect(screen.queryByText("旧条件结果")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "搜索" }));
    expect(replacementSearch).toHaveBeenCalledWith({ query: "新条件", includeArchived: false });
    expect(onSearch).toHaveBeenCalledTimes(1);
  });

  it("uses a single restore action for archived results and protects IME Enter", () => {
    const onSearch = vi.fn();
    const onOpen = vi.fn();
    const onRestoreAndOpen = vi.fn();
    renderSearch({
      onSearch,
      onOpen,
      onRestoreAndOpen,
      status: "ready",
      results: [{
        sessionId: "archived",
        projectId: "project",
        projectTitle: "项目 A",
        title: "同名会话",
        archived: true,
      }],
    });
    const input = screen.getByRole("textbox", { name: "搜索关键词" });
    fireEvent.change(input, { target: { value: "同名" } });
    fireEvent.compositionStart(input);
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onSearch).not.toHaveBeenCalled();
    fireEvent.compositionEnd(input);
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onSearch).toHaveBeenCalledTimes(1);
  });
});

function renderSearch(overrides: Partial<React.ComponentProps<typeof ConversationSearch>> = {}) {
  const props: React.ComponentProps<typeof ConversationSearch> = {
    results: [],
    status: "idle",
    onSearch: vi.fn(),
    onOpen: vi.fn(),
    onRestoreAndOpen: vi.fn(),
    onClose: vi.fn(),
    ...overrides,
  };
  return {
    ...render(<ConversationSearch {...props} />),
    props,
  };
}

function component(
  overrides: Partial<React.ComponentProps<typeof ConversationSearch>>,
): JSX.Element {
  return (
    <ConversationSearch
      results={[]}
      status="idle"
      onSearch={vi.fn()}
      onOpen={vi.fn()}
      onRestoreAndOpen={vi.fn()}
      onClose={vi.fn()}
      {...overrides}
    />
  );
}
