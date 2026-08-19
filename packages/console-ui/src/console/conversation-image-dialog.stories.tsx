import type { Meta, StoryObj } from "@storybook/react";
import { useRef, useState } from "react";

import {
  ConversationImageDialog,
  type ConversationImageDialogItem,
} from "@/console/conversation-image-dialog";
import { ConversationImagePreviewCard } from "@/console/structured-attachments";
import firstImageUrl from "../../../../assets/readme/dashboard-en.png";
import secondImageUrl from "../../../../assets/readme/team-loop.png";

const item: ConversationImageDialogItem = {
  id: "dialog-image",
  displayName: "dashboard-en.png",
  mediaType: "image/png",
  previewUrl: firstImageUrl,
  largePreviewUrl: firstImageUrl,
  sourceLabel: "来自 UI 负责人",
};

function InteractiveImageDialog(): JSX.Element {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const items = [
    item,
    {
      ...item,
      id: "dialog-image-second",
      displayName: "team-loop.png",
      previewUrl: secondImageUrl,
      largePreviewUrl: secondImageUrl,
    },
  ] satisfies ConversationImageDialogItem[];
  return (
    <div className="p-8">
      <ConversationImagePreviewCard ref={triggerRef} item={item} onOpen={() => setOpen(true)} />
      <ConversationImageDialog
        open={open}
        items={items}
        onOpenChange={setOpen}
        returnFocusRef={triggerRef}
      />
    </div>
  );
}

const meta = {
  title: "Component/Console/ConversationImageDialog",
  component: ConversationImageDialog,
  parameters: {
    layout: "centered",
  },
  args: {
    open: false,
    items: [item],
    onOpenChange: () => undefined,
  },
} satisfies Meta<typeof ConversationImageDialog>;

export default meta;
type Story = StoryObj<typeof meta>;

export const OpenFromPreview: Story = {
  name: "从预览打开并返回",
  render: () => <InteractiveImageDialog />,
};
