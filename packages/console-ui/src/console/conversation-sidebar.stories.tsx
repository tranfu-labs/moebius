import type { Meta, StoryObj } from "@storybook/react";
import { useState } from "react";

import {
  ConversationSidebar,
  type ConversationSidebarProject
} from "@/console/conversation-sidebar";

const projects: ConversationSidebarProject[] = [
  {
    id: "moebius",
    path: "/Users/example/work/moebius",
    sessions: [
      { id: "running-fix", title: "失败汇总修复", awaitsHumanReason: "exception", unreadSince: "2026-07-11T10:06:00.000Z", isRunning: true, createdAt: "2026-07-11T10:05:00.000Z", summary: "需要处理异常" },
      { id: "docs-history", title: "文档归档记录", awaitsHumanReason: null, unreadSince: "2026-07-11T10:04:30.000Z", isRunning: false, createdAt: "2026-07-11T10:04:00.000Z" },
      { id: "waiting-summary", title: "失败汇总", awaitsHumanReason: "acceptance", unreadSince: null, isRunning: false, createdAt: "2026-07-11T10:03:00.000Z", summary: "等你验收" },
      { id: "running-progress", title: "进度提示", awaitsHumanReason: null, unreadSince: null, isRunning: true, createdAt: "2026-07-11T10:02:00.000Z", summary: "正在运行测试" },
      { id: "idle-refactor", title: "导出功能重构", awaitsHumanReason: null, unreadSince: null, isRunning: false, createdAt: "2026-07-11T10:01:00.000Z" }
    ]
  },
  {
    id: "tranfu-site",
    path: "/Users/example/work/tranfu-site/",
    sessions: [
      { id: "site-waiting", title: "首页文案", awaitsHumanReason: "confirmation", unreadSince: null, isRunning: false, createdAt: "2026-07-11T10:01:00.000Z", summary: "提案等确认" },
      { id: "site-idle", title: "分享卡片", awaitsHumanReason: null, unreadSince: null, isRunning: false, createdAt: "2026-07-11T10:00:00.000Z" }
    ]
  }
];

const meta = {
  title: "Block/Console/ConversationSidebar",
  component: ConversationSidebar,
  args: {
    projects,
    selectedSessionId: "running-progress"
  },
  parameters: {
    layout: "centered"
  }
} satisfies Meta<typeof ConversationSidebar>;

export default meta;
type Story = StoryObj<typeof meta>;

export const NewestSessionsFirst: Story = {
  render: (args) => {
    const [selectedSessionId, setSelectedSessionId] = useState(args.selectedSessionId);

    return (
      <ConversationSidebar
        {...args}
        selectedSessionId={selectedSessionId}
        onSelectSession={(sessionId) => setSelectedSessionId(sessionId)}
        className="h-[460px]"
      />
    );
  }
};
