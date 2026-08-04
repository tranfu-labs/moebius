import type { Meta, StoryObj } from "@storybook/react";

import { WorkspaceFileView } from "@/console/workspace-file-view";

const markdown = `# Moebius

A local conversation console.

- Full workspace files
- Dedicated Review view
`;

const meta = {
  title: "Block/Console/WorkspaceFileView",
  component: WorkspaceFileView,
  parameters: { layout: "padded" },
  args: {
    targetKey: "readme",
    path: "README.md",
    text: markdown,
    lines: markdown.split("\n").map((text, index) => ({ lineNumber: index + 1, text })),
    hasExplicitLine: false,
  },
  decorators: [
    (Story) => <div className="flex h-[420px] overflow-hidden border border-line bg-canvas"><Story /></div>,
  ],
} satisfies Meta<typeof WorkspaceFileView>;

export default meta;
type Story = StoryObj<typeof meta>;

export const MarkdownPreview: Story = {};

export const ExplicitMarkdownSource: Story = {
  args: {
    targetKey: "readme:4",
    hasExplicitLine: true,
    targetLine: 4,
  },
};

export const PlainSource: Story = {
  args: {
    targetKey: "app",
    path: "src/app.ts",
    text: "export const ready = true;",
    lines: [{ lineNumber: 1, text: "export const ready = true;" }],
    hasExplicitLine: false,
  },
};
