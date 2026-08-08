import type { Meta, StoryObj } from "@storybook/react";
import * as React from "react";
import { useState } from "react";

import type { AgentTeamDetailState } from "@/console/agent-team-detail";
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
export const MemberPortrait: Story = {
  name: "更换成员画像",
  render: (args) => <TeamDetailHarness args={args} />,
};

/** 成员编辑的完整可玩状态：改画像、改名称与描述、拖拽排序、单一保存。 */
export const MemberEditing: Story = {
  name: "成员编辑",
  render: (args) => <TeamDetailHarness args={args} />,
};

const LONG_BODY = [
  "## 工作方式",
  "",
  "先确认用户真正要达到的结果，再决定动手范围。遇到不确定的地方，先问清楚而不是猜。",
  "",
  ...Array.from({ length: 12 }, (_, index) => [
    `### 第 ${index + 1} 类情况`,
    "",
    "当输入与既有约定冲突时，以磁盘现状为准，并把差异写进交接说明。不要为了让流程看起来顺利而隐瞒冲突。",
    "",
    "- 先复现，再判断",
    "- 证据不足时说明缺什么，而不是给一个含糊结论",
    "",
  ].join("\n")),
].join("\n");

function TeamDetailHarness({
  args,
  bodyFor,
  memberOverrides,
}: {
  args: React.ComponentProps<typeof AgentTeamsPage>;
  bodyFor?: (slug: string) => string;
  memberOverrides?: OperatorAgentTeam["members"];
}): JSX.Element {
  const [portraits, setPortraits] = useState<Record<string, string | null>>({});
  const [identities, setIdentities] = useState<Record<string, { displayName: string; description: string }>>({});
  const [order, setOrder] = useState((memberOverrides ?? userTeam.members).map((member) => member.slug));
  const [selected, setSelected] = useState(((memberOverrides ?? userTeam.members)[0])!.slug);
  const [dirty, setDirty] = useState<Record<string, boolean>>({});

  const roster = memberOverrides ?? userTeam.members;
  const members = order.map((slug) => {
    const base = roster.find((member) => member.slug === slug)!;
    return {
      ...base,
      ...identities[slug],
      portraitId: portraits[slug] ?? null,
    };
  });
  const team: OperatorAgentTeam = {
    ...userTeam,
    members,
    memberOrder: order,
    // 位置即任命：第一位就是主 Agent，没有第二条真相。
    primaryAgentSlug: order[0]!,
  };
  const detail = readyDetailState(team, selected, bodyFor);
  for (const member of members) {
    detail.memberEditors[member.slug] = {
      ...detail.memberEditors[member.slug]!,
      isDirty: dirty[member.slug] === true,
    };
  }

  return (
    <AgentTeamsPage
      {...args}
      state={{ status: "ready", teams: [team] }}
      selectedTeamKey={team.teamKey}
      selectedMemberSlug={selected}
      detailState={detail}
      onOpenTeam={() => undefined}
      onSelectMember={(_teamKey, memberSlug) => setSelected(memberSlug)}
      onChangeMemberPortrait={(_teamKey, memberSlug, portraitId) => {
        setPortraits((previous) => ({ ...previous, [memberSlug]: portraitId }));
        setDirty((previous) => ({ ...previous, [memberSlug]: true }));
      }}
      onChangeMemberIdentity={(_teamKey, memberSlug, identity) => {
        setIdentities((previous) => {
          const base = previous[memberSlug]
            ?? {
              displayName: roster.find((m) => m.slug === memberSlug)!.displayName,
              description: roster.find((m) => m.slug === memberSlug)!.description,
            };
          return { ...previous, [memberSlug]: { ...base, ...identity } };
        });
        setDirty((previous) => ({ ...previous, [memberSlug]: true }));
      }}
      onReorderMembers={(_teamKey, memberSlugs) => setOrder(memberSlugs)}
      onSaveMember={async (_teamKey, memberSlug) => {
        setDirty((previous) => ({ ...previous, [memberSlug]: false }));
      }}
    />
  );
}

function readyDetailState(
  team: OperatorAgentTeam,
  selectedMemberSlug: string,
  bodyFor: (slug: string) => string = () => "## 工作方式\n\n先确认用户真正要达到的结果，再决定动手范围。\n\n## 交接\n\n完成后把已核实的事实、剩余风险和下一步建议一并交回。\n",
): AgentTeamDetailState {
  return {
    teamKey: team.teamKey,
    selectedMemberSlug,
    saveAllFailures: [],
    memberEditors: Object.fromEntries(team.members.map((member) => [
      member.slug,
      {
        memberSlug: member.slug,
        loadStatus: "ready" as const,
        loadError: null,
        draftMarkdown: `---\ndisplay_name: ${member.displayName}\ndescription: ${member.description}\n---\n\n${bodyFor(member.slug)}`,
        isDirty: false,
        saveStatus: "idle" as const,
        saveError: null,
        externalChangeStatus: "none" as const,
        displayName: member.displayName,
        description: member.description,
      },
    ])),
  };
}

/** 很长的 AGENT.md：正文自然撑开、整页滚动，左侧运行配置与底部保存都钉住不飘走。 */
export const LongAgentMarkdown: Story = {
  name: "边界 · 超长 AGENT.md",
  render: (args) => <TeamDetailHarness args={args} bodyFor={() => LONG_BODY} />,
};

/** 空 AGENT.md：给出邀请而不是一张空白卡。 */
export const EmptyAgentMarkdown: Story = {
  name: "边界 · 空 AGENT.md",
  render: (args) => <TeamDetailHarness args={args} bodyFor={() => ""} />,
};

/** 单一成员：唯一的成员必然是主 Agent，没有可排的顺序，拖拽整体关闭。 */
export const SingleMember: Story = {
  name: "边界 · 只有一名成员",
  render: (args) => (
    <TeamDetailHarness args={args} memberOverrides={[userTeam.members[0]!]} />
  ),
};

/** 长名称与长描述：字段不得把布局撑破，成员条也要能横向滚动。 */
export const OverflowingIdentity: Story = {
  name: "边界 · 超长名称与描述",
  render: (args) => (
    <TeamDetailHarness
      args={args}
      memberOverrides={userTeam.members.map((member, index) => ({
        ...member,
        displayName: index === 0
          ? "负责整体技术决策与跨团队协调的资深技术负责人"
          : member.displayName,
        description: index === 0
          ? "在需求不明确时先澄清目标，再拆分任务、安排验证顺序，并对最终交付质量负责；遇到跨团队依赖时负责对齐接口与时间点。"
          : member.description,
      }))}
    />
  ),
};

/** 成员多到溢出：成员条横向滚动，不换行也不压缩每个条目。 */
export const ManyMembers: Story = {
  name: "边界 · 成员溢出",
  render: (args) => (
    <TeamDetailHarness
      args={args}
      memberOverrides={Array.from({ length: 9 }, (_, index) => ({
        ...userTeam.members[index % userTeam.members.length]!,
        slug: `member-${index}`,
        displayName: `${userTeam.members[index % userTeam.members.length]!.displayName}${index + 1}`,
      }))}
    />
  ),
};
