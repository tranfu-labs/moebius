import type { Meta, StoryObj } from "@storybook/react";

import type { OperatorAgentTeam } from "@/console/agent-teams-page";
import { I18nProvider } from "@/i18n";
import { OnboardingShell } from "./onboarding-shell";

const editorialTeam: OperatorAgentTeam = {
  teamKey: "user:ai-social-editorial",
  id: "ai-social-editorial",
  ownership: "user",
  name: "AI 热点社媒编辑部",
  description: "从热点研究到发布前品牌复核",
  primaryAgentSlug: "strategy-lead",
  memberOrder: ["strategy-lead", "trend-researcher", "social-editor", "brand-reviewer"],
  onboardingOrchestration: {
    status: "ready",
    relayBeats: [
      { speakerSlug: "strategy-lead", message: "我先锁定今天值得跟进的热点与发布目标。" },
      { speakerSlug: "trend-researcher", message: "已核对信息源、时间线和争议点，整理成选题资料。" },
      { speakerSlug: "social-editor", message: "已完成首版社媒内容，并按渠道调整表达。" },
      { speakerSlug: "brand-reviewer", message: "首轮复核发现一处事实口径和品牌语气问题。" },
      { speakerSlug: "social-editor", message: "已修正事实表述，并收紧标题和行动号召。" },
      { speakerSlug: "strategy-lead", message: "收尾：内容、来源与复核结论均已保留，可以发布。" },
    ],
  },
  members: [
    { slug: "strategy-lead", displayName: "策略负责人", description: "选题与收尾" },
    { slug: "trend-researcher", displayName: "热点研究员", description: "事实研究" },
    { slug: "social-editor", displayName: "社交媒体编辑", description: "内容编辑" },
    { slug: "brand-reviewer", displayName: "品牌复核专员", description: "品牌复核" },
  ],
  status: "usable",
  canCreateConversation: true,
};

const meta = {
  title: "Page/Onboarding/OnboardingShell",
  component: OnboardingShell,
  parameters: {
    layout: "fullscreen",
  },
  decorators: [
    (Story) => (
      <I18nProvider locale="zh-CN">
        <Story />
      </I18nProvider>
    ),
  ],
  args: {
    environment: {
      codex: { status: "ready", revision: 1 },
      claude: { status: "missing", revision: 1 },
      kimi: { status: "missing", revision: 1 },
    },
    installations: {
      codex: { cli: "codex", status: "idle", revision: 0 },
      claude: { cli: "claude", status: "idle", revision: 0 },
      kimi: { cli: "kimi", status: "idle", revision: 0 },
    },
    teamsState: { status: "ready", teams: [editorialTeam] },
    teamBuilderState: {
      phase: "idle",
      messages: [{
        role: "assistant",
        text: "你希望这支团队长期替你完成什么工作？",
      }],
      proposal: null,
      proposalRevision: null,
      error: null,
    },
    onRecheckEnvironment: () => undefined,
    onInstallCli: () => undefined,
    onCancelCliInstallation: () => undefined,
    onRetryTeams: () => undefined,
    onOpenTeamBuilder: () => undefined,
    onTeamBuilderSubmit: () => undefined,
    onTeamBuilderAdjust: () => undefined,
    onTeamBuilderRetry: () => undefined,
    onTeamBuilderCommit: () => undefined,
    onComplete: () => undefined,
  },
} satisfies Meta<typeof OnboardingShell>;

export default meta;
type Story = StoryObj<typeof meta>;

export const LongNameEditorialTeam: Story = {};
