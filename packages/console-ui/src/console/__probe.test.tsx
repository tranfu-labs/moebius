import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { MessageToolbar } from "@/console/message-toolbar";

describe("probe", () => {
  it("opens", () => {
    render(
      <MessageToolbar
        incident={{ label: "没有启动" }}
        incidentDetail={<button type="button">换执行配置重跑</button>}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /查看事故详情/u }));
    expect(screen.getByRole("button", { name: "换执行配置重跑", hidden: true })).toBeTruthy();
  });
});
