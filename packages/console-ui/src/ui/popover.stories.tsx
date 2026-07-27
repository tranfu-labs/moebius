import type { Meta, StoryObj } from "@storybook/react";

import { Button } from "@/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/ui/popover";

const meta = {
  title: "Component/UI/Popover",
  component: Popover
} satisfies Meta<typeof Popover>;

export default meta;
type Story = StoryObj<typeof meta>;

export const WaitList: Story = {
  render: () => (
    <Popover defaultOpen>
      <PopoverTrigger asChild>
        <Button variant="outline">1 等你</Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-80">
        <div className="mb-2 text-sm font-semibold text-ink">等你 (1)</div>
        <div className="rounded-md p-2 text-sm hover:bg-hover">
          <div className="font-medium text-ink">失败汇总</div>
          <div className="text-xs text-sub">等你验收 · tranfu-agents</div>
        </div>
      </PopoverContent>
    </Popover>
  )
};
