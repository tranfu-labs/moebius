import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { ConversationImageStatusCard } from "./conversation-image-status-card";

const item = {
  id: "state-image",
  displayName: "dashboard.svg",
  mediaType: "image/svg+xml",
  sourceLabel: "来自 开发",
};

describe("ConversationImageStatusCard", () => {
  it("keeps the loading state in the image slot with the PRD copy", () => {
    render(<ConversationImageStatusCard item={item} status="loading" />);

    expect(screen.getByText("正在加载「dashboard.svg」，预览会显示在这里。")).toBeVisible();
    expect(screen.getByText("SVG · 来自 开发")).toBeVisible();
  });

  it("offers local recovery actions without replacing the rest of the message", () => {
    const onReload = vi.fn();
    const onOpenFile = vi.fn();
    render(
      <div>
        <p>同一消息中的正文</p>
        <ConversationImageStatusCard item={item} status="failed" onReload={onReload} onOpenFile={onOpenFile} />
      </div>,
    );

    expect(screen.getByText("同一消息中的正文")).toBeVisible();
    expect(screen.getByText("这张图片暂时显示不了")).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "重新加载" }));
    fireEvent.click(screen.getByRole("button", { name: "打开文件" }));
    expect(onReload).toHaveBeenCalledOnce();
    expect(onOpenFile).toHaveBeenCalledOnce();
  });

  it("only exposes the controlled file action for an unsafe SVG", () => {
    render(<ConversationImageStatusCard item={item} status="unsafe" onOpenFile={() => undefined} />);

    expect(screen.getByText("这张 SVG 不能在会话中安全显示，你仍可以打开原文件。")).toBeVisible();
    expect(screen.queryByRole("button", { name: "重新加载" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "打开文件" })).toBeVisible();
  });
});
