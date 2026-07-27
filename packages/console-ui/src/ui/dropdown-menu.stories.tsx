import type { Meta, StoryObj } from "@storybook/react";

import { Button } from "@/ui/button";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from "@/ui/dropdown-menu";

const meta = {
  title: "Component/UI/DropdownMenu",
  component: DropdownMenu
} satisfies Meta<typeof DropdownMenu>;

export default meta;
type Story = StoryObj<typeof meta>;

export const RoleActions: Story = {
  render: () => (
    <DropdownMenu defaultOpen>
      <DropdownMenuTrigger asChild>
        <Button variant="outline">选择动作</Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start">
        <DropdownMenuItem>打开会话</DropdownMenuItem>
        <DropdownMenuItem>查看运行记录</DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuCheckboxItem checked>只看等你</DropdownMenuCheckboxItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
};
