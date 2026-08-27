import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { I18nProvider } from "@/i18n";
import {
  UpdatePromptDialog,
  type UpdateInstallDecision,
  type UpdateInstallFailure,
  type UpdateInstallFailureDecision,
  type UpdateReadyDecision,
} from "./update-prompt-dialog";

function renderReady(onDecision: (decision: UpdateReadyDecision) => void = vi.fn()) {
  const onOpenReleaseNotes = vi.fn();
  render(
    <I18nProvider locale="zh-CN">
      <UpdatePromptDialog
        mode="ready"
        open
        currentVersion="0.4.3"
        latestVersion="0.5.0"
        onDecision={onDecision}
        onOpenReleaseNotes={onOpenReleaseNotes}
      />
    </I18nProvider>,
  );
  return { onOpenReleaseNotes };
}

function renderInstallConfirmation(
  runningTaskCount: number,
  onDecision: (decision: UpdateInstallDecision) => void = vi.fn(),
  locale: "zh-CN" | "en" = "zh-CN",
) {
  render(
    <I18nProvider locale={locale}>
      <UpdatePromptDialog
        mode="install-confirmation"
        open
        version="0.5.0"
        runningTaskCount={runningTaskCount}
        onDecision={onDecision}
      />
    </I18nProvider>,
  );
}

function renderInstallFailure(
  failure: UpdateInstallFailure,
  onDecision: (decision: UpdateInstallFailureDecision) => void = vi.fn(),
  locale: "zh-CN" | "en" = "zh-CN",
) {
  render(
    <I18nProvider locale={locale}>
      <UpdatePromptDialog
        mode="install-failure"
        open
        failure={failure}
        onDecision={onDecision}
      />
    </I18nProvider>,
  );
}

describe("UpdatePromptDialog", () => {
  it("shows the ready update choices and keeps release notes separate", () => {
    const onDecision = vi.fn<(decision: UpdateReadyDecision) => void>();
    const { onOpenReleaseNotes } = renderReady(onDecision);

    expect(screen.getByRole("dialog", { name: "Moebius 0.5.0 已准备好安装" })).toBeVisible();
    expect(screen.getByText("0.4.3")).toBeVisible();
    expect(screen.getByText("0.5.0")).toBeVisible();

    fireEvent.click(screen.getByRole("button", { name: "查看更新内容" }));
    expect(onOpenReleaseNotes).toHaveBeenCalledOnce();
    expect(onDecision).not.toHaveBeenCalled();
    expect(screen.getByRole("dialog", { name: "Moebius 0.5.0 已准备好安装" })).toBeVisible();

    fireEvent.click(screen.getByRole("button", { name: "跳过此版本" }));
    expect(onDecision.mock.calls).toEqual([["skip-version"]]);
  });

  it("keeps the dialog content above its backdrop so explicit actions remain clickable", () => {
    renderReady();

    expect(screen.getByTestId("update-prompt-dialog")).toHaveClass("z-layer-system");
    expect(document.querySelector('[class~="z-layer-system-backdrop"]')).not.toBeNull();
  });

  it("maps Escape dismissal to remind me later", () => {
    const onDecision = vi.fn<(decision: UpdateReadyDecision) => void>();
    renderReady(onDecision);

    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    expect(onDecision).toHaveBeenCalledWith("remind-later");
  });

  it("maps backdrop dismissal to remind me later", async () => {
    const onDecision = vi.fn<(decision: UpdateReadyDecision) => void>();
    renderReady(onDecision);

    const overlay = screen.getByTestId("dialog-overlay");
    expect(overlay).toBeVisible();
    await userEvent.setup().click(overlay);
    expect(onDecision).toHaveBeenCalledWith("remind-later");
  });

  it("uses a distinct destructive confirmation when tasks are running", () => {
    const onDecision = vi.fn<(decision: UpdateInstallDecision) => void>();
    renderInstallConfirmation(3, onDecision);

    expect(screen.getByRole("dialog", { name: "安装需要先停止 3 个运行中任务" })).toBeVisible();
    expect(screen.getByText("继续工作")).toBeVisible();
    expect(screen.getByRole("button", { name: "停止任务并重启安装" })).toHaveClass("text-danger");

    fireEvent.click(screen.getByRole("button", { name: "继续工作" }));
    expect(onDecision.mock.calls).toEqual([["continue-working"]]);
  });

  it("uses singular task wording for one running task", () => {
    renderInstallConfirmation(1, vi.fn(), "en");

    expect(screen.getByRole("dialog", { name: "Installation needs to stop 1 running task" })).toBeVisible();
    expect(screen.queryByText(/1 running tasks/u)).toBeNull();
  });

  it("keeps stop-and-install as the install decision", () => {
    const onDecision = vi.fn<(decision: UpdateInstallDecision) => void>();
    renderInstallConfirmation(3, onDecision);

    fireEvent.click(screen.getByRole("button", { name: "停止任务并重启安装" }));
    expect(onDecision.mock.calls).toEqual([["install"]]);
  });

  it("maps task-free confirmation dismissal to cancel", () => {
    const onDecision = vi.fn<(decision: UpdateInstallDecision) => void>();
    renderInstallConfirmation(0, onDecision);

    expect(screen.getByRole("dialog", { name: "重启并安装 0.5.0" })).toBeVisible();
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    expect(onDecision).toHaveBeenCalledWith("cancel");
  });

  it("explains a task-stop failure and keeps retry separate from continuing", () => {
    const onDecision = vi.fn<(decision: UpdateInstallFailureDecision) => void>();
    renderInstallFailure({
      kind: "task-stop",
      version: "0.5.0",
      runningTaskCount: 2,
      hadRunningTasks: true,
      tasksStopped: false,
      installStarted: false,
    }, onDecision);

    expect(screen.getByRole("dialog", { name: "任务未能停止，更新尚未安装" })).toBeVisible();
    expect(screen.getByText(/仍有 2 个任务在运行/u)).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "继续工作" }));
    expect(onDecision).toHaveBeenLastCalledWith("dismiss");
    fireEvent.click(screen.getByRole("button", { name: "重试" }));
    expect(onDecision).toHaveBeenLastCalledWith("retry");
  });

  it("uses singular task wording in an English task-stop failure", () => {
    renderInstallFailure({
      kind: "task-stop",
      version: "0.5.0",
      runningTaskCount: 1,
      hadRunningTasks: true,
      tasksStopped: false,
      installStarted: false,
    }, vi.fn(), "en");

    expect(screen.getByText("1 task is still running. Installation has not started, and your task and session records are unchanged.")).toBeVisible();
  });

  it("describes a zero-task install failure and never retries on dismissal", async () => {
    const onDecision = vi.fn<(decision: UpdateInstallFailureDecision) => void>();
    renderInstallFailure({
      kind: "install",
      version: "0.5.0",
      runningTaskCount: 0,
      hadRunningTasks: false,
      tasksStopped: true,
      installStarted: true,
    }, onDecision);

    expect(screen.getByRole("dialog", { name: "更新安装失败" })).toBeVisible();
    expect(screen.getByText("安装未能完成。应用已经恢复，可以继续工作。")).toBeVisible();
    const overlay = screen.getByTestId("dialog-overlay");
    await userEvent.setup().click(overlay);
    expect(onDecision).toHaveBeenLastCalledWith("dismiss");
    expect(onDecision).not.toHaveBeenCalledWith("retry");
  });
});
