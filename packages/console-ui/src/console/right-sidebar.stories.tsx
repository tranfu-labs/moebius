import type { Meta, StoryObj } from "@storybook/react";
import { useState } from "react";

import {
  DEFAULT_RIGHT_SIDEBAR_WIDTH_PX,
  RightSidebar,
  type RightSidebarProps,
} from "@/console/right-sidebar";
import {
  addBlankRightSidebarTab,
  ensureRightSidebarTabsForOpen,
  type RightSidebarTabsState,
} from "@/console/right-sidebar-tabs";

const meta = {
  title: "Block/Console/RightSidebar",
  component: RightSidebarStory,
  args: {
    isGitRepository: true,
    narrow: false,
  },
  parameters: { layout: "fullscreen" },
} satisfies Meta<typeof RightSidebarStory>;

export default meta;
type Story = StoryObj<typeof meta>;

export const BlankTab: Story = {};

export const NonGit: Story = {
  args: { isGitRepository: false },
};

export const NarrowOverlay: Story = {
  args: { narrow: true },
};

export const SameTitlesAndUpdating: Story = {
  args: { scenario: "same-titles" },
};

interface RightSidebarStoryProps extends Pick<RightSidebarProps, "isGitRepository" | "narrow"> {
  scenario?: "default" | "same-titles";
}

function RightSidebarStory({
  isGitRepository = true,
  narrow = false,
  scenario = "default",
}: RightSidebarStoryProps): JSX.Element {
  const [open, setOpen] = useState(true);
  const [width, setWidth] = useState(DEFAULT_RIGHT_SIDEBAR_WIDTH_PX);
  const [state, setState] = useState<RightSidebarTabsState>(() => scenario === "same-titles"
    ? {
        tabs: [
          { id: "same-a", type: "conversation", title: "发布前检查", sourceKey: "conversation:a", closable: true },
          { id: "same-b", type: "conversation", title: "发布前检查", sourceKey: "conversation:b", closable: true },
          { id: "updating-a", type: "conversation", title: "旧标题 A", sourceKey: "conversation:c", closable: true },
          { id: "updating-b", type: "conversation", title: "旧标题 B", sourceKey: "conversation:d", closable: true },
        ],
        activeTabId: "same-b",
      }
    : addBlankRightSidebarTab(
      ensureRightSidebarTabsForOpen(
        { tabs: [], activeTabId: null },
        { id: "diff", isGitRepository },
      ),
      "blank",
    ));
  const [nextId, setNextId] = useState(1);
  return (
    <div className="relative flex h-screen justify-end bg-canvas">
      <RightSidebar
        open={open}
        width={width}
        narrow={narrow}
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
        onWidthChange={setWidth}
        createTabId={() => {
          const id = `story-${String(nextId)}`;
          setNextId((current) => current + 1);
          return id;
        }}
      />
    </div>
  );
}
