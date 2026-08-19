import type { Meta, StoryObj } from "@storybook/react";

import {
  ConversationImagePreviewCard,
  type ConversationImagePreviewItem,
} from "@/console/structured-attachments";
import firstImageUrl from "../../../../assets/readme/dashboard-en.png";
import secondImageUrl from "../../../../assets/readme/team-loop.png";

const fromYou: ConversationImagePreviewItem = {
  id: "from-you",
  displayName: "dashboard-en.png",
  mediaType: "image/png",
  previewUrl: firstImageUrl,
  sourceLabel: "来自你",
};

const fromAgent: ConversationImagePreviewItem = {
  id: "from-agent",
  displayName: "team-loop.png",
  mediaType: "image/png",
  previewUrl: secondImageUrl,
  sourceLabel: "来自 UI 负责人",
};

const meta = {
  title: "Component/Console/ConversationImagePreviewCard",
  component: ConversationImagePreviewCard,
  parameters: {
    layout: "centered",
  },
  args: {
    item: fromYou,
    onOpen: () => undefined,
  },
} satisfies Meta<typeof ConversationImagePreviewCard>;

export default meta;
type Story = StoryObj<typeof meta>;

export const FromYou: Story = {
  name: "来自你",
};

export const SourceVariants: Story = {
  name: "两张真实图片",
  render: () => (
    <div className="flex max-w-[calc(100vw-48px)] flex-wrap gap-2 p-4">
      <ConversationImagePreviewCard item={fromYou} onOpen={() => undefined} />
      <ConversationImagePreviewCard item={fromAgent} onOpen={() => undefined} />
    </div>
  ),
};
