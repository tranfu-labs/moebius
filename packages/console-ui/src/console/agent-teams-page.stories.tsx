import type { Meta, StoryObj } from "@storybook/react";

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
