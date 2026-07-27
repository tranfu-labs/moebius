import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";
import { chromium } from "playwright";

const here = dirname(fileURLToPath(import.meta.url));
const packageRoot = resolve(here, "..");
const repositoryRoot = resolve(packageRoot, "..");
const prototypePath = resolve(
  repositoryRoot,
  "docs/product/pages/main-conversation.prototype.html"
);
const artifactDir = await mkdtemp(
  resolve(tmpdir(), "moebius-main-conversation-prototype-interactive-")
);
const evidencePath = resolve(artifactDir, "interactive-evidence.json");
const checks = [];
const requests = [];

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
page.on("request", (request) => requests.push(request.url()));

try {
  await page.goto(pathToFileURL(prototypePath).href);
  await page.locator('[data-prototype="main-conversation"]').waitFor();

  assert(
    (await page.locator(".app-sidebar [data-rail-event]").count()) === 0,
    "project/session sidebar must not contain a message rail"
  );
  assert(
    (await page.locator(".main-conversation [data-testid='conversation-rail']").count())
      === 1,
    "main conversation must own exactly one message rail"
  );
  checks.push("rail-owned-by-current-main-conversation");

  const rail = page.getByTestId("conversation-rail");
  const tallCapacity = Number(await rail.getAttribute("data-capacity"));
  assert(tallCapacity > 9, "tall main timeline must not inherit the old nine-row cap");
  checks.push("capacity-derived-from-main-timeline-viewport");

  const titleBefore = await page.locator(".conversation-header h1").boundingBox();
  const messageBefore = await page
    .getByTestId("timeline-message-event-34")
    .boundingBox();
  await rail.hover();
  await page.locator(".conversation-rail.is-expanded").waitFor();
  const titleAfter = await page.locator(".conversation-header h1").boundingBox();
  const messageAfter = await page
    .getByTestId("timeline-message-event-34")
    .boundingBox();
  assertSamePosition(titleBefore, titleAfter, "title");
  assertSamePosition(messageBefore, messageAfter, "timeline message");
  checks.push("expanded-swimlanes-overlay-without-layout-shift");

  const expandedStage = page.locator(".conversation-rail.is-expanded .rail-stage");
  const expandedStageBounds = await expandedStage.boundingBox();
  const fullRowBounds = await page.getByTestId("rail-event-event-33").boundingBox();
  assert(
    expandedStageBounds && fullRowBounds
      && Math.abs(expandedStageBounds.width - fullRowBounds.width) < 0.5,
    "each expanded event row must use the full panel width as its hit target"
  );
  checks.push("expanded-event-uses-full-row-hit-target");

  const connectorPaths = await page.locator(".rail-connections path").evaluateAll(
    (paths) => paths.map((path) => path.getAttribute("d") ?? "")
  );
  assert(
    connectorPaths.length > 0
      && connectorPaths.every((path) => path.includes(" C ") && !path.includes(" H ")),
    "adjacent rows must use Git graph cubic curves instead of right-angle paths"
  );
  checks.push("onboarding-style-git-graph-curves");

  await page.screenshot({
    path: resolve(artifactDir, "wide-expanded-dark.png"),
    fullPage: true
  });

  await page.getByTestId("rail-event-event-33").hover();
  const preview = page.getByTestId("event-preview-card");
  await preview.waitFor();
  const previewText = await preview.textContent();
  assert(
    !previewText?.includes("不对，这不是会话列表左侧"),
    "agent preview must not repeat the triggering user message as a title"
  );
  assert(
    previewText?.includes("界面原型师"),
    "agent preview must use the readable member name"
  );
  assert(
    previewText?.includes("新原型将目录固定在正文列左侧留白"),
    "agent preview body must use the original reply opening"
  );
  checks.push("agent-hover-card-uses-two-line-readable-template");

  const stageBounds = await expandedStage.boundingBox();
  const rightLanePreviewBounds = await preview.boundingBox();
  await page.getByTestId("rail-event-event-01").hover();
  const leftLanePreviewBounds = await preview.boundingBox();
  assert(
    stageBounds && rightLanePreviewBounds && leftLanePreviewBounds
      && Math.abs(
        (rightLanePreviewBounds.x - (stageBounds.x + stageBounds.width))
        - (leftLanePreviewBounds.x - (stageBounds.x + stageBounds.width))
      ) < 0.5,
    "preview side offset must remain fixed relative to the expanded panel"
  );
  checks.push("preview-offset-fixed-to-panel-not-lane");

  await page.getByTestId("rail-event-event-33").click();
  await page.getByTestId("timeline-message-event-33").waitFor();
  assert(
    await page
      .getByTestId("timeline-message-event-33")
      .evaluate((element) => element.classList.contains("is-highlighted")),
    "clicking a rail event must highlight the exact original message"
  );
  checks.push("pointer-location-and-highlight");

  await rail.hover();
  const keyboardStart = page.getByTestId("rail-event-event-33");
  await keyboardStart.focus();
  const scrollBefore = await page
    .getByTestId("timeline")
    .evaluate((element) => element.scrollTop);
  await keyboardStart.press("ArrowUp");
  await page.waitForFunction(() => {
    return document.activeElement?.getAttribute("data-rail-event") === "event-32";
  });
  assert(
    (await page.locator(":focus").getAttribute("data-rail-event")) === "event-32",
    "ArrowUp must move to the previous real event"
  );
  const scrollAfterBrowse = await page
    .getByTestId("timeline")
    .evaluate((element) => element.scrollTop);
  assert(
    scrollAfterBrowse === scrollBefore,
    "browsing the rail must not move the main timeline before activation"
  );
  await page.locator(":focus").press("Enter");
  assert(
    await page
      .getByTestId("timeline-message-event-32")
      .evaluate((element) => element.classList.contains("is-highlighted")),
    "Enter must activate and highlight the focused event"
  );
  checks.push("keyboard-browse-without-scroll-then-activate");

  await page.getByRole("button", { name: "下次定位失败" }).click();
  await rail.hover();
  await page.getByTestId("rail-event-event-34").click();
  assert(
    (await page.getByTestId("announcement").textContent())?.includes(
      "已保持当前阅读位置"
    ),
    "failed exact location must preserve the current reading position"
  );
  assert(
    (await rail.locator('[aria-current="location"]').getAttribute("data-rail-event"))
      === "event-32",
    "failed location must not silently move to a nearby event"
  );
  await page.getByRole("button", { name: "下次定位失败" }).click();
  await rail.hover();
  await page.getByTestId("rail-event-event-34").click();
  checks.push("failed-location-preserves-position-and-recovery-succeeds");

  const heightControls = page
    .locator(".control-group")
    .filter({ hasText: "时间线高度" });
  await heightControls.getByRole("button", { name: "矮" }).click();
  await page.waitForTimeout(80);
  const compactCapacity = Number(await rail.getAttribute("data-capacity"));
  assert(
    compactCapacity < tallCapacity,
    "compact main timeline must expose a smaller derived rail capacity"
  );
  checks.push("height-responsive-focus-window");

  const widthControls = page
    .locator(".control-group")
    .filter({ hasText: "主会话宽度" });
  await widthControls.getByRole("button", { name: "宽" }).click();
  await page.waitForTimeout(80);
  const wideContainer = Number(await rail.getAttribute("data-container-width"));
  await widthControls.getByRole("button", { name: "窄" }).click();
  await page.waitForTimeout(80);
  const narrowContainer = Number(await rail.getAttribute("data-container-width"));
  assert(narrowContainer < wideContainer, "narrow mode must shrink the main container");
  assert(
    (await page.locator(".main-conversation [data-testid='conversation-rail']").count())
      === 1,
    "narrow mode must keep the rail inside the main conversation"
  );
  checks.push("main-container-width-responsive-and-rail-never-migrates");

  await page.getByRole("button", { name: "切换为亮色主题" }).click();
  assert(
    (await page.locator("html").getAttribute("data-theme")) === "light",
    "theme control must switch the self-contained prototype to light mode"
  );
  await rail.hover();
  await page.screenshot({
    path: resolve(artifactDir, "narrow-expanded-light.png"),
    fullPage: true
  });
  checks.push("light-and-dark-theme");

  await page.emulateMedia({ reducedMotion: "reduce" });
  await widthControls.getByRole("button", { name: "中" }).click();
  await page.waitForTimeout(50);
  await rail.hover();
  const visibleEvent = rail.locator("[data-rail-event]").last();
  await visibleEvent.focus();
  await visibleEvent.press("Enter");
  assert(
    (await page.getByTestId("announcement").textContent())?.includes(
      "已定位并突出原消息"
    ),
    "reduced motion must preserve exact location information"
  );
  await page.screenshot({
    path: resolve(artifactDir, "medium-reduced-motion.png"),
    fullPage: true
  });
  checks.push("reduced-motion-equivalent-interaction");

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
        prototype: "docs/product/pages/main-conversation.prototype.html",
        checkedAt: new Date().toISOString(),
        viewport: { width: 1440, height: 1000 },
        tallCapacity,
        compactCapacity,
        wideContainer,
        narrowContainer,
        screenshots: [
          "wide-expanded-dark.png",
          "narrow-expanded-light.png",
          "medium-reduced-motion.png"
        ],
        checks
      },
      null,
      2
    )}\n`,
    "utf8"
  );

  process.stdout.write(
    `Verified interactive main conversation prototype (${checks.length} checks). Evidence: ${evidencePath}\n`
  );
} finally {
  await browser.close();
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function assertSamePosition(before, after, label) {
  assert(before && after, `${label} must have measurable bounds`);
  assert(
    Math.abs(before.x - after.x) < 0.5
      && Math.abs(before.y - after.y) < 0.5
      && Math.abs(before.width - after.width) < 0.5
      && Math.abs(before.height - after.height) < 0.5,
    `${label} moved when the swimlane overlay expanded`
  );
}
