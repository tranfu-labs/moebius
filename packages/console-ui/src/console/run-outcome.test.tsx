import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { RunOutcome, type RunOutcomeStatus } from "./run-outcome";

const outcomeFixtures: Array<{ status: RunOutcomeStatus; summary: string; reason: string }> = [
  { status: "run-not-started", summary: "这一步没跑起来", reason: "exit:42" },
  { status: "run-stuck", summary: "这一步卡住了", reason: "idle-timeout:10ms" },
  { status: "user-stopped", summary: "你让这一步停下了", reason: "interrupted:user" },
  { status: "resume-unavailable", summary: "原执行已经无法继续", reason: "rollout-unavailable" },
  { status: "retry-exhausted", summary: "这一步反复没跑起来，已经不再重试", reason: "dead-letter:max-retries" },
];

describe("RunOutcome", () => {
  it("maps terminal outcomes to readable summaries without rendering machine reasons", () => {
    for (const fixture of outcomeFixtures) {
      const { unmount } = render(<RunOutcome status={fixture.status} role="dev" rawReason={fixture.reason} />);

      expect(screen.getByText(fixture.summary)).toBeVisible();
      expect(screen.queryByText(fixture.reason)).not.toBeInTheDocument();
      unmount();
    }
  });

  it("keeps retry separate from the complete-output action", () => {
    const onRetry = vi.fn();
    const onOpenOutput = vi.fn();
    render(
      <RunOutcome
        status="run-not-started"
        rawReason="exit:42"
        rawOutput="complete failure output"
        onRetry={onRetry}
        onOpenOutput={onOpenOutput}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "重试" }));
    expect(onRetry).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: "完整输出" }));
    expect(onOpenOutput).toHaveBeenCalledWith("complete failure output");
    expect(screen.queryByText("exit:42")).not.toBeInTheDocument();
  });

  it("keeps the accessible edit-and-resend and complete-output actions for a user interruption", () => {
    const onEditAndResend = vi.fn();
    const onOpenOutput = vi.fn();
    render(
      <RunOutcome
        status="user-stopped"
        onOpenDiagnostics={vi.fn()}
        onEditAndResend={onEditAndResend}
        onOpenOutput={onOpenOutput}
      />,
    );

    expect(screen.getByText("你让这一步停下了")).toBeVisible();
    expect(screen.queryByRole("button", { name: "重试" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "改一改重发这轮消息" }));
    expect(onEditAndResend).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByRole("button", { name: "完整输出" }));
    expect(onOpenOutput).toHaveBeenCalledWith(null);
  });

  it("does not expose edit or resend on other outcomes", () => {
    render(<RunOutcome status="run-stuck" onRetry={vi.fn()} onEditAndResend={vi.fn()} />);

    expect(screen.queryByRole("button", { name: /改一改重发/u })).not.toBeInTheDocument();
  });

  it("labels an unavailable recovery as an explicit new run", () => {
    const onRetry = vi.fn();
    render(<RunOutcome status="resume-unavailable" onRetry={onRetry} />);

    fireEvent.click(screen.getByRole("button", { name: "重新运行" }));
    expect(onRetry).toHaveBeenCalledOnce();
    expect(screen.queryByRole("button", { name: "重试" })).not.toBeInTheDocument();
  });

  it("shows the same custom member name for every terminal fact", () => {
    for (const fixture of outcomeFixtures) {
      const { unmount } = render(
        <RunOutcome
          status={fixture.status}
          role="plan-executor"
          memberIdentities={[{ slug: "plan-executor", displayName: "方案执行者" }]}
        />,
      );
      expect(screen.getByText("方案执行者")).toBeVisible();
      expect(screen.queryByText("协作者")).not.toBeInTheDocument();
      unmount();
    }
  });

  it("shows terminal duration once and omits a fake zero duration when no process started", () => {
    const { rerender } = render(
      <RunOutcome
        status="run-stuck"
        elapsedMs={138_000}
        completedAt="2026-07-26T06:32:00.000Z"
      />,
    );
    expect(screen.getByText("耗时 02:18")).toBeVisible();

    rerender(<RunOutcome status="run-not-started" elapsedMs={null} />);
    expect(screen.queryByText(/耗时|00:00/u)).not.toBeInTheDocument();
  });
});
