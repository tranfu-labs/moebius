import type { Meta, StoryObj } from "@storybook/react";
import { useState } from "react";

import { RoleComposer } from "@/console/role-composer";

const meta = {
  title: "Component/Console/RoleComposer",
  component: RoleComposer,
  args: {
    value: "",
    onValueChange: () => undefined,
    statusText: "发消息不会打断运行"
  },
  parameters: {
    layout: "centered"
  }
} satisfies Meta<typeof RoleComposer>;

export default meta;
type Story = StoryObj<typeof meta>;

export const MentionCompletion: Story = {
  render: (args) => {
    const [value, setValue] = useState(args.value);

    return (
      <div className="w-[520px] space-y-3">
        <RoleComposer {...args} value={value} onValueChange={setValue} />
        <div className="rounded-lg border border-line bg-card px-3 py-2 text-xs text-sub">
          当前值：<span className="text-ink">{value || "空"}</span>
        </div>
      </div>
    );
  }
};

export const ExistingMentionBlocked: Story = {
  args: {
    value: "@dev 已经在消息里，继续输入 @",
    statusText: "同一条消息只由控件插入一个角色"
  },
  render: MentionCompletion.render
};
