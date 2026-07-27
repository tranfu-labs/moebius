import type { DesktopLocale } from "../language-preference-contract.js";
import { translateDesktop } from "../i18n/index.js";

export function installerCleanupBlockedDialogOptions(locale: DesktopLocale = "zh-CN"): {
  type: "error";
  buttons: [string];
  defaultId: 0;
  cancelId: 0;
  title: string;
  message: string;
  detail: string;
  noLink: true;
} {
  return {
    type: "error",
    buttons: [translateDesktop(locale, "dialog.quit.stay")],
    defaultId: 0,
    cancelId: 0,
    title: translateDesktop(locale, "dialog.cleanup.title"),
    message: translateDesktop(locale, "dialog.cleanup.message"),
    detail: translateDesktop(locale, "dialog.cleanup.detail"),
    noLink: true,
  };
}
