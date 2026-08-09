import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { MessageAction, MessageToolbar } from "./message-toolbar";
import { FileText } from "lucide-react";

describe("MessageToolbar", () => {
  it("stays action-only when nothing went wrong", () => {
    render(
      <MessageToolbar>
        <MessageAction icon={FileText} label="完整输出" onClick={() => undefined} />
      </MessageToolbar>,
    );

    expect(screen.getByRole("button", { name: "完整输出" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /事故详情/u })).not.toBeInTheDocument();
  });

  it("folds the state, timing and diagnostic behind one incident marker", () => {
    render(
      <MessageToolbar
        incident={{
          label: "没有启动",
          detail: "没有找到 Kimi CLI。请先安装 Kimi，然后重试。",
          contentIncomplete: true,
          elapsedMs: 767_000,
          completedAt: "2026-07-11T10:13:00.000Z",
        }}
        incidentDetail={<button type="button">重试</button>}
      />,
    );

    // 时间线上只有一个入口，状态文字不占版面
    expect(screen.queryByText("没有启动")).not.toBeInTheDocument();
    const marker = screen.getByRole("button", { name: "查看事故详情：没有启动" });

    fireEvent.click(marker);

    expect(screen.getByText("没有启动")).toBeVisible();
    expect(screen.getByText("上面的内容在中途停下，不是完整结论。")).toBeVisible();
    expect(screen.getByText("没有找到 Kimi CLI。请先安装 Kimi，然后重试。")).toBeVisible();
    expect(screen.getByRole("button", { name: "重试" })).toBeVisible();
  });

  it("runs a toolbar action", () => {
    const onClick = vi.fn();
    render(
      <MessageToolbar>
        <MessageAction icon={FileText} label="完整输出" onClick={onClick} />
      </MessageToolbar>,
    );

    fireEvent.click(screen.getByRole("button", { name: "完整输出" }));
    expect(onClick).toHaveBeenCalledOnce();
  });
});
