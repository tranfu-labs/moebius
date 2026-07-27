import type { Meta, StoryObj } from "@storybook/react";

import { Input } from "@/ui/input";

const meta = {
  title: "Component/UI/Input",
  component: Input,
  args: {
    placeholder: "写下你判定的依据，方便回溯"
  }
} satisfies Meta<typeof Input>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Playground: Story = {};

export const ComposerLine: Story = {
  render: () => (
    <div className="max-w-xl space-y-1">
      <Input placeholder="@ 输入消息，@角色 交棒..." />
      <p className="text-xs text-hint">发消息不会打断运行 · 开发在第 3 步</p>
    </div>
  )
};
