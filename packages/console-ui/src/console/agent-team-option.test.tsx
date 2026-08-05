import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { AgentTeamOption } from "./agent-team-option";

describe("AgentTeamOption", () => {
  it("keeps members collapsed until the disclosure is activated", () => {
    render(<AgentTeamOption team={{
      label: "产品研发闭环团队",
      ownership: "system",
      description: "把产品想法推进为可验证的软件功能",
      primaryAgentSlug: "lead",
      members: [
        { slug: "lead", displayName: "产品交付总控" },
        { slug: "spec", displayName: "产品规格评审" },
        { slug: "user", displayName: "用户任务评审" },
        { slug: "dev", displayName: "开发负责人" },
      ],
    }} />);

    expect(screen.queryByText("用户任务评审")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "查看成员" }));
    expect(screen.getByText("用户任务评审")).toBeVisible();
    expect(screen.getByTestId("agent-team-members")).toHaveClass("max-h-24", "overflow-y-auto", "overscroll-contain");
    fireEvent.click(screen.getByRole("button", { name: "收起成员" }));
    expect(screen.queryByText("用户任务评审")).not.toBeInTheDocument();
  });
});
