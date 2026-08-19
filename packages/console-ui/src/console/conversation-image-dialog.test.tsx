import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { useRef, useState } from "react";
import { describe, expect, it } from "vitest";

import {
  ConversationImageDialog,
  type ConversationImageDialogItem,
} from "./conversation-image-dialog";
import { ConversationImagePreviewCard } from "./structured-attachments";

const item: ConversationImageDialogItem = {
  id: "dialog-image",
  displayName: "layout.svg",
  mediaType: "image/svg+xml",
  previewUrl: "data:image/svg+xml;base64,AA==",
  largePreviewUrl: "data:image/png;base64,AA==",
  sourceLabel: "来自 UI 负责人",
};

function Harness(): JSX.Element {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const items = [
    item,
    {
      ...item,
      id: "dialog-image-second",
      displayName: "detail-check.png",
    },
  ] satisfies ConversationImageDialogItem[];
  return (
    <>
      <ConversationImagePreviewCard ref={triggerRef} item={item} onOpen={() => setOpen(true)} />
      <ConversationImageDialog open={open} items={items} onOpenChange={setOpen} returnFocusRef={triggerRef} />
    </>
  );
}

describe("ConversationImageDialog", () => {
  it("opens as a full-viewport image viewer without metadata chrome", () => {
    render(<Harness />);
    fireEvent.click(screen.getByRole("button", { name: "查看大图：layout.svg" }));

    const dialog = screen.getByRole("dialog", { name: "图片预览" });
    expect(dialog).toBeVisible();
    expect(within(dialog).getByRole("img", { name: "layout.svg的大图预览" })).toBeVisible();
    expect(within(dialog).queryByText("SVG · 来自 UI 负责人")).not.toBeInTheDocument();
  });

  it("switches images and resets the zoom for the new image", () => {
    render(<Harness />);
    fireEvent.click(screen.getByRole("button", { name: "查看大图：layout.svg" }));

    fireEvent.click(screen.getByRole("button", { name: "放大图片" }));
    expect(screen.getByTestId("image-lightbox-zoom")).toHaveTextContent("125%");
    fireEvent.click(screen.getByRole("button", { name: "下一张图片" }));

    expect(screen.getByRole("img", { name: "detail-check.png的大图预览" })).toBeVisible();
    expect(screen.getByTestId("image-lightbox-zoom")).toHaveTextContent("100%");
    expect(screen.getByRole("button", { name: "上一张图片" })).toBeEnabled();
  });

  it("enables the pan cursor only after the image has been enlarged", () => {
    render(<Harness />);
    fireEvent.click(screen.getByRole("button", { name: "查看大图：layout.svg" }));
    const viewport = screen.getByTestId("image-lightbox-viewport");
    expect(viewport).toHaveClass("cursor-default");

    fireEvent.click(screen.getByRole("button", { name: "放大图片" }));
    expect(viewport).toHaveClass("cursor-grab");
  });

  it("closes with Escape and restores focus to the preview", async () => {
    render(<Harness />);
    const trigger = screen.getByRole("button", { name: "查看大图：layout.svg" });
    fireEvent.click(trigger);
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });

    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(trigger).toHaveFocus();
  });

  it("closes from the named close button and restores focus", async () => {
    render(<Harness />);
    const trigger = screen.getByRole("button", { name: "查看大图：layout.svg" });
    fireEvent.click(trigger);
    fireEvent.click(screen.getByRole("button", { name: "关闭大图" }));

    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(trigger).toHaveFocus();
  });

  it("keeps large-view loading and failure inside the dialog", () => {
    const { rerender } = render(
      <ConversationImageDialog open items={[item]} status="loading" onOpenChange={() => undefined} />,
    );
    expect(screen.getByText("正在打开「layout.svg」…")).toBeVisible();

    rerender(
      <ConversationImageDialog
        open
        items={[item]}
        status="failed"
        onOpenChange={() => undefined}
        onReload={() => undefined}
        onOpenFile={() => undefined}
      />,
    );
    expect(screen.getByText("这张图片暂时显示不了")).toBeVisible();
    expect(screen.getByRole("button", { name: "重新加载" })).toBeVisible();
    expect(screen.getByRole("button", { name: "打开文件" })).toBeVisible();
  });
});
