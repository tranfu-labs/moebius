import type { Meta, StoryObj } from "@storybook/react";

import { OperatorConsole, type OperatorConsoleProps } from "@/console/operator-console";

const agentMarkdown = [
  "## 结论",
  "已把复合组件接入真实操作台。",
  "",
  "## 依据",
  "- packages/console-ui/src/console/operator-console.tsx",
  "",
  "## 下一步",
  "交棒：@qa 请按验收场景走查",
  "",
  "<!-- moebius:stage=code-verified -->",
].join("\n");

const sessions: OperatorConsoleProps["project"]["sessions"] = [
  {
    sessionId: "waiting",
    projectId: "local",
    workspaceMode: "worktree",
    workspacePendingMode: null,
    title: "等待验收",
    status: "waiting",
    awaitsHumanReason: "acceptance",
    unreadSince: null,
    runningCount: 0,
    waitingCount: 1,
    stuckCount: 0,
    errorCount: 0,
    interruptedCount: 0,
    createdAt: "2026-07-11T10:00:00.000Z",
    updatedAt: "2026-07-11T10:04:00.000Z",
  },
  {
    sessionId: "running",
    projectId: "local",
    workspaceMode: "worktree",
    workspacePendingMode: null,
    title: "集成收尾",
    status: "running",
    awaitsHumanReason: null,
    unreadSince: null,
    runningCount: 1,
    waitingCount: 0,
    stuckCount: 0,
    errorCount: 0,
    interruptedCount: 0,
    childCount: 1,
    createdAt: "2026-07-11T10:00:00.000Z",
    updatedAt: "2026-07-11T10:04:00.000Z",
  },
  {
    sessionId: "idle",
    projectId: "local",
    workspaceMode: "worktree",
    workspacePendingMode: null,
    parentSessionId: "running",
    title: "截图走查",
    status: "idle",
    awaitsHumanReason: null,
    unreadSince: "2026-07-11T10:04:00.000Z",
    runningCount: 0,
    waitingCount: 0,
    stuckCount: 0,
    errorCount: 0,
    interruptedCount: 0,
    createdAt: "2026-07-11T10:00:00.000Z",
    updatedAt: "2026-07-11T10:04:00.000Z",
  },
];

const sample: OperatorConsoleProps = {
  project: {
    projectId: "local",
    sourceType: "local-folder",
    title: "moebius",
    folderPath: "/Users/example/moebius",
    worktreeMode: true,
    workspaceCwd: "/tmp/t65-cwd-sentinel",
    workspaceMode: "worktree",
    worktreePath: "/tmp/t65-worktree-sentinel",
    worktreeUnavailableReason: null,
    workspaceUpdatedAt: "2026-07-11T10:04:00.000Z",
    sessions,
    runningCount: 1,
    waitingCount: 1,
    stuckCount: 0,
    errorCount: 0,
  },
  selectedProjectId: "local",
  selectedSessionId: "running",
  selectedSession: sessions[1]!,
  messages: [
    {
      id: 1,
      sessionId: "running",
      speaker: "user",
      role: null,
      body: "请完成 T6.5 集成收尾。",
      status: "displayed",
      runId: null,
      runDir: null,
      error: null,
      createdAt: "2026-07-11T10:00:00.000Z",
      updatedAt: "2026-07-11T10:00:00.000Z",
    },
    {
      id: 2,
      sessionId: "running",
      speaker: "agent",
      role: "dev",
      body: agentMarkdown,
      status: "displayed",
      runId: "run-t65",
      runDir: "/tmp/t65-runDir-sentinel",
      error: null,
      createdAt: "2026-07-11T10:01:00.000Z",
      updatedAt: "2026-07-11T10:02:00.000Z",
    },
  ],
  activeRun: {
    sessionId: "running",
    runId: "run-t65",
    role: "dev",
    status: "running",
    startedAt: "2026-07-11T10:01:00.000Z",
    elapsedMs: 94_000,
    runDir: "/tmp/t65-runDir-sentinel",
    cwd: "/tmp/t65-cwd-sentinel",
    workspaceMode: "worktree",
    worktreeUnavailableReason: null,
    stdoutTail: "stdout tail with raw detail",
    stderrTail: null,
    liveMarkdown: "## 正在整合\n\n- 保留一个活动节点\n- 原地更新 Markdown",
    lastOutputSummary: "正在整合复合组件",
    tailDiagnostic: null,
    interruptible: true,
  },
  composerValue: "@",
  runnerStatus: "running",
  sqlitePath: ".state/local-console.sqlite",
  lastError: null,
  onComposerChange: () => undefined,
  onSend: () => undefined,
  onSelectSession: () => undefined,
  onInterrupt: () => undefined,
};

const meta = {
  title: "Page/Console/OperatorConsole",
  component: OperatorConsole,
  args: sample,
  parameters: {
    layout: "fullscreen",
  },
} satisfies Meta<typeof OperatorConsole>;

export default meta;
type Story = StoryObj<typeof meta>;

export const T65Running: Story = {};

export const SidebarConversationManagement: Story = {
  args: {
    project: {
      ...sample.project,
      branchName: "feature/sidebar-management",
      isGitRepository: true,
      sessions: [
        {
          ...sessions[0]!,
          title: "发布前检查",
          hasUnacknowledgedAttention: true,
          attentionRevision: 3,
          attentionAcknowledgedRevision: 2,
          titleRevision: 1,
          branchName: "feature/sidebar-management",
          pinnedAt: "2026-07-11T10:10:00.000Z",
        },
        {
          ...sessions[1]!,
          title: "发布前检查",
          hasUnacknowledgedAttention: false,
          titleRevision: 0,
          branchName: "feature/release-check",
        },
        {
          ...sessions[2]!,
          parentSessionId: null,
          title: "文档同步",
          hasUnacknowledgedAttention: false,
          manualUnreadAt: "2026-07-11T10:08:00.000Z",
          titleRevision: 0,
          branchName: "feature/docs",
        },
      ],
    },
    selectedSession: {
      ...sessions[1]!,
      title: "发布前检查",
      hasUnacknowledgedAttention: false,
      titleRevision: 0,
      branchName: "feature/release-check",
    },
    rightSidebarOpen: true,
    rightSidebarTabs: {
      tabs: [
        {
          id: "same-title-a",
          type: "conversation",
          title: "发布前检查",
          sourceKey: "conversation:waiting",
          closable: true,
        },
        {
          id: "same-title-b",
          type: "conversation",
          title: "发布前检查",
          sourceKey: "conversation:running",
          closable: true,
        },
      ],
      activeTabId: "same-title-b",
    },
    rightSidebarTabDiscriminators: {
      "same-title-a": "moebius · feature/sidebar-management",
      "same-title-b": "moebius · feature/release-check",
    },
    onUpdateSessionReadState: async () => undefined,
    onSetSessionPinned: async () => undefined,
    onRenameSession: async () => undefined,
  },
};

export const PrimaryControlLanes: Story = {
  args: {
    activeRun: {
      ...sample.activeRun!,
      runId: "run-manager",
      role: "dev-manager",
      liveMarkdown: "## 正在判断新消息\n\n主理人保持运行，同时协调开发与测试两条执行车道。",
      lastOutputSummary: "主理人正在协调团队",
    },
    activeRuns: [
      {
        ...sample.activeRun!,
        runId: "run-manager",
        role: "dev-manager",
        liveMarkdown: "## 正在判断新消息\n\n主理人保持运行，同时协调开发与测试两条执行车道。",
        lastOutputSummary: "主理人正在协调团队",
      },
      {
        ...sample.activeRun!,
        runId: "run-dev",
        role: "dev",
        liveMarkdown: "正在修复停止链路，并等待主理人的下一次重定向。",
        lastOutputSummary: "开发正在修复停止链路",
      },
      {
        ...sample.activeRun!,
        runId: "run-qa",
        role: "qa",
        liveMarkdown: "正在验证并行运行时只停止自己的 runId。",
        lastOutputSummary: "测试正在验证并行停止",
      },
    ],
    pendingPrimaryMessages: [
      {
        ...sample.messages[0]!,
        id: 21,
        body: "先确认停止按钮只影响主理人",
        status: "pending",
      },
      {
        ...sample.messages[0]!,
        id: 22,
        body: "然后补充多 Agent 并行验收说明",
        status: "pending",
      },
    ],
    selectedSession: {
      ...sessions[1]!,
      runningCount: 3,
    },
    composerValue: "这条消息继续发给主理人",
  },
};

export const DashboardShellAlignment: Story = {
  args: {
    projects: [
      {
        ...sample.project,
        sessions: [
          ...sessions,
          {
            ...sessions[2]!,
            sessionId: "unread-root",
            parentSessionId: null,
            title: "长消息版式复核",
          },
        ],
      },
      {
        ...sample.project,
        projectId: "marketing",
        title: "marketing-site",
        folderPath: "/Users/example/marketing-site",
        sessions: [
          {
            ...sessions[0]!,
            projectId: "marketing",
            sessionId: "marketing-waiting",
            title: "官网分享卡片",
          },
        ],
      },
    ],
    messages: [
      {
        ...sample.messages[0]!,
        body: "请把左侧栏、长消息、活动记录和输入框统一到同一条 dashboard 内容轴。",
      },
      {
        ...sample.messages[1]!,
        body: [
          "## 对齐说明",
          "",
          "这是一段用于检查 68ch 阅读宽度的长回复。它保留 Markdown、完整输出和成员身份，同时让正文从 24px 头像左缘向右缩进 32px。",
          "",
          "窗口变窄后，标题、消息、活动 run、待发射区和 composer 应该共同收缩，不能让根页面产生横向滚动。",
        ].join("\n"),
      },
    ],
    pendingPrimaryMessages: [
      {
        ...sample.messages[0]!,
        id: 41,
        body: "等待主理人结束后继续核对窄窗。",
        status: "pending",
      },
    ],
    composerValue: "补充一条带附件的草稿",
    rightSidebarOpen: false,
  },
};

export const DashboardShellWithRightSidebar: Story = {
  args: {
    ...DashboardShellAlignment.args,
    rightSidebarOpen: true,
  },
};

export const T65Outcomes: Story = {
  args: {
    activeRun: null,
    selectedSession: { ...sessions[1]!, status: "idle", runningCount: 0 },
    messages: [
      {
        ...sample.messages[0],
        id: 10,
        speaker: "system",
        status: "failed",
        body: "Codex failed: exit:42",
        error: "exit:42",
      },
      {
        ...sample.messages[0],
        id: 11,
        speaker: "system",
        status: "stuck",
        body: "Codex stuck: idle-timeout:10ms",
        error: "idle-timeout:10ms",
      },
      {
        ...sample.messages[0],
        id: 12,
        speaker: "system",
        status: "interrupted",
        body: "Interrupted by user",
        error: "interrupted:user-interrupted",
      },
      {
        ...sample.messages[0],
        id: 13,
        speaker: "system",
        status: "failed",
        body: "dead-letter body handoff raw",
        error: "dead-letter: repeated exit",
      },
    ],
  },
};

export const T65EmptyComposer: Story = {
  args: {
    activeRun: null,
    messages: [],
    selectedSession: { ...sessions[2]!, status: "idle" },
    selectedSessionId: "idle",
    composerValue: "@",
  },
};

export const ConversationRelayReference: Story = {
  args: {
    activeRun: null,
    memberIdentities: [
      { slug: "dev-manager", displayName: "主理人" },
      { slug: "dev", displayName: "开发" },
      { slug: "qa", displayName: "测试" },
    ],
    messages: [
      {
        ...sample.messages[0]!,
        id: 31,
        body: "请把主会话目录轨对齐 dashboard 参考稿。",
      },
      {
        ...sample.messages[1]!,
        id: 32,
        role: "dev-manager",
        body: "先确认产品事实与实现边界。",
      },
      {
        ...sample.messages[1]!,
        id: 33,
        role: "dev",
        body: "已经完成成员泳道与分支模型。",
      },
      {
        ...sample.messages[1]!,
        id: 34,
        role: "dev-manager",
        body: "继续补齐自动验证。",
      },
      {
        ...sample.messages[1]!,
        id: 35,
        role: "qa",
        body: "等待独立桌面视觉复核。",
      },
      {
        ...sample.messages[1]!,
        id: 36,
        role: "dev",
        body: "自动证据已经准备完成。",
      },
    ],
    selectedSession: { ...sessions[1]!, status: "idle", runningCount: 0 },
  },
};

export const ConversationRelayRightSidebarOpen: Story = {
  args: {
    ...ConversationRelayReference.args,
    rightSidebarOpen: true,
    sidebarOpen: true,
  },
};

export const ConversationRelayProjectSidebarClosed: Story = {
  args: {
    ...ConversationRelayReference.args,
    rightSidebarOpen: false,
    sidebarOpen: false,
  },
};
