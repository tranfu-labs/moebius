import type { Meta, StoryObj } from "@storybook/react";

import {
  TeamBuilderView,
  type TeamBuilderViewState,
} from "@/ai-team-builder/team-builder-view";
import type { TeamProposalPreview } from "@/ai-team-builder/team-proposal-card";
import { I18nProvider } from "@/i18n";

const proposal: TeamProposalPreview = {
  team: {
    name: "官网增长团队",
    purpose: "长期负责公司官网的内容迭代、转化优化与发布。",
  },
  members: [
    {
      slug: "growth-lead",
      name: "增长负责人",
      role: "主 Agent",
      responsibilities: ["拆解增长目标", "派发任务并收尾验收"],
      handoffs: ["@content-editor", "@web-dev"],
    },
    {
      slug: "content-editor",
      name: "内容编辑",
      role: "内容",
      responsibilities: ["撰写与校对页面文案", "维护品牌语气一致性"],
      handoffs: ["@web-dev"],
    },
    {
      slug: "web-dev",
      name: "前端开发",
      role: "实现与验收",
      responsibilities: ["实现页面改动", "验证构建与视觉效果", "按验收语句逐条走查"],
      handoffs: ["@growth-lead"],
    },
  ],
  primaryAgentSlug: "growth-lead",
  relayBeats: [
    { speakerSlug: "growth-lead", message: "收到目标后先拆成本轮可交付的页面改动清单。" },
    { speakerSlug: "content-editor", message: "先出文案，再由前端落页面。" },
    { speakerSlug: "web-dev", message: "上线前按验收语句逐条走查并给出结论。" },
  ],
};

const state: TeamBuilderViewState = {
  phase: "proposal",
  messages: [
    {
      role: "user",
      text: "我想要一支能长期维护公司官网的团队。",
    },
    {
      role: "assistant",
      text: "方案如下：增长负责人统筹派工，内容编辑与前端开发接力协作，可继续调整或直接创建。",
    },
  ],
  proposal,
  proposalRevision: 1,
  error: null,
};

const meta = {
  title: "AI Team Builder/TeamBuilderView",
  component: TeamBuilderView,
  args: {
    state,
    contextLabel: "Agent 团队",
    backLabel: "返回 Agent 团队",
    onBack: () => undefined,
    onSubmit: () => undefined,
    onAdjust: () => undefined,
    onRetry: () => undefined,
    onCommit: () => undefined,
  },
  parameters: { layout: "fullscreen" },
  globals: { theme: "dark" },
  decorators: [
    (Story) => (
      <I18nProvider locale="zh-CN">
        <Story />
      </I18nProvider>
    ),
  ],
} satisfies Meta<typeof TeamBuilderView>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Proposal: Story = {};
