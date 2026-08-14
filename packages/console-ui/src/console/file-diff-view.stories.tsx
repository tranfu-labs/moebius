import type { Meta, StoryObj } from "@storybook/react";

import { FileDiffView } from "@/console/file-diff-view";

const meta = {
  title: "Component/Console/FileDiffView",
  component: FileDiffView,
  args: {
    appearance: "focused",
    path: "packages/console-ui/src/console/operator-console.stories.tsx",
    content: {
      available: true,
      path: "packages/console-ui/src/console/operator-console.stories.tsx",
      reason: null,
      lines: [
        { kind: "unchanged", oldLineNumber: 760, newLineNumber: 760, text: "export const DashboardShellWithRightSidebar = {" },
        { kind: "deletion", oldLineNumber: 761, newLineNumber: null, text: "  appearance: \"default\"," },
        { kind: "addition", oldLineNumber: null, newLineNumber: 761, text: "  appearance: \"focused\"," },
        { kind: "unchanged", oldLineNumber: 762, newLineNumber: 762, text: "};" },
      ],
    },
  },
  render: (args) => (
    <div className="grid h-[360px] w-[720px] max-w-screen grid-cols-[minmax(0,1fr)] grid-rows-[auto_minmax(0,1fr)] bg-card">
      <FileDiffView {...args} />
    </div>
  ),
  parameters: { layout: "centered" },
} satisfies Meta<typeof FileDiffView>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Loaded: Story = { name: "页面同款 · 已加载" };

export const SelectFile: Story = {
  name: "空状态 · 选择文件",
  args: { path: null, content: null },
};

export const Loading: Story = {
  name: "加载中",
  args: { loading: true },
};
