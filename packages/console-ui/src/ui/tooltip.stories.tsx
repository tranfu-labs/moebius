import type { Meta, StoryObj } from "@storybook/react";

import { Button } from "@/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/ui/tooltip";

const meta = {
  title: "Component/UI/Tooltip",
  component: Tooltip,
} satisfies Meta<typeof Tooltip>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  render: () => (
    <TooltipProvider delayDuration={0}>
      <Tooltip defaultOpen>
        <TooltipTrigger asChild>
          <Button variant="outline">文本片段 1</Button>
        </TooltipTrigger>
        <TooltipContent>
          Moebius 会话记录：sessions/source-session.jsonl；外部执行：Codex 019b8ef2
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  ),
};
