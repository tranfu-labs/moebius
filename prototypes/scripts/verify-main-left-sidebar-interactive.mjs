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
  "docs/product/pages/main-left-sidebar.prototype.html"
);
const artifactDir = await mkdtemp(
  resolve(tmpdir(), "moebius-main-left-sidebar-prototype-interactive-")
);
const evidencePath = resolve(artifactDir, "interactive-evidence.json");
const prototypeUrl = pathToFileURL(prototypePath).href;
const checks = [];
const requests = [];

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({
  viewport: { width: 1440, height: 920 },
  colorScheme: "dark",
  reducedMotion: "no-preference"
});
const page = await context.newPage();
page.on("request", (request) => requests.push(request.url()));

try {
  await page.goto(prototypeUrl);
  await page.getByRole("complementary", { name: "主页面左侧栏" }).waitFor();

  const overlay = page.getByTestId("shared-overlay");
  assert(
    (await overlay.count()) === 1,
    "the whole sidebar must render exactly one shared information overlay"
  );

  await page.locator('[data-conversation-id="c-sync"]').hover();
  await expectText(overlay.locator('[data-overlay-line="title"]'), "重构状态同步层");
  const firstTransform = await overlay.evaluate(
    (element) => getComputedStyle(element).transform
  );

  await page.locator('[data-conversation-id="c-dmg"]').hover();
  await expectText(
    overlay.locator('[data-overlay-line="branch"]'),
    "feature/dmg-signing"
  );
  const secondTransform = await overlay.evaluate(
    (element) => getComputedStyle(element).transform
  );
  assert(
    firstTransform !== secondTransform,
    "the shared overlay must move between rows instead of recreating at one fixed position"
  );

  await page.locator('[data-conversation-id="c-quarterly"]').hover();
  assert(
    (await overlay.locator('[data-overlay-line="branch"]').count()) === 0,
    "a non-Git project must omit the third overlay line"
  );
  checks.push("single-shared-overlay-follows-git-and-non-git-rows");

  await openContextMenu(page, "c-sync");
  assert(
    !(await overlay.getAttribute("class"))?.includes("is-visible"),
    "opening a conversation menu must immediately hide the overlay"
  );
  await assertMenu(page, { read: true, unread: false });
  await page.getByRole("menu").press("Escape");

  await openContextMenu(page, "c-detached");
  await assertMenu(page, { read: false, unread: false });
  await page.getByRole("menu").press("Escape");

  await openContextMenu(page, "c-quarterly");
  await assertMenu(page, { read: false, unread: true });
  await page.getByRole("menuitem", { name: "标记为未读" }).click();
  await page.waitForFunction(
    () =>
      document
        .querySelector('[data-conversation-id="c-quarterly"] [data-dot]')
        ?.getAttribute("data-dot") === "unread"
  );
  checks.push("read-menu-matrix-and-persisted-unread-transition");

  await openContextMenu(page, "c-dmg");
  await page.getByRole("menuitem", { name: "置顶", exact: true }).click();
  await page.waitForFunction(
    () =>
      document.querySelectorAll('[data-conversation-id="c-dmg"]').length === 1
      && document
        .querySelector('[aria-label="置顶"]')
        ?.contains(document.querySelector('[data-conversation-id="c-dmg"]'))
  );
  assert(
    (await page.locator('[data-conversation-id="c-dmg"]').count()) === 1,
    "pinning must move the conversation without duplicating it"
  );
  checks.push("pin-migrates-without-duplication");

  await page.locator('[data-conversation-id="c-quarterly"]').click();
  await openContextMenu(page, "c-quarterly");
  await page.getByRole("menuitem", { name: "重命名" }).click();
  const renameDialog = page.getByRole("dialog", { name: "重命名对话" });
  const renameInput = renameDialog.getByLabel("对话名称");
  await renameInput.fill("  发布日上线清单  ");
  await renameDialog.getByRole("button", { name: "保存", exact: true }).click();
  await page.waitForFunction(
    () =>
      document.querySelector('[data-testid="main-title"]')?.textContent
        === "发布日上线清单"
  );
  assert(
    (await page.locator('[data-conversation-id="c-quarterly"] .conv-title').textContent())
      === "发布日上线清单",
    "successful rename must update the sidebar row"
  );
  assert(
    (await page
      .locator('[data-right-tab-id="c-quarterly"] [role="tab"]')
      .getAttribute("aria-label"))
      === "发布日上线清单",
    "successful rename must update the linked right-sidebar tab and remove obsolete duplicate context"
  );
  checks.push("rename-updates-row-main-title-and-linked-tab");

  await page.getByTestId("toggle-tab-title-failures").click();
  const failedTabs = page.locator(
    '[data-right-tab-id="c-quarterly"], [data-right-tab-id="c-copy"]'
  );
  assert(
    (await failedTabs.locator(".right-tab-title").allTextContents()).every(
      (title) => title === "标题更新中"
    ),
    "failed retained tab groups must not display stale titles"
  );
  const failedLabels = await failedTabs
    .locator('[role="tab"]')
    .evaluateAll((elements) =>
      elements.map((element) => element.getAttribute("aria-label"))
    );
  assert(
    failedLabels.length === 2
      && failedLabels.every((label) => label?.startsWith("标题更新中，"))
      && failedLabels[0] !== failedLabels[1],
    "two unavailable titles must retain distinct stable accessible context"
  );
  await page.getByRole("button", { name: "重试标题读取" }).click();
  assert(
    (await page
      .locator('[data-right-tab-id="c-quarterly"] .right-tab-title')
      .textContent()) === "发布日上线清单",
    "retry must restore the saved title in the same tab"
  );
  checks.push("same-title-discriminator-and-title-read-recovery");

  const strip = page.getByTestId("right-tab-strip");
  const selectedTarget = page.locator(
    '[data-right-tab-id="c-unreadable"] [role="tab"]'
  );
  await selectedTarget.click();
  await page.evaluate(() => {
    document
      .querySelector('[data-testid="expand-selected-tab-title"]')
      ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
  await page.waitForFunction(
    () =>
      document
        .querySelector('[data-right-tab-id="c-unreadable"] .right-tab-title')
        ?.textContent?.includes("发布日上线前")
  );
  await assertContained(strip, page.locator('[data-right-tab-id="c-unreadable"]'));

  const focusedClose = page.locator(
    '[data-right-tab-id="c-dmg"] .right-tab-close'
  );
  await focusedClose.focus();
  await page.evaluate(() => {
    document
      .querySelector('[data-testid="expand-selected-tab-title"]')
      ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
  await page.waitForTimeout(220);
  assert(
    await focusedClose.evaluate(
      (element) => element === document.activeElement
    ),
    "a width-changing update must preserve keyboard focus inside the tab strip"
  );
  await assertContained(strip, page.locator('[data-right-tab-id="c-dmg"]'));

  const scrollBeforeBackgroundUpdate = await strip.evaluate(
    (element) => element.scrollLeft
  );
  await page.evaluate(() => {
    document
      .querySelector('[data-testid="expand-background-tab-title"]')
      ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
  await page.waitForTimeout(50);
  const scrollAfterBackgroundUpdate = await strip.evaluate(
    (element) => element.scrollLeft
  );
  assert(
    Math.abs(scrollAfterBackgroundUpdate - scrollBeforeBackgroundUpdate) <= 1,
    "an unfocused background title update must not steal horizontal position"
  );
  checks.push("overflow-keeps-selected-or-focused-tab-visible-without-background-jump");

  await page.getByRole("button", { name: "窄 900" }).click();
  await page.getByRole("button", { name: "切换为亮色主题" }).click();
  await page.getByRole("button", { name: "减少动态效果" }).click();
  const frameBox = await page.locator(".app-frame").boundingBox();
  assert(
    frameBox && frameBox.width <= 900 && frameBox.x >= 0,
    "narrow review frame must remain inside the viewport"
  );
  assert(
    (await page.locator("html").getAttribute("data-theme")) === "light",
    "the light review fixture must activate the light token pair"
  );
  const overlayTransition = await overlay.evaluate(
    (element) => getComputedStyle(element).transitionDuration
  );
  const runningAnimation = await page
    .locator('[data-dot="running"]')
    .first()
    .evaluate((element) => getComputedStyle(element).animationName);
  assert(
    overlayTransition.split(",").every((duration) =>
      ["0.001ms", "1e-06s", "0s"].includes(duration.trim())
    )
      && runningAnimation === "none",
    "reduced motion must make overlay movement immediate and stop the running pulse"
  );
  await page.screenshot({
    path: resolve(artifactDir, "narrow-light-reduced.png"),
    fullPage: true
  });
  checks.push("narrow-light-and-reduced-motion");

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
        prototype: "docs/product/pages/main-left-sidebar.prototype.html",
        checkedAt: new Date().toISOString(),
        screenshots: ["narrow-light-reduced.png"],
        checks
      },
      null,
      2
    )}\n`,
    "utf8"
  );

  process.stdout.write(
    `Verified interactive main-left-sidebar prototype (${checks.length} checks). Evidence: ${evidencePath}\n`
  );
} finally {
  await browser.close();
}

async function openContextMenu(page, conversationId) {
  await page.locator(`[data-conversation-id="${conversationId}"]`).click({
    button: "right"
  });
  await page.getByRole("menu").waitFor();
}

async function assertMenu(page, expected) {
  assert(
    (await page.getByRole("menuitem", { name: "标记为已读" }).count())
      === (expected.read ? 1 : 0),
    `mark-read menu presence did not match ${expected.read}`
  );
  assert(
    (await page.getByRole("menuitem", { name: "标记为未读" }).count())
      === (expected.unread ? 1 : 0),
    `mark-unread menu presence did not match ${expected.unread}`
  );
}

async function expectText(locator, expected) {
  await locator.waitFor();
  assert(
    (await locator.textContent())?.includes(expected),
    `expected text ${JSON.stringify(expected)}`
  );
}

async function assertContained(container, item) {
  const containerBox = await container.boundingBox();
  const itemBox = await item.boundingBox();
  assert(
    containerBox
      && itemBox
      && itemBox.x >= containerBox.x - 1
      && itemBox.x + itemBox.width <= containerBox.x + containerBox.width + 1,
    "the relevant tab must remain fully visible inside the horizontal strip"
  );
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}
