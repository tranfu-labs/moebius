import type { Meta, StoryObj } from "@storybook/react";
import { useLayoutEffect, useRef, useState } from "react";

import {
  RightSidebar,
  type RightSidebarProps,
} from "@/console/right-sidebar";
import { projectRightSidebarLayout, type RightSidebarLayout } from "@/console/right-sidebar-layout";
import {
  addBlankRightSidebarTab,
  ensureRightSidebarTabsForOpen,
  type RightSidebarTabsState,
} from "@/console/right-sidebar-tabs";

const meta = {
  title: "Block/Console/RightSidebar",
  component: RightSidebarStory,
  args: {
    appearance: "focused",
    isGitRepository: true,
  },
  parameters: { layout: "fullscreen" },
} satisfies Meta<typeof RightSidebarStory>;

export default meta;
type Story = StoryObj<typeof meta>;

export const BlankTab: Story = { name: "页面同款 · 空标签" };

export const Default1200: Story = {
  name: "页面同款 · 标准桌面",
  args: { availableWidth: 1_200 },
};

export const NonGit: Story = {
  name: "非 Git 项目",
  args: { isGitRepository: false },
};

export const NarrowOverlay: Story = {
  name: "窄窗口 · 覆盖层",
  args: { availableWidth: 959 },
};

export const SplitMinimum: Story = {
  name: "分栏 · 最小宽度",
  args: { availableWidth: 960 },
};

export const SameTitlesAndUpdating: Story = {
  name: "同名标签 · 更新中",
  args: { scenario: "same-titles" },
};

export const KeyboardResize: Story = {
  name: "键盘 · 调整宽度",
  args: { availableWidth: 1_200 },
  play: async ({ canvasElement }) => {
    const separator = canvasElement.querySelector<HTMLElement>("[data-testid='right-sidebar-resize-handle']");
    if (separator === null) throw new Error("KeyboardResize story requires the split separator");
    separator.focus();
    separator.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowLeft", bubbles: true }));
    await nextFrame();
  },
};

export const ClosingSnapshot: Story = {
  name: "动画 · 关闭快照",
  args: { holdClosingSnapshot: true, scenario: "final-tab" },
  play: async ({ canvasElement }) => {
    const closeButton = canvasElement.querySelector<HTMLButtonElement>("[aria-label^='关闭标签']");
    if (closeButton === null) throw new Error("ClosingSnapshot story requires one closable tab");
    closeButton.click();
    await nextFrame();
  },
};

export const ReducedMotion: Story = {
  name: "减弱动效",
  args: { reducedMotion: true, scenario: "final-tab" },
};

interface RightSidebarStoryProps extends Pick<RightSidebarProps, "appearance" | "isGitRepository"> {
  availableWidth?: number;
  holdClosingSnapshot?: boolean;
  layout?: RightSidebarLayout;
  reducedMotion?: boolean;
  scenario?: "default" | "same-titles" | "final-tab";
}

function RightSidebarStory({
  appearance = "focused",
  isGitRepository = true,
  availableWidth = 1_200,
  holdClosingSnapshot = false,
  layout,
  reducedMotion = false,
  scenario = "default",
}: RightSidebarStoryProps): JSX.Element {
  const [environmentReady, setEnvironmentReady] = useState(!reducedMotion && !holdClosingSnapshot);
  const [open, setOpen] = useState(true);
  const [widthPreference, setWidthPreference] = useState<number | null>(null);
  const projection = projectRightSidebarLayout(availableWidth, widthPreference);
  const [state, setState] = useState<RightSidebarTabsState>(() => {
    if (scenario === "same-titles") {
      return {
        tabs: [
          { id: "same-a", type: "conversation", title: "发布前检查", sourceKey: "conversation:a", closable: true },
          { id: "same-b", type: "conversation", title: "发布前检查", sourceKey: "conversation:b", closable: true },
          { id: "updating-a", type: "conversation", title: "旧标题 A", sourceKey: "conversation:c", closable: true },
          { id: "updating-b", type: "conversation", title: "旧标题 B", sourceKey: "conversation:d", closable: true },
        ],
        activeTabId: "same-b",
      };
    }
    if (scenario === "final-tab") {
      return ensureRightSidebarTabsForOpen(
        { tabs: [], activeTabId: null },
        { id: "diff", isGitRepository },
      );
    }
    return addBlankRightSidebarTab(
      ensureRightSidebarTabsForOpen(
        { tabs: [], activeTabId: null },
        { id: "diff", isGitRepository },
      ),
      "blank",
    );
  });
  const [nextId, setNextId] = useState(1);
  const toggleRef = useRef<HTMLButtonElement>(null);

  useLayoutEffect(() => {
    const originalMatchMedia = window.matchMedia;
    const originalSetTimeout = window.setTimeout;
    if (reducedMotion) {
      window.matchMedia = (query: string) => reducedMotionMediaQuery(query);
    }
    if (holdClosingSnapshot) {
      window.setTimeout = ((handler: TimerHandler, timeout?: number, ...args: unknown[]) => {
        if (timeout === 200) return -1;
        return originalSetTimeout(handler, timeout, ...args);
      }) as typeof window.setTimeout;
    }
    setEnvironmentReady(true);
    return () => {
      window.matchMedia = originalMatchMedia;
      window.setTimeout = originalSetTimeout;
    };
  }, [holdClosingSnapshot, reducedMotion]);

  if (!environmentReady) return <div className="p-4 text-sm text-sub">准备右侧栏交互场景…</div>;

  return (
    <div
      className="relative flex h-screen justify-end bg-canvas"
      data-right-sidebar-story-hold={holdClosingSnapshot || undefined}
      style={{ width: `${String(availableWidth)}px`, maxWidth: "100vw" }}
    >
      {holdClosingSnapshot ? <style>{`
        [data-right-sidebar-story-hold="true"] [data-testid="right-sidebar"] {
          transition-duration: 3600000ms !important;
        }
      `}</style> : null}
      <button
        ref={toggleRef}
        type="button"
        className="absolute left-3 top-3 z-layer-floating rounded-lg border border-line bg-canvas px-3 py-2 text-xs text-ink"
        onClick={() => setOpen((current) => !current)}
      >
        {open ? "隐藏右侧栏" : "显示右侧栏"}
      </button>
      <RightSidebar
        appearance={appearance}
        open={open}
        availableWidth={availableWidth}
        width={projection.width}
        minWidth={projection.minWidth}
        maxWidth={projection.maxWidth}
        layout={layout ?? projection.layout}
        isGitRepository={isGitRepository}
        state={state}
        tabDiscriminators={scenario === "same-titles"
          ? {
              "same-a": "moebius · feature/sidebar",
              "same-b": "docs · feature/sidebar",
              "updating-a": "moebius · main · 同刻第 1 个",
              "updating-b": "moebius · main · 同刻第 2 个",
            }
          : undefined}
        updatingTabIds={scenario === "same-titles" ? ["updating-a", "updating-b"] : undefined}
        onRetryTitles={() => undefined}
        onStateChange={setState}
        onOpenChange={setOpen}
        onWidthChange={setWidthPreference}
        toggleButtonRef={toggleRef}
        createTabId={() => {
          const id = `story-${String(nextId)}`;
          setNextId((current) => current + 1);
          return id;
        }}
      />
    </div>
  );
}

function reducedMotionMediaQuery(query: string): MediaQueryList {
  return {
    matches: query === "(prefers-reduced-motion: reduce)",
    media: query,
    onchange: null,
    addListener: () => undefined,
    removeListener: () => undefined,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    dispatchEvent: () => true,
  };
}

function nextFrame(): Promise<void> {
  return new Promise((resolve) => requestAnimationFrame(() => resolve()));
}
