import type { Meta, StoryObj } from "@storybook/react";

import { ConversationRelayRail } from "@/console/conversation-relay-rail";
import type { ConversationRelayEvent } from "@/console/conversation-relay-rail-model";

const referenceEvents = [
  event(1, "user", "user", "你", "请把主会话目录轨对齐 dashboard 参考稿"),
  event(2, "agent", "dev-manager", "主理人", "先确认产品事实与实现边界"),
  event(3, "agent", "dev", "开发", "已完成成员泳道与分支模型"),
  event(4, "agent", "dev-manager", "主理人", "继续补齐自动验证"),
  event(5, "agent", "qa", "测试", "等待独立桌面视觉复核"),
  event(6, "agent", "dev", "开发", "已准备交付自动证据"),
] satisfies ConversationRelayEvent[];

const meta = {
  title: "Block/Console/ConversationRelayRail",
  component: ConversationRelayRail,
  render: (args) => (
    <div
      className="bg-canvas p-4"
      style={{ height: 560, width: Math.max(120, args.containerWidth) }}
    >
      <ConversationRelayRail {...args} />
    </div>
  ),
  args: {
    containerWidth: 760,
    currentEventId: "message-4",
    events: referenceEvents,
    onActivate: () => undefined,
  },
} satisfies Meta<typeof ConversationRelayRail>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Collapsed: Story = {};

export const ExpandedByHover: Story = {
  play: ({ canvasElement }) => {
    hover(canvasElement.querySelector('[data-testid="relay-event-message-3"]'));
  },
};

export const ExpandedByKeyboardFocus: Story = {
  play: ({ canvasElement }) => {
    canvasElement.querySelector<HTMLElement>(
      '[data-testid="relay-event-message-1"]',
    )?.focus();
  },
};

export const LongConversationMiddle: Story = {
  args: {
    currentEventId: "message-13",
    events: Array.from({ length: 25 }, (_, index) => {
      const source = referenceEvents[index % referenceEvents.length]!;
      return {
        ...source,
        id: `message-${String(index + 1)}`,
        messageId: index + 1,
        body: `长会话中的第 ${String(index + 1)} 条真实消息`,
      };
    }),
  },
  play: ({ canvasElement }) => {
    hover(canvasElement.querySelector('[data-testid="conversation-relay-rail"]'));
  },
};

export const ManyMembersNarrow: Story = {
  args: {
    containerWidth: 150,
    currentEventId: "message-9",
    events: [
      event(1, "user", "user", "你", "在窄窗口检查多成员目录"),
      ...Array.from({ length: 8 }, (_, index) =>
        event(
          index + 2,
          "agent",
          `member-${String(index + 1)}`,
          `成员 ${String(index + 1)}`,
          `第 ${String(index + 1)} 个成员的最终回复`,
        )),
    ],
  },
  play: ({ canvasElement }) => {
    hover(canvasElement.querySelector('[data-testid="conversation-relay-rail"]'));
  },
};

export const DarkThemeExpanded: Story = {
  decorators: [
    (Story) => (
      <div className="dark">
        <Story />
      </div>
    ),
  ],
  play: ({ canvasElement }) => {
    hover(canvasElement.querySelector('[data-testid="relay-event-message-5"]'));
  },
};

function event(
  messageId: number,
  kind: "user" | "agent",
  actorKey: string,
  actorName: string,
  body: string,
): ConversationRelayEvent {
  return {
    id: `message-${String(messageId)}`,
    messageId,
    kind,
    actorKey,
    actorName,
    body,
    updatedAt: `2026-07-26T10:0${String(messageId)}:00.000Z`,
  };
}

function hover(element: Element | null): void {
  element?.dispatchEvent(new MouseEvent("mouseover", {
    bubbles: true,
    cancelable: true,
    view: window,
  }));
}
