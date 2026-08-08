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
const KIMI = engineProfile({ cli: "kimi", model: "kimi-code/kimi-for-coding", effort: "on" });

const userTeam: OperatorAgentTeam = {
  teamKey: "user:my-development",
  id: "user-my-development",
  ownership: "user",
  name: "我的开发团队",
  description: "为官网重构项目定制的团队，增加了产品经理角色。",
  primaryAgentSlug: "dev-manager",
  memberOrder: ["dev-manager", "product-manager", "dev", "qa"],
  members: [
    { slug: "dev-manager", displayName: "开发经理", description: "负责技术决策与任务拆分，把控整体质量。", executionProfile: CODEX },
    { slug: "product-manager", displayName: "产品经理", description: "澄清用户目标，定义验收标准。", executionProfile: CODEX },
    { slug: "dev", displayName: "开发", description: "按方案实现功能，输出代码与验证结果。", executionProfile: CLAUDE },
    { slug: "qa", displayName: "测试", description: "设计测试方案，对抗性审查每个交付。", executionProfile: KIMI },
  ],
  status: "usable",
  canCreateConversation: true,
};

/**
 * 团队详情自成一个 story 入口，不再挂在团队首页下面：它是一个独立的整屏视图，
 * 而每次都要先经过列表、再点一行才能看到它，纯属浪费。
 */
const meta = {
  title: "Page/Console/AgentTeamDetail",
  component: AgentTeamsPage,
  args: {
    state: { status: "ready", teams: [userTeam] },
    useStackedRows: false,
    onBack: () => undefined,
  },
  parameters: { layout: "fullscreen" },
  decorators: [(Story) => <div className="flex h-screen flex-col"><Story /></div>],
} satisfies Meta<typeof AgentTeamsPage>;

export default meta;
type Story = StoryObj<typeof meta>;

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
  const [info, setInfo] = useState({ name: userTeam.name, description: userTeam.description });
  const [bodies, setBodies] = useState<Record<string, string>>({});
  const [profiles, setProfiles] = useState<Record<string, EngineProfile>>({});
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
    ...info,
    members: members.map((member) => ({
      ...member,
      executionProfile: profiles[member.slug] ?? member.executionProfile,
    })),
    memberOrder: order,
    // 位置即任命：第一位就是主 Agent，没有第二条真相。
    primaryAgentSlug: order[0]!,
  };
  const detail = readyDetailState(team, selected, (slug) => bodies[slug] ?? (bodyFor ?? defaultBody)(slug));
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
      onUpdateTeamInformation={(_teamKey, next) => setInfo(next)}
      onChangeMember={(_teamKey, memberSlug, agentMarkdown) => {
        const body = agentMarkdown.replace(/^---\n[\s\S]*?\n---\n\n/u, "");
        setBodies((previous) => ({ ...previous, [memberSlug]: body }));
        setDirty((previous) => ({ ...previous, [memberSlug]: true }));
      }}
      onDiscardMember={(_teamKey, memberSlug) => {
        setBodies((previous) => {
          const next = { ...previous };
          delete next[memberSlug];
          return next;
        });
        setIdentities((previous) => {
          const next = { ...previous };
          delete next[memberSlug];
          return next;
        });
        setDirty((previous) => ({ ...previous, [memberSlug]: false }));
      }}
      onDiscardAll={() => {
        setBodies({});
        setIdentities({});
        setDirty({});
      }}
      onSaveAll={async () => {
        setDirty({});
        return { failures: [] };
      }}
      onSaveExecutionProfile={async (_teamKey, memberSlug, profile) => {
        const document = {
          binding: { source: "explicit" as const, profile },
          recommendation: null,
          effectiveProfile: profile,
        };
        setProfiles((previous) => ({ ...previous, [memberSlug]: document }));
        return document;
      }}
      onAddMember={() => undefined}
      onCloseTeam={() => undefined}
      onSaveMember={async (_teamKey, memberSlug) => {
        setDirty((previous) => ({ ...previous, [memberSlug]: false }));
      }}
      // 接上对象级操作，菜单才有内容可审——空壳菜单是审不出设计的。
      fileManagerActionLabel="在 Finder 中显示"
      onOpenLocation={() => undefined}
      onDuplicateUserTeam={async () => team.teamKey}
      onTrashUserTeam={async () => undefined}
      onDuplicateMember={async () => undefined}
      onTrashMember={async () => undefined}
    />
  );
}

const defaultBody = (): string =>
  "## 工作方式\n\n先确认用户真正要达到的结果，再决定动手范围。\n\n## 交接\n\n完成后把已核实的事实、剩余风险和下一步建议一并交回。\n";

function readyDetailState(
  team: OperatorAgentTeam,
  selectedMemberSlug: string,
  bodyFor: (slug: string) => string = defaultBody,
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
