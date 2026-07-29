import { describe, expect, it } from "vitest";

import {
  installerCleanupBlockedDialogOptions,
  installerQuitDialogOptions,
} from "../src/onboarding/shutdown-coordination.js";
import type { OnboardingCli } from "../src/onboarding/cli-readiness-contract.js";

describe("onboarding installer shutdown coordination", () => {
  it.each([
    [["codex"], "Codex CLI 仍在安装。", "Codex CLI is still being installed."],
    [["claude"], "Claude Code CLI 仍在安装。", "Claude Code CLI is still being installed."],
    [["kimi"], "Kimi CLI 仍在安装。", "Kimi CLI is still being installed."],
    [["codex", "claude"], "Codex 与 Claude Code CLI 仍在安装。", "Codex and Claude Code CLIs are still being installed."],
    [["codex", "kimi"], "Codex 与 Kimi CLI 仍在安装。", "Codex and Kimi CLIs are still being installed."],
    [["claude", "kimi"], "Claude Code 与 Kimi CLI 仍在安装。", "Claude Code and Kimi CLIs are still being installed."],
    [["codex", "claude", "kimi"], "Codex、Claude Code 与 Kimi CLI 仍在安装。", "Codex, Claude Code, and Kimi CLIs are still being installed."],
  ] satisfies Array<[OnboardingCli[], string, string]>)(
    "lists the exact running CLI combination %j",
    (running, expectedZh, expectedEn) => {
      expect(installerQuitDialogOptions(running, "zh-CN").message).toBe(expectedZh);
      expect(installerQuitDialogOptions([...running].reverse(), "en").message).toBe(expectedEn);
    },
  );

  it("blocks exit with a safe retry-later message when process reaping is unconfirmed", () => {
    const options = installerCleanupBlockedDialogOptions();
    expect(options).toMatchObject({
      type: "error",
      buttons: ["留在应用"],
      defaultId: 0,
      cancelId: 0,
    });
    expect(`${options.title}${options.message}${options.detail}`).toContain("阻止退出");
    expect(JSON.stringify(options)).not.toMatch(/pid|stderr|token|\/Users\//i);
  });
});
