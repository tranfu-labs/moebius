import type { Meta, StoryObj } from "@storybook/react";

import {
  StructuredAttachmentList,
  type ComposerAttachment,
  type StructuredAttachment,
} from "@/console/structured-attachments";
import previewUrl from "../../../../assets/readme/dashboard-en.png";

const messageAttachments: StructuredAttachment[] = [
  {
    attachmentId: "image-ready",
    kind: "image",
    displayName: "conversation-preview.png",
    mediaType: "image/png",
    byteSize: 284_672,
    previewUrl,
  },
  {
    attachmentId: "file-ready",
    kind: "file",
    displayName: "implementation-notes.pdf",
    mediaType: "application/pdf",
    byteSize: 82_944,
  },
];

const draftAttachments: ComposerAttachment[] = [
  {
    clientId: "draft-ready",
    attachmentId: "draft-ready",
    kind: "image",
    displayName: "ready-image.png",
    mediaType: "image/png",
    byteSize: 196_608,
    previewUrl,
    status: "ready",
  },
  {
    clientId: "draft-pending",
    kind: "image",
    displayName: "preparing-image.webp",
    mediaType: "image/webp",
    byteSize: 147_456,
    previewUrl,
    status: "pending",
  },
  {
    clientId: "draft-failed",
    kind: "file",
    displayName: "failed-upload.pdf",
    mediaType: "application/pdf",
    byteSize: 4_096,
    status: "failed",
    error: "文件暂时无法添加",
  },
];

const meta = {
  title: "Component/Console/StructuredAttachmentList",
  component: StructuredAttachmentList,
  parameters: {
    layout: "centered",
  },
  args: {
    attachments: messageAttachments,
    mode: "message",
    sourceLabel: "来自你",
  },
} satisfies Meta<typeof StructuredAttachmentList>;

export default meta;
type Story = StoryObj<typeof meta>;

export const ExistingImplementationBaseline: Story = {
  name: "现有实现基线",
  render: () => (
    <div className="w-[640px] max-w-[calc(100vw-48px)] space-y-6 rounded-xl bg-card p-4">
      <section className="space-y-2">
        <h2 className="text-base font-semibold text-ink">消息图片与普通附件</h2>
        <StructuredAttachmentList
          attachments={messageAttachments}
          mode="message"
          sourceLabel="来自你"
        />
      </section>
      <section className="space-y-2 border-t border-line pt-4">
        <h2 className="text-base font-semibold text-ink">附件草稿状态</h2>
        <StructuredAttachmentList
          attachments={draftAttachments}
          mode="draft"
          onRemove={() => undefined}
          onRetry={() => undefined}
        />
      </section>
    </div>
  ),
};
