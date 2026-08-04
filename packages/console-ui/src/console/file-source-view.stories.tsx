import type { Meta, StoryObj } from "@storybook/react";

import { FileSourceView } from "@/console/file-source-view";

const meta = {
  title: "Component/Console/FileSourceView",
  component: FileSourceView,
  parameters: { layout: "padded" },
  args: {
    lines: [
      { lineNumber: 40, text: "export function readProjectFile() {" },
      { lineNumber: 41, text: "  return currentWorkspaceText;" },
      { lineNumber: 42, text: "}" },
    ],
    targetLine: 41,
  },
  decorators: [
    (Story) => <div className="h-48 overflow-hidden border border-line bg-canvas"><Story /></div>,
  ],
} satisfies Meta<typeof FileSourceView>;

export default meta;
type Story = StoryObj<typeof meta>;

export const LocatedCurrentSource: Story = {};

export const EmptyFile: Story = {
  args: { lines: [], targetLine: null },
};
