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
  "docs/product/pages/settings.prototype.html"
);
const artifactDir = await mkdtemp(
  resolve(tmpdir(), "moebius-settings-prototype-interactive-")
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
  const dialog = page.getByRole("dialog");
  await dialog.waitFor();

  assert(
    (await page.locator('[aria-current="page"]').count()) === 1
      && (await page.getByRole("button", { name: "常规" }).count()) === 1,
    "the first release must expose only the General category"
  );
  assert(
    (await dialog.getByText("Agent 与团队").count()) === 0
      && (await dialog.getByText("即将推出").count()) === 0,
    "future categories must not appear as disabled placeholders"
  );
  checks.push("general-only-category");

  const backdrop = page.getByTestId("settings-backdrop");
  await backdrop.click({ position: { x: 4, y: 4 } });
  assert(await dialog.isVisible(), "backdrop click must not close settings");
  checks.push("backdrop-does-not-close");

  await page.screenshot({
    path: resolve(artifactDir, "wide-dark-zh.png"),
    fullPage: true
  });

  const userMessageBefore = await page
    .locator(".user-message p")
    .textContent();
  const agentMessageBefore = await page
    .locator(".agent-message p")
    .first()
    .textContent();
  const projectNameBefore = await page
    .locator(".project-row strong")
    .textContent();
  const draftBefore = await page.locator(".composer textarea").inputValue();

  await page.getByRole("radio", { name: /English/ }).click();
  assert(
    (await page.locator("html").getAttribute("lang")) === "zh-CN",
    "language must remain unchanged while persistence is in progress"
  );
  assert(
    (await page.getByText("正在保存…").count()) === 1,
    "saving state must identify the pending target"
  );
  await page.waitForFunction(
    () => document.documentElement.lang === "en",
    undefined,
    { timeout: 3000 }
  );
  assert(
    (await page.getByRole("heading", { name: "Settings", exact: true }).count())
      === 1
      && (await page.getByText("New conversation", { exact: true }).count()) === 1,
    "settings and workspace static UI must switch atomically"
  );
  assert(
    (await page.locator(".user-message p").textContent()) === userMessageBefore
      && (await page.locator(".agent-message p").first().textContent())
        === agentMessageBefore
      && (await page.locator(".project-row strong").textContent())
        === projectNameBefore
      && (await page.locator(".composer textarea").inputValue()) === draftBefore,
    "user content, agent content, project name, and draft must remain unchanged"
  );
  checks.push("save-before-atomic-global-switch-and-content-preservation");

  await page.reload();
  await dialog.waitFor();
  assert(
    (await page.locator("html").getAttribute("lang")) === "en"
      && (await page.getByRole("radio", { name: /English/ }).getAttribute(
        "aria-checked"
      )) === "true",
    "saved language must survive reload"
  );
  checks.push("persisted-selection-survives-reload");

  await page.evaluate(() => window.__settingsPrototype.failNextSave());
  await page.getByRole("radio", { name: /简体中文/ }).click();
  assert(
    (await page.locator("html").getAttribute("lang")) === "en",
    "failed target must not apply before persistence"
  );
  await page.getByRole("alert").waitFor();
  assert(
    (await page.locator("html").getAttribute("lang")) === "en"
      && (await page.getByRole("heading", { name: "Settings", exact: true }).count())
        === 1,
    "save failure must retain the prior interface language"
  );
  await page.getByRole("button", { name: "Retry" }).click();
  await page.waitForFunction(
    () => document.documentElement.lang === "zh-CN",
    undefined,
    { timeout: 3000 }
  );
  assert(
    (await page.getByRole("radio", { name: /简体中文/ }).getAttribute(
      "aria-checked"
    )) === "true",
    "retry must save and apply the target language"
  );
  checks.push("save-failure-retains-language-and-retry-recovers");

  await page.getByRole("button", { name: "关闭设置" }).press("Escape");
  assert(!(await dialog.isVisible()), "Escape must close the settings dialog");
  assert(
    await page.getByRole("button", { name: "设置", exact: true }).evaluate(
      (element) => element === document.activeElement
    ),
    "closing settings must restore focus to the trigger"
  );
  await page.getByRole("button", { name: "设置", exact: true }).press("Enter");
  await dialog.waitFor();
  await page.getByRole("button", { name: "关闭设置" }).press("Tab");
  assert(
    (await page.locator(":focus").getAttribute("aria-current")) === "page",
    "Tab must enter the category navigation"
  );
  checks.push("keyboard-open-close-focus-return-and-dialog-navigation");

  await page.setViewportSize({ width: 520, height: 760 });
  const dialogBox = await dialog.boundingBox();
  const navBox = await page.locator(".settings-nav").boundingBox();
  const contentBox = await page.locator(".settings-content").boundingBox();
  assert(
    dialogBox && navBox && contentBox
      && contentBox.y >= navBox.y + navBox.height - 1
      && dialogBox.x >= 0
      && dialogBox.x + dialogBox.width <= 520,
    "narrow layout must move category navigation above complete content"
  );
  await page.screenshot({
    path: resolve(artifactDir, "narrow-dark-zh.png"),
    fullPage: true
  });
  checks.push("narrow-stacked-layout");

  await page.emulateMedia({
    colorScheme: "light",
    reducedMotion: "reduce"
  });
  await page.waitForFunction(
    () => document.documentElement.dataset.theme === "light"
  );
  assert(
    (await page.locator("html").getAttribute("data-theme")) === "light",
    "light system theme must select the light token pair"
  );
  const animationDuration = await page
    .locator(".language-option")
    .first()
    .evaluate((element) => getComputedStyle(element).transitionDuration);
  assert(
    animationDuration === "0.001ms" || animationDuration === "1e-06s",
    "reduced motion must collapse decorative transition duration"
  );
  await page.screenshot({
    path: resolve(artifactDir, "narrow-light-reduced-motion.png"),
    fullPage: true
  });
  checks.push("light-theme-and-reduced-motion");

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
        prototype: "docs/product/pages/settings.prototype.html",
        checkedAt: new Date().toISOString(),
        screenshots: [
          "wide-dark-zh.png",
          "narrow-dark-zh.png",
          "narrow-light-reduced-motion.png"
        ],
        checks
      },
      null,
      2
    )}\n`,
    "utf8"
  );

  process.stdout.write(
    `Verified interactive settings prototype (${checks.length} checks). Evidence: ${evidencePath}\n`
  );
} finally {
  await browser.close();
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}
