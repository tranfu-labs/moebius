import type { Meta, StoryObj } from "@storybook/react";

import {
  AgentTeamsPage,
  type OperatorAgentTeam,
} from "@/console/agent-teams-page";

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
    },
    {
      slug: "dev",
      displayName: "开发",
      description: "按方案实现功能，输出代码与验证结果。",
    },
    {
      slug: "qa",
      displayName: "测试",
      description: "设计测试方案，对抗性审查每个交付。",
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
    },
    {
      slug: "product-manager",
      displayName: "产品经理",
      description: "澄清需求、拆分功能点并验收最终交付。",
    },
    {
      slug: "dev",
      displayName: "开发",
      description: "按方案实现功能，输出代码与验证结果。",
    },
    {
      slug: "qa",
      displayName: "测试",
      description: "设计测试方案，对抗性审查每个交付。",
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

export const Ready: Story = {};
