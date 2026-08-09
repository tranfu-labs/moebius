import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { RunOutcome, type RunOutcomeStatus } from "./run-outcome";
import { EXECUTION_MODEL_REGISTRY } from "./execution-profile-registry";

const outcomeFixtures: Array<{ status: RunOutcomeStatus; summary: string; reason: string }> = [
  { status: "run-not-started", summary: "没有启动", reason: "exit:42" },
  { status: "run-stuck", summary: "无响应", reason: "idle-timeout:10ms" },
  { status: "user-stopped", summary: "已停止", reason: "interrupted:user" },
  { status: "system-stopped", summary: "已被系统停止", reason: "interrupted:system" },
  { status: "resume-unavailable", summary: "无法继续", reason: "rollout-unavailable" },
  { status: "retry-exhausted", summary: "多次未能启动", reason: "dead-letter:max-retries" },
  { status: "quota-exhausted", summary: "额度不可用", reason: "kimi-quota-exhausted" },
  { status: "rate-limited", summary: "服务繁忙", reason: "kimi-rate-limited" },
  { status: "auth-failed", summary: "需要重新登录", reason: "auth" },
  { status: "run-crashed", summary: "结果不完整", reason: "no-complete-result" },
];

describe("RunOutcome", () => {
  it("offers retry as a labelled action", () => {
    const onRetry = vi.fn();
    const onOpenOutput = vi.fn();
    render(
      <RunOutcome
        status="run-not-started"
        rawReason="exit:42"
        onRetry={onRetry}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "重试" }));
    expect(onRetry).toHaveBeenCalledTimes(1);
    expect(screen.queryByText("exit:42")).not.toBeInTheDocument();
  });

  it("keeps the accessible edit-and-resend action for a user interruption", () => {
    const onEditAndResend = vi.fn();
    const onOpenOutput = vi.fn();
    const onRetry = vi.fn();
    render(
      <RunOutcome
        status="user-stopped"
        onEditAndResend={onEditAndResend}
        onRetry={onRetry}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "重试" }));
    expect(onRetry).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByRole("button", { name: "改一改重发这轮消息" }));
    expect(onEditAndResend).toHaveBeenCalledOnce();
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

  it("shows provider recovery actions instead of retrying a disabled Pi profile", () => {
    const onRetry = vi.fn();
    const onOpenProviderSettings = vi.fn();
    const onSelectTeam = vi.fn();
    render(
      <RunOutcome
        status="run-crashed"
        providerUnavailable="disabled"
        rawReason="pi-provider-disabled"
        onRetry={onRetry}
        onOverrideAndRetry={vi.fn()}
        onSelectTeam={onSelectTeam}
        maintenanceAction={{
          label: "前往设置重新启用",
          onClick: onOpenProviderSettings,
        }}
      />,
    );

    expect(screen.queryByText(/PiHost/u)).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "重试" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "换执行配置重跑" })).toBeVisible();

    fireEvent.click(screen.getByRole("button", { name: "前往设置重新启用" }));
    fireEvent.click(screen.getByRole("button", { name: "改选团队" }));
    expect(onOpenProviderSettings).toHaveBeenCalledOnce();
    expect(onSelectTeam).toHaveBeenCalledOnce();
    expect(onRetry).not.toHaveBeenCalled();
  });

  it("submits a single-run profile override", async () => {
    const onRetry = vi.fn();
    const onOverrideAndRetry = vi.fn();
    render(
      <RunOutcome
        status="quota-exhausted"
        initialProfile={{ cli: "kimi", model: "kimi-code/kimi-for-coding", effort: "on" }}
        onRetry={onRetry}
        onOverrideAndRetry={onOverrideAndRetry}
      />,
    );

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

  it("keeps the override panel usable across slow and failed registry states", () => {
    const onReload = vi.fn();
    const props = {
      status: "quota-exhausted" as const,
      onOverrideAndRetry: vi.fn(),
    };
    const { rerender } = render(
      <RunOutcome {...props} executionRegistryState={{ status: "loading" }} />,
    );

    fireEvent.click(screen.getByRole("button", { name: "换执行配置重跑" }));
    expect(screen.getByText("正在读取可用的执行配置…")).toBeVisible();

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
  });

  it("offers ready Pi provider profiles for a single-run override", async () => {
    const onOverrideAndRetry = vi.fn();
    render(
      <RunOutcome
        status="auth-failed"
        initialProfile={{
          cli: "pi",
          providerId: "deepseek",
          providerProfileId: "profile-old",
          model: "deepseek-v4-pro",
          effort: "high",
        }}
        providerProfiles={[
          {
            id: "profile-ready",
            providerId: "deepseek",
            displayName: "DeepSeek 工作档案",
            defaultModel: "deepseek-v4-flash",
            verifiedModels: ["deepseek-v4-flash"],
            readiness: "ready",
          },
          {
            id: "profile-disabled",
            providerId: "deepseek",
            displayName: "停用档案",
            defaultModel: "deepseek-v4-pro",
            verifiedModels: ["deepseek-v4-pro"],
            readiness: "disabled",
          },
        ]}
        onOverrideAndRetry={onOverrideAndRetry}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "换执行配置重跑" }));
    expect(screen.getByRole("combobox", { name: "AI 服务商" })).toHaveValue("profile-ready");
    expect(screen.queryByRole("option", { name: "停用档案" })).not.toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "Model" })).toHaveValue("deepseek-v4-flash");
    fireEvent.click(screen.getByRole("button", { name: "仅本次重跑" }));
    await waitFor(() => expect(onOverrideAndRetry).toHaveBeenCalledWith({
      cli: "pi",
      providerId: "deepseek",
      providerProfileId: "profile-ready",
      model: "deepseek-v4-flash",
      effort: "high",
    }));
  });

  it("makes permanent Pi migration and ending continuation explicit actions", async () => {
    const onMigrateAndContinue = vi.fn();
    const onEndContinuation = vi.fn();
    const providerProfiles = [{
      id: "profile-ready",
      providerId: "deepseek" as const,
      displayName: "DeepSeek 工作档案",
      defaultModel: "deepseek-v4-pro" as const,
      verifiedModels: ["deepseek-v4-pro" as const],
      readiness: "ready" as const,
    }];
    render(
      <RunOutcome
        status="resume-unavailable"
        initialProfile={{
          cli: "pi",
          providerId: "deepseek",
          providerProfileId: "profile-missing",
          model: "deepseek-v4-flash",
          effort: "high",
        }}
        providerProfiles={providerProfiles}
        onMigrateAndContinue={onMigrateAndContinue}
        onEndContinuation={onEndContinuation}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "迁移当前会话" }));
    fireEvent.click(screen.getByRole("button", { name: "迁移并继续" }));
    await waitFor(() => expect(onMigrateAndContinue).toHaveBeenCalledWith({
      cli: "pi",
      providerId: "deepseek",
      providerProfileId: "profile-ready",
      model: "deepseek-v4-pro",
      effort: "high",
    }));
    fireEvent.click(screen.getByRole("button", { name: "结束并保留历史" }));
    await waitFor(() => expect(onEndContinuation).toHaveBeenCalledOnce());
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
