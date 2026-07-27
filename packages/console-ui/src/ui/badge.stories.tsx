import type { Meta, StoryObj } from "@storybook/react";

import { Badge } from "@/ui/badge";

const meta = {
  title: "Component/UI/Badge",
  component: Badge,
  args: {
    children: "这一步卡住了",
    variant: "stuck"
  },
  argTypes: {
    variant: {
      control: "select",
      options: ["failed", "stuck", "interrupted", "pass"]
    }
  }
} satisfies Meta<typeof Badge>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Playground: Story = {};

export const ConsoleStates: Story = {
  render: () => (
    <div className="flex flex-wrap items-center gap-3.5">
      <Badge variant="failed">错误</Badge>
      <Badge variant="stuck">卡住</Badge>
      <Badge variant="interrupted">已中断</Badge>
      <Badge variant="pass">通过</Badge>
    </div>
  )
};
