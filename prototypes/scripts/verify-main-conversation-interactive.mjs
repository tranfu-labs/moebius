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

  // 默认场景是「团队菜单」；目录轨验收先切回 rail 场景。
  await page.getByTestId("scene-rail").click();
  await page.getByTestId("conversation-rail").waitFor();

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

  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.getByRole("button", { name: "切换为暗色主题" }).click();

  /* ---------------- 场景：团队菜单 ---------------- */

  await page.getByTestId("scene-team-menu").click();
  const teamTrigger = page.getByTestId("team-menu-trigger");
  await teamTrigger.waitFor();
  assert(
    (await teamTrigger.textContent())?.includes("开发团队"),
    "existing session trigger must read the historical snapshot team name"
  );
  checks.push("collapsed-trigger-reads-snapshot-identity");

  await teamTrigger.click();
  const teamMenu = page.getByTestId("team-menu");
  await teamMenu.waitFor();
  const currentOption = page.getByTestId("team-option-current");
  const currentText = await currentOption.textContent();
  assert(
    currentText?.includes("当前对话 · 开发团队")
      && currentText.includes("官方来源")
      && currentText.includes("4 名成员")
      && currentText.includes("快照载入于 2026-08-02 09:14"),
    "current option must show the frozen snapshot identity, members and load time"
  );
  assert(
    (await page.getByTestId("team-option-team-delivery").count()) === 0,
    "the team backing the current snapshot must not be listed again below"
  );
  const copyOptionText = await page
    .getByTestId("team-option-team-delivery-copy")
    .textContent();
  assert(
    copyOptionText?.includes("交付团队") && copyOptionText.includes("用户团队"),
    "same-named user team must stay distinguishable by source"
  );
  checks.push("menu-separates-snapshot-from-current-catalog");

  await page.keyboard.press("Escape");
  assert(
    (await teamMenu.count()) === 0,
    "Escape must close the team menu"
  );
  assert(
    await teamTrigger.evaluate(
      (element) => element === document.activeElement
    ),
    "closing the menu must return focus to the trigger"
  );
  checks.push("menu-escape-closes-and-restores-focus");

  await page.getByTestId("mode-new").click();
  await teamTrigger.click();
  const moreButton = page.getByTestId("member-more-team-delivery");
  await moreButton.waitFor();
  await moreButton.click();
  const expandedRow = page.getByTestId("member-row-team-delivery");
  assert(
    (await expandedRow.textContent())?.includes("发布专员"),
    "＋N must expand the full member list inside the option"
  );
  assert(
    (await teamMenu.count()) === 1,
    "expanding members must not close the selector"
  );
  checks.push("plus-n-expands-full-member-list-without-closing");

  await page.getByTestId("member-less-team-delivery").click();
  assert(
    !((await expandedRow.textContent())?.includes("发布专员")),
    "toggling again must collapse the member list"
  );
  await moreButton.focus();
  await moreButton.press("Enter");
  assert(
    (await expandedRow.textContent())?.includes("发布专员"),
    "keyboard activation of ＋N must also expand the member list"
  );
  await page.screenshot({
    path: resolve(artifactDir, "team-menu-new-expanded.png"),
    fullPage: true
  });
  checks.push("plus-n-keyboard-operable");

  await page.keyboard.press("Escape");
  await page
    .getByTestId("team-option-team-marketing")
    .locator(".team-option-main")
    .click();
  assert(
    (await teamTrigger.textContent())?.includes("营销团队"),
    "choosing a team in a new conversation must update the trigger"
  );
  checks.push("new-conversation-team-selection");

  await page.getByTestId("mode-existing").click();
  await teamTrigger.click();
  await page
    .getByTestId("team-option-team-marketing")
    .locator(".team-option-main")
    .click();
  const pendingNote = page.getByTestId("pending-switch-note");
  await pendingNote.waitFor();
  assert(
    (await pendingNote.textContent())?.includes(
      "当前已启动的运行都结束后换成「营销团队」"
    ),
    "switching with old work must show the pending boundary note"
  );
  assert(
    (await teamTrigger.textContent())?.includes("待生效"),
    "trigger must show the pending target identity with a pending marker"
  );
  await page.getByRole("button", { name: "模拟旧工作结束" }).click();
  assert(
    (await page.getByTestId("announcement").textContent())?.includes(
      "已载入「营销团队」当前最新保存的完整版本"
    ),
    "completing old work must load the target team's latest saved version"
  );
  checks.push("pending-team-switch-respects-run-boundary");

  /* ---------------- 场景：变化与应用 ---------------- */

  await page.getByTestId("scene-apply").click();
  const prompts = page.getByTestId("change-prompts");
  await prompts.waitFor();
  for (const label of [
    "Agent 定义已更新 · 3 名成员",
    "运行配置已更新 · 3 名成员",
    "团队信息已更新"
  ]) {
    assert(
      (await prompts.textContent())?.includes(label),
      `change prompts must include: ${label}`
    );
  }
  checks.push("categorized-change-prompts");

  await page.getByTestId("apply-团队信息已更新").click();
  await page.getByTestId("apply-pending").waitFor();
  assert(
    (await prompts.count()) === 0,
    "after clicking 应用 the categorized prompts must merge into the waiting state"
  );
  const draftInput = page.getByLabel("消息草稿");
  await draftInput.fill("等新版生效后再发这一条");
  await draftInput.press("Enter");
  const queue = page.getByTestId("waiting-queue");
  await queue.waitFor();
  await page.getByRole("button", { name: "移除等待消息：等新版生效后再发这一条" }).click();
  assert(
    (await queue.count()) === 0,
    "waiting messages must be removable"
  );
  await draftInput.fill("保留这条等待消息");
  await draftInput.press("Enter");
  checks.push("post-click-messages-wait-in-editable-queue");

  await page.getByTestId("settle-old-work").click();
  await page.getByTestId("apply-done").waitFor();
  assert(
    (await page.getByTestId("announcement").textContent())?.includes(
      "已应用整支团队最新保存的完整版本"
    ),
    "settling old work must apply the whole frozen team version"
  );
  checks.push("apply-succeeds-after-old-work");

  await page.getByRole("button", { name: "重置场景" }).click();
  await prompts.waitFor();
  await page.getByTestId("toggle-apply-failure").click();
  await page.getByTestId("apply-Agent 定义已更新 · 3 名成员").click();
  await page.getByTestId("settle-old-work").click();
  const failedBanner = page.getByTestId("apply-failed");
  await failedBanner.waitFor();
  assert(
    (await failedBanner.textContent())?.includes("落盘失败，未应用"),
    "apply failure must keep the old snapshot and explain it was not applied"
  );
  await draftInput.fill("失败期间发送的消息");
  await draftInput.press("Enter");
  await page.getByTestId("retry-apply").click();
  await page.getByTestId("apply-pending").waitFor();
  assert(
    (await queue.textContent())?.includes("失败期间发送的消息"),
    "retry must keep the same frozen target and the waiting queue"
  );
  await page.getByTestId("settle-old-work").click();
  await page.getByTestId("apply-done").waitFor();
  checks.push("apply-failure-retry-uses-same-frozen-version");

  await page.getByRole("button", { name: "重置场景" }).click();
  await page.getByTestId("apply-Agent 定义已更新 · 3 名成员").click();
  await page.getByTestId("settle-old-work").click();
  await page.getByTestId("apply-failed").waitFor();
  await draftInput.fill("取消后按旧版发射");
  await draftInput.press("Enter");
  await page.getByTestId("cancel-apply").click();
  await prompts.waitFor();
  assert(
    (await page.getByTestId("announcement").textContent())?.includes(
      "已取消应用"
    ),
    "cancel must release waiting messages under the current old snapshot"
  );
  await page.screenshot({
    path: resolve(artifactDir, "apply-prompts-restored.png"),
    fullPage: true
  });
  checks.push("apply-cancel-releases-queue-and-restores-prompts");
  await page.getByTestId("toggle-apply-failure").click();

  /* ---------------- 场景：头像信息卡 ---------------- */

  await page.getByTestId("scene-avatar-card").click();
  await page.getByTestId("avatar-run-dev").click();
  const infoCard = page.getByTestId("agent-info-card");
  await infoCard.waitFor();
  const devArticleBox = await page
    .getByTestId("agent-record-run-dev")
    .boundingBox();
  const devCardBox = await infoCard.boundingBox();
  assert(
    devArticleBox && devCardBox
      && Math.abs(devCardBox.y - (devArticleBox.y + devArticleBox.height + 6)) < 2
      && Math.abs(devCardBox.x - (devArticleBox.x - 6)) < 2,
    "info card must anchor directly below the triggering message row"
  );
  checks.push("info-card-anchored-to-message-row");
  const cardText = await infoCard.textContent();
  assert(
    (await page.getByTestId("config-provenance").textContent()) ===
      "实际执行配置",
    "successful run must mark config as actually executed"
  );
  assert(
    cardText?.includes("@dev · 开发团队 · 官方来源")
      && cardText.includes("团队版本载入于 2026-08-02 09:14")
      && cardText.includes("gpt-5.5"),
    "info card must show snapshot identity, load time and frozen config"
  );
  assert(
    !cardText.includes("gpt-5.6"),
    "info card must not leak current team values"
  );
  checks.push("info-card-shows-frozen-facts-only");

  await page.getByTestId("view-agent-markdown").click();
  const viewer = page.getByTestId("agent-md-viewer");
  await viewer.waitFor();
  assert(
    (await viewer.textContent())?.includes("负责实现。完成后把验证交给 @qa。"),
    "viewer must show the frozen readonly AGENT.md"
  );
  await page.keyboard.press("Escape");
  assert(
    (await viewer.count()) === 0 && (await infoCard.count()) === 1,
    "Escape must close only the viewer and keep the info card"
  );
  await page.keyboard.press("Escape");
  assert(
    (await infoCard.count()) === 0,
    "second Escape must close the info card"
  );
  assert(
    await page
      .getByTestId("avatar-run-dev")
      .evaluate((element) => element === document.activeElement),
    "closing must return focus to the originating avatar"
  );
  checks.push("markdown-viewer-and-card-escape-focus-order");

  await page.getByTestId("avatar-run-qa").click();
  assert(
    (await page.getByTestId("config-provenance").textContent()) ===
      "本次计划尝试 · 未开始执行",
    "pre-start failure must not claim the model actually ran"
  );
  await page.keyboard.press("Escape");
  await page.getByTestId("avatar-run-security").click();
  const legacyCard = page.getByTestId("agent-info-card");
  const legacyText = await legacyCard.textContent();
  assert(
    (await page.getByTestId("config-provenance").textContent()) ===
      "本次绑定配置 · 是否开始未记录"
      && legacyText?.includes("此项未记录"),
    "legacy records must mark unprovable facts as not recorded"
  );
  await page.locator(".composer-context").click();
  assert(
    (await legacyCard.count()) === 0,
    "clicking outside must close the info card"
  );
  await page.screenshot({
    path: resolve(artifactDir, "avatar-card-closed.png"),
    fullPage: true
  });
  checks.push("provenance-levels-and-outside-dismiss");

  const heightControlsForCard = page
    .locator(".control-group")
    .filter({ hasText: "时间线高度" });
  await heightControlsForCard.getByRole("button", { name: "矮" }).click();
  await page.waitForTimeout(80);
  await page
    .getByTestId("timeline")
    .evaluate((element) => element.scrollTo(0, element.scrollHeight));
  await page.getByTestId("avatar-run-security").click();
  const flippedCard = page.getByTestId("agent-info-card");
  await flippedCard.waitFor();
  const securityArticleBox = await page
    .getByTestId("agent-record-run-security")
    .boundingBox();
  const flippedCardBox = await flippedCard.boundingBox();
  assert(
    (await flippedCard.getAttribute("data-placement")) === "above"
      && securityArticleBox && flippedCardBox
      && flippedCardBox.y + flippedCardBox.height <= securityArticleBox.y + 1,
    "with no room below, the card must flip above the message row"
  );
  checks.push("info-card-flips-above-when-space-insufficient");
  await page.keyboard.press("Escape");
  await heightControlsForCard.getByRole("button", { name: "高" }).click();
  await page.waitForTimeout(80);

  const widthControlsForCard = page
    .locator(".control-group")
    .filter({ hasText: "主会话宽度" });
  await widthControlsForCard.getByRole("button", { name: "窄" }).click();
  await page.waitForTimeout(80);
  await page.getByTestId("avatar-run-dev").click();
  const narrowCard = page.getByTestId("agent-info-card");
  await narrowCard.waitFor();
  const narrowCardBox = await narrowCard.boundingBox();
  const viewportWidth = await page.evaluate(() => window.innerWidth);
  assert(
    narrowCardBox && narrowCardBox.x >= 0
      && narrowCardBox.x + narrowCardBox.width <= viewportWidth,
    "narrow window must keep the card fully inside the viewport"
  );
  assert(
    !(await page.evaluate(
      () => document.documentElement.scrollWidth > window.innerWidth
    )),
    "narrow window with an open card must not scroll horizontally"
  );
  checks.push("info-card-contained-in-narrow-viewport");
  await page.keyboard.press("Escape");
  await widthControlsForCard.getByRole("button", { name: "宽" }).click();
  await page.waitForTimeout(80);

  /* ---------------- 场景：团队保存反馈 ---------------- */

  await page.getByTestId("scene-team-save").click();
  await page.getByTestId("unsaved-dev").waitFor();
  await page.getByTestId("save-current-member").click();
  const saveFeedback = page.getByTestId("save-feedback");
  assert(
    (await saveFeedback.textContent())?.includes("已保存，无需重启")
      && (await saveFeedback.textContent())?.includes(
        "点击任一「应用」会载入整支团队最新保存的完整版本"
      ),
    "single save must show the full effectiveness feedback near the action"
  );
  assert(
    (await page.getByTestId("unsaved-dev").count()) === 0,
    "successful save must clear the member's unsaved marker"
  );
  checks.push("single-save-effectiveness-feedback");

  await page.getByTestId("toggle-partial-failure").click();
  await page.getByTestId("save-all-and-leave").click();
  const failedItem = page.getByTestId("save-feedback-item-failed");
  await failedItem.waitFor();
  assert(
    (await failedItem.textContent())?.includes(
      "未保存，仍使用上一次保存的版本"
    ) && (await page.getByTestId("teams-detail").count()) === 1,
    "partial failure must stay in detail with per-item feedback"
  );
  await page.getByTestId("retry-save-item").click();
  assert(
    (await page.getByTestId("save-feedback-success").textContent())?.includes(
      "测试工程师：已保存，无需重启。"
    ),
    "retrying the failed item must save it without mixing drafts"
  );
  checks.push("partial-save-itemized-feedback-and-retry");

  await page.getByTestId("toggle-partial-failure").click();
  await page.getByTestId("scene-avatar-card").click();
  await page.getByTestId("scene-team-save").click();
  await page.getByTestId("save-all-and-leave").click();
  const homeFeedback = page.getByTestId("home-save-feedback");
  await homeFeedback.waitFor();
  assert(
    (await homeFeedback.textContent())?.includes(
      "已保存「交付团队」的 2 个项目，无需重启"
    ),
    "save-all-and-leave must land the feedback above the team list"
  );
  assert(
    (await page.locator(".teams-home-row").count()) >= 4,
    "team home must list the teams below the feedback"
  );
  await page.screenshot({
    path: resolve(artifactDir, "teams-home-feedback.png"),
    fullPage: true
  });
  checks.push("save-all-leave-home-feedback-anchor");

  /* ---------------- 响应式 / 主题 / 减少动态 ---------------- */

  const sceneWidthControls = page
    .locator(".control-group")
    .filter({ hasText: "主会话宽度" });
  await sceneWidthControls.getByRole("button", { name: "窄" }).click();
  await page.waitForTimeout(80);
  const hasHorizontalOverflow = await page.evaluate(
    () => document.documentElement.scrollWidth > window.innerWidth
  );
  assert(!hasHorizontalOverflow, "narrow frame must not scroll horizontally");
  checks.push("narrow-viewport-without-horizontal-scroll");

  await page.getByRole("button", { name: "切换为亮色主题" }).click();
  await page.getByTestId("scene-apply").click();
  await page.getByTestId("change-prompts").waitFor();
  await page.screenshot({
    path: resolve(artifactDir, "apply-narrow-light.png"),
    fullPage: true
  });
  checks.push("apply-scene-light-theme-readable");

  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.getByTestId("scene-avatar-card").click();
  await page.getByTestId("avatar-run-dev").click();
  assert(
    (await page.getByTestId("config-provenance").textContent()) ===
      "实际执行配置",
    "reduced motion must preserve the info card content and order"
  );
  await page.screenshot({
    path: resolve(artifactDir, "avatar-reduced-motion.png"),
    fullPage: true
  });
  checks.push("reduced-motion-info-card-equivalent");

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
          "medium-reduced-motion.png",
          "team-menu-new-expanded.png",
          "apply-prompts-restored.png",
          "avatar-card-closed.png",
          "teams-home-feedback.png",
          "apply-narrow-light.png",
          "avatar-reduced-motion.png"
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
