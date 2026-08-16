import type { Meta, StoryObj } from "@storybook/react";

import type { OperatorAgentTeam } from "@/console/agent-teams-page";
import { SessionTeamMenu } from "@/console/session-team-menu";

const teams: OperatorAgentTeam[] = [
  team("development", "开发团队", "负责实现、复核与交付", ["主理人", "开发", "测试"]),
  team("product-review", "产品评审团队", "负责产品判断与体验复核", ["产品经理", "设计师"]),
];

const meta = {
  title: "Component/Console/SessionTeamMenu",
  component: SessionTeamMenu,
  args: {
    appearance: "focused",
    team: teams[0],
    teams,
    health: "usable",
    onSelectTeam: () => undefined,
  },
  parameters: { layout: "centered" },
} satisfies Meta<typeof SessionTeamMenu>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Trigger: Story = { name: "页面同款 · 团队选择" };

export const Open: Story = {
  name: "页面同款 · 展开菜单",
  args: { open: true, onOpenChange: () => undefined },
};

export const NeedsRepair: Story = {
  name: "异常 · 需要修复",
  args: {
    health: "needs-repair",
    team: { ...teams[0]!, status: "needs-repair" },
  },
};

function team(
  id: string,
  name: string,
  description: string,
  memberNames: string[],
): OperatorAgentTeam {
  const members = memberNames.map((displayName, index) => ({
    slug: `${id}-${String(index + 1)}`,
    displayName,
    description: `${displayName}成员`,
  }));
  return {
    teamKey: `system:${id}`,
    id,
    ownership: "system",
    name,
    description,
    primaryAgentSlug: members[0]?.slug ?? null,
    memberOrder: members.map((member) => member.slug),
    members,
    status: "usable",
    canCreateConversation: true,
  };
}
