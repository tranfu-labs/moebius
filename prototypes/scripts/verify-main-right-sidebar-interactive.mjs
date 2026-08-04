import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { chromium } from "playwright";

const here = dirname(fileURLToPath(import.meta.url));
const packageRoot = resolve(here, "..");
const repositoryRoot = resolve(packageRoot, "..");
const prototypePath = resolve(
  repositoryRoot,
  "docs/product/pages/main-right-sidebar.prototype.html"
);
const artifactDir = await mkdtemp(
  resolve(tmpdir(), "moebius-main-right-sidebar-prototype-interactive-")
);
const evidencePath = resolve(artifactDir, "interactive-evidence.json");
const prototypeUrl = pathToFileURL(prototypePath).href;
const checks = [];
const requests = [];

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({
  viewport: { width: 1720, height: 900 },
  colorScheme: "dark",
  reducedMotion: "no-preference"
});
const page = await context.newPage();
page.on("request", (request) => requests.push(request.url()));

const SETTLE_MS = 400;

try {
  await page.goto(prototypeUrl);
  const sidebar = page.getByRole("complementary", { name: "主页面右侧栏" });
  const toggle = page.getByRole("button", { name: "显示右侧栏" });
  const separator = page.getByRole("separator", { name: "调整右侧栏宽度" });

  /* 默认关闭，界面为两栏。 */
  assert((await sidebar.count()) === 0, "sidebar must start closed");
  await toggle.waitFor();
  checks.push("default-closed-two-pane");

  /* 结果卡片一步打开改动标签；默认宽度 = 可用 1440 的 50%。 */
  await page.getByRole("button", { name: "查看" }).click();
  await sidebar.waitFor();
  await page.waitForTimeout(SETTLE_MS);
  await assertAsideWidth(720);
  await assertSeparator({ now: 720, min: 480, max: 960 });
  checks.push("open-from-result-card-default-half-width");

  /* 分隔线键盘调整：16/64 步进、Home/End、边界停留。 */
  await separator.focus();
  await separator.press("ArrowLeft");
  await assertSeparatorNow(736);
  await separator.press("Shift+ArrowRight");
  await assertSeparatorNow(672);
  await separator.press("Home");
  await assertSeparatorNow(480);
  await separator.press("End");
  await assertSeparatorNow(960);
  assert(
    (await separator.getAttribute("data-bound")) === "max",
    "reaching the max bound must surface boundary feedback"
  );
  checks.push("resizer-keyboard-steps-and-bounds");

  /* 宽度偏好跨重启保留。 */
  await page.getByRole("button", { name: "模拟重启" }).click();
  await separator.waitFor();
  await assertSeparatorNow(960);
  await page.getByTestId("right-tab-strip").waitFor();
  checks.push("width-preference-survives-restart");

  /* 分隔线鼠标拖拽：左拖扩大、右拖缩小、边界不越界。 */
  await separator.press("Home");
  await assertSeparatorNow(480);
  await dragSeparator(-200);
  await assertSeparatorNow(680);
  await dragSeparator(500);
  await assertSeparatorNow(480);
  await dragSeparator(-2000);
  await assertSeparatorNow(960);
  checks.push("resizer-pointer-drag-clamped-at-bounds");

  /* 窗口收窄只临时收敛呈现值，放宽后恢复原偏好。 */
  await setAvailableWidth("1200");
  await assertSeparator({ now: 720, min: 480, max: 720 });
  await setAvailableWidth("960");
  await assertSeparatorNow(480);
  await setAvailableWidth("1440");
  await assertSeparatorNow(960);
  checks.push("preference-clamped-not-overwritten-then-restored");

  /* 显示/隐藏保留标签现场。 */
  await page.getByRole("button", { name: "隐藏右侧栏" }).click();
  await page.waitForTimeout(SETTLE_MS);
  assert((await sidebar.count()) === 0, "hidden sidebar must leave the structure");
  await page.getByRole("button", { name: "显示右侧栏" }).click();
  await sidebar.waitFor();
  await page.waitForTimeout(SETTLE_MS);
  assert(
    (await page.locator('[data-right-tab-id="changes-card"]').count()) === 1,
    "hide then show must restore the retained tab strip"
  );
  checks.push("hide-preserves-tab-strip");

  /* 关闭后恢复主会话原滚动位置。 */
  await page.locator(".conversation-scroll").evaluate((element) => {
    element.scrollTop = 400;
  });
  await page.getByRole("button", { name: "隐藏右侧栏" }).click();
  await page.waitForTimeout(SETTLE_MS);
  const restoredScrollTop = await page
    .locator(".conversation-scroll")
    .evaluate((element) => element.scrollTop);
  assert(
    Math.abs(restoredScrollTop - 400) <= 2,
    `closing must restore the conversation scroll position, got ${restoredScrollTop}`
  );
  checks.push("close-restores-conversation-scroll");

  /* 动画中途反向：以最后意图为准，从当下进度反向。 */
  await page.getByRole("button", { name: "显示右侧栏" }).click();
  await page.waitForTimeout(SETTLE_MS);
  await page.getByRole("button", { name: "隐藏右侧栏" }).click();
  await page.waitForTimeout(60);
  await page.getByRole("button", { name: "显示右侧栏" }).click();
  assert(
    (await sidebar.count()) === 1,
    "mid-animation reversal must keep the sidebar in the structure"
  );
  await page.waitForTimeout(SETTLE_MS);
  await assertAsideWidth(960);
  await page.getByRole("button", { name: "隐藏右侧栏" }).click();
  await page.waitForTimeout(60);
  assert((await sidebar.count()) === 1, "closing snapshot must remain visible mid-animation");
  await page.waitForTimeout(SETTLE_MS);
  assert((await sidebar.count()) === 0, "final state must follow the last intent");
  checks.push("mid-animation-reversal-follows-last-intent");

  /* 关掉最后一个标签：不可交互视觉快照，动效结束后移除，重开进入内容选择。 */
  await page.getByRole("button", { name: "显示右侧栏" }).click();
  await sidebar.waitFor();
  await page.waitForTimeout(SETTLE_MS);
  await page.getByRole("button", { name: "完整输出" }).click();
  await page.getByRole("button", { name: "关闭“开发”" }).click();
  await page.waitForTimeout(50);
  assert(
    (await page.locator('[data-right-tab-id="changes-card"]').count()) === 1,
    "closing one tab must keep the remaining tab untouched"
  );
  await page.getByRole("button", { name: "关闭“改动”" }).click();
  assert(
    (await sidebar.count()) === 1
      && (await sidebar.getAttribute("data-inert")) === "true",
    "closing the last tab must keep a non-interactive snapshot during exit"
  );
  const pointerEvents = await sidebar.evaluate(
    (element) => getComputedStyle(element).pointerEvents
  );
  assert(pointerEvents === "none", "the exit snapshot must not receive pointer input");
  assert(
    await page
      .getByRole("button", { name: "显示右侧栏" })
      .evaluate((element) => element === document.activeElement),
    "closing the last tab must move focus to the show/hide button"
  );
  await page.waitForTimeout(SETTLE_MS);
  assert((await sidebar.count()) === 0, "the sidebar must unmount after the exit motion");
  await page.getByRole("button", { name: "显示右侧栏" }).click();
  await sidebar.waitFor();
  await page.waitForTimeout(SETTLE_MS);
  await page.getByText("这个标签要看什么").waitFor();
  assert(
    (await page.getByRole("tab").count()) === 0,
    "reopening with zero tabs must not fabricate a placeholder tab"
  );
  await page.getByRole("button", { name: /⇄ 改动/ }).click();
  await page.locator('[data-right-tab-id]').first().waitFor();
  checks.push("last-tab-close-snapshot-then-content-picker");

  /* 可用宽度 959：覆盖布局、无分隔线、独立关闭按钮。 */
  await setAvailableWidth("959");
  assert(
    (await sidebar.getAttribute("data-layout")) === "overlay",
    "959px available width must switch to the overlay layout"
  );
  assert(
    (await separator.count()) === 0,
    "the overlay layout must not render the width separator"
  );
  await assertAsideWidth(959);
  await page.getByRole("button", { name: "关闭右侧栏" }).click();
  await page.waitForTimeout(SETTLE_MS);
  assert((await sidebar.count()) === 0, "overlay close button must close the sidebar");
  await page.getByRole("button", { name: "显示右侧栏" }).click();
  await sidebar.waitFor();
  await page.waitForTimeout(SETTLE_MS);
  checks.push("overlay-layout-below-960-with-own-close");

  /* 跨过 960 边界只换布局，不播放开关动画。 */
  const overlayTransform = await sidebar.evaluate(
    (element) => getComputedStyle(element).transform
  );
  await setAvailableWidth("1200");
  assert(
    (await sidebar.getAttribute("data-layout")) === "side-by-side",
    "crossing back above 960 must return to the side-by-side layout"
  );
  const sideBySideBox = await sidebar.boundingBox();
  assert(
    sideBySideBox && Math.abs(sideBySideBox.width - 720) <= 1,
    "crossing the boundary must not replay the open motion; the 960px preference must clamp to the 1200px boundary (720px)"
  );
  assert(
    overlayTransform === "none"
      || overlayTransform === "matrix(1, 0, 0, 1, 0, 0)",
    "a settled overlay must sit flush against the right edge"
  );
  checks.push("layout-crossing-without-toggle-animation");

  /* 减少动态效果：开关立即完成。 */
  await page.getByRole("button", { name: "减少动态效果" }).click();
  await page.getByRole("button", { name: "隐藏右侧栏" }).click();
  assert(
    (await sidebar.count()) === 0,
    "reduced motion must complete the close immediately"
  );
  await page.getByRole("button", { name: "显示右侧栏" }).click();
  assert(
    (await sidebar.count()) === 1,
    "reduced motion must complete the open immediately"
  );
  checks.push("reduced-motion-instant-toggle");

  /* 亮色 + 窄窗口 + 减少动态效果截图留证。 */
  await page.getByRole("button", { name: "切换为亮色主题" }).click();
  await setAvailableWidth("959");
  assert(
    (await page.locator("html").getAttribute("data-theme")) === "light",
    "the light fixture must activate the light token pair"
  );
  await page.screenshot({
    path: resolve(artifactDir, "overlay-light-reduced.png"),
    fullPage: true
  });
  checks.push("overlay-light-reduced-screenshot");

  const externalRequests = requests.filter(
    (url) => !url.startsWith("file:") && !url.startsWith("data:")
  );
  assert(
    externalRequests.length === 0,
    `file prototype attempted external requests: ${externalRequests.join(", ")}`
  );
  checks.push("file-url-without-network-requests");

  await writeFile(
    evidencePath,
    `${JSON.stringify(
      {
        prototype: "docs/product/pages/main-right-sidebar.prototype.html",
        checkedAt: new Date().toISOString(),
        screenshots: ["overlay-light-reduced.png"],
        checks
      },
      null,
      2
    )}\n`,
    "utf8"
  );

  process.stdout.write(
    `Verified interactive main-right-sidebar prototype (${checks.length} checks). Evidence: ${evidencePath}\n`
  );
} finally {
  await browser.close();
}

async function setAvailableWidth(label) {
  await page.getByRole("button", { name: label, exact: true }).click();
  await page.waitForTimeout(50);
}

async function assertAsideWidth(expected) {
  const sidebar = page.getByRole("complementary", { name: "主页面右侧栏" });
  const box = await sidebar.boundingBox();
  assert(
    box && Math.abs(box.width - expected) <= 1,
    `expected sidebar width ${expected}px, got ${box ? box.width : "none"}`
  );
}

async function assertSeparatorNow(expected) {
  const separator = page.getByRole("separator", { name: "调整右侧栏宽度" });
  await page.waitForFunction(
    (value) =>
      document
        .querySelector('[role="separator"]')
        ?.getAttribute("aria-valuenow") === String(value),
    expected
  );
}

async function assertSeparator({ now, min, max }) {
  const separator = page.getByRole("separator", { name: "调整右侧栏宽度" });
  await assertSeparatorNow(now);
  assert(
    (await separator.getAttribute("aria-valuemin")) === String(min)
      && (await separator.getAttribute("aria-valuemax")) === String(max),
    `expected separator bounds ${min}..${max}`
  );
}

async function dragSeparator(deltaX) {
  const separator = page.getByRole("separator", { name: "调整右侧栏宽度" });
  const box = await separator.boundingBox();
  assert(box, "separator must be visible to drag");
  const startX = box.x + box.width / 2;
  const startY = box.y + box.height / 2;
  await page.mouse.move(startX, startY);
  await page.mouse.down();
  await page.mouse.move(startX + deltaX, startY, { steps: 6 });
  await page.mouse.up();
  await page.waitForTimeout(50);
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}
