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
    expect(screen.getAllByText("常规")).toHaveLength(2);
    expect(screen.getByRole("radio", { name: "简体中文" })).toBeChecked();
    expect(screen.getByRole("radio", { name: "English" })).not.toBeChecked();
    expect(screen.queryByText(/即将推出|Agent 与团队|已归档/u)).not.toBeInTheDocument();
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
