import type { Meta, StoryObj } from "@storybook/react";

import { AgentTeamSaveFeedback } from "./agent-team-save-feedback";

const meta = {
  title: "Component/Console/AgentTeamSaveFeedback",
  component: AgentTeamSaveFeedback,
  args: {
    feedback: {
      kind: "saved",
      teamName: "产品交付团队",
      savedItemCount: 3,
      canApplyToExistingConversation: true,
    },
  },
  decorators: [(Story) => <div className="w-[560px] max-w-[calc(100vw-24px)]"><Story /></div>],
} satisfies Meta<typeof AgentTeamSaveFeedback>;

export default meta;
type Story = StoryObj<typeof meta>;
export const Saved: Story = {};
export const ExternalLoaded: Story = {
  args: { feedback: { kind: "external-loaded", teamName: "同名团队", savedItemCount: 1, canApplyToExistingConversation: true } },
};
