import type { Meta, StoryObj } from "@storybook/react";

import {
  ConversationStatusIndicator,
  type ConversationSessionStatus,
} from "@/console/conversation-sidebar";

const meta = {
  title: "Component/Console/ConversationStatusIndicator",
  component: ConversationStatusIndicator,
  args: { status: "red" },
  parameters: { layout: "centered" },
} satisfies Meta<typeof ConversationStatusIndicator>;

export default meta;
type Story = StoryObj<typeof meta>;

export const StatusMatrix: Story = {
  render: () => (
    <div className="grid grid-cols-[auto_auto] items-center gap-x-3 gap-y-2 rounded-xl border border-line bg-rail p-4 text-sm text-ink">
      {([
        ["red", "需要你处理"],
        ["blue", "未读"],
        ["blink", "正在运行"],
        ["none", "已读且静止"],
      ] satisfies Array<[ConversationSessionStatus, string]>).map(([status, label]) => (
        <div key={status} className="contents">
          <ConversationStatusIndicator status={status} />
          <span>{label}</span>
        </div>
      ))}
    </div>
  ),
};
