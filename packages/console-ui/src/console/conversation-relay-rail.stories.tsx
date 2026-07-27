import type { Meta, StoryObj } from "@storybook/react";

import { ConversationRelayRail } from "@/console/conversation-relay-rail";

const meta = {
  title: "Block/Console/ConversationRelayRail",
  component: ConversationRelayRail,
  decorators: [
    (Story) => (
      <div className="h-[560px] w-[760px] bg-canvas p-4">
        <Story />
      </div>
    ),
  ],
  args: {
    containerWidth: 760,
    currentEventId: "message-4",
    events: [
      event("message-1", 1, "user", "user", "你", "请实现主会话目录轨"),
      event("message-2", 2, "agent", "product-lead", "产品交付负责人", "先确认产品落点"),
      event("message-3", 3, "agent", "ui-prototyper", "界面原型师", "已完成原型"),
      event("message-4", 4, "agent", "implementation-lead", "实施负责人", "正在接入正式页面"),
    ],
    onActivate: () => undefined,
  },
} satisfies Meta<typeof ConversationRelayRail>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

function event(
  id: string,
  messageId: number,
  kind: "user" | "agent",
  actorKey: string,
  actorName: string,
  body: string,
) {
  return {
    id,
    messageId,
    kind,
    actorKey,
    actorName,
    body,
    updatedAt: "2026-07-26T10:00:00.000Z",
  };
}
