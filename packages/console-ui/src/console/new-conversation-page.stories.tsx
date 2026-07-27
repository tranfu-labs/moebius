import type { Meta, StoryObj } from "@storybook/react";

import { NewConversationPage } from "./new-conversation-page";

const meta = {
  title: "Page/Console/NewConversationPage",
  component: NewConversationPage,
  parameters: { layout: "fullscreen" },
  args: {
    projects: [
      { projectId: "a", title: "moebius", available: true, independentWorkspaceAvailable: true, branchLabel: "main" },
      { projectId: "b", title: "marketing-site", available: true, independentWorkspaceAvailable: false, branchLabel: "main" },
    ],
    teams: [{
      teamKey: "system:development",
      label: "开发团队",
      members: [{ slug: "dev", displayName: "开发", description: "实现功能" }],
    }],
    selectedProjectId: null,
    selectedWorkspaceMode: "direct",
    selectedTeamKey: "system:development",
    draft: "",
    onSelectProject: () => undefined,
    onSelectWorkspace: () => undefined,
    onAddProject: () => undefined,
    onSelectTeam: () => undefined,
    onDraftChange: () => undefined,
    onSubmit: () => undefined,
  },
} satisfies Meta<typeof NewConversationPage>;

export default meta;
type Story = StoryObj<typeof meta>;

export const ProjectUnselected: Story = {};

export const ProjectSelected: Story = {
  args: { selectedProjectId: "a", draft: "帮我完善新用户引导" },
};
