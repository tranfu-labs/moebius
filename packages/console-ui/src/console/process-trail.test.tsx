import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { ProcessTrail, type ProcessStep } from "./process-trail";

const steps: ProcessStep[] = [
  { id: "1", kind: "thinking", title: "先看官网构建是否通过", status: "done" },
  { id: "2", kind: "command", title: "pnpm --filter marketing-site build", detail: "退出码 0", status: "done" },
  { id: "3", kind: "file", title: "读取 share-card.tsx", status: "running" },
];

describe("ProcessTrail", () => {
  it("keeps every step visible while the run is live", () => {
    render(<ProcessTrail steps={steps} />);

    expect(screen.getByText("先看官网构建是否通过")).toBeVisible();
    expect(screen.getByText("pnpm --filter marketing-site build")).toBeVisible();
    expect(screen.getByText("退出码 0")).toBeVisible();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("folds into one line once the answer landed, and reopens on demand", () => {
    render(<ProcessTrail steps={steps} collapsed />);

    const summary = screen.getByRole("button", { name: /思考与工具调用 · 3 步/u });
    expect(summary).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByText("先看官网构建是否通过")).not.toBeInTheDocument();

    fireEvent.click(summary);

    expect(summary).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText("先看官网构建是否通过")).toBeVisible();
  });

  it("renders nothing without steps", () => {
    const { container } = render(<ProcessTrail steps={[]} collapsed />);
    expect(container).toBeEmptyDOMElement();
  });
});
