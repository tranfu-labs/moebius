import { createHash } from "node:crypto";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { chromium } from "playwright";

const here = dirname(fileURLToPath(import.meta.url));
const packageRoot = resolve(here, "..");
const repositoryRoot = resolve(packageRoot, "..");
const prototypePath = resolve(
  repositoryRoot,
  "docs/product/pages/agent-conversation.prototype.html"
);
const artifactDir = await mkdtemp(
  resolve(tmpdir(), "moebius-agent-conversation-prototype-")
);
const evidencePath = resolve(artifactDir, "evidence.json");
const prototypeUrl = pathToFileURL(prototypePath).href;
const html = await readFile(prototypePath, "utf8");
const checks = [];
const externalRequests = new Set();

const externalAttributes = [
  ...html.matchAll(/\b(?:src|href)=["']([^"'#][^"']*)["']/gu)
]
  .map((match) => match[1])
  .filter((value) => !value.startsWith("data:") && !value.startsWith("mailto:"));

if (externalAttributes.length > 0) {
  throw new Error(
    `Published HTML has external resource attributes: ${externalAttributes.join(", ")}`
  );
}
checks.push("single-html-has-no-external-resource-attributes");

const browser = await chromium.launch({ headless: true });

function watchExternalRequests(page) {
  page.on("request", (request) => {
    const url = request.url();
    if (url.startsWith("http://") || url.startsWith("https://")) {
      externalRequests.add(url);
    }
  });
}

try {
  const desktopContext = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    colorScheme: "dark"
  });
  const desktopPage = await desktopContext.newPage();
  watchExternalRequests(desktopPage);
  await desktopPage.goto(prototypeUrl);
  await desktopPage.locator('[data-prototype="agent-conversation"]').waitFor();
  await desktopPage.getByRole("heading", { name: "Agent 工作状态" }).waitFor();
  checks.push("file-url-renders-wide-dark");

  const runRecords = desktopPage.locator('[data-testid^="run-record-"]');
  if ((await runRecords.count()) !== 2) {
    throw new Error("Default fixture must show two simultaneous Agent run records.");
  }
  await desktopPage.getByTestId("run-record-开发").getByText("已进行").waitFor();
  await desktopPage.getByTestId("run-record-软件测试").getByText("已进行").waitFor();
  checks.push("multiple-agent-runs-remain-independent");

  await desktopPage.getByTestId("output-unavailable-Kimi").waitFor();
  if (
    (await desktopPage
      .getByRole("button", { name: "软件测试的完整输出" })
      .count()) !== 0
  ) {
    throw new Error("Kimi must not expose a clickable full-output entry.");
  }
  checks.push("kimi-output-unavailable-is-inline-and-not-clickable");

  await desktopPage.getByTestId("process-attempt-1").waitFor();
  await desktopPage.getByTestId("process-attempt-2").waitFor();
  await desktopPage.getByText("第 1 次执行").waitFor();
  await desktopPage.getByText("第 2 次执行").waitFor();
  checks.push("process-tab-aggregates-independent-attempts");

  const latestActivity = desktopPage.getByTestId("run-record-开发").getByTestId("latest-activity");
  await latestActivity.getByText("正在搜索代码").waitFor();
  await desktopPage.getByRole("button", { name: "接收下一事件" }).click();
  await latestActivity.getByText("正在运行命令").waitFor();
  await desktopPage.getByRole("button", { name: "接收下一事件" }).click();
  await latestActivity.getByText("已完成命令").waitFor();
  await desktopPage.waitForTimeout(350);
  if ((await latestActivity.textContent())?.includes("正在搜索代码")) {
    throw new Error(
      "A completed newer concurrent tool flashed back to the older search event."
    );
  }
  checks.push("latest-activity-updates-in-place-without-concurrency-flashback");

  await desktopPage.getByRole("button", { name: "长任务格式" }).click();
  await desktopPage.getByTestId("run-record-开发").getByText("1:02:18").waitFor();
  checks.push("duration-switches-to-hour-format");

  await desktopPage.getByRole("button", { name: "已完成" }).click();
  const completedRun = desktopPage.getByTestId("run-record-开发");
  const terminalTime = completedRun.locator(".duration-label");
  await completedRun.getByText("耗时", { exact: true }).waitFor();
  await terminalTime.focus();
  await completedRun.getByText("完成于 14:32").waitFor();
  const terminalAria = await terminalTime.getAttribute("aria-label");
  if (!terminalAria?.includes("耗时") || !terminalAria.includes("完成于 14:32")) {
    throw new Error("Terminal duration lacks equivalent accessible completion time.");
  }
  checks.push("terminal-duration-reveals-completed-at-on-focus");

  await desktopPage.getByRole("button", { name: "已停下" }).click();
  await completedRun.getByText("已停下", { exact: true }).waitFor();
  await completedRun.getByRole("button", { name: "重试" }).waitFor();
  await completedRun.getByRole("button", { name: "改一改重发" }).click();
  const composer = desktopPage.getByRole("textbox", { name: "继续告诉主理人" });
  if (!(await composer.inputValue()).includes("重新核对")) {
    throw new Error("Edit-and-resend must restore the original input for editing.");
  }
  await desktopPage.getByRole("button", { name: "取消修改" }).click();
  await completedRun.getByRole("button", { name: "重试" }).click();
  await desktopPage.getByTestId("process-attempt-3").waitFor();
  await completedRun.getByText("已进行").waitFor();
  checks.push("stopped-run-supports-retry-and-edit-resend");

  await desktopPage.getByRole("button", { name: "可恢复" }).click();
  const pausedRun = desktopPage.getByTestId("run-record-开发");
  await pausedRun.getByText("已暂停，可恢复").waitFor();
  const pausedSecondsBefore = Number(
    await pausedRun.locator(".duration-label").getAttribute("data-seconds")
  );
  await desktopPage.waitForTimeout(1100);
  const pausedSecondsAfter = Number(
    await pausedRun.locator(".duration-label").getAttribute("data-seconds")
  );
  if (pausedSecondsBefore !== pausedSecondsAfter) {
    throw new Error("Paused duration continued to accumulate.");
  }
  await pausedRun.getByRole("button", { name: "继续" }).click();
  await desktopPage.waitForTimeout(1100);
  const resumedSeconds = Number(
    await pausedRun.locator(".duration-label").getAttribute("data-seconds")
  );
  if (resumedSeconds <= pausedSecondsAfter) {
    throw new Error("Continuing a paused run did not resume the same duration.");
  }
  checks.push("pause-freezes-and-continue-resumes-same-run");

  await desktopPage.getByRole("button", { name: "无法继续" }).click();
  await pausedRun.getByText("原执行会话已丢失，没有自动重新运行。").waitFor();
  if ((await desktopPage.locator('[data-testid^="process-attempt-"]').count()) !== 2) {
    throw new Error("Recovery failure must not create an automatic new attempt.");
  }
  await pausedRun.getByRole("button", { name: "重新运行" }).click();
  await desktopPage.getByTestId("process-attempt-3").waitFor();
  checks.push("recovery-failure-requires-explicit-rerun");

  await desktopPage.getByLabel("切换为亮色主题").click();
  if (!(await desktopPage.locator("html").evaluate((element) => element.classList.contains("light")))) {
    throw new Error("Light theme toggle did not update the document theme.");
  }
  checks.push("light-theme");

  await desktopPage.screenshot({
    path: resolve(artifactDir, "agent-conversation-wide-light.png"),
    fullPage: true
  });
  await desktopContext.close();

  const narrowContext = await browser.newContext({
    viewport: { width: 640, height: 820 },
    colorScheme: "dark",
    reducedMotion: "reduce"
  });
  const narrowPage = await narrowContext.newPage();
  watchExternalRequests(narrowPage);
  await narrowPage.goto(prototypeUrl);
  await narrowPage.getByRole("heading", { name: "开发 · 这一步的完整输出" }).waitFor();

  const narrowGeometry = await narrowPage.evaluate(() => ({
    overflow: document.documentElement.scrollWidth - window.innerWidth,
    processWidth:
      document.querySelector(".process-panel")?.getBoundingClientRect().width ?? 0,
    transitionDuration: getComputedStyle(
      document.querySelector(".toolbar-button") ?? document.body
    ).transitionDuration
  }));
  if (narrowGeometry.overflow > 1) {
    throw new Error(`Narrow fixture has ${narrowGeometry.overflow}px horizontal overflow.`);
  }
  if (Math.abs(narrowGeometry.processWidth - 640) > 1) {
    throw new Error(
      `Narrow process overlay should fill the viewport, found ${narrowGeometry.processWidth}px.`
    );
  }
  if (
    narrowGeometry.transitionDuration !== "1e-06s"
    && narrowGeometry.transitionDuration !== "0.000001s"
    && narrowGeometry.transitionDuration !== "0s"
  ) {
    throw new Error(
      `Reduced-motion fixture retained a visible transition: ${narrowGeometry.transitionDuration}.`
    );
  }
  checks.push("narrow-overlay-has-no-horizontal-overflow");
  checks.push("prefers-reduced-motion-removes-visible-transitions");

  await narrowPage
    .locator(".process-panel")
    .getByRole("button", { name: "关闭完整输出" })
    .click();
  await narrowPage.getByRole("heading", { name: "Agent 工作状态" }).waitFor();
  await narrowPage.getByRole("button", { name: "打开完整输出" }).click();
  await narrowPage.getByRole("heading", { name: "开发 · 这一步的完整输出" }).waitFor();
  checks.push("narrow-process-overlay-closes-and-reopens-by-keyboard-ready-controls");

  await narrowPage.screenshot({
    path: resolve(artifactDir, "agent-conversation-narrow-dark.png"),
    fullPage: true
  });
  await narrowContext.close();

  if (externalRequests.size > 0) {
    throw new Error(
      `Prototype made external requests: ${[...externalRequests].join(", ")}`
    );
  }
  checks.push("no-http-or-https-requests");

  await writeFile(
    evidencePath,
    `${JSON.stringify(
      {
        prototype: "docs/product/pages/agent-conversation.prototype.html",
        sha256: createHash("sha256").update(html).digest("hex"),
        checkedAt: new Date().toISOString(),
        checks,
        screenshots: [
          "agent-conversation-wide-light.png",
          "agent-conversation-narrow-dark.png"
        ]
      },
      null,
      2
    )}\n`,
    "utf8"
  );
  process.stdout.write(
    `Verified agent conversation prototype (${checks.length} checks). Evidence: ${evidencePath}\n`
  );
} finally {
  await browser.close();
}
