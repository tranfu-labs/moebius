import type { Meta, StoryObj } from "@storybook/react";

import { ResultCard } from "@/console/result-card";

const meta = {
  title: "Component/Console/ResultCard",
  component: ResultCard,
  args: {
    fileCount: 2,
    onOpen: () => undefined,
  },
} satisfies Meta<typeof ResultCard>;

export default meta;
type Story = StoryObj<typeof meta>;

export const WithChanges: Story = {};

export const NoChanges: Story = {
  args: { fileCount: 0 },
};
