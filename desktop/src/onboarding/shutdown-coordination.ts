import type { DesktopLocale } from "../language-preference-contract.js";
import { translateDesktop } from "../i18n/index.js";
import type { OnboardingCli } from "./cli-readiness-contract.js";

const ONBOARDING_CLIS = ["codex", "claude", "kimi"] as const;

export function installerQuitDialogOptions(
  runningClis: readonly OnboardingCli[],
  locale: DesktopLocale = "zh-CN",
): {
  type: "warning";
  buttons: [string, string];
  defaultId: 0;
  cancelId: 0;
  title: string;
  message: string;
  detail: string;
  noLink: true;
} {
  const running = ONBOARDING_CLIS.filter((cli) => runningClis.includes(cli));
  if (running.length === 0) {
    throw new Error("At least one running CLI is required.");
  }
  const labels = running.map(onboardingCliLabel);
  return {
    type: "warning",
    buttons: [
      translateDesktop(locale, "dialog.quit.stay"),
      translateDesktop(locale, "dialog.quit.cancelInstall"),
    ],
    defaultId: 0,
    cancelId: 0,
    title: translateDesktop(locale, "dialog.quit.title"),
    message: running.length === 1
      ? translateDesktop(locale, "dialog.quit.oneInstalling", {
          cli: labels[0]!,
        })
      : translateDesktop(locale, "dialog.quit.manyInstalling", {
          clis: formatCliList(labels, locale),
        }),
    detail: translateDesktop(locale, "dialog.quit.detail"),
    noLink: true,
  };
}

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

export function exitTaskDialogOptions(
  runningTaskCount: number,
  locale: DesktopLocale = "zh-CN",
): {
  type: "warning";
  buttons: [string, string];
  defaultId: 0;
  cancelId: 0;
  title: string;
  message: string;
  detail: string;
  noLink: true;
} {
  return {
    type: "warning",
    buttons: [
      translateDesktop(locale, "dialog.exit.stay"),
      translateDesktop(locale, "dialog.exit.confirm"),
    ],
    defaultId: 0,
    cancelId: 0,
    title: translateDesktop(locale, "dialog.exit.title"),
    message: translateDesktop(locale, "dialog.exit.message", { count: runningTaskCount }),
    detail: translateDesktop(locale, "dialog.exit.detail"),
    noLink: true,
  };
}

export function onboardingCliLabel(cli: OnboardingCli): string {
  return cli === "codex" ? "Codex" : cli === "claude" ? "Claude Code" : "Kimi";
}

function formatCliList(labels: readonly string[], locale: DesktopLocale): string {
  if (labels.length === 2) {
    return locale === "zh-CN"
      ? `${labels[0]} 与 ${labels[1]}`
      : `${labels[0]} and ${labels[1]}`;
  }
  return locale === "zh-CN"
    ? `${labels.slice(0, -1).join("、")} 与 ${labels.at(-1)}`
    : `${labels.slice(0, -1).join(", ")}, and ${labels.at(-1)}`;
}
