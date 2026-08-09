import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { IncidentNotice } from "./incident-card";

describe("IncidentNotice", () => {
  it("states what happened in one line and carries no actions", () => {
    render(
      <IncidentNotice
        incident={{ label: "无响应", detail: "工具调用运行过久", contentIncomplete: true }}
      />,
    );

    expect(screen.getByText("无响应")).toBeVisible();
    expect(screen.getByText("· 内容不完整")).toBeVisible();
    expect(screen.getByText("工具调用运行过久")).toBeVisible();
    // 动作统一在消息工具条上，事故行只陈述事实
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
    // 耗时归表头，事故行永远不重复
    expect(screen.queryByText(/耗时/u)).not.toBeInTheDocument();
  });

  it("marks a severe state apart from a warning", () => {
    const { container } = render(
      <IncidentNotice incident={{ label: "需要重新登录", severity: "danger" }} />,
    );
    expect(container.querySelector("svg")).toHaveClass("text-danger");
  });
});
