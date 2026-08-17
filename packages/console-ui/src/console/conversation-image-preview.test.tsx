import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import {
  ConversationImagePreviewCard,
  StructuredAttachmentList,
  type ComposerAttachment,
  type ConversationImagePreviewItem,
} from "./structured-attachments";
import type { ConversationImageDialogItem } from "./conversation-image-dialog";

const item: ConversationImagePreviewItem = {
  id: "preview-a",
  displayName: "layout.png",
  mediaType: "image/png",
  previewUrl: "data:image/png;base64,AA==",
  sourceLabel: "来自你",
};

describe("ConversationImagePreviewCard", () => {
  it("shows only the image while keeping one accessible large-view action", () => {
    const onOpen = vi.fn();
    render(<ConversationImagePreviewCard item={item} onOpen={onOpen} />);

    expect(screen.getByRole("img", { name: "layout.png，来自你" })).toBeVisible();
    expect(screen.queryByText("layout.png")).not.toBeInTheDocument();
    expect(screen.queryByText("PNG · 来自你")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "查看大图：layout.png" }));
    expect(onOpen).toHaveBeenCalledWith(item);
  });

  it("keeps the complete name available when the visible label truncates", () => {
    render(<ConversationImagePreviewCard item={{ ...item, displayName: "a-very-long-preview-file-name.png" }} onOpen={() => undefined} />);

    expect(screen.getByRole("button", { name: "查看大图：a-very-long-preview-file-name.png" }))
      .not.toHaveAttribute("title");
  });

  it("shows a ready draft image in the existing attachment flow", () => {
    const attachment: ComposerAttachment = {
      clientId: "draft-image",
      attachmentId: "draft-image",
      kind: "image",
      displayName: "dashboard-reference.png",
      mediaType: "image/png",
      byteSize: 284_672,
      previewUrl: "data:image/png;base64,AA==",
      status: "ready",
    };

    render(
      <StructuredAttachmentList
        attachments={[attachment]}
        mode="draft"
        onRemove={() => undefined}
      />,
    );

    expect(screen.getByText("dashboard-reference.png")).toBeVisible();
    expect(screen.getByText("已准备 · PNG · 来自你")).toBeVisible();
    expect(screen.getByRole("button", { name: "移除附件 dashboard-reference.png" })).toBeVisible();
  });

  it("opens a sent user image from the production attachment list", async () => {
    render(
      <StructuredAttachmentList
        attachments={[{
          attachmentId: "sent-image",
          kind: "image",
          displayName: "sent-reference.png",
          mediaType: "image/png",
          byteSize: 284_672,
          previewUrl: "data:image/png;base64,AA==",
          largePreviewUrl: "data:image/png;base64,AA==",
        }]}
        mode="message"
        sourceLabel="来自你"
      />,
    );

    const trigger = screen.getByRole("button", { name: "查看大图：sent-reference.png" });
    fireEvent.click(trigger);

    expect(screen.getByRole("dialog")).toBeVisible();
    expect(screen.getByRole("img", { name: "sent-reference.png的大图预览" })).toBeVisible();

    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(trigger).toHaveFocus();
  });

  it("uses the current conversation gallery when switching from one message image", () => {
    const gallery: ConversationImageDialogItem[] = [
      {
        id: "sent-image-a",
        displayName: "first.png",
        mediaType: "image/png",
        previewUrl: "data:image/png;base64,AA==",
        sourceLabel: "来自你",
      },
      {
        id: "sent-image-b",
        displayName: "second.png",
        mediaType: "image/png",
        previewUrl: "data:image/png;base64,AA==",
        sourceLabel: "来自你",
      },
    ];
    render(
      <StructuredAttachmentList
        attachments={[{
          attachmentId: "sent-image-a",
          kind: "image",
          displayName: "first.png",
          mediaType: "image/png",
          byteSize: 1,
          previewUrl: "data:image/png;base64,AA==",
        }]}
        mode="message"
        sourceLabel="来自你"
        imageGallery={gallery}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "查看大图：first.png" }));
    fireEvent.click(screen.getByRole("button", { name: "下一张图片" }));
    expect(screen.getByRole("img", { name: "second.png的大图预览" })).toBeVisible();
  });

  it("keeps Agent image order and uses the readable member source", () => {
    render(
      <StructuredAttachmentList
        attachments={[
          {
            attachmentId: "agent-image-a",
            kind: "image",
            displayName: "wide-layout.png",
            mediaType: "image/png",
            byteSize: 284_672,
            previewUrl: "data:image/png;base64,AA==",
          },
          {
            attachmentId: "agent-image-b",
            kind: "image",
            displayName: "narrow-layout.webp",
            mediaType: "image/webp",
            byteSize: 196_608,
            previewUrl: "data:image/png;base64,AA==",
          },
        ]}
        mode="message"
        sourceLabel="来自 开发"
      />,
    );

    const previews = screen.getAllByRole("button", { name: /查看大图/u });
    expect(previews.map((preview) => preview.getAttribute("aria-label"))).toEqual([
      "查看大图：wide-layout.png",
      "查看大图：narrow-layout.webp",
    ]);
    expect(screen.queryByText("PNG · 来自 开发")).not.toBeInTheDocument();
    expect(screen.queryByText("WEBP · 来自 开发")).not.toBeInTheDocument();
  });
});
