import type { Meta, StoryObj } from "@storybook/react";
import { useRef, useState } from "react";

import {
  ConversationImageDialog,
  type ConversationImageDialogItem,
} from "@/console/conversation-image-dialog";
import {
  ConversationImageStatusCard,
  type ConversationImageStatus,
} from "@/console/conversation-image-status-card";
import {
  ConversationImagePreviewCard,
  StructuredAttachmentList,
  type ComposerAttachment,
} from "@/console/structured-attachments";
import previewUrl from "../../../../assets/readme/hero.png";

const imageItem = {
  id: "state-image",
  displayName: "dashboard-reference.svg",
  mediaType: "image/svg+xml",
  sourceLabel: "来自 开发",
};

const dialogItem: ConversationImageDialogItem = {
  ...imageItem,
  previewUrl,
  largePreviewUrl: previewUrl,
};

const meta = {
  title: "Block/Console/ConversationImageStates",
  component: ConversationImageStatusCard,
  parameters: { layout: "padded" },
  args: {
    item: imageItem,
    status: "loading",
  },
} satisfies Meta<typeof ConversationImageStatusCard>;

export default meta;
type Story = StoryObj<typeof meta>;

const matrix = [
  ["主时间线", "不渲染图片区域", "时间线加载卡", "时间线失败卡", "安全拒绝卡", "复用就绪预览卡"],
  ["大图层", "不打开查看层", "大图加载区", "大图失败区", "复用安全拒绝区", "复用就绪大图层"],
  ["待发送区", "复用空输入框", "待发送准备中", "待发送失败卡", "SVG 降级为普通文件", "复用就绪附件卡"],
  ["右侧子会话", "复用主时间线空态", "复用时间线加载卡", "复用时间线失败卡", "复用安全拒绝卡", "复用就绪预览卡"],
] as const;

export const StateMatrix: Story = {
  name: "状态矩阵",
  render: () => (
    <div className="overflow-x-auto rounded-xl border border-line bg-card">
      <table className="min-w-[840px] w-full border-collapse text-left text-xs">
        <thead className="bg-sunken text-sub">
          <tr>
            {(["页面", "空态", "加载中", "报错", "无权限／安全拒绝", "超长文本"] as const).map((label) => (
              <th key={label} className="border-b border-line px-3 py-2 font-medium">{label}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {matrix.map((row) => (
            <tr key={row[0]} className="text-ink">
              {row.map((cell, index) => (
                <td key={cell} className="border-b border-line px-3 py-2 align-top last:border-r-0">
                  {index === 0 ? <strong className="font-medium">{cell}</strong> : cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  ),
};

export const TimelineStates: Story = {
  name: "主时间线 · 异步与长文本",
  render: () => (
    <div className="flex max-w-full flex-wrap gap-2 rounded-xl border border-line bg-card p-4">
      {(["loading", "failed", "missing", "changed", "unsafe"] as const).map((status) => (
        <ConversationImageStatusCard
          key={status}
          item={imageItem}
          status={status}
          onReload={() => undefined}
          onOpenFile={() => undefined}
        />
      ))}
      <ConversationImagePreviewCard
        item={{
          ...imageItem,
          displayName: "dashboard-responsive-layout-check-with-an-extra-long-file-name.svg",
          previewUrl,
        }}
        onOpen={() => undefined}
      />
    </div>
  ),
};

const composerAttachments: ComposerAttachment[] = [
  {
    clientId: "pending-image",
    kind: "image",
    displayName: "preparing-layout.png",
    mediaType: "image/png",
    byteSize: 196_608,
    previewUrl,
    status: "pending",
  },
  {
    clientId: "failed-image",
    kind: "image",
    displayName: "invalid-layout.png",
    mediaType: "image/png",
    byteSize: 196_608,
    previewUrl,
    status: "failed",
    error: "「invalid-layout.png」不是可读取的图片。你可以重新选择文件，或将它移除。",
  },
  {
    clientId: "svg-fallback",
    attachmentId: "svg-fallback",
    kind: "file",
    displayName: "unsafe-preview.svg",
    mediaType: "image/svg+xml",
    byteSize: 24_576,
    status: "ready",
    degradedImagePreview: true,
  },
  {
    clientId: "long-ready-image",
    attachmentId: "long-ready-image",
    kind: "image",
    displayName: "dashboard-responsive-layout-check-with-an-extra-long-file-name.webp",
    mediaType: "image/webp",
    byteSize: 284_672,
    previewUrl,
    status: "ready",
  },
];

export const ComposerStates: Story = {
  name: "待发送区 · 状态与长文本",
  render: () => (
    <div className="max-w-[720px] rounded-xl border border-line bg-card p-4">
      <StructuredAttachmentList
        attachments={composerAttachments}
        mode="draft"
        onRemove={() => undefined}
        onRetry={() => undefined}
      />
      <p role="status" className="mt-3 text-xs text-hint">请重试或移除无法添加的图片</p>
    </div>
  ),
};

function DialogStateHarness(): JSX.Element {
  const [status, setStatus] = useState<"ready" | ConversationImageStatus>("loading");
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const options: readonly ("ready" | ConversationImageStatus)[] = ["ready", "loading", "failed", "missing", "changed", "unsafe"];
  return (
    <div className="flex flex-wrap gap-2">
      {options.map((option) => (
        <button
          key={option}
          ref={option === "ready" ? triggerRef : undefined}
          type="button"
          className="min-h-8 rounded-md border border-line bg-card px-3 text-xs text-sub hover:bg-hover hover:text-ink"
          onClick={() => {
            setStatus(option);
            setOpen(true);
          }}
        >
          打开 · {option}
        </button>
      ))}
      <ConversationImageDialog
        open={open}
        items={[dialogItem]}
        status={status}
        onOpenChange={setOpen}
        returnFocusRef={triggerRef}
        onReload={() => undefined}
        onOpenFile={() => undefined}
      />
    </div>
  );
}

export const DialogStates: Story = {
  name: "大图层 · 状态入口",
  render: () => <DialogStateHarness />,
};

export const SecondarySubtaskReuse: Story = {
  name: "次要页 · 右侧子会话复用",
  render: () => (
    <div className="w-[320px] max-w-full rounded-xl border border-line bg-card p-3">
      <p className="mb-3 text-xs text-sub">右侧子会话沿用主时间线状态组件，并在自身可用宽度内换行。</p>
      <div className="flex flex-wrap gap-2">
        <ConversationImageStatusCard item={imageItem} status="loading" />
        <ConversationImageStatusCard item={imageItem} status="unsafe" onOpenFile={() => undefined} />
      </div>
    </div>
  ),
};
