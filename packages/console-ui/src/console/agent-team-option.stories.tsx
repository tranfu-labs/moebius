import type { Meta, StoryObj } from "@storybook/react";

import { AgentTeamOption } from "./agent-team-option";

const meta = {
  title: "Component/Console/AgentTeamOption",
  component: AgentTeamOption,
  args: {
    team: {
      label: "同名团队 · 用户来源",
      ownership: "user",
      description: "负责从产品定义到生产交付，并用压力数据验证狭窄窗口中的摘要与成员披露。",
      primaryAgentSlug: "product-delivery-lead",
      members: [
        { slug: "product-delivery-lead", displayName: "交付负责人" },
        { slug: "product-reviewer", displayName: "产品评审" },
        { slug: "implementation-lead", displayName: "实现负责人" },
        { slug: "functional-qa", displayName: "功能验收" },
        { slug: "visual-qa", displayName: "视觉验收" },
        { slug: "release", displayName: "发布" },
        { slug: "security", displayName: "安全复核" },
        { slug: "analytics", displayName: "数据分析" },
        { slug: "support", displayName: "用户支持" },
      ],
    },
  },
  decorators: [(Story) => <div className="w-[320px] max-w-[calc(100vw-24px)]"><Story /></div>],
} satisfies Meta<typeof AgentTeamOption>;

export default meta;
type Story = StoryObj<typeof meta>;
export const LongMemberList: Story = {};

export const SameNameTeams: Story = {
  render: () => (
    <div className="grid gap-3">
      <div className="rounded-md border border-line p-3">
        <AgentTeamOption team={{
          label: "开发团队 · Moebius",
          ownership: "system",
          description: "内置的软件开发团队。",
          primaryAgentSlug: "product-delivery-lead",
          members: [
            { slug: "product-delivery-lead", displayName: "交付负责人" },
            { slug: "implementation-lead", displayName: "实现负责人" },
          ],
        }} />
      </div>
      <div className="rounded-md border border-line p-3">
        <AgentTeamOption team={{
          label: "开发团队 · 用户来源",
          ownership: "user",
          description: "用户创建的同名团队。",
          primaryAgentSlug: "owner",
          members: [
            { slug: "owner", displayName: "负责人" },
            { slug: "developer", displayName: "开发者" },
          ],
        }} />
      </div>
    </div>
  ),
};

export const NarrowWindow: Story = {
  parameters: {
    viewport: {
      defaultViewport: "teamOptionNarrow",
      viewports: {
        teamOptionNarrow: {
          name: "Team option narrow · 360 × 640",
          styles: { width: "360px", height: "640px" },
        },
      },
    },
  },
};
