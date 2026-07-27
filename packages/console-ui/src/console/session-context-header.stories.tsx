import type { Meta, StoryObj } from "@storybook/react";

import { SessionContextHeader } from "@/console/session-context-header";

const meta = {
  title: "Component/Console/SessionContextHeader",
  component: SessionContextHeader,
  args: {
    parentTitle: "目标 · 导出体验",
    taskLabel: "任务 T2 · 进度提示",
    status: "running",
    progress: {
      passed: 1,
      running: 1,
      waiting: 1
    },
    onOpenParent: () => undefined
  },
  parameters: {
    layout: "centered"
  }
} satisfies Meta<typeof SessionContextHeader>;

export default meta;
type Story = StoryObj<typeof meta>;

export const CurrentSessionContext: Story = {
  args: {
    className: "w-[680px]"
  }
};
