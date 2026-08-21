import { act, useState } from "react";
import type { Meta, StoryObj } from "@storybook/react";

import type { OperatorAgentTeam } from "@/console/agent-teams-page";
import {
  ResponsiveOperatorConsole,
  type OperatorConsoleProps,
  type OperatorProject,
} from "@/console/operator-console";
import { RIGHT_SIDEBAR_BUILTIN_TAB_TITLES } from "@/console/right-sidebar-tabs";

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
  sqlitePath: ".state/local-console.sqlite",
  onComposerChange: () => undefined,
  onSend: () => undefined,
  onSelectSession: () => undefined,
  onInterrupt: () => undefined,
};

const traceabilityTeams: OperatorAgentTeam[] = [
  {
    teamKey: "system:development",
    id: "development",
    ownership: "system",
    officialSourceName: "Moebius",
    name: "研发团队（当前目录）",
    description: "当前已保存的团队信息，用于与对话历史快照区分。",
    primaryAgentSlug: "product-delivery-lead",
    memberOrder: [
      "product-delivery-lead",
      "product-reviewer",
      "implementation-lead",
      "functional-qa",
      "visual-qa",
      "release",
    ],
    members: [
      { slug: "product-delivery-lead", displayName: "交付负责人", description: "统筹交付" },
      { slug: "product-reviewer", displayName: "产品评审", description: "产品复核" },
      { slug: "implementation-lead", displayName: "实现负责人", description: "生产实现" },
      { slug: "functional-qa", displayName: "功能验收", description: "功能验证" },
      { slug: "visual-qa", displayName: "视觉验收", description: "视觉验证" },
      { slug: "release", displayName: "发布", description: "发布收尾" },
    ],
    status: "usable",
    canCreateConversation: true,
  },
];

const dashboardComposerTeams: OperatorAgentTeam[] = [
  ...traceabilityTeams,
  {
    teamKey: "user:product-review",
    id: "product-review",
    ownership: "user",
    name: "产品评审团队",
    description: "用于从当前会话切换到另一套可继续执行的团队配置。",
    primaryAgentSlug: "product-reviewer",
    memberOrder: ["product-reviewer", "visual-qa"],
    members: [
      { slug: "product-reviewer", displayName: "产品评审", description: "产品复核" },
      { slug: "visual-qa", displayName: "视觉验收", description: "视觉验证" },
    ],
    status: "usable",
    canCreateConversation: true,
  },
];

const traceabilitySession: OperatorConsoleProps["selectedSession"] = {
  ...sessions[1]!,
  agentTeamOwnership: "system",
  agentTeamId: "development",
  agentTeamHealth: "usable",
  agentTeamSnapshot: {
    team: {
      ownership: "system",
      id: "development",
      name: "开发团队（对话已载入）",
      description: "这份名称与成员身份来自对话冻结的历史版本。",
      primaryAgentSlug: "product-delivery-lead",
      officialSourceName: "Moebius",
    },
    members: traceabilityTeams[0]!.members.map((member) => ({
      name: member.slug,
      displayName: member.displayName,
      description: member.description,
    })),
    loadedAt: "2026-08-04T10:00:00.000Z",
  },
};

const traceabilityArgs = {
  selectedSession: traceabilitySession,
  conversationAgentTeamKey: "system:development",
  agentTeamsState: { status: "ready", teams: traceabilityTeams } as const,
  sessionTeamUpdate: {
    status: "available",
    categories: [
      { kind: "agent-definition", affectedMemberCount: 2 },
      { kind: "execution-profile", affectedMemberCount: 1 },
      { kind: "team-information", affectedMemberCount: 1 },
    ],
  } as const,
  onApplySessionTeamUpdate: () => undefined,
  onLoadRunAgentInfo: async () => ({
    sessionId: "running",
    runId: "run-t65",
    role: "dev",
    agent: { slug: "dev", displayName: "开发", description: "生产实现" },
    team: { teamKey: "system:development", name: "开发团队（对话已载入）", ownership: "system" as const, sourceName: "Moebius" },
    profile: { cli: "codex" as const, model: "gpt-5", effort: "high" },
    loadedAt: "2026-08-04T10:00:00.000Z",
    evidence: "executed" as const,
  }),
} satisfies Partial<OperatorConsoleProps>;

const meta = {
  title: "Page/Console/OperatorConsole",
  component: ResponsiveOperatorConsole,
  args: {
    ...sample,
    appearance: "focused",
  },
  parameters: {
    layout: "fullscreen",
  },
} satisfies Meta<typeof ResponsiveOperatorConsole>;

export default meta;
type Story = StoryObj<typeof meta>;

export const T65Running: Story = {
  name: "T6.5 · 运行中",
};

/** 侧边栏底部同步进行态：与"安装更新"共用同一位置，hover 报出正在同步的团队名。 */
export const TeamSyncInProgress: Story = {
  args: {
    teamSyncStatus: { kind: "syncing", teamNames: ["开发团队", "内容生产团队"] },
  },
};

/** 同步产生了实际改动后的一次性提示；点击进入团队页并收起。 */
export const TeamSyncUpdated: Story = {
  args: {
    teamSyncStatus: { kind: "updated" },
    onDismissTeamSyncStatus: () => undefined,
  },
};

export const PiApiRunning: Story = {
  name: "Pi API · 运行中",
  args: {
    activeRun: {
      ...sample.activeRun!,
      engine: "pi",
      activity: {
        cursor: 3,
        kind: "edit",
        phase: "running",
        action: "正在修改",
        object: "src/provider-profile.ts",
        occurredAt: "2026-08-05T08:01:00.000Z",
      },
      lastOutputSummary: "Pi API 正在通过 DeepSeek 执行编码任务",
      liveMarkdown: "## 正在执行\n\n已读取项目并准备运行定向测试。",
    },
  },
};

export const SidebarConversationManagement: Story = {
  name: "侧边栏 · 会话管理",
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
  name: "主理人 · 多车道控制",
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
  name: "仪表盘 · 内容轴对齐",
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
    selectedSession: traceabilitySession,
    conversationAgentTeamKey: "system:development",
    agentTeamsState: { status: "ready", teams: dashboardComposerTeams },
    onChangeSessionTeam: () => undefined,
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
          "**关键判断：** 正文、操作与行内强调必须使用稳定的字重层级。这段长回复保留 Markdown、完整输出和成员身份，同时让正文从 24px 头像左缘向右缩进 32px。",
          "",
          "窗口变窄后，标题、消息、活动 run、排队区和 composer 应该共同收缩，不能让根页面产生横向滚动。",
        ].join("\n"),
        runTiming: {
          stepId: "step-dashboard-alignment",
          attempt: 1,
          createdAt: "2026-07-11T10:01:00.000Z",
          startedAt: "2026-07-11T10:01:00.000Z",
          elapsedMs: 60_000,
          completedAt: "2026-07-11T10:02:00.000Z",
          status: "completed",
          engine: "codex",
          processOutputAvailable: true,
        },
      },
    ],
    pendingPrimaryMessages: [
      {
        ...sample.messages[0]!,
        id: 41,
        body: "等待主理人结束后继续核对窄窗，并补充右侧文件改动区域的边界与选中状态。",
        status: "pending",
      },
      {
        ...sample.messages[0]!,
        id: 42,
        body: "复核文件树选中状态与改动行的层次。",
        status: "pending",
      },
      {
        ...sample.messages[0]!,
        id: 43,
        body: "最后检查深色模式下输入框与浮岛的层次。",
        status: "pending",
      },
    ],
    composerValue: "补充一条带附件的草稿",
    rightSidebarOpen: false,
  },
};

export const ProjectActions: Story = {
  name: "项目 · 菜单与排序",
  parameters: {
    userActionCoverage: {
      required: true,
      actions: [
        "project-row.collapse",
        "project-row.reorder",
        "project-menu.show-in-folder",
        "project-menu.rename",
        "project-menu.remove",
      ],
    },
  },
  render: (args) => <ProjectActionsStory args={args} />,
  play: async ({ canvasElement }) => {
    const secondaryProjectId = "project-actions-secondary";
    const secondaryRow = () => projectActionsRow(canvasElement, secondaryProjectId);
    const feedback = () => canvasElement.querySelector<HTMLElement>("[data-testid='project-actions-feedback']");

    const secondaryToggle = secondaryRow().querySelector<HTMLElement>(
      "[data-testid='conversation-sidebar-project-toggle']",
    );
    if (secondaryToggle === null) {
      throw new Error("ProjectActions story requires a secondary project toggle");
    }
    secondaryToggle.focus();
    await dispatchStoryKey(secondaryToggle, "Enter");
    await nextStoryFrame();
    if (secondaryToggle.getAttribute("aria-expanded") !== "false") {
      throw new Error("ProjectActions story did not collapse the secondary project");
    }

    const sourceRow = secondaryRow();
    await dispatchStoryPointer(sourceRow, "pointerdown", 2, 180, 20);
    await waitStoryMilliseconds(160);
    await dispatchStoryPointer(sourceRow, "pointermove", 2, 180, -10);
    await dispatchStoryPointer(sourceRow, "pointerup", 2, 180, -10);
    await nextStoryFrame();
    await nextStoryFrame();
    const projectOrder = Array.from(canvasElement.querySelectorAll<HTMLElement>(
      "[data-testid='conversation-sidebar-project']",
    )).map((element) => element.getAttribute("data-project-id"));
    if (projectOrder.join(",") !== `${secondaryProjectId},project-actions`) {
      throw new Error(`ProjectActions story did not reorder projects: ${projectOrder.join(",")}`);
    }
    if (feedback()?.textContent?.trim() !== "项目顺序已保存。") {
      throw new Error("ProjectActions story did not show reorder feedback");
    }

    await chooseProjectAction(canvasElement, secondaryProjectId, "在文件管理器中显示", 3);
    if (feedback()?.textContent?.trim() !== "已触发“在文件管理器中显示”，项目仍保持可用。") {
      throw new Error("ProjectActions story did not show show-in-folder feedback");
    }

    await chooseProjectAction(canvasElement, secondaryProjectId, "修改显示名称", 4);
    const renameInput = document.querySelector<HTMLInputElement>("[role='dialog'] input");
    if (renameInput === null) {
      throw new Error("ProjectActions story did not open the rename dialog");
    }
    await setStoryInputValue(renameInput, "docs-site-renamed");
    const saveButton = Array.from(document.querySelectorAll<HTMLButtonElement>("[role='dialog'] button"))
      .find((button) => button.textContent?.trim() === "保存");
    if (saveButton === undefined) {
      throw new Error("ProjectActions story did not expose the rename confirmation");
    }
    await clickStoryElement(saveButton);
    await nextStoryFrame();
    if (canvasElement.textContent?.includes("docs-site-renamed") !== true) {
      throw new Error("ProjectActions story did not show the renamed project");
    }
    if (feedback()?.textContent?.trim() !== "项目显示名称已更新。") {
      throw new Error("ProjectActions story did not show rename feedback");
    }

    await chooseProjectAction(canvasElement, secondaryProjectId, "移除项目", 5);
    const removeButton = Array.from(document.querySelectorAll<HTMLButtonElement>("[role='dialog'] button"))
      .find((button) => button.textContent?.trim() === "移除项目");
    if (removeButton === undefined) {
      throw new Error("ProjectActions story did not expose the remove confirmation");
    }
    await clickStoryElement(removeButton);
    await nextStoryFrame();
    if (canvasElement.querySelector(`[data-testid='conversation-sidebar-project'][data-project-id='${secondaryProjectId}']`) !== null) {
      throw new Error("ProjectActions story did not remove the secondary project");
    }
    if (feedback()?.textContent?.trim() !== "项目已从侧栏移除，磁盘文件夹保留。") {
      throw new Error("ProjectActions story did not show remove feedback");
    }
  },
};

function projectActionsRow(canvasElement: HTMLElement, projectId: string): HTMLElement {
  const row = canvasElement.querySelector<HTMLElement>(
    `[data-testid='conversation-sidebar-project'][data-project-id='${projectId}']`,
  );
  if (row === null) {
    throw new Error(`ProjectActions story could not find project row ${projectId}`);
  }
  return row;
}

async function chooseProjectAction(
  canvasElement: HTMLElement,
  projectId: string,
  label: string,
  pointerId: number,
): Promise<void> {
  const trigger = projectActionsRow(canvasElement, projectId).querySelector<HTMLButtonElement>(
    "[data-project-row-action='project-menu']",
  );
  if (trigger === null) {
    throw new Error(`ProjectActions story could not find project menu ${projectId}`);
  }
  await dispatchStoryPointer(trigger, "pointerdown", pointerId, 180, 20);
  await dispatchStoryPointer(trigger, "pointerup", pointerId, 180, 20);
  await clickStoryElement(trigger);
  await nextStoryFrame();
  const menuItem = Array.from(document.querySelectorAll<HTMLElement>("[role='menuitem']"))
    .find((element) => element.textContent?.trim() === label);
  if (menuItem === undefined) {
    throw new Error(`ProjectActions story could not find menu item ${label}`);
  }
  await dispatchStoryPointer(menuItem, "pointerdown", pointerId, 180, 20);
  await dispatchStoryPointer(menuItem, "pointerup", pointerId, 180, 20);
  await clickStoryElement(menuItem);
  await nextStoryFrame();
}

async function clickStoryElement(element: Element): Promise<void> {
  await act(async () => {
    element.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, button: 0 }));
  });
}

async function setStoryInputValue(input: HTMLInputElement, value: string): Promise<void> {
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
    setter?.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

function ProjectActionsStory({ args }: { args: OperatorConsoleProps }): JSX.Element {
  const [projects, setProjects] = useState<OperatorProject[]>(createProjectActionsFixture);
  const [selectedProjectId, setSelectedProjectId] = useState("project-actions");
  const [selectedSessionId, setSelectedSessionId] = useState("project-actions-session");
  const [feedback, setFeedback] = useState("打开项目更多菜单，完成一个动作后这里会显示结果。");
  const selectedProject = projects.find((candidate) => candidate.projectId === selectedProjectId)
    ?? projects[0]!;
  const selectedSession = selectedProject.sessions.find((candidate) => candidate.sessionId === selectedSessionId)
    ?? selectedProject.sessions[0]
    ?? null;

  return (
    <ResponsiveOperatorConsole
      {...args}
      project={selectedProject}
      projects={projects}
      selectedProjectId={selectedProject.projectId}
      selectedSessionId={selectedSession?.sessionId ?? ""}
      selectedSession={selectedSession}
      messages={[]}
      activeRun={null}
      composerValue=""
      conversationNotice={<span data-testid="project-actions-feedback">{feedback}</span>}
      onSelectSession={({ sessionId, projectId }) => {
        setSelectedSessionId(sessionId);
        setSelectedProjectId(projectId);
        setFeedback("已打开所选对话。");
      }}
      onShowProjectInFolder={() => {
        setFeedback("已触发“在文件管理器中显示”，项目仍保持可用。");
      }}
      onRenameProject={async (projectId, title) => {
        const nextTitle = title.trim() || "project-actions";
        setProjects((current) => current.map((candidate) => candidate.projectId === projectId
          ? { ...candidate, title: nextTitle }
          : candidate));
        setFeedback("项目显示名称已更新。");
      }}
      onRemoveProject={async (projectId) => {
        setProjects((current) => {
          const next = current.filter((candidate) => candidate.projectId !== projectId);
          const fallback = next[0];
          if (fallback !== undefined) {
            setSelectedProjectId(fallback.projectId);
            setSelectedSessionId(fallback.sessions[0]?.sessionId ?? "");
          }
          return next;
        });
        setFeedback("项目已从侧栏移除，磁盘文件夹保留。");
      }}
      onReorderProjects={async (projectIds) => {
        setProjects((current) => {
          const byId = new Map(current.map((candidate) => [candidate.projectId, candidate]));
          return projectIds.flatMap((projectId) => {
            const candidate = byId.get(projectId);
            return candidate === undefined ? [] : [candidate];
          });
        });
        setFeedback("项目顺序已保存。");
        return true;
      }}
    />
  );
}

function createProjectActionsFixture(): OperatorProject[] {
  const primarySession = {
    ...sessions[1]!,
    sessionId: "project-actions-session",
    projectId: "project-actions",
    title: "菜单动作旅程",
    status: "idle" as const,
    runningCount: 0,
  };
  const secondarySession = {
    ...sessions[2]!,
    sessionId: "project-actions-secondary-session",
    projectId: "project-actions-secondary",
    title: "拖拽与折叠复核",
    status: "idle" as const,
    runningCount: 0,
  };
  return [
    {
      ...sample.project,
      projectId: "project-actions",
      title: "moebius",
      folderPath: "/Users/example/moebius",
      sessions: [primarySession],
      runningCount: 0,
      waitingCount: 0,
    },
    {
      ...sample.project,
      projectId: "project-actions-secondary",
      title: "docs-site",
      folderPath: "/Users/example/docs-site",
      sessions: [secondarySession],
      runningCount: 0,
      waitingCount: 0,
    },
  ];
}

async function dispatchStoryPointer(
  element: Element,
  type: "pointerdown" | "pointermove" | "pointerup",
  pointerId: number,
  clientX: number,
  clientY: number,
): Promise<void> {
  const event = typeof globalThis.PointerEvent === "function"
    ? new globalThis.PointerEvent(type, {
      bubbles: true,
      cancelable: true,
      button: 0,
      pointerId,
      clientX,
      clientY,
    })
    : new MouseEvent(type, {
      bubbles: true,
      cancelable: true,
      button: 0,
      clientX,
      clientY,
    });
  if (!("pointerId" in event)) {
    Object.defineProperty(event, "pointerId", { value: pointerId });
  }
  await act(async () => {
    element.dispatchEvent(event);
  });
}

async function dispatchStoryKey(element: Element, key: string): Promise<void> {
  await act(async () => {
    element.dispatchEvent(new KeyboardEvent("keydown", {
      bubbles: true,
      cancelable: true,
      key,
    }));
  });
}

async function nextStoryFrame(): Promise<void> {
  await new Promise<void>((resolve) => window.setTimeout(resolve, 0));
}

async function waitStoryMilliseconds(milliseconds: number): Promise<void> {
  await new Promise<void>((resolve) => window.setTimeout(resolve, milliseconds));
}

export const DashboardLoadingState: Story = {
  name: "仪表盘 · 加载中",
  args: {
    ...DashboardShellAlignment.args,
    projectListState: "loading",
  },
};

export const DashboardEmptyState: Story = {
  name: "仪表盘 · 空会话",
  args: {
    ...DashboardShellAlignment.args,
    messages: [],
    activeRun: null,
    pendingPrimaryMessages: [],
    selectedSession: { ...sessions[1]!, status: "idle", runningCount: 0 },
  },
};

export const DashboardShellWithRightSidebar: Story = {
  name: "聚焦画布 · 右侧栏",
  args: {
    ...DashboardShellAlignment.args,
    projects: DashboardShellAlignment.args?.projects?.map((project) => ({
      ...project,
      isGitRepository: true,
    })),
    project: {
      ...sample.project,
      isGitRepository: true,
    },
    rightSidebarOpen: true,
    rightSidebarTabs: {
      tabs: [{
        id: "workspace-diff",
        type: "workspace-diff",
        title: RIGHT_SIDEBAR_BUILTIN_TAB_TITLES.workspaceDiff,
        sourceKey: "workspace-diff:running",
        closable: true,
      }],
      activeTabId: "workspace-diff",
    },
    workspaceDiff: { available: true, fileCount: 4, reason: null },
    onRetryRun: () => undefined,
    onAnalyzeConversation: () => undefined,
    onLoadWorkspaceDiff: async () => ({
      available: true,
      fileCount: 4,
      files: [
        { path: "packages/console-ui/src/console/operator-console.stories.tsx", additions: 48, deletions: 7 },
        { path: "packages/console-ui/src/styles/tokens.css", additions: 12, deletions: 6 },
        { path: "packages/console-ui/src/console/conversation-layout.ts", additions: 8, deletions: 3 },
        { path: "packages/console-ui/src/console/operator-console.test.tsx", additions: 26, deletions: 0 },
      ],
      reason: null,
      workspaceMode: "worktree",
    }),
    onLoadWorkspaceDiffFile: async (_sessionId, filePath) => ({
      available: true,
      path: filePath,
      reason: null,
      lines: [
        { kind: "unchanged", oldLineNumber: 760, newLineNumber: 760, text: "export const DashboardShellWithRightSidebar: Story = {" },
        { kind: "deletion", oldLineNumber: 761, newLineNumber: null, text: "  args: DashboardShellAlignment.args," },
        { kind: "addition", oldLineNumber: null, newLineNumber: 761, text: "  name: \"Focused canvas · 1440 × 832\"," },
        { kind: "addition", oldLineNumber: null, newLineNumber: 762, text: "  render: (args) => <ResponsiveOperatorConsole {...args} />," },
        { kind: "addition", oldLineNumber: null, newLineNumber: 763, text: "  args: { ...DashboardShellAlignment.args, appearance: \"focused\" }," },
        { kind: "unchanged", oldLineNumber: 762, newLineNumber: 764, text: "};" },
      ],
    }),
  },
  parameters: {
    viewport: {
      defaultViewport: "balancedDesktop",
      viewports: {
        balancedDesktop: {
          name: "均衡桌面 1440 × 832",
          styles: { width: "1440px", height: "832px" },
        },
      },
    },
  },
};

export const DashboardShellWithLongComposer: Story = {
  name: "聚焦画布 · 长输入",
  args: {
    ...DashboardShellWithRightSidebar.args,
    composerValue: [
      "请继续检查当前收尾方案，尤其关注右侧文件改动、主对话内容轴和输入区之间的响应式关系。",
      "窗口变窄时不要让输入内容挤压操作按钮，也不要让 Composer 突然横向滚动。",
      "最后请补充一份可以直接交给测试同学复核的验收说明。",
    ].join("\n"),
  },
  parameters: DashboardShellWithRightSidebar.parameters,
};

export const DashboardNarrowSidebarDrawer: Story = {
  name: "窄窗口 · 侧边栏抽屉",
  args: DashboardShellAlignment.args,
  parameters: {
    viewport: {
      defaultViewport: "dashboardNarrow",
      viewports: {
        dashboardNarrow: {
          name: "仪表盘窄窗 700 × 600",
          styles: { width: "700px", height: "600px" },
        },
      },
    },
  },
  play: async ({ canvasElement }) => {
    Array.from(canvasElement.querySelectorAll<HTMLButtonElement>("button"))
      .find((button) => button.getAttribute("aria-label") === "打开侧边栏")
      ?.click();
  },
};

export const T65Outcomes: Story = {
  name: "T6.5 · 终局结果",
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
  name: "T6.5 · 空输入框",
  args: {
    activeRun: null,
    messages: [],
    selectedSession: { ...sessions[2]!, status: "idle" },
    selectedSessionId: "idle",
    composerValue: "@",
  },
};

export const ConversationRelayReference: Story = {
  name: "会话目录轨 · 接力参考",
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
  name: "会话目录轨 · 打开右侧栏",
  args: {
    ...ConversationRelayReference.args,
    rightSidebarOpen: true,
    sidebarOpen: true,
  },
};

export const ConversationRelayProjectSidebarClosed: Story = {
  name: "会话目录轨 · 关闭项目侧栏",
  args: {
    ...ConversationRelayReference.args,
    rightSidebarOpen: false,
    sidebarOpen: false,
  },
};

export const TeamTraceabilityLight: Story = {
  name: "团队可追溯 · 浅色",
  args: traceabilityArgs,
};

export const TeamTraceabilityDark: Story = {
  name: "团队可追溯 · 深色",
  args: traceabilityArgs,
  globals: { theme: "dark" },
};

export const TeamTraceabilityNarrow: Story = {
  name: "团队可追溯 · 窄窗口",
  args: traceabilityArgs,
  parameters: {
    viewport: {
      defaultViewport: "teamTraceabilityNarrow",
      viewports: {
        teamTraceabilityNarrow: {
          name: "团队可追溯窄窗 · 680 × 800",
          styles: { width: "680px", height: "800px" },
        },
      },
    },
  },
};

export const TeamTraceabilityReducedMotion: Story = {
  name: "团队可追溯 · 减弱动效",
  args: traceabilityArgs,
  decorators: [
    (Story) => (
      <div className="[&_*]:!animate-none [&_*]:!transition-none [&_*]:!scroll-auto [&_*::before]:!animate-none [&_*::before]:!transition-none [&_*::after]:!animate-none [&_*::after]:!transition-none">
        <Story />
      </div>
    ),
  ],
};

const sessionTeamUpdateDetailArgs = {
  ...traceabilityArgs,
  onViewSessionTeamUpdate: () => undefined,
  onDismissSessionTeamUpdateCategory: () => undefined,
  sessionTeamUpdateDetailView: {
    teamName: "开发团队",
    members: [
      {
        memberSlug: "dev-manager",
        displayName: "开发经理",
        changes: [{
          summary: "交付汇总以真机行为证据开头……",
          authorLabel: "官方 v1.3",
          previousText: "交付汇总列出改动文件",
        }],
      },
      {
        memberSlug: "qa",
        displayName: "测试",
        changes: [{
          summary: "把自动返工上限从三轮改成两轮",
          authorLabel: "你 · 3 天前",
          previousText: null,
        }],
      },
    ],
  },
} satisfies Partial<OperatorConsoleProps>;

/** 会话内变化提示带"查看"和"×"，在完整会话页语境里查看信息密度与相邻关系。 */
export const SessionTeamUpdateWithViewAndDismiss: Story = {
  args: sessionTeamUpdateDetailArgs,
};

export const SessionTeamUpdateWithViewAndDismissDark: Story = {
  args: sessionTeamUpdateDetailArgs,
  globals: { theme: "dark" },
};

export const SessionTeamUpdateWithViewAndDismissNarrow: Story = {
  args: sessionTeamUpdateDetailArgs,
  parameters: {
    viewport: {
      defaultViewport: "sessionTeamUpdateNarrow",
      viewports: {
        sessionTeamUpdateNarrow: {
          name: "Session team update narrow · 680 × 800",
          styles: { width: "680px", height: "800px" },
        },
      },
    },
  },
};

/** 点击"查看"后的弹窗打开态，压在会话页上；右下角"取消"只关闭弹窗，"应用"与提示上的应用同语义。 */
export const SessionTeamUpdateDetailDialogOpen: Story = {
  args: sessionTeamUpdateDetailArgs,
  play: async ({ canvasElement }) => {
    const viewButton = [...canvasElement.querySelectorAll("button")]
      .find((button) => button.textContent?.trim() === "查看");
    if (viewButton === undefined) throw new Error("SessionTeamUpdateDetailDialogOpen story requires a 查看 button");
    viewButton.click();
    await new Promise<void>((resolve) => window.setTimeout(resolve, 0));
  },
};

export const SessionTeamUpdateDetailDialogOpenDark: Story = {
  args: sessionTeamUpdateDetailArgs,
  play: SessionTeamUpdateDetailDialogOpen.play,
  globals: { theme: "dark" },
};

export const SessionTeamUpdateDetailDialogOpenNarrow: Story = {
  args: sessionTeamUpdateDetailArgs,
  play: SessionTeamUpdateDetailDialogOpen.play,
  parameters: {
    viewport: {
      defaultViewport: "sessionTeamUpdateDialogNarrow",
      viewports: {
        sessionTeamUpdateDialogNarrow: {
          name: "Session team update dialog narrow · 480 × 720",
          styles: { width: "480px", height: "720px" },
        },
      },
    },
  },
};
