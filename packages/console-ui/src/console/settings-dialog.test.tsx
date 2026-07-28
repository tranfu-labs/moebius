import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { I18nProvider } from "@/i18n";
import { SettingsDialog, type SettingsDialogProps } from "./settings-dialog";

function renderDialog(overrides: Partial<SettingsDialogProps> = {}) {
  const props: SettingsDialogProps = {
    open: true,
    activeLocale: "zh-CN",
    pendingLocale: null,
    saveStatus: "idle",
    onOpenChange: vi.fn(),
    onSelectLocale: vi.fn(),
    onRetry: vi.fn(),
    ...overrides,
  };
  render(
    <I18nProvider locale={props.activeLocale}>
      <SettingsDialog {...props} />
    </I18nProvider>,
  );
  return props;
}

describe("SettingsDialog", () => {
  it("shows only General and the two language options", () => {
    renderDialog();

    expect(screen.getByRole("dialog", { name: "设置" })).toBeVisible();
    expect(screen.getByText("常规")).toBeVisible();
    expect(screen.getByRole("radio", { name: "简体中文" })).toBeChecked();
    expect(screen.getByRole("radio", { name: "English" })).not.toBeChecked();
    expect(screen.queryByText(/关于|即将推出|Agent 与团队|已归档/u)).not.toBeInTheDocument();
  });

  it("renders the About candidate from controlled deterministic state", () => {
    const onCheckForUpdates = vi.fn();
    const onDownloadUpdate = vi.fn();
    const onCopyVersion = vi.fn();
    renderDialog({
      activeSection: "about",
      about: {
        currentVersion: "0.1.4",
        latestVersion: "0.1.5",
        updateStatus: "available",
      },
      onCheckForUpdates,
      onDownloadUpdate,
      onCopyVersion,
    });

    expect(screen.getByText("Moebius")).toBeVisible();
    expect(screen.getByText("0.1.4")).toBeVisible();
    expect(screen.getByText("Apple Silicon Mac")).toHaveClass("block", "w-full", "text-right");
    expect(screen.getByText("新版 0.1.5")).toBeVisible();
    expect(screen.getByText("查看发布记录")).toBeVisible();
    expect(screen.getAllByText("设置")).toHaveLength(1);

    fireEvent.click(screen.getByRole("button", { name: "再次检查" }));
    fireEvent.click(screen.getByRole("button", { name: "下载新版本" }));
    fireEvent.click(screen.getByRole("button", { name: "复制版本信息" }));
    expect(onCheckForUpdates).toHaveBeenCalledOnce();
    expect(onDownloadUpdate).toHaveBeenCalledOnce();
    expect(onCopyVersion).toHaveBeenCalledOnce();
  });

  it("delegates section changes without owning runtime integration", () => {
    const onSectionChange = vi.fn();
    renderDialog({
      about: { currentVersion: "0.1.4", updateStatus: "idle" },
      onSectionChange,
    });

    fireEvent.click(screen.getByRole("button", { name: "关于" }));
    expect(onSectionChange).toHaveBeenCalledWith("about");
    expect(screen.queryByText("当前版本")).not.toBeInTheDocument();
  });

  it("keeps update checking and failure states explicit and retryable", () => {
    const onCheckForUpdates = vi.fn();
    const { rerender } = render(
      <I18nProvider locale="zh-CN">
        <SettingsDialog
          open
          activeLocale="zh-CN"
          pendingLocale={null}
          saveStatus="idle"
          activeSection="about"
          about={{ currentVersion: "0.1.4", updateStatus: "checking" }}
          onOpenChange={vi.fn()}
          onSelectLocale={vi.fn()}
          onRetry={vi.fn()}
          onCheckForUpdates={onCheckForUpdates}
        />
      </I18nProvider>,
    );

    const checkingButton = screen.getByRole("button", { name: "正在检查…" });
    checkingButton.focus();
    expect(checkingButton).toHaveFocus();
    expect(checkingButton).toHaveAttribute("aria-disabled", "true");
    expect(checkingButton).toBeEnabled();
    fireEvent.click(checkingButton);
    expect(onCheckForUpdates).not.toHaveBeenCalled();
    expect(screen.getByText("正在检查…")).toBeVisible();

    rerender(
      <I18nProvider locale="zh-CN">
        <SettingsDialog
          open
          activeLocale="zh-CN"
          pendingLocale={null}
          saveStatus="idle"
          activeSection="about"
          about={{ currentVersion: "0.1.4", updateStatus: "failed" }}
          onOpenChange={vi.fn()}
          onSelectLocale={vi.fn()}
          onRetry={vi.fn()}
        />
      </I18nProvider>,
    );

    expect(screen.getByRole("alert")).toHaveTextContent("检查更新失败");
    expect(screen.getByRole("button", { name: "重试" })).toBeEnabled();
    expect(screen.getByText("0.1.4")).toBeVisible();
  });

  it("keeps language and update controls focused while controlled async state changes", () => {
    const baseProps = {
      open: true,
      activeLocale: "zh-CN" as const,
      onOpenChange: vi.fn(),
      onSelectLocale: vi.fn(),
      onRetry: vi.fn(),
    };
    const view = render(
      <I18nProvider locale="zh-CN">
        <SettingsDialog
          {...baseProps}
          pendingLocale={null}
          saveStatus="idle"
          about={{ currentVersion: "0.1.4", updateStatus: "idle" }}
        />
      </I18nProvider>,
    );
    const english = screen.getByRole("radio", { name: "English" });
    english.focus();

    view.rerender(
      <I18nProvider locale="zh-CN">
        <SettingsDialog
          {...baseProps}
          pendingLocale="en"
          saveStatus="saving"
          about={{ currentVersion: "0.1.4", updateStatus: "idle" }}
        />
      </I18nProvider>,
    );
    expect(english).toHaveFocus();
    expect(english).toHaveAttribute("aria-disabled", "true");
    expect(english).toBeEnabled();
    fireEvent.click(screen.getByRole("radio", { name: "简体中文" }));
    expect(baseProps.onSelectLocale).not.toHaveBeenCalled();

    view.rerender(
      <I18nProvider locale="zh-CN">
        <SettingsDialog
          {...baseProps}
          pendingLocale={null}
          saveStatus="idle"
          activeSection="about"
          about={{ currentVersion: "0.1.4", updateStatus: "idle" }}
        />
      </I18nProvider>,
    );
    const checkButton = screen.getByRole("button", { name: "检查更新" });
    checkButton.focus();
    view.rerender(
      <I18nProvider locale="zh-CN">
        <SettingsDialog
          {...baseProps}
          pendingLocale={null}
          saveStatus="idle"
          activeSection="about"
          about={{ currentVersion: "0.1.4", updateStatus: "checking" }}
        />
      </I18nProvider>,
    );
    expect(checkButton).toHaveFocus();
    expect(checkButton).toHaveAttribute("aria-disabled", "true");
    expect(checkButton).toBeEnabled();
  });

  it("keeps external-link failure feedback inside About", () => {
    renderDialog({
      activeSection: "about",
      about: { currentVersion: "0.1.4", updateStatus: "idle" },
      externalLinkStatus: "failed",
    });

    expect(screen.getByRole("alert")).toHaveTextContent("无法打开系统浏览器");
    expect(screen.getByRole("dialog", { name: "设置" })).toBeVisible();
  });

  it("delegates selection without changing the active language itself", () => {
    const props = renderDialog();
    fireEvent.click(screen.getByRole("radio", { name: "English" }));
    expect(props.onSelectLocale).toHaveBeenCalledWith("en");
    expect(screen.getByRole("dialog", { name: "设置" })).toBeVisible();
  });

  it("keeps the old language and exposes retry after failure", () => {
    const props = renderDialog({ pendingLocale: "en", saveStatus: "failed" });
    expect(screen.getByRole("alert")).toHaveTextContent("无法保存语言设置");
    fireEvent.click(screen.getByRole("button", { name: "重试" }));
    expect(props.onRetry).toHaveBeenCalledOnce();
  });

  it("closes with Escape but ignores outside pointer interaction", () => {
    const props = renderDialog();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(props.onOpenChange).toHaveBeenCalledWith(false);

    const overlay = document.querySelector("[data-radix-dialog-overlay]");
    if (overlay !== null) {
      fireEvent.pointerDown(overlay);
    }
    expect(props.onOpenChange).toHaveBeenCalledTimes(1);
  });
});
