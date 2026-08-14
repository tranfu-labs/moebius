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
    isGitRepository: true,
    sessions: [
      { id: "running-fix", title: "失败汇总修复", hasUnacknowledgedAttention: true, attentionRevision: 2, titleRevision: 0, unreadSince: "2026-07-11T10:06:00.000Z", isRunning: true, branchName: "feature/sidebar", createdAt: "2026-07-11T10:05:00.000Z", summary: "需要处理异常" },
      { id: "docs-history", title: "文档归档记录", hasUnacknowledgedAttention: false, titleRevision: 0, unreadSince: "2026-07-11T10:04:30.000Z", isRunning: false, branchName: "feature/sidebar", createdAt: "2026-07-11T10:04:00.000Z" },
      { id: "waiting-summary", title: "失败汇总", hasUnacknowledgedAttention: false, titleRevision: 0, unreadSince: null, isRunning: false, branchName: "feature/sidebar", pinnedAt: "2026-07-11T10:08:00.000Z", createdAt: "2026-07-11T10:03:00.000Z", summary: "等你验收" },
      { id: "running-progress", title: "进度提示", hasUnacknowledgedAttention: false, titleRevision: 0, unreadSince: null, isRunning: true, branchName: "feature/sidebar", createdAt: "2026-07-11T10:02:00.000Z", summary: "正在运行测试" },
      { id: "idle-refactor", title: "导出功能重构", hasUnacknowledgedAttention: false, titleRevision: 0, unreadSince: null, isRunning: false, branchName: "feature/sidebar", createdAt: "2026-07-11T10:01:00.000Z" }
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
    appearance: "focused",
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
  name: "页面同款 · 最近会话",
  render: (args) => {
    const [selectedSessionId, setSelectedSessionId] = useState(args.selectedSessionId);
    const [storyProjects, setStoryProjects] = useState(args.projects);

    return (
      <ConversationSidebar
        {...args}
        projects={storyProjects}
        selectedSessionId={selectedSessionId}
        onSelectSession={(sessionId) => setSelectedSessionId(sessionId)}
        onUpdateReadState={async (session, projectId, action) => {
          setStoryProjects((current) => current.map((project) => project.id !== projectId
            ? project
            : {
                ...project,
                sessions: project.sessions.map((candidate) => candidate.id !== session.id
                  ? candidate
                  : action === "mark-read-attention"
                    ? { ...candidate, hasUnacknowledgedAttention: false }
                    : action === "mark-read-unread"
                      ? { ...candidate, unreadSince: null, manualUnreadAt: null }
                      : { ...candidate, manualUnreadAt: "2026-07-11T10:09:00.000Z" }),
              }));
        }}
        onSetSessionPinned={async (session, projectId, pinned) => {
          setStoryProjects((current) => current.map((project) => project.id !== projectId
            ? project
            : {
                ...project,
                sessions: project.sessions.map((candidate) => candidate.id === session.id
                  ? { ...candidate, pinnedAt: pinned ? "2026-07-11T10:10:00.000Z" : null }
                  : candidate),
              }));
        }}
        onRenameSession={async (session, projectId, title) => {
          setStoryProjects((current) => current.map((project) => project.id !== projectId
            ? project
            : {
                ...project,
                sessions: project.sessions.map((candidate) => candidate.id === session.id
                  ? { ...candidate, title: title.trim(), titleRevision: (candidate.titleRevision ?? 0) + 1 }
                  : candidate),
              }));
        }}
        className="h-[460px]"
      />
    );
  }
};
