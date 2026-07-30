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
  type RightSidebarTabsState,
} from "./right-sidebar-tabs";

describe("RightSidebar", () => {
  it("offers an ordinary conversation, diff, and project files in a git blank tab", () => {
    renderSidebar({
      state: addBlankRightSidebarTab(initialState(), "blank"),
      isGitRepository: true,
    });

    const content = screen.getByTestId("right-sidebar-content");
    expect(within(content).getByRole("button", { name: /新会话/u })).toBeVisible();
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

  it("closes the sidebar when its final tab closes", () => {
    const onStateChange = vi.fn();
    const onOpenChange = vi.fn();
    renderSidebar({ onStateChange, onOpenChange });

    fireEvent.click(screen.getByRole("button", { name: "关闭标签：改动" }));

    expect(onStateChange).toHaveBeenCalledWith({ tabs: [], activeTabId: null });
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("renders an ordinary conversation through the generic conversation content slot", () => {
    renderSidebar({
      state: {
        tabs: [{
          id: "conversation",
          type: "conversation",
          title: "分析运行耗时",
          sourceKey: "conversation:analysis",
          closable: true,
        }],
        activeTabId: "conversation",
      },
      contentSlots: {
        conversation: () => <div>普通会话内容</div>,
      },
    });

    expect(screen.getByRole("tab", { name: "分析运行耗时" })).toBeVisible();
    expect(screen.getByText("普通会话内容")).toBeVisible();
  });

  it("moves keyboard focus to a requested active conversation tab", () => {
    const onFocusTabHandled = vi.fn();
    renderSidebar({
      state: {
        tabs: [{
          id: "conversation",
          type: "conversation",
          title: "分析运行耗时",
          sourceKey: "conversation:analysis",
          closable: true,
        }],
        activeTabId: "conversation",
      },
      focusTabId: "conversation",
      onFocusTabHandled,
    });

    expect(screen.getByRole("tab", { name: "分析运行耗时" })).toHaveFocus();
    expect(onFocusTabHandled).toHaveBeenCalledWith("conversation");
  });

  it("gives same-title and updating tabs visible discriminators with matching accessible names", () => {
    const onRetryTitles = vi.fn();
    renderSidebar({
      state: {
        tabs: [
          { id: "one", type: "conversation", title: "发布前检查", sourceKey: "conversation:one", closable: true },
          { id: "two", type: "conversation", title: "发布前检查", sourceKey: "conversation:two", closable: true },
          { id: "loading", type: "conversation", title: "旧标题", sourceKey: "conversation:loading", closable: true },
        ],
        activeTabId: "two",
      },
      tabDiscriminators: {
        one: "moebius · feature/sidebar",
        two: "docs · feature/sidebar",
        loading: "moebius · main",
      },
      updatingTabIds: ["loading"],
      onRetryTitles,
    });

    expect(screen.getByRole("tab", { name: "发布前检查，moebius · feature/sidebar" })).toBeVisible();
    expect(screen.getByRole("tab", { name: "发布前检查，docs · feature/sidebar" })).toBeVisible();
    expect(screen.getByRole("tab", { name: "标题更新中，moebius · main" })).toBeVisible();
    expect(screen.getByRole("status")).toHaveTextContent("会话名称已保存，标签标题正在重试");
    fireEvent.click(screen.getByRole("button", { name: "重试标题" }));
    expect(onRetryTitles).toHaveBeenCalledOnce();
    expect(screen.getByRole("button", {
      name: "关闭标签：发布前检查，docs · feature/sidebar",
    })).toBeVisible();
  });

  it("keeps the active or keyboard-focused tab inside the horizontal viewport", () => {
    const scrollIntoView = vi.fn();
    const original = HTMLElement.prototype.scrollIntoView;
    HTMLElement.prototype.scrollIntoView = scrollIntoView;
    try {
      renderSidebar({
        state: {
          tabs: [{
            id: "long",
            type: "conversation",
            title: "这是一个重命名之后明显变长的会话标题",
            sourceKey: "conversation:long",
            closable: true,
          }],
          activeTabId: "long",
        },
      });
      expect(scrollIntoView).toHaveBeenCalledWith({ block: "nearest", inline: "nearest" });
      scrollIntoView.mockClear();
      fireEvent.focus(screen.getByRole("tab"));
      expect(scrollIntoView).toHaveBeenCalledWith({ block: "nearest", inline: "nearest" });
    } finally {
      HTMLElement.prototype.scrollIntoView = original;
    }
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
  const type = isGitRepository ? "workspace-diff" : "project-files";
  return {
    tabs: [{
      id: isGitRepository ? "diff" : "files",
      type,
      title: isGitRepository
        ? "builtin:workspace-diff"
        : "builtin:project-files",
      sourceKey: null,
      closable: true,
    }],
    activeTabId: isGitRepository ? "diff" : "files",
  };
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
