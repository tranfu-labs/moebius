import type { Meta, StoryObj } from "@storybook/react";
import { useState, type ComponentProps } from "react";

import {
  AgentTeamsPage,
  type OperatorAgentTeam,
} from "@/console/agent-teams-page";
import type {
  AgentExecutionProfileDocument,
  AgentTeamDetailState,
} from "@/console/agent-team-detail";

/**
 * Page-story wrapper that makes the detail view interactive: member tabs switch
 * `selectedMemberSlug` in a local `detailState` instead of dead-ending on a
 * static prop (the production container is stateful; stories must be too, or
 * the review entry points lock up on the first member).
 */
function StatefulAgentTeamsPage({
  detailState,
  onSelectMember,
  ...rest
}: ComponentProps<typeof AgentTeamsPage>): JSX.Element {
  const [currentDetailState, setCurrentDetailState] = useState<AgentTeamDetailState | null>(
    detailState ?? null,
  );
  return (
    <AgentTeamsPage
      {...rest}
      detailState={currentDetailState}
      onSelectMember={onSelectMember ?? ((_teamKey, memberSlug) => {
        setCurrentDetailState((current) => current === null ? current : {
          ...current,
          selectedMemberSlug: memberSlug,
        });
      })}
    />
  );
}

const recommendedCodexProfile: AgentExecutionProfileDocument = {
  binding: { source: "recommended", profile: { cli: "codex", model: "gpt-5.6-sol", effort: "high" } },
  recommendation: { cli: "codex", model: "gpt-5.6-sol", effort: "high" },
  effectiveProfile: { cli: "codex", model: "gpt-5.6-sol", effort: "high" },
};

const builtInTeam: OperatorAgentTeam = {
  teamKey: "system:development",
  id: "system-development",
  ownership: "system",
  name: "开发团队",
  description: "内置的软件开发团队，覆盖方案、实现与测试。",
  primaryAgentSlug: "dev-manager",
  memberOrder: ["dev-manager", "dev", "qa"],
  members: [
    {
      slug: "dev-manager",
      displayName: "开发经理",
      description: "负责技术决策与任务拆分，把控整体质量。",
      executionProfile: recommendedCodexProfile,
    },
    {
      slug: "dev",
      displayName: "开发",
      description: "按方案实现功能，输出代码与验证结果。",
      executionProfile: recommendedCodexProfile,
    },
    {
      slug: "qa",
      displayName: "测试",
      description: "设计测试方案，对抗性审查每个交付。",
      executionProfile: recommendedCodexProfile,
    },
  ],
  status: "usable",
  canCreateConversation: true,
};

const userTeam: OperatorAgentTeam = {
  teamKey: "user:my-dev-team",
  id: "user-my-dev-team",
  ownership: "user",
  name: "我的开发团队",
  description: "为官网重构项目定制的团队，增加了产品经理角色。",
  primaryAgentSlug: "dev-manager",
  memberOrder: ["dev-manager", "product-manager", "dev", "qa"],
  members: [
    {
      slug: "dev-manager",
      displayName: "开发经理",
      description: "负责技术决策与任务拆分，把控整体质量。",
      executionProfile: recommendedCodexProfile,
    },
    {
      slug: "product-manager",
      displayName: "产品经理",
      description: "澄清需求、拆分功能点并验收最终交付。",
      executionProfile: {
        binding: {
          source: "explicit",
          profile: {
            cli: "pi",
            providerId: "deepseek",
            providerProfileId: "deepseek-production",
            model: "deepseek-v4-pro",
            effort: "high",
          },
        },
        recommendation: null,
        effectiveProfile: {
          cli: "pi",
          providerId: "deepseek",
          providerProfileId: "deepseek-production",
          model: "deepseek-v4-pro",
          effort: "high",
        },
      },
    },
    {
      slug: "dev",
      displayName: "开发",
      description: "按方案实现功能，输出代码与验证结果。",
      executionProfile: recommendedCodexProfile,
    },
    {
      slug: "qa",
      displayName: "测试",
      description: "设计测试方案，对抗性审查每个交付。",
      executionProfile: recommendedCodexProfile,
    },
  ],
  status: "usable",
  canCreateConversation: true,
};

const meta = {
  title: "Page/Console/AgentTeamsPage",
  component: AgentTeamsPage,
  render: (args) => <StatefulAgentTeamsPage {...args} />,
  args: {
    state: { status: "ready", teams: [builtInTeam, userTeam] },
    useStackedRows: false,
    onCreateTeam: async () => userTeam,
    onBack: () => undefined,
  },
  parameters: { layout: "fullscreen" },
  globals: { theme: "dark" },
} satisfies Meta<typeof AgentTeamsPage>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Ready: Story = {};

const syncedTeam: OperatorAgentTeam = {
  ...builtInTeam,
  hasUnseenOfficialSync: true,
  officialSyncBanner: {
    officialVersion: "1.3",
    changeSummary: "新增 release，移除 qa，dev 的职责有更新",
    affectedMemberCount: 3,
  },
  recentOfficialSync: {
    officialVersion: "1.3",
    changeSummary: "新增 release，移除 qa，dev 的职责有更新",
    affectedMemberCount: 3,
    timeLabel: "2026-08-06",
  },
};

const officialSyncAndChangesDetailState = {
  teamKey: syncedTeam.teamKey,
  selectedMemberSlug: "dev-manager",
  memberEditors: {
    "dev-manager": {
      memberSlug: "dev-manager",
      loadStatus: "ready" as const,
      loadError: null,
      draftMarkdown: "# 开发经理\n\n你负责判断推进方向、验证方案可行性……\n\n交付汇总以真机行为证据开头，列出改动文件与验证方式。",
      isDirty: false,
      saveStatus: "idle" as const,
      saveError: null,
      externalChangeStatus: "none" as const,
      displayName: "开发经理",
      description: "负责技术决策与任务拆分，把控整体质量。",
      recentChange: {
        summary: "官方 v1.3 更新了 2 处",
        summaryStatus: "ready" as const,
        authorLabel: "官方 v1.3",
        timeLabel: "2026-08-06",
      },
      changeMarkers: [{
        blockIndex: 2,
        authorKind: "official" as const,
        authorLabel: "官方 v1.3",
        timeLabel: "2026-08-06",
        previousText: "交付汇总列出改动文件。",
      }],
      revisionTimeline: [
        {
          id: "rev-3",
          authorLabel: "官方 v1.3",
          timeLabel: "2026-08-06",
          summary: "收紧了交付汇总的证据要求，保留了你写的返工轮次上限",
          summaryStatus: "ready" as const,
        },
        {
          id: "rev-2",
          authorLabel: "你",
          timeLabel: "2026-08-03",
          summary: "把自动返工上限从三轮改成两轮",
          summaryStatus: "ready" as const,
        },
        {
          id: "rev-1",
          authorLabel: "官方 v1.2",
          timeLabel: "2026-07-28",
          summary: "这支团队的官方初始版本",
          summaryStatus: "ready" as const,
          isEarliest: true,
        },
      ],
    },
    // 评审入口要求：非默认成员也必须有可切换的编辑器状态，且至少一名成员的
    // 最近变化与时间线署名是「你」——否则任务 1（"我写的那条记住了吗"）在
    // 默认视图里永远找不到任何一条用户自己的记录。
    "dev": {
      memberSlug: "dev",
      loadStatus: "ready" as const,
      loadError: null,
      draftMarkdown: "# 开发\n\n按方案实现功能，输出代码与验证结果。\n\n单元测试必须覆盖失败恢复路径。",
      isDirty: false,
      saveStatus: "idle" as const,
      saveError: null,
      externalChangeStatus: "none" as const,
      displayName: "开发",
      description: "按方案实现功能，输出代码与验证结果。",
      recentChange: {
        summary: "你补充了失败恢复路径的测试要求",
        summaryStatus: "ready" as const,
        authorLabel: "你",
        timeLabel: "2026-08-04",
      },
      changeMarkers: [{
        blockIndex: 2,
        authorKind: "user" as const,
        authorLabel: "你",
        timeLabel: "2026-08-04",
        previousText: "交付时运行全部相关测试。",
      }],
      revisionTimeline: [
        {
          id: "dev-rev-2",
          authorLabel: "你",
          timeLabel: "2026-08-04",
          summary: "把交付测试要求从「运行全部相关测试」改成「必须覆盖失败恢复路径」",
          summaryStatus: "ready" as const,
        },
        {
          id: "dev-rev-1",
          authorLabel: "官方 v1.2",
          timeLabel: "2026-07-28",
          summary: "这支团队的官方初始版本",
          summaryStatus: "ready" as const,
          isEarliest: true,
        },
      ],
    },
    "qa": {
      memberSlug: "qa",
      loadStatus: "ready" as const,
      loadError: null,
      draftMarkdown: "# 测试\n\n设计测试方案，对抗性审查每个交付。\n\n验收记录必须包含真机步骤。",
      isDirty: false,
      saveStatus: "idle" as const,
      saveError: null,
      externalChangeStatus: "none" as const,
      displayName: "测试",
      description: "设计测试方案，对抗性审查每个交付。",
      recentChange: {
        summary: "官方 v1.3 更新了验收记录要求",
        summaryStatus: "ready" as const,
        authorLabel: "官方 v1.3",
        timeLabel: "2026-08-06",
      },
      changeMarkers: [{
        blockIndex: 2,
        authorKind: "official" as const,
        authorLabel: "官方 v1.3",
        timeLabel: "2026-08-06",
        previousText: "验收记录只列自动化测试结果。",
      }],
      revisionTimeline: [
        {
          id: "qa-rev-3",
          authorLabel: "官方 v1.3",
          timeLabel: "2026-08-06",
          summary: "验收记录改为必须包含真机步骤",
          summaryStatus: "ready" as const,
        },
        {
          id: "qa-rev-2",
          authorLabel: "你",
          timeLabel: "2026-08-02",
          summary: "把验收记录从纯自动化结果改成带环境标注",
          summaryStatus: "ready" as const,
        },
        {
          id: "qa-rev-1",
          authorLabel: "官方 v1.2",
          timeLabel: "2026-07-28",
          summary: "这支团队的官方初始版本",
          summaryStatus: "ready" as const,
          isEarliest: true,
        },
      ],
    },
  },
  saveAllFailures: [],
};

/**
 * 点击"开发团队"进入详情，可见：同步结果横幅、AGENT.md 左侧变化标记与"最近变化"摘要、
 * 点击"全部"展开成员级时间线、"更多"菜单里的"最近的官方同步"。
 * 团队首页横行上"开发团队"带"官方有新变化"标记（进入详情后按规则消失，本 fixture 不模拟该副作用）。
 */
export const OfficialSyncAndChanges: Story = {
  args: {
    state: { status: "ready", teams: [syncedTeam, userTeam] },
    detailState: officialSyncAndChangesDetailState,
    onViewSyncChanges: () => undefined,
    onRevertSync: async () => undefined,
    onDismissSyncBanner: () => undefined,
    onRestoreRevision: async () => undefined,
  },
};

export const OfficialSyncAndChangesNarrow: Story = {
  args: OfficialSyncAndChanges.args,
  parameters: {
    viewport: {
      defaultViewport: "teamsNarrow",
      viewports: {
        teamsNarrow: {
          name: "Agent teams narrow · 390 × 780",
          styles: { width: "390px", height: "780px" },
        },
      },
    },
  },
};

export const OfficialSyncAndChangesLight: Story = {
  args: OfficialSyncAndChanges.args,
  globals: { theme: "light" },
};

/** 点过"全部"之后的时间线展开态——这是用户审查成员级时间线的唯一入口，必须在完整页面语境里看。 */
export const TimelineExpanded: Story = {
  args: OfficialSyncAndChanges.args,
  play: async ({ canvasElement }) => {
    await openTeamRow(canvasElement, syncedTeam.teamKey);
    const toggle = canvasElement.querySelector<HTMLButtonElement>(
      "[data-testid='agent-team-markdown-timeline-toggle']",
    );
    if (toggle === null) throw new Error("TimelineExpanded story requires the timeline toggle button");
    toggle.click();
    await nextFrame();
  },
};

/**
 * 摘要还没生成 / 生成失败两种状态在页面里的样子：dev-manager 的标题行是
 * unavailable（按 changeMarkers 块数出机械摘要「本次改动涉及 2 处」），dev 的
 * 标题行是 pending（「正在生成说明…」）；时间线先展开 dev-manager 看条目，
 * 再点 dev 成员 tab 看标题行 pending。两条标题行都不允许消失——PRD 要求
 * 「最近变化」常驻，摘要缺失时用中性占位。
 */
export const TimelineSummaryPendingAndUnavailable: Story = {
  args: {
    ...OfficialSyncAndChanges.args,
    detailState: {
      ...officialSyncAndChangesDetailState,
      memberEditors: {
        "dev-manager": {
          ...officialSyncAndChangesDetailState.memberEditors["dev-manager"]!,
          recentChange: {
            summary: null,
            summaryStatus: "unavailable",
            authorLabel: "你",
            timeLabel: "刚刚",
          },
          changeMarkers: [
            {
              blockIndex: 0,
              authorKind: "user",
              authorLabel: "你",
              timeLabel: "刚刚",
              previousText: null,
            },
            {
              blockIndex: 1,
              authorKind: "user",
              authorLabel: "你",
              timeLabel: "刚刚",
              previousText: null,
            },
          ],
          revisionTimeline: [
            {
              id: "rev-2",
              authorLabel: "你",
              timeLabel: "刚刚",
              summary: null,
              summaryStatus: "pending",
            },
            {
              id: "rev-1",
              authorLabel: "你",
              timeLabel: "5 分钟前",
              summary: null,
              summaryStatus: "unavailable",
              isEarliest: true,
            },
          ],
        },
        dev: {
          ...officialSyncAndChangesDetailState.memberEditors["dev"]!,
          recentChange: {
            summary: null,
            summaryStatus: "pending",
            authorLabel: "你",
            timeLabel: "刚刚",
          },
          changeMarkers: [{
            blockIndex: 2,
            authorKind: "user",
            authorLabel: "你",
            timeLabel: "刚刚",
            previousText: null,
          }],
          revisionTimeline: [
            {
              id: "dev-rev-2",
              authorLabel: "你",
              timeLabel: "刚刚",
              summary: null,
              summaryStatus: "pending",
            },
            {
              id: "dev-rev-1",
              authorLabel: "官方 v1.2",
              timeLabel: "2026-07-28",
              summary: "这支团队的官方初始版本",
              summaryStatus: "ready",
              isEarliest: true,
            },
          ],
        },
      },
    },
  },
  play: TimelineExpanded.play,
};

const generalAssistantTeam: OperatorAgentTeam = {
  teamKey: "system:general-assistant",
  id: "system-general-assistant",
  ownership: "system",
  name: "通用助手",
  description: "用于没有预设专业分工的一般对话与任务。",
  primaryAgentSlug: "assistant",
  memberOrder: ["assistant"],
  members: [{
    slug: "assistant",
    displayName: "通用助手",
    description: "处理一般对话与任务",
  }],
  status: "usable",
  canCreateConversation: true,
  hasUnseenOfficialSync: true,
  recentOfficialSync: {
    officialVersion: "1.2",
    changeSummary: "这支团队的官方初始版本",
    affectedMemberCount: 1,
    timeLabel: "2026-07-28",
  },
};

/** `general-assistant` 真实的 `AGENT.md` 一个 Markdown 标题都没有；切块须退化为整份视为一块。 */
export const HeadlessAgentMarkdown: Story = {
  play: async ({ canvasElement }) => {
    await openTeamRow(canvasElement, generalAssistantTeam.teamKey);
  },
  args: {
    state: { status: "ready", teams: [generalAssistantTeam, builtInTeam, userTeam] },
    detailState: {
      teamKey: generalAssistantTeam.teamKey,
      selectedMemberSlug: "assistant",
      memberEditors: {
        assistant: {
          memberSlug: "assistant",
          loadStatus: "ready",
          loadError: null,
          draftMarkdown: "处理一般对话与任务，不附加专业职责、固定流程或团队交棒。",
          isDirty: false,
          saveStatus: "idle",
          saveError: null,
          externalChangeStatus: "none",
          displayName: "通用助手",
          description: "处理一般对话与任务",
          recentChange: {
            summary: "官方 v1.2 · 这支团队的官方初始版本",
            summaryStatus: "ready" as const,
            authorLabel: "官方 v1.2",
            timeLabel: "2026-07-28",
          },
          changeMarkers: [{
            blockIndex: 0,
            authorKind: "official",
            authorLabel: "官方 v1.2",
            timeLabel: "这支团队的官方初始版本",
            previousText: null,
          }],
        },
      },
      saveAllFailures: [],
    },
  },
};

/** "更多"菜单展开，露出常驻的"最近的官方同步"入口——横幅收起后用户仍能从这里找到撤销能力。 */
export const MoreMenuOpen: Story = {
  args: OfficialSyncAndChanges.args,
  play: async ({ canvasElement }) => {
    await openTeamRow(canvasElement, syncedTeam.teamKey);
    const trigger = canvasElement.querySelector<HTMLButtonElement>(
      "[data-testid='agent-team-more-menu-trigger']",
    );
    if (trigger === null) throw new Error("MoreMenuOpen story requires the team more-menu trigger");
    await openRadixTrigger(trigger);
  },
};

/**
 * 同步结果横幅已经被用户关闭（点了"×"），但撤销能力没有消失——"更多"菜单里的
 * "最近的官方同步"仍然常驻可用，本 fixture 直接展开该菜单验证这一点。
 */
export const BannerDismissed: Story = {
  args: {
    ...OfficialSyncAndChanges.args,
    state: {
      status: "ready",
      teams: [{ ...syncedTeam, hasUnseenOfficialSync: false, officialSyncBanner: null }, userTeam],
    },
  },
  play: MoreMenuOpen.play,
};

function nextFrame(): Promise<void> {
  return new Promise((resolve) => requestAnimationFrame(() => resolve()));
}

/** `AgentTeamsPage` starts on the team list; every interactive fixture must open the row first. */
async function openTeamRow(canvasElement: HTMLElement, teamKey: string): Promise<void> {
  const row = canvasElement.querySelector<HTMLButtonElement>(
    `[data-testid='agent-team-row'][data-team-key='${teamKey}']`,
  );
  if (row === null) throw new Error(`Story requires a team row for ${teamKey}`);
  row.click();
  await nextFrame();
  await nextFrame();
}

/**
 * Radix triggers (DropdownMenu, etc.) open on `pointerdown`, not the synthetic `click` event that
 * `HTMLElement.click()` dispatches; a real `pointerdown` + `pointerup` pair (no trailing `.click()`,
 * which would toggle it closed again) matches actual mouse input.
 */
async function openRadixTrigger(trigger: HTMLElement): Promise<void> {
  const pointerInit: PointerEventInit = { bubbles: true, cancelable: true, button: 0, pointerId: 1, pointerType: "mouse" };
  trigger.dispatchEvent(new PointerEvent("pointerdown", pointerInit));
  trigger.dispatchEvent(new PointerEvent("pointerup", pointerInit));
  await nextFrame();
  await nextFrame();
}

export const PiApiMember: Story = {
  args: {
    selectedTeamKey: userTeam.teamKey,
    selectedMemberSlug: "product-manager",
    providerProfiles: [{
      id: "deepseek-production",
      providerId: "deepseek",
      providerName: "DeepSeek",
      displayName: "生产 DeepSeek",
      defaultModel: "deepseek-v4-pro",
      verifiedModels: ["deepseek-v4-pro", "deepseek-v4-flash"],
      readiness: "ready",
      reason: null,
    }],
    onSaveExecutionProfile: async () => userTeam.members[1]!.executionProfile!,
    onRestoreRecommendedProfile: async () => userTeam.members[1]!.executionProfile!,
    onOpenProviderSettings: () => undefined,
  },
};
