import type { Meta, StoryObj } from "@storybook/react";

import type { OperatorAgentTeam } from "@/console/agent-teams-page";
import { I18nProvider } from "@/i18n";
import { RelayDemo } from "./relay-demo";

const developmentTeam: OperatorAgentTeam = {
  teamKey: "system:development",
  id: "development",
  ownership: "system",
  name: "开发团队",
  description: "负责软件方案、实现、测试、复核和主理收尾",
  primaryAgentSlug: "dev-manager",
  memberOrder: ["dev-manager", "dev", "qa"],
  onboardingOrchestration: {
    status: "ready",
    relayBeats: [
      { speakerSlug: "dev-manager", message: "我先拆出计算口径、边界样本和回归证据，开发先定位并提交修复。" },
      { speakerSlug: "dev", message: "已修正暂停区间的重复计入，并补上基础回归用例。" },
      { speakerSlug: "qa", message: "第一轮复核未通过：跨日运行仍有一分钟偏差。" },
      { speakerSlug: "dev", message: "已统一跨日取整口径并加入午夜边界用例。" },
      { speakerSlug: "qa", message: "第二轮复核通过：暂停、跨日和取整边界都已覆盖。" },
      { speakerSlug: "dev-manager", message: "收尾：两轮复核及通过证据都保留在时间线中。" },
    ],
  },
  members: [
    { slug: "dev-manager", displayName: "开发经理", description: "负责拆解和收尾" },
    { slug: "dev", displayName: "开发", description: "负责实现" },
    { slug: "qa", displayName: "软件测试", description: "负责复核" },
  ],
  status: "usable",
  canCreateConversation: true,
};

const meta = {
  title: "Onboarding/RelayDemo",
  component: RelayDemo,
  decorators: [
    (Story) => (
      <I18nProvider locale="zh-CN">
        <div className="mx-auto w-full max-w-[780px]">
          <Story />
        </div>
      </I18nProvider>
    ),
  ],
  args: {
    team: developmentTeam,
    relayRun: 1,
    onReplay: () => undefined,
  },
} satisfies Meta<typeof RelayDemo>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Standard: Story = {};

export const ReducedMotion: Story = {
  args: {
    reducedMotion: true,
  },
};

export const LongNameEditorialTeam: Story = {
  args: {
    team: {
      ...developmentTeam,
      teamKey: "user:ai-social-editorial",
      id: "ai-social-editorial",
      ownership: "user",
      name: "AI 热点社媒编辑部",
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
    },
  },
};
