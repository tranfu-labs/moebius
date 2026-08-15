import type { Meta, StoryObj } from "@storybook/react";

import { ComposerContext } from "./composer-context";

const session = {
  sessionId: "session-a",
  projectId: "project-a",
  agentTeamOwnership: "system" as const,
  agentTeamId: "development",
  workspaceMode: "direct" as const,
  workspacePendingMode: null,
  workspaceUnavailableReason: null,
  branchName: "feat/session-context",
  title: "上下文完整化",
  status: "idle" as const,
  awaitsHumanReason: null,
  unreadSince: null,
  runningCount: 0,
  waitingCount: 0,
  stuckCount: 0,
  errorCount: 0,
  interruptedCount: 0,
  createdAt: "2026-07-22T00:00:00.000Z",
  updatedAt: "2026-07-22T00:00:00.000Z",
};
const project = {
  projectId: "project-a",
  sourceType: "local-folder" as const,
  title: "moebius",
  folderPath: "/workspace/moebius",
  worktreeMode: false,
  workspaceCwd: "/workspace/moebius",
  workspaceMode: "direct" as const,
  worktreePath: null,
  worktreeUnavailableReason: null,
  workspaceUpdatedAt: null,
  branchName: "feat/session-context",
  sessions: [session],
  runningCount: 0,
  waitingCount: 0,
  stuckCount: 0,
  errorCount: 0,
};
const team = {
  teamKey: "system:development",
  id: "development",
  ownership: "system" as const,
  name: "开发团队",
  description: "负责开发",
  primaryAgentSlug: "dev-manager",
  memberOrder: ["dev-manager", "dev", "qa"],
  members: [],
  status: "usable" as const,
  canCreateConversation: true,
};

const meta = {
  title: "Block/Console/ComposerContext",
  component: ComposerContext,
  args: {
    appearance: "focused",
    project,
    projects: [project],
    selectedSession: session,
    agentTeam: team,
    teams: [team],
    canChangeProject: false,
    disabled: false,
  },
} satisfies Meta<typeof ComposerContext>;

export default meta;
type Story = StoryObj<typeof meta>;

export const LockedWorkspace: Story = { name: "页面同款 · 已锁定工作区" };

export const BeforeFirstMessage: Story = {
  name: "页面同款 · 首条消息前",
  args: { onChangeSessionWorkspace: () => undefined },
};
