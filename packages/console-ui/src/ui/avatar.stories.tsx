import type { Meta, StoryObj } from "@storybook/react";

import { Avatar, AvatarFallback } from "@/ui/avatar";

const meta = {
  title: "Component/UI/Avatar",
  component: Avatar
} satisfies Meta<typeof Avatar>;

export default meta;
type Story = StoryObj<typeof meta>;

export const NeutralRoles: Story = {
  render: () => (
    <div className="flex items-center gap-2">
      {["你", "开", "测", "技", "产", "用", "C"].map((label) => (
        <Avatar key={label}>
          <AvatarFallback>{label}</AvatarFallback>
        </Avatar>
      ))}
    </div>
  )
};
