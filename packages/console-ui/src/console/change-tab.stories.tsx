import type { Meta, StoryObj } from "@storybook/react";

import { ChangeTab } from "@/console/change-tab";
import type { WorkspaceFileContent } from "@/console/file-diff-view";

const files = [
  { path: "packages/console-ui/src/console/conversation-relay-rail.tsx", additions: 18, deletions: 4 },
  { path: "packages/console-ui/src/console/operator-console.stories.tsx", additions: 26, deletions: 7 },
  { path: "packages/console-ui/src/styles/tokens.css", additions: 4, deletions: 2 },
];

const fileContent: WorkspaceFileContent = {
  available: true,
  path: files[0]!.path,
  reason: null,
  lines: [
    { kind: "unchanged", oldLineNumber: 194, newLineNumber: 194, text: "return (" },
    { kind: "deletion", oldLineNumber: 195, newLineNumber: null, text: "  <nav className=\"border border-line\">" },
    { kind: "addition", oldLineNumber: null, newLineNumber: 195, text: "  <nav className=\"border-0\">" },
    { kind: "addition", oldLineNumber: null, newLineNumber: 196, text: "    {children}" },
    { kind: "unchanged", oldLineNumber: 196, newLineNumber: 197, text: "  </nav>" },
  ],
};

const meta = {
  title: "Block/Console/ChangeTab",
  component: ChangeTab,
  args: {
    appearance: "focused",
    sessionId: "session-a",
    workspaceMode: "worktree",
    conversationStarted: true,
    isWorking: false,
    loadDiff: async () => ({
      available: true as const,
      fileCount: files.length,
      files,
      reason: null,
      workspaceMode: "worktree" as const,
    }),
    loadFile: async (_sessionId, path) => ({ ...fileContent, path }),
  },
  render: (args) => (
    <div className="h-[560px] w-[760px] max-w-screen bg-card">
      <ChangeTab {...args} />
    </div>
  ),
  parameters: { layout: "centered" },
} satisfies Meta<typeof ChangeTab>;

export default meta;
type Story = StoryObj<typeof meta>;

export const WorkspaceDiff: Story = { name: "页面同款 · 工作区改动" };

export const TreeHidden: Story = {
  name: "页面同款 · 隐藏文件树",
  play: async ({ canvasElement }) => {
    await new Promise<void>((resolve) => window.setTimeout(resolve, 20));
    canvasElement.querySelector<HTMLButtonElement>('[aria-label="隐藏文件树"]')?.click();
  },
};

export const Empty: Story = {
  name: "空状态 · 无改动",
  args: {
    loadDiff: async () => ({
      available: true as const,
      fileCount: 0,
      files: [],
      reason: null,
      workspaceMode: "worktree" as const,
    }),
  },
};
