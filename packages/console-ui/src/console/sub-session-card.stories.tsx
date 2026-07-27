import type { Meta, StoryObj } from "@storybook/react";

import { SubSessionCard } from "@/console/sub-session-card";

const meta = {
  title: "Component/Console/SubSessionCard",
  component: SubSessionCard,
  args: {
    items: [
      { sessionId: "copy", title: "落地页文案", memberName: "开发", status: "running", statusLabel: "进行中" },
      { sessionId: "qa", title: "空状态验收", memberName: "测试", status: "not-started", statusLabel: "没跑起来" },
      { sessionId: "build", title: "构建脚本", memberName: "开发", status: "finished", statusLabel: "已结束" },
    ],
    openedSessionId: "qa",
  },
  parameters: { layout: "centered" },
} satisfies Meta<typeof SubSessionCard>;

export default meta;
type Story = StoryObj<typeof meta>;

export const SplitGoal: Story = { args: { className: "w-[620px]" } };
