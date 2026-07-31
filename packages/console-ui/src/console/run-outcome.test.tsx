import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { RunOutcome, type RunOutcomeStatus } from "./run-outcome";
import { EXECUTION_MODEL_REGISTRY } from "./execution-profile-registry";

const outcomeFixtures: Array<{ status: RunOutcomeStatus; summary: string; reason: string }> = [
  { status: "run-not-started", summary: "这一步没跑起来", reason: "exit:42" },
  { status: "run-stuck", summary: "这一步卡住了", reason: "idle-timeout:10ms" },
  { status: "user-stopped", summary: "你让这一步停下了", reason: "interrupted:user" },
  { status: "system-stopped", summary: "这一步被系统停止了", reason: "interrupted:system" },
  { status: "resume-unavailable", summary: "原执行已经无法继续", reason: "rollout-unavailable" },
  { status: "retry-exhausted", summary: "这一步反复没跑起来，已经不再重试", reason: "dead-letter:max-retries" },
  { status: "quota-exhausted", summary: "当前额度不可用", reason: "kimi-quota-exhausted" },
  { status: "rate-limited", summary: "对方服务持续繁忙", reason: "kimi-rate-limited" },
  { status: "auth-failed", summary: "执行引擎需要重新登录", reason: "auth" },
  { status: "run-crashed", summary: "这一步没有产出完整结果", reason: "no-complete-result" },
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

  it("shows an actionable safe description without exposing the machine reason", () => {
    render(
      <RunOutcome
        status="run-not-started"
        rawReason="codex-cli-upgrade-required"
        description="Codex 版本过旧，无法运行模型 gpt-5.6-sol。请升级当前 Codex 后再重试。"
      />,
    );

    expect(screen.getByText(
      "Codex 版本过旧，无法运行模型 gpt-5.6-sol。请升级当前 Codex 后再重试。",
    )).toBeVisible();
    expect(screen.queryByText("codex-cli-upgrade-required")).not.toBeInTheDocument();
  });

  it("keeps the accessible edit-and-resend and complete-output actions for a user interruption", () => {
    const onEditAndResend = vi.fn();
    const onOpenOutput = vi.fn();
    const onRetry = vi.fn();
    render(
      <RunOutcome
        status="user-stopped"
        onOpenDiagnostics={vi.fn()}
        onEditAndResend={onEditAndResend}
        onRetry={onRetry}
        onOpenOutput={onOpenOutput}
      />,
    );

    expect(screen.getByText("你让这一步停下了")).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "重试" }));
    expect(onRetry).toHaveBeenCalledOnce();
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

  it("keeps partial Markdown visible and submits a single-run profile override", async () => {
    const onRetry = vi.fn();
    const onOverrideAndRetry = vi.fn();
    render(
      <RunOutcome
        status="quota-exhausted"
        partialMarkdown={"## 已完成\n\n- 保留这部分"}
        contentIncomplete
        initialProfile={{ cli: "kimi", model: "kimi-code/kimi-for-coding", effort: "on" }}
        onRetry={onRetry}
        onOverrideAndRetry={onOverrideAndRetry}
      />,
    );

    expect(screen.getByRole("heading", { name: "已完成" })).toBeVisible();
    expect(screen.getByText("内容不完整")).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "换执行配置重跑" }));
    fireEvent.change(screen.getByRole("combobox", { name: "CLI" }), {
      target: { value: "codex" },
    });
    fireEvent.click(screen.getByRole("button", { name: "仅本次重跑" }));
    await waitFor(() => expect(onOverrideAndRetry).toHaveBeenCalledWith({
        cli: "codex",
        model: "gpt-5.6-sol",
        effort: "high",
      }));
    expect(screen.queryByRole("button", { name: "仅本次重跑" })).not.toBeInTheDocument();
  });

  it("preserves terminal content across slow and failed registry states", () => {
    const onReload = vi.fn();
    const props = {
      status: "quota-exhausted" as const,
      partialMarkdown: "保留的中断内容",
      contentIncomplete: true,
      onOverrideAndRetry: vi.fn(),
    };
    const { rerender } = render(
      <RunOutcome {...props} executionRegistryState={{ status: "loading" }} />,
    );

    fireEvent.click(screen.getByRole("button", { name: "换执行配置重跑" }));
    expect(screen.getByText("正在读取可用的执行配置…")).toBeVisible();
    expect(screen.getByText("保留的中断内容")).toBeVisible();

    rerender(
      <RunOutcome
        {...props}
        executionRegistryState={{ status: "error", message: "" }}
        onReloadExecutionRegistry={onReload}
      />,
    );
    expect(screen.getByRole("alert")).toHaveTextContent("暂时无法读取执行配置");
    fireEvent.click(screen.getAllByRole("button", { name: "重试" }).at(-1)!);
    expect(onReload).toHaveBeenCalledOnce();

    rerender(
      <RunOutcome
        {...props}
        executionRegistryState={{ status: "ready", registry: EXECUTION_MODEL_REGISTRY }}
      />,
    );
    expect(screen.getByRole("combobox", { name: "CLI" })).toBeVisible();
    expect(screen.getByText("保留的中断内容")).toBeVisible();
  });

  it("uses the latest callback and blocks duplicate override submissions", async () => {
    let finish!: () => void;
    const pending = new Promise<void>((resolve) => {
      finish = resolve;
    });
    const stale = vi.fn();
    const current = vi.fn(() => pending);
    const common = {
      status: "user-stopped" as const,
      initialProfile: { cli: "kimi" as const, model: "kimi-code/kimi-for-coding", effort: "on" },
    };
    const { rerender } = render(
      <RunOutcome {...common} onOverrideAndRetry={stale} />,
    );
    fireEvent.click(screen.getByRole("button", { name: "换执行配置重跑" }));
    rerender(<RunOutcome {...common} onOverrideAndRetry={current} />);

    const submit = screen.getByRole("button", { name: "仅本次重跑" });
    fireEvent.click(submit);
    fireEvent.click(submit);
    expect(stale).not.toHaveBeenCalled();
    expect(current).toHaveBeenCalledOnce();
    expect(submit).toBeDisabled();

    finish();
    await waitFor(() =>
      expect(screen.queryByRole("button", { name: "仅本次重跑" })).not.toBeInTheDocument());
  });
});
