import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { I18nProvider } from "@/i18n";

import {
  DEFAULT_RIGHT_SIDEBAR_WIDTH_PX,
  MAX_RIGHT_SIDEBAR_WIDTH_PX,
  MIN_RIGHT_SIDEBAR_WIDTH_PX,
  RightSidebar,
} from "./right-sidebar";
import {
  addBlankRightSidebarTab,
  ensureRightSidebarTabsForOpen,
  type RightSidebarTabsState,
} from "./right-sidebar-tabs";

describe("RightSidebar", () => {
  it("offers exactly diff and project files in a git blank tab", () => {
    renderSidebar({
      state: addBlankRightSidebarTab(initialState(), "blank"),
      isGitRepository: true,
    });

    const content = screen.getByTestId("right-sidebar-content");
    expect(within(content).getByRole("button", { name: /改动/u })).toBeVisible();
    expect(within(content).getByRole("button", { name: /项目文件/u })).toBeVisible();
    expect(within(content).queryByText(/终端|预览|浏览器/u)).not.toBeInTheDocument();
    expect(within(content).getByText("成员的完整输出和子任务从左边的主对话区点开。")).toBeVisible();
  });

  it("removes diff for a non-git project and explains why", () => {
    renderSidebar({
      state: addBlankRightSidebarTab(initialState(false), "blank"),
      isGitRepository: false,
    });

    const content = screen.getByTestId("right-sidebar-content");
    expect(within(content).queryByRole("button", { name: /改动/u })).not.toBeInTheDocument();
    expect(within(content).getByRole("button", { name: /项目文件/u })).toBeVisible();
    expect(within(content).getByRole("note")).toHaveTextContent("不是 git 仓库");
  });

  it("renders stable built-in tab codes through the active English locale", () => {
    renderSidebar({
      state: addBlankRightSidebarTab(initialState(), "blank"),
    }, "en");

    expect(screen.getByRole("tab", { name: "Changes" })).toBeVisible();
    expect(screen.getByRole("tab", { name: "New tab" })).toBeVisible();
    expect(screen.queryByText("改动")).not.toBeInTheDocument();
    expect(screen.queryByText("新标签")).not.toBeInTheDocument();
  });

  it("keeps plus reachable beside an overflowing tablist and closes every tab", () => {
    const onStateChange = vi.fn();
    const state = Array.from({ length: 8 }).reduce<RightSidebarTabsState>(
      (current, _value, index) => addBlankRightSidebarTab(current, `blank-${String(index)}`),
      initialState(),
    );
    renderSidebar({ state, onStateChange });

    expect(screen.getByRole("tablist", { name: "右侧栏标签" })).toHaveClass("overflow-x-auto");
    expect(screen.getByRole("button", { name: "新建空白标签" })).toBeVisible();
    expect(screen.getAllByRole("button", { name: /关闭标签/u })).toHaveLength(9);
    fireEvent.click(screen.getByRole("button", { name: "新建空白标签" }));
    expect(onStateChange).toHaveBeenCalledWith(expect.objectContaining({
      tabs: expect.arrayContaining([expect.objectContaining({ type: "blank" })]),
    }));
  });

  it("uses an overlay with its own route back to the conversation", () => {
    const onOpenChange = vi.fn();
    renderSidebar({ narrow: true, onOpenChange });

    expect(screen.getByTestId("right-sidebar")).toHaveAttribute("data-layout", "overlay");
    expect(screen.queryByRole("separator", { name: "调整右侧栏宽度" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "关闭右侧栏并回到会话区" }));
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("resizes from the left boundary within the supported range", () => {
    const onWidthChange = vi.fn();
    renderSidebar({ onWidthChange });

    const handle = screen.getByRole("separator", { name: "调整右侧栏宽度" });
    expect(handle).toHaveAttribute("aria-valuemin", String(MIN_RIGHT_SIDEBAR_WIDTH_PX));
    expect(handle).toHaveAttribute("aria-valuemax", String(MAX_RIGHT_SIDEBAR_WIDTH_PX));

    firePointer(handle, "pointerdown", { pointerId: 4, button: 0, clientX: 800 });
    firePointer(handle, "pointermove", { pointerId: 4, clientX: 2_000 });
    expect(onWidthChange).toHaveBeenLastCalledWith(MIN_RIGHT_SIDEBAR_WIDTH_PX);
    firePointer(handle, "pointermove", { pointerId: 4, clientX: 0 });
    expect(onWidthChange).toHaveBeenLastCalledWith(MAX_RIGHT_SIDEBAR_WIDTH_PX);
  });
});

function renderSidebar(
  overrides: Partial<React.ComponentProps<typeof RightSidebar>> = {},
  locale: "zh-CN" | "en" = "zh-CN",
) {
  let nextId = 1;
  return render(
    <I18nProvider locale={locale}>
      <RightSidebar
        open
        width={DEFAULT_RIGHT_SIDEBAR_WIDTH_PX}
        narrow={false}
        isGitRepository
        state={initialState()}
        onStateChange={() => undefined}
        onOpenChange={() => undefined}
        onWidthChange={() => undefined}
        createTabId={() => `generated-${String(nextId++)}`}
        {...overrides}
      />
    </I18nProvider>,
  );
}

function initialState(isGitRepository = true): RightSidebarTabsState {
  return ensureRightSidebarTabsForOpen(
    { tabs: [], activeTabId: null },
    { id: isGitRepository ? "diff" : "files", isGitRepository },
  );
}

function firePointer(
  element: Element,
  type: "pointerdown" | "pointermove",
  init: { pointerId: number; button?: number; clientX: number },
): void {
  const event = new MouseEvent(type, {
    bubbles: true,
    cancelable: true,
    button: init.button ?? 0,
    clientX: init.clientX,
  });
  Object.defineProperty(event, "pointerId", { value: init.pointerId });
  fireEvent(element, event);
}
