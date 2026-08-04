import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { SessionTeamUpdateNotice } from "./session-team-update-notice";

describe("SessionTeamUpdateNotice", () => {
  it("keeps identity-frontmatter categories separate while sharing one full apply", () => {
    const onApply = vi.fn();
    render(<SessionTeamUpdateNotice state={{
      status: "available",
      categories: [
        { kind: "agent-definition", affectedMemberCount: 1 },
        { kind: "team-information", affectedMemberCount: 1 },
      ],
    }} onApply={onApply} />);

    expect(screen.getByText("Agent 定义已更新")).toBeVisible();
    expect(screen.getByText("团队信息已更新")).toBeVisible();
    expect(screen.queryByText("运行配置已更新")).not.toBeInTheDocument();
    fireEvent.click(screen.getAllByRole("button", { name: "应用" })[1]!);
    expect(onApply).toHaveBeenCalledTimes(1);
  });

  it.each([
    { status: "waiting" as const, categories: [] },
    { status: "failed" as const, categories: [], failure: { code: "FAILED", summary: "failed" } },
  ])("keeps the $status recovery state identifiable after a restart", (state) => {
    render(<SessionTeamUpdateNotice state={state} />);
    expect(screen.getByLabelText("团队更新")).toBeVisible();
  });
});
