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

function RightSidebarStory({
  isGitRepository = true,
  narrow = false,
}: Pick<RightSidebarProps, "isGitRepository" | "narrow">): JSX.Element {
  const [open, setOpen] = useState(true);
  const [width, setWidth] = useState(DEFAULT_RIGHT_SIDEBAR_WIDTH_PX);
  const [state, setState] = useState<RightSidebarTabsState>(() => addBlankRightSidebarTab(
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
