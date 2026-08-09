import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { IncidentCard } from "./incident-card";

describe("IncidentCard", () => {
  it("names the state and offers recovery in place", () => {
    render(
      <IncidentCard
        incident={{
          label: "无响应",
          detail: "工具调用运行过久",
          contentIncomplete: true,
          elapsedMs: 767_000,
          completedAt: "2026-07-11T10:13:00.000Z",
        }}
        actions={<button type="button">重试</button>}
      />,
    );

    // 卡片自己说清楚发生了什么，不需要用户先点一个图标才知道
    expect(screen.getByText("无响应")).toBeVisible();
    expect(screen.getByText("上面的内容在中途停下，不是完整结论。")).toBeVisible();
    expect(screen.getByText("工具调用运行过久")).toBeVisible();
    expect(screen.getByRole("button", { name: "重试" })).toBeVisible();
    expect(screen.getByRole("group", { name: "无响应" })).toBeVisible();
  });

  it("marks a severe state with the danger border", () => {
    render(<IncidentCard incident={{ label: "需要重新登录", severity: "danger" }} />);
    expect(screen.getByRole("group", { name: "需要重新登录" })).toHaveClass("border-danger");
  });
});
