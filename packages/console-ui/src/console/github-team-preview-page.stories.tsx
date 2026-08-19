import type { Meta, StoryObj } from "@storybook/react";
import { useState } from "react";

import {
  GithubTeamPreviewPage,
  type GithubTeamPreviewData,
  type GithubTeamPreviewState,
} from "@/console/github-team-pages";

const team: GithubTeamPreviewData = {
  repository: "someone/moebius-team-product",
  name: "产品团队",
  description: "从需求澄清到 PRD 定稿，四名成员接力。",
  stars: 128,
  updatedLabel: "3 天前更新",
  language: "zh",
  primaryAgentSlug: "product-manager",
  members: [
    {
      slug: "product-manager",
      displayName: "产品经理",
      description: "接收目标并组织团队接力。",
      recommendedProfile: "gpt-5.6-sol · high",
      markdown: "# 产品经理\n\n你是产品经理，通过与用户对话产出交付物。\n\n## 工作方式\n\n1. 先核对目标、边界与事实来源。\n2. 把复杂任务拆成可验收的阶段。\n3. 每次交接写明结论、证据和未决项。\n\n## 红线\n\n- 不把猜测写成用户事实。\n- 不在缺少依据时替用户决定产品范围。",
    },
    {
      slug: "researcher",
      displayName: "用户研究",
      description: "设计研究并整理可追溯证据。",
      recommendedProfile: "claude-opus-5 · high",
      markdown: "# 用户研究\n\n围绕当前决策缺口选择研究方法，区分观察、推断和结论。\n\n- 每条洞察必须能回到原始证据。\n- 单个参与者的表达只记作观察，不上升为普遍结论。",
    },
    {
      slug: "writer",
      displayName: "文案",
      description: "把产品判断转成界面文案。",
      recommendedProfile: "kimi-k2 · medium",
      markdown: "# 文案\n\n用具体动作和后果写界面文案。按钮使用动词，错误信息说明发生了什么以及下一步能做什么。",
    },
    {
      slug: "reviewer",
      displayName: "评审",
      description: "对照需求和证据检查交付。",
      recommendedProfile: "gpt-5.6-sol · high",
      markdown: "# 评审\n\n逐项检查信息完整性、可追溯性与边界状态。发现问题时指出具体位置和违反的约束。",
    },
  ],
};

function PreviewHarness({ state = { status: "ready", team } }: { state?: GithubTeamPreviewState }): JSX.Element {
  const sourceTeam = "team" in state ? state.team : null;
  const [selectedMemberSlug, setSelectedMemberSlug] = useState(sourceTeam?.members[0]?.slug);
  return (
    <GithubTeamPreviewPage
      state={state}
      selectedMemberSlug={selectedMemberSlug}
      onSelectMember={setSelectedMemberSlug}
    />
  );
}

const meta = {
  title: "Page/Console/GithubTeamPreviewPage",
  component: GithubTeamPreviewPage,
  parameters: { layout: "fullscreen" },
  decorators: [(Story) => <div className="h-screen"><Story /></div>],
  globals: { theme: "dark" },
  args: { state: { status: "ready", team }, selectedMemberSlug: "product-manager" },
} satisfies Meta<typeof GithubTeamPreviewPage>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Ready: Story = {
  name: "安装前完整预览",
  render: () => <PreviewHarness />,
};

export const Loading: Story = { name: "加载中", args: { state: { status: "loading" } } };
export const Installed: Story = { name: "已装过", args: { state: { status: "installed", team } } };
export const InvalidRepository: Story = { name: "仓库格式不符", args: { state: { status: "invalid-repository", repository: team.repository } } };
export const Offline: Story = { name: "GitHub 不可用", args: { state: { status: "offline", repository: team.repository } } };
export const PermissionDenied: Story = { name: "无权限", args: { state: { status: "permission-denied", repository: team.repository } } };
export const RateLimited: Story = { name: "限流", args: { state: { status: "rate-limited", repository: team.repository, seconds: 42 } } };
export const Installing: Story = { name: "正在安装", args: { state: { status: "installing", team } } };
export const InstallFailed: Story = { name: "安装失败", args: { state: { status: "install-failed", team, reason: "无法写入本机团队目录；没有留下残留文件。" } } };

export const MemberUnreadable: Story = {
  name: "部分成员文件读不到",
  render: () => (
    <PreviewHarness state={{
      status: "ready",
      team: {
        ...team,
        members: team.members.map((member) => member.slug === "reviewer"
          ? { ...member, readable: false, readError: "reviewer/AGENT.md 不存在，无法安装这支团队。" }
          : member),
      },
    }} />
  ),
};

export const LongMarkdown: Story = {
  name: "超长 AGENT.md",
  render: () => (
    <PreviewHarness state={{
      status: "ready",
      team: {
        ...team,
        members: team.members.map((member, index) => index === 0
          ? { ...member, markdown: `${member.markdown}\n\n${Array.from({ length: 18 }, (_, item) => `## 规则 ${item + 1}\n\n这是一段用于验证区域内滚动的完整规则正文，不截断、不折叠，也不把底部安装操作推出视口。`).join("\n\n")}` }
          : member),
      },
    }} />
  ),
};

export const Narrow: Story = {
  name: "窄窗",
  render: () => <PreviewHarness />,
  parameters: {
    viewport: {
      defaultViewport: "githubPreviewNarrow",
      viewports: { githubPreviewNarrow: { name: "390 × 780", styles: { width: "390px", height: "780px" } } },
    },
  },
};
