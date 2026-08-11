import type { Meta, StoryObj } from "@storybook/react";
import * as React from "react";
import { useState } from "react";

import {
  AgentTeamsPage,
  type OperatorAgentTeam,
} from "@/console/agent-teams-page";

type EngineProfile = NonNullable<OperatorAgentTeam["members"][number]["executionProfile"]>;

function engineProfile(profile: EngineProfile["effectiveProfile"]): EngineProfile {
  return { binding: { source: "explicit", profile }, recommendation: null, effectiveProfile: profile };
}

const CODEX = engineProfile({ cli: "codex", model: "gpt-5.6-sol", effort: "high" });
const CLAUDE = engineProfile({ cli: "claude", model: "claude-opus-5", effort: "high" });
const KIMI = engineProfile({ cli: "kimi", model: "kimi-k2", effort: "medium" });
const DEEPSEEK = engineProfile({
  cli: "pi",
  providerId: "deepseek",
  providerProfileId: "deepseek-production",
  model: "deepseek-v4-pro",
  effort: "high",
});

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
      executionProfile: CODEX,
    },
    {
      slug: "dev",
      displayName: "开发",
      description: "按方案实现功能，输出代码与验证结果。",
      executionProfile: CLAUDE,
    },
    {
      slug: "qa",
      displayName: "测试",
      description: "设计测试方案，对抗性审查每个交付。",
      executionProfile: KIMI,
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
      executionProfile: CODEX,
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
      executionProfile: CLAUDE,
    },
    {
      slug: "qa",
      displayName: "测试",
      description: "设计测试方案，对抗性审查每个交付。",
      executionProfile: KIMI,
    },
  ],
  status: "usable",
  canCreateConversation: true,
};

const meta = {
  title: "Page/Console/AgentTeamsPage",
  component: AgentTeamsPage,
  args: {
    state: { status: "ready", teams: [builtInTeam, userTeam] },
    useStackedRows: false,
    onCreateTeam: async () => userTeam,
    onBack: () => undefined,
  },
  parameters: { layout: "fullscreen" },
  // 页面根是 flex-1 min-h-0 overflow-auto，它假定自己活在一个有高度的应用外壳里。
  // 少了这层，Storybook 里滚动会落到 body 上，sticky 之类依赖滚动容器的行为全部失真。
  decorators: [(Story) => <div className="flex h-screen flex-col"><Story /></div>],
  globals: { theme: "dark" },
} satisfies Meta<typeof AgentTeamsPage>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Ready: Story = { name: "默认" };

/** 成员条溢出：主 Agent 不计入，其余超过 5 名时折叠成 ＋N。 */
export const MemberOverflow: Story = {
  name: "成员溢出",
  args: {
    state: {
      status: "ready",
      teams: [{
        ...userTeam,
        memberOrder: [...userTeam.memberOrder, "designer", "security", "data", "ops", "writer"],
        members: [
          ...userTeam.members,
          { executionProfile: CLAUDE, slug: "designer", displayName: "设计", description: "把方案落成界面。" },
          { executionProfile: CODEX, slug: "security", displayName: "安全", description: "审查越权与数据风险。" },
          { executionProfile: DEEPSEEK, slug: "data", displayName: "数据", description: "取数与口径对齐。" },
          { executionProfile: KIMI, slug: "ops", displayName: "运维", description: "值班与告警响应。" },
          { executionProfile: CLAUDE, slug: "writer", displayName: "文案", description: "对外表达与文档。" },
        ],
      }],
    },
  },
};

/** 只有一支官方团队：单卡不应撑满整个版心，列宽由卡片下限决定。 */
export const OnlyOfficial: Story = {
  name: "仅官方团队",
  args: { state: { status: "ready", teams: [builtInTeam] } },
};

/** 主 Agent 是唯一成员：成员条为空，不能塌成错位或留下空盒子。 */
export const SoloMember: Story = {
  name: "单成员团队",
  args: {
    state: {
      status: "ready",
      teams: [{
        ...userTeam,
        teamKey: "user:solo",
        id: "user-solo",
        name: "独立研究员",
        description: "一个人负责调研、结论与复核。",
        memberOrder: ["dev-manager"],
        members: [userTeam.members[0]!],
      }],
    },
  },
};

/** 文本边界：超长团队名、超长描述、以及完全没有描述。 */
export const TextBoundaries: Story = {
  name: "文本边界",
  args: {
    state: {
      status: "ready",
      teams: [
        {
          ...userTeam,
          teamKey: "user:long-name",
          id: "user-long-name",
          name: "负责官网重构与品牌升级的跨职能协作团队（含设计与内容）",
          description: "为官网重构项目定制的团队，覆盖需求澄清、视觉设计、前端实现、内容撰写与上线前的整体验收走查，成员之间按接力棒推进。",
        },
        {
          ...userTeam,
          teamKey: "user:no-desc",
          id: "user-no-desc",
          name: "临时团队",
          description: null,
        },
        {
          ...userTeam,
          teamKey: "user:tiny",
          id: "user-tiny",
          name: "A",
          description: "短。",
        },
      ],
    },
  },
};

/** 加载失败：错误面板与重试入口。 */
export const LoadFailed: Story = {
  name: "加载失败",
  args: { state: { status: "error" }, onRetry: () => undefined },
};

/** 应用配置异常：与加载失败是不同的文案与语义。 */
export const ConfigurationError: Story = {
  name: "配置异常",
  args: { state: { status: "configuration-error" }, onRetry: () => undefined },
};

/** 三种状态药丸同屏：官方 + 已定制 + 有更新、未完成草稿、需要修复。 */
export const StatusBadges: Story = {
  name: "状态标记",
  args: {
    state: {
      status: "ready",
      teams: [
        {
          ...builtInTeam,
          officialManagement: {
            customizationStatus: "customized",
            updateStatus: "available",
            primaryAction: "protect-and-update",
            requiresProtectiveCopy: true,
            addedMembers: [],
            removedMembers: [],
            recommendationChangedMembers: [],
            protectedMembers: [],
            collidingMembers: [],
          },
        },
        {
          ...userTeam,
          teamKey: "user:draft",
          id: "user-draft",
          name: "内容团队",
          primaryAgentSlug: null,
          status: "unfinished-draft",
          canCreateConversation: false,
        },
        {
          ...userTeam,
          teamKey: "user:broken",
          id: "user-broken",
          name: "运维团队",
          status: "needs-repair",
          canCreateConversation: false,
        },
      ],
    },
  },
};

/** 窄侧栏：成员头像落到描述下方，表头右列标题隐藏。 */
export const NarrowRows: Story = {
  name: "窄侧栏",
  args: { useStackedRows: true },
};

/** 团队变多时的扫描效率：靠分组 + 行首主 Agent 头像定位，而不是逐行读字。 */
export const ManyTeams: Story = {
  name: "团队较多",
  args: {
    state: {
      status: "ready",
      teams: [
        builtInTeam,
        { ...userTeam, teamKey: "user:site", id: "user-site", name: "官网重构团队" },
        {
          ...userTeam,
          teamKey: "user:content",
          id: "user-content",
          name: "内容团队",
          description: "负责选题、初稿与事实核对。",
          primaryAgentSlug: "product-manager",
        },
        {
          ...builtInTeam,
          ownership: "user",
          teamKey: "user:data",
          id: "user-data",
          name: "数据分析团队",
          description: "取数、建模与口径对齐。",
          primaryAgentSlug: "qa",
        },
        {
          ...userTeam,
          teamKey: "user:ops",
          id: "user-ops",
          name: "运维团队",
          description: "值班、告警响应与容量规划。",
          primaryAgentSlug: "dev",
        },
      ],
    },
  },
};

/** 一支团队都没有时的空态。 */
export const Empty: Story = {
  name: "空态",
  args: { state: { status: "ready", teams: [] } },
};

export const Loading: Story = {
  name: "加载中",
  args: { state: { status: "loading" } },
};

/** 执行引擎标识：四种引擎同屏，验证 logo 随主题变色且不喧宾夺主。 */
export const ProviderMarks: Story = {
  name: "模型标识",
  args: {
    selectedTeamKey: "user:engines",
    selectedMemberSlug: "dev-manager",
    state: {
      status: "ready",
      teams: [{
        ...userTeam,
        teamKey: "user:engines",
        id: "user-engines",
        name: "多引擎团队",
        description: "四名成员分别跑在不同的执行引擎上。",
        memberOrder: ["dev-manager", "product-manager", "dev", "qa"],
        members: [
          { ...userTeam.members[0]!, executionProfile: engineProfile({ cli: "codex", model: "gpt-5.6-sol", effort: "high" }) },
          { ...userTeam.members[1]!, executionProfile: engineProfile({ cli: "claude", model: "claude-opus-5", effort: "high" }) },
          { ...userTeam.members[2]!, executionProfile: engineProfile({ cli: "kimi", model: "kimi-k2", effort: "medium" }) },
          {
            ...userTeam.members[3]!,
            executionProfile: engineProfile({
              cli: "pi",
              providerId: "deepseek",
              providerProfileId: "deepseek-production",
              model: "deepseek-v4-pro",
              effort: "high",
            }),
          },
        ],
      }],
    },
  },
};

/**
 * 在团队详情里更换当前成员的画像：入口是标题上的画像本身，候选一律用该成员现有底色渲染。
 * 换完之后成员选择器、团队横行的主 Agent 方形画像会一起跟上。
 */

// ---------- 官方同步与修订历史（agent-md-revision-and-default-agent） ----------

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
          isLatest: true,
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
        },
      ],
    },
    // 评审入口要求：非默认成员也必须有可切换的编辑器状态，且至少一名成员的
    // 最近变化与时间线署名是「你」——否则任务 1（"我写的那条记住了吗"）在
    // 默认视图里永远找不到任何一条用户自己的记录。
    dev: {
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
          isLatest: true,
        },
        {
          id: "dev-rev-1",
          authorLabel: "官方 v1.2",
          timeLabel: "2026-07-28",
          summary: "这支团队的官方初始版本",
          summaryStatus: "ready" as const,
        },
      ],
    },
    qa: {
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
          isLatest: true,
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
        },
      ],
    },
  },
  saveAllFailures: [],
};

/**
 * 点击"开发团队"进入详情，可见：同步结果横幅、正文左侧变化标记与"最近变化"摘要、
 * 点击"全部"展开成员级时间线、"更多"菜单里的"最近的官方同步"。
 * 团队首页横行上"开发团队"带"官方有新变化"标记（进入详情后按规则消失，本 fixture 不模拟该副作用）。
 */
export const OfficialSyncAndChanges: Story = {
  name: "官方同步与变化",
  args: {
    state: { status: "ready", teams: [syncedTeam, userTeam] },
    openTeamKey: syncedTeam.teamKey,
    detailState: officialSyncAndChangesDetailState,
    onViewSyncChanges: () => undefined,
    onRevertSync: async () => undefined,
    onDismissSyncBanner: () => undefined,
    onRestoreRevision: async () => undefined,
  },
};

export const OfficialSyncAndChangesNarrow: Story = {
  name: "官方同步与变化 · 窄窗",
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
  name: "官方同步与变化 · 亮色",
  args: OfficialSyncAndChanges.args,
  globals: { theme: "light" },
};

/** 点过"全部"之后的时间线展开态——这是用户审查成员级时间线的唯一入口，必须在完整页面语境里看。 */
export const TimelineExpanded: Story = {
  name: "时间线展开",
  args: OfficialSyncAndChanges.args,
  play: async ({ canvasElement }) => {
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
 * 标题行是 pending（「正在生成说明…」）。两条标题行都不允许消失——PRD 要求
 * 「最近变化」常驻，摘要缺失时用中性占位。
 */
export const TimelineSummaryPendingAndUnavailable: Story = {
  name: "摘要生成中与不可用",
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
              isLatest: true,
            },
            {
              id: "rev-1",
              authorLabel: "你",
              timeLabel: "5 分钟前",
              summary: null,
              summaryStatus: "unavailable",
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
              isLatest: true,
            },
            {
              id: "dev-rev-1",
              authorLabel: "官方 v1.2",
              timeLabel: "2026-07-28",
              summary: "这支团队的官方初始版本",
              summaryStatus: "ready",
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
  name: "无标题 AGENT.md",
  args: {
    state: { status: "ready", teams: [generalAssistantTeam, builtInTeam, userTeam] },
    openTeamKey: generalAssistantTeam.teamKey,
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
            timeLabel: "2026-07-28",
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
  name: "更多菜单展开",
  args: OfficialSyncAndChanges.args,
  play: async ({ canvasElement }) => {
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
  name: "横幅已关闭",
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
