import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { useRef, useState } from "react";
import { describe, expect, it, vi } from "vitest";

import { I18nProvider } from "@/i18n";

import {
  RightSidebar,
} from "./right-sidebar";
import {
  RIGHT_SIDEBAR_MIN_WIDTH_PX,
  projectRightSidebarLayout,
} from "./right-sidebar-layout";
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

  it("uses primary foreground for focused inactive tabs and weight for the active tab", () => {
    renderSidebar({
      appearance: "focused",
      state: addBlankRightSidebarTab(initialState(), "blank"),
    });

    const inactive = screen.getByRole("tab", { name: "改动" }).parentElement;
    const active = screen.getByRole("tab", { name: "新标签" }).parentElement;
    expect(inactive).toHaveClass("text-ink", "font-normal");
    expect(inactive).not.toHaveClass("text-sub");
    expect(active).toHaveClass("bg-sel", "text-ink", "font-normal");
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

  it("uses an in-flow split track with content anchored to its right edge", () => {
    renderSidebar();

    const sidebar = screen.getByTestId("right-sidebar");
    const surface = screen.getByTestId("right-sidebar-surface");
    expect(sidebar).toHaveClass("relative", "transition-[width]");
    expect(sidebar).not.toHaveClass("absolute", "transition-transform");
    expect(surface).toHaveClass("absolute", "inset-y-0", "right-0");
  });

  it("paints a collapsed split track before revealing its right-anchored content", () => {
    const frames: FrameRequestCallback[] = [];
    const requestFrame = vi.spyOn(window, "requestAnimationFrame")
      .mockImplementation((callback) => {
        frames.push(callback);
        return frames.length;
      });
    try {
      render(<ControlledSidebar />);
      fireEvent.click(screen.getByRole("button", { name: "隐藏右侧栏" }));
      fireEvent.transitionEnd(screen.getByTestId("right-sidebar"), { propertyName: "width" });
      fireEvent.click(screen.getByRole("button", { name: "显示右侧栏" }));

      const sidebar = screen.getByTestId("right-sidebar");
      expect(sidebar).toHaveStyle({ width: "0px" });
      expect(frames).toHaveLength(1);

      act(() => frames.shift()?.(0));
      expect(sidebar).toHaveStyle({ width: "0px" });
      expect(frames).toHaveLength(1);

      act(() => frames.shift()?.(16));
      expect(sidebar.style.width).not.toBe("0px");
    } finally {
      requestFrame.mockRestore();
    }
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

  it("uses roving focus and standard arrow-key navigation across tabs", async () => {
    const onStateChange = vi.fn();
    renderSidebar({
      state: {
        tabs: [
          { id: "conversation", type: "conversation", title: "新会话", sourceKey: "conversation:new", closable: true },
          { id: "files", type: "project-files", title: "builtin:project-files", sourceKey: null, closable: true },
        ],
        activeTabId: "conversation",
      },
      onStateChange,
    });

    const conversationTab = screen.getByRole("tab", { name: "新会话" });
    const filesTab = screen.getByRole("tab", { name: "项目文件" });
    expect(conversationTab).toHaveAttribute("tabindex", "0");
    expect(filesTab).toHaveAttribute("tabindex", "-1");

    conversationTab.focus();
    fireEvent.keyDown(conversationTab, { key: "ArrowRight" });

    expect(onStateChange).toHaveBeenCalledWith(expect.objectContaining({ activeTabId: "files" }));
    await waitFor(() => expect(filesTab).toHaveFocus());
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
    renderSidebar({ layout: "overlay", onOpenChange });

    expect(screen.getByTestId("right-sidebar")).toHaveAttribute("data-layout", "overlay");
    expect(screen.queryByRole("separator", { name: "调整右侧栏宽度" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "关闭右侧栏并回到会话区" }));
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("moves focus from disappearing layout controls to the host toggle without resetting content", () => {
    const { rerender } = render(<LayoutFocusSidebar availableWidth={1_200} />);
    const activeTab = screen.getByRole("tab", { name: "改动" });
    const content = screen.getByTestId("right-sidebar-content");
    content.scrollTop = 37;

    screen.getByRole("separator", { name: "调整右侧栏宽度" }).focus();
    rerender(<LayoutFocusSidebar availableWidth={959} />);

    expect(screen.getByRole("button", { name: "切换右侧栏" })).toHaveFocus();
    expect(screen.getByRole("tab", { name: "改动" })).toBe(activeTab);
    expect(screen.getByTestId("right-sidebar-content")).toBe(content);
    expect(content.scrollTop).toBe(37);
    expect(screen.getByTestId("right-sidebar")).toHaveAttribute("data-motion-state", "open");

    screen.getByRole("button", { name: "关闭右侧栏并回到会话区" }).focus();
    rerender(<LayoutFocusSidebar availableWidth={1_200} />);

    expect(screen.getByRole("button", { name: "切换右侧栏" })).toHaveFocus();
    expect(screen.getByRole("tab", { name: "改动" })).toBe(activeTab);
    expect(screen.getByTestId("right-sidebar-content")).toBe(content);
    expect(content.scrollTop).toBe(37);
    expect(screen.getByTestId("right-sidebar")).toHaveAttribute("data-motion-state", "open");
  });

  it("resizes from the left boundary within the supported range", () => {
    const onWidthChange = vi.fn();
    renderSidebar({ onWidthChange });

    const handle = screen.getByRole("separator", { name: "调整右侧栏宽度" });
    expect(handle).toHaveAttribute("aria-valuemin", String(RIGHT_SIDEBAR_MIN_WIDTH_PX));
    expect(handle).toHaveAttribute("aria-valuemax", "720");

    firePointer(handle, "pointerdown", { pointerId: 4, button: 0, clientX: 800 });
    firePointer(handle, "pointermove", { pointerId: 4, clientX: 2_000 });
    expect(onWidthChange).toHaveBeenLastCalledWith(RIGHT_SIDEBAR_MIN_WIDTH_PX);
    firePointer(handle, "pointermove", { pointerId: 4, clientX: 0 });
    expect(onWidthChange).toHaveBeenLastCalledWith(720);
  });

  it("resizes from the keyboard with ordinary, large, and boundary steps", () => {
    const onWidthChange = vi.fn();
    renderSidebar({ onWidthChange });

    const handle = screen.getByRole("separator", { name: "调整右侧栏宽度" });
    fireEvent.keyDown(handle, { key: "ArrowLeft" });
    expect(onWidthChange).toHaveBeenLastCalledWith(616);
    fireEvent.keyDown(handle, { key: "ArrowRight", shiftKey: true });
    expect(onWidthChange).toHaveBeenLastCalledWith(536);
    fireEvent.keyDown(handle, { key: "Home" });
    expect(onWidthChange).toHaveBeenLastCalledWith(480);
    fireEvent.keyDown(handle, { key: "End" });
    expect(onWidthChange).toHaveBeenLastCalledWith(720);
  });

  it("keeps the final tab as an inert snapshot until exit and returns focus", () => {
    const onExitComplete = vi.fn();
    render(<ControlledSidebar onExitComplete={onExitComplete} />);

    fireEvent.click(screen.getByRole("button", { name: "关闭标签：改动" }));

    const sidebar = screen.getByTestId("right-sidebar");
    const surface = screen.getByTestId("right-sidebar-surface");
    expect(sidebar).toHaveAttribute("data-motion-state", "closing");
    expect(sidebar).toHaveStyle({ width: "0px" });
    expect(surface).not.toHaveClass("translate-x-full", "transition-transform");
    expect(sidebar.inert).toBe(true);
    expect(screen.getByRole("tab", { name: "改动", hidden: true })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "显示右侧栏" })).toHaveFocus();

    fireEvent.transitionEnd(sidebar, { propertyName: "width" });
    expect(screen.queryByTestId("right-sidebar")).not.toBeInTheDocument();
    expect(onExitComplete).toHaveBeenCalledOnce();

    fireEvent.click(screen.getByRole("button", { name: "显示右侧栏" }));
    expect(screen.getByTestId("right-sidebar-content")).toHaveTextContent("这个标签要看什么");
    expect(screen.queryByRole("tab")).not.toBeInTheDocument();
  });

  it("reverses a closing sidebar in place when the last intent is open", () => {
    render(<ControlledSidebar />);

    fireEvent.click(screen.getByRole("button", { name: "隐藏右侧栏" }));
    const sidebar = screen.getByTestId("right-sidebar");
    expect(sidebar).toHaveAttribute("data-motion-state", "closing");
    fireEvent.click(screen.getByRole("button", { name: "显示右侧栏" }));
    fireEvent.transitionEnd(sidebar, { propertyName: "width" });

    expect(screen.getByTestId("right-sidebar")).toBe(sidebar);
    expect(sidebar).not.toHaveAttribute("aria-hidden");
  });

  it("finishes immediately when reduced motion is enabled", () => {
    const originalMatchMedia = window.matchMedia;
    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      value: vi.fn().mockReturnValue({
        matches: true,
        media: "(prefers-reduced-motion: reduce)",
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      }),
    });
    try {
      const onExitComplete = vi.fn();
      render(<ControlledSidebar onExitComplete={onExitComplete} />);
      fireEvent.click(screen.getByRole("button", { name: "隐藏右侧栏" }));
      expect(screen.queryByTestId("right-sidebar")).not.toBeInTheDocument();
      expect(onExitComplete).toHaveBeenCalledOnce();
    } finally {
      Object.defineProperty(window, "matchMedia", {
        configurable: true,
        value: originalMatchMedia,
      });
    }
  });
});

function ControlledSidebar({
  onExitComplete = () => undefined,
}: {
  onExitComplete?: () => void;
}): JSX.Element {
  const [open, setOpen] = useState(true);
  const [state, setState] = useState(initialState());
  const toggleRef = useRef<HTMLButtonElement>(null);
  const projection = projectRightSidebarLayout(1_200, null);
  return (
    <I18nProvider locale="zh-CN">
      <button ref={toggleRef} type="button" onClick={() => setOpen((current) => !current)}>
        {open ? "隐藏右侧栏" : "显示右侧栏"}
      </button>
      <RightSidebar
        open={open}
        availableWidth={1_200}
        width={projection.width}
        minWidth={projection.minWidth}
        maxWidth={projection.maxWidth}
        layout={projection.layout}
        isGitRepository
        state={state}
        onStateChange={setState}
        onOpenChange={setOpen}
        onWidthChange={() => undefined}
        toggleButtonRef={toggleRef}
        onExitComplete={onExitComplete}
        createTabId={() => "generated"}
      />
    </I18nProvider>
  );
}

function LayoutFocusSidebar({ availableWidth }: { availableWidth: number }): JSX.Element {
  const toggleRef = useRef<HTMLButtonElement>(null);
  const projection = projectRightSidebarLayout(availableWidth, null);
  return (
    <I18nProvider locale="zh-CN">
      <button ref={toggleRef} type="button">切换右侧栏</button>
      <RightSidebar
        open
        availableWidth={availableWidth}
        width={projection.width}
        minWidth={projection.minWidth}
        maxWidth={projection.maxWidth}
        layout={projection.layout}
        isGitRepository
        state={initialState()}
        onStateChange={() => undefined}
        onOpenChange={() => undefined}
        onWidthChange={() => undefined}
        toggleButtonRef={toggleRef}
        createTabId={() => "generated"}
      />
    </I18nProvider>
  );
}

function renderSidebar(
  overrides: Partial<React.ComponentProps<typeof RightSidebar>> = {},
  locale: "zh-CN" | "en" = "zh-CN",
) {
  let nextId = 1;
  const projection = projectRightSidebarLayout(1_200, null);
  return render(
    <I18nProvider locale={locale}>
      <RightSidebar
        open
        availableWidth={1_200}
        width={projection.width}
        minWidth={projection.minWidth}
        maxWidth={projection.maxWidth}
        layout={projection.layout}
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
