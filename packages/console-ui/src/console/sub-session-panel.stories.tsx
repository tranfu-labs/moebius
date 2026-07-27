import type { Meta, StoryObj } from "@storybook/react";

import { SubSessionPanel } from "@/console/sub-session-panel";

const meta = {
  title: "Block/Console/SubSessionPanel",
  component: SubSessionPanel,
  args: {
    title: "空状态验收",
    narrow: false,
    onClose: () => undefined,
    children: <p className="text-sm text-sub">已有子会话时间线内容</p>,
  },
  decorators: [(Story) => <div className="relative h-[520px] w-[900px] bg-canvas"><Story /></div>],
} satisfies Meta<typeof SubSessionPanel>;

export default meta;
type Story = StoryObj<typeof meta>;

export const WideShell: Story = {};
export const NarrowOverlay: Story = { args: { narrow: true } };
