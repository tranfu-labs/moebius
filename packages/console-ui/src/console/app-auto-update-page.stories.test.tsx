import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { act } from "react";

import {
  AppAutoUpdateStoryCanvas,
  type UpdateStoryArgs,
} from "./app-auto-update-page.stories";

afterEach(() => {
  cleanup();
});

describe("AppAutoUpdate Page Stories", () => {
  it("keeps the reminder task count aligned with its task-protection confirmation", async () => {
    const root = renderStory({
      scenario: "ready-reminder",
      activeLocale: "zh-CN",
      currentVersion: "0.4.3",
      latestVersion: "0.5.0",
      taskCount: 3,
    });

    expect(root).toHaveTextContent("3 running");
    await clickStoryButton(root, "重启并安装");
    expect(root).toHaveTextContent("安装需要先停止 3 个运行中任务");
    await clickStoryButton(root, "继续工作");
    expect(root).toHaveTextContent("Fixture decision: continue-working");
  });

  it("keeps the About and reminder paths on the same running-task protection result", async () => {
    const root = renderStory({
      scenario: "skipped-settings-install",
      activeLocale: "zh-CN",
      currentVersion: "0.4.3",
      latestVersion: "0.5.0",
      taskCount: 3,
    });

    expect(root).toHaveTextContent("新版 0.5.0 已准备好 · 你选择了跳过这个版本");
    await clickStoryButton(root, "重启并安装");
    expect(root).toHaveTextContent("安装需要先停止 3 个运行中任务");
    await clickStoryButton(root, "停止任务并重启安装");
    expect(root).toHaveTextContent("Fixture decision: install");
  });

  it("keeps the zero-task confirmation explicit instead of mixing it into the running-task story", async () => {
    const root = renderStory({
      scenario: "ready-reminder",
      activeLocale: "zh-CN",
      currentVersion: "0.4.3",
      latestVersion: "0.5.0",
      taskCount: 0,
    });

    expect(root).toHaveTextContent("0 running");
    await clickStoryButton(root, "重启并安装");
    expect(root).toHaveTextContent("重启并安装 0.5.0");
    await clickStoryButton(root, "重启并安装");
    expect(root).toHaveTextContent("Fixture decision: install");
  });

  it("shows task-stop failure feedback and routes retry back through confirmation", async () => {
    const root = renderStory({
      scenario: "install-failure",
      failureKind: "task-stop",
      activeLocale: "zh-CN",
      currentVersion: "0.4.3",
      latestVersion: "0.5.0",
      taskCount: 3,
    });

    expect(root).toHaveTextContent("任务未能停止，更新尚未安装");
    await clickStoryButton(root, "重试");
    expect(root).toHaveTextContent("安装需要先停止 3 个运行中任务");
  });

  it("keeps the stopped-task install failure distinct from a network check failure", () => {
    const root = renderStory({
      scenario: "install-failure",
      failureKind: "install-with-tasks",
      activeLocale: "en",
      currentVersion: "0.4.3",
      latestVersion: "0.5.0",
      taskCount: 0,
    });

    expect(root).toHaveTextContent("Update installation failed");
    expect(root).not.toHaveTextContent("The update check failed");
    expect(root).toHaveTextContent("Retry installation");
  });
});

function renderStory(args: UpdateStoryArgs): HTMLElement {
  const view = render(<AppAutoUpdateStoryCanvas {...args} />);
  return view.container.ownerDocument.body;
}

async function clickStoryButton(root: HTMLElement, label: string): Promise<void> {
  const matches = Array.from(root.querySelectorAll<HTMLButtonElement>("button"))
    .filter((button) => button.textContent?.trim() === label);
  if (matches.length !== 1) {
    throw new Error(`Expected exactly one Story button named ${label}, found ${matches.length}`);
  }
  await act(async () => {
    matches[0]!.click();
  });
}
