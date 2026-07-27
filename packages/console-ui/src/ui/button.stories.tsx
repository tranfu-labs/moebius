import type { Meta, StoryObj } from "@storybook/react";
import { Send, Square } from "lucide-react";

import { Button } from "@/ui/button";

const meta = {
  title: "Component/UI/Button",
  component: Button,
  args: {
    children: "提交验收结果",
    variant: "default",
    size: "default"
  },
  argTypes: {
    variant: {
      control: "select",
      options: ["default", "outline", "ghost", "danger", "subtle"]
    },
    size: {
      control: "select",
      options: ["default", "sm", "lg", "icon"]
    }
  }
} satisfies Meta<typeof Button>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Playground: Story = {};

export const ConsoleActions: Story = {
  render: () => (
    <div className="flex flex-wrap items-center gap-2">
      <Button>
        <Send className="h-4 w-4" strokeWidth={1.5} />
        发送
      </Button>
      <Button variant="outline">新会话</Button>
      <Button variant={"danger"}>
        <Square className="h-4 w-4" strokeWidth={1.5} />
        中断
      </Button>
      <Button variant="ghost">先不验</Button>
    </div>
  )
};
