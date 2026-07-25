import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { chromium } from "playwright";

const here = dirname(fileURLToPath(import.meta.url));
const packageRoot = resolve(here, "..");
const repositoryRoot = resolve(packageRoot, "..");
const prototypePath = resolve(
  repositoryRoot,
  "docs/product/pages/onboarding.prototype.html"
);
const artifactDir = resolve(
  repositoryRoot,
  "artifacts/acceptance/onboarding-prototype"
);
const evidencePath = resolve(artifactDir, "evidence.json");
const html = await readFile(prototypePath, "utf8");
const prototypeUrl = pathToFileURL(prototypePath).href;
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

await mkdir(artifactDir, { recursive: true });

const browser = await chromium.launch({ headless: true });
const externalRequests = new Set();
const checks = [];

function watchExternalRequests(page) {
  page.on("request", (request) => {
    const url = request.url();
    if (url.startsWith("http://") || url.startsWith("https://")) {
      externalRequests.add(url);
    }
  });
}

async function expectStableStep(page, step) {
  const currentStep = page.getByTestId(`step-${step}`);
  await currentStep.waitFor();
  await page.waitForTimeout(500);

  const activeStepCount = await page
    .locator('[data-testid^="step-"]')
    .count();
  if (activeStepCount !== 1 || (await currentStep.count()) !== 1) {
    throw new Error(
      `Expected onboarding to remain on step ${step}, found ${activeStepCount} active step roots.`
    );
  }
}

async function readReplayFixture(page) {
  await page.getByTestId("replay-main-fixture").waitFor();
  return {
    project: await page.getByTestId("replay-project").textContent(),
    conversation: await page.getByTestId("replay-conversation").textContent(),
    draft: await page.getByTestId("replay-draft").inputValue(),
    team: await page.getByTestId("replay-team").textContent()
  };
}

async function expectActionGeometry(page, expectedFrameWidth) {
  const geometry = await page.evaluate(() => {
    const frame = document.querySelector(".onboarding-frame");
    const stage = document.querySelector(".onboarding-stage");
    const footer = document.querySelector(".onboarding-footer");
    const actions = document.querySelector(".onboarding-actions");
    const primary = document.querySelector('[data-testid="primary-action"]');
    const secondary = document.querySelector('[data-testid="back-action"]');
    if (
      !(frame instanceof HTMLElement)
      || !(stage instanceof HTMLElement)
      || !(footer instanceof HTMLElement)
      || !(actions instanceof HTMLElement)
      || !(primary instanceof HTMLElement)
    ) {
      throw new Error("Onboarding action geometry targets are missing.");
    }
    const frameRect = frame.getBoundingClientRect();
    const stageRect = stage.getBoundingClientRect();
    const footerRect = footer.getBoundingClientRect();
    const actionsRect = actions.getBoundingClientRect();
    const primaryRect = primary.getBoundingClientRect();
    const secondaryRect = secondary instanceof HTMLElement
      ? secondary.getBoundingClientRect()
      : null;
    return {
      frameWidth: frameRect.width,
      primaryRightGap: frameRect.right - primaryRect.right,
      footerBottomGap: window.innerHeight - footerRect.bottom,
      stageFooterGap: footerRect.top - stageRect.bottom,
      buttonGap: secondaryRect === null
        ? null
        : primaryRect.left - secondaryRect.right,
      horizontalOverflow: document.documentElement.scrollWidth - window.innerWidth,
      footerCount: document.querySelectorAll(".onboarding-footer").length,
      legacyProgressCount: document.querySelectorAll(
        ".step-progress, .step-dots, .step-count"
      ).length,
      actionsInFooter: footer.contains(actions)
    };
  });

  if (
    expectedFrameWidth !== null
    && Math.abs(geometry.frameWidth - expectedFrameWidth) > 0.5
  ) {
    throw new Error(
      `Expected ${expectedFrameWidth}px onboarding frame, found ${geometry.frameWidth}px.`
    );
  }
  if (Math.abs(geometry.footerBottomGap) > 0.5) {
    throw new Error(
      `Onboarding footer is not pinned to the viewport bottom: ${geometry.footerBottomGap}px.`
    );
  }
  if (Math.abs(geometry.stageFooterGap) > 0.5) {
    throw new Error(
      `Scrollable stage and footer are not adjacent: ${geometry.stageFooterGap}px.`
    );
  }
  if (Math.abs(geometry.primaryRightGap) > 0.5) {
    throw new Error(
      `Primary action is not aligned to the frame right edge: ${geometry.primaryRightGap}px.`
    );
  }
  if (geometry.buttonGap !== null && Math.abs(geometry.buttonGap - 8) > 0.5) {
    throw new Error(
      `Expected 8px action gap, found ${geometry.buttonGap}px.`
    );
  }
  if (geometry.horizontalOverflow > 0.5) {
    throw new Error(
      `Onboarding created ${geometry.horizontalOverflow}px horizontal overflow.`
    );
  }
  if (geometry.footerCount !== 1 || !geometry.actionsInFooter) {
    throw new Error("Onboarding actions must render inside one dedicated footer.");
  }
  if (geometry.legacyProgressCount !== 0) {
    throw new Error("Legacy footer progress is still rendered.");
  }
}

try {
  const desktopContext = await browser.newContext({
    viewport: { width: 1280, height: 800 },
    colorScheme: "dark"
  });
  const desktopPage = await desktopContext.newPage();
  watchExternalRequests(desktopPage);
  await desktopPage.goto(prototypeUrl);
  await desktopPage.getByTestId("step-1").waitFor();
  await desktopPage.getByRole("heading", { name: "环境准备" }).waitFor();
  await desktopPage.getByText(
    "moebius 用 codex 来运行每一位团队成员"
  ).waitFor();
  await desktopPage.getByText("首次启动", { exact: true }).waitFor();
  const readySurfaceText = await desktopPage.getByTestId("step-1").textContent();
  if (/\bcodex(?:-cli)?\s+\d+\.\d+/iu.test(readySurfaceText ?? "")) {
    throw new Error("The static ready prototype must not claim a detected Codex version.");
  }
  checks.push("static-ready-does-not-fake-version");
  if ((await desktopPage.getByTestId("back-action").count()) !== 0) {
    throw new Error("The first onboarding step must not expose a back action.");
  }
  checks.push("file-url-render");

  const primary = desktopPage.getByTestId("primary-action");
  await primary.focus();
  await desktopPage.keyboard.press("Enter");
  await expectStableStep(desktopPage, 2);
  await desktopPage.getByRole("heading", { name: "选择一支团队" }).waitFor();
  await desktopPage.getByText("跟 AI 聊出一支新团队").waitFor();
  await desktopPage.getByText(
    "你说一下要做什么样的活，AI 帮你把成员组齐"
  ).waitFor();
  checks.push("desktop-copy-step-1-and-2");
  checks.push("keyboard-step-1-to-2");
  await expectActionGeometry(desktopPage, 780);
  checks.push("desktop-780-frame-and-fixed-action-footer");

  await desktopPage.getByTestId("back-action").click();
  await expectStableStep(desktopPage, 1);
  await desktopPage.getByTestId("primary-action").click();
  await expectStableStep(desktopPage, 2);
  checks.push("back-navigation-preserves-journey");

  await desktopPage.getByTestId("open-team-builder").click();
  await desktopPage.getByTestId("team-builder").waitFor();
  await desktopPage.getByText("AI 团队设计器").waitFor();
  await desktopPage.getByText("独立只读 AI 会话").waitFor();
  await desktopPage.getByText("仍在第 2 步").waitFor();
  await desktopPage.getByText(
    "你希望这支团队长期替你完成什么工作？"
  ).waitFor();
  if (
    (await desktopPage.getByTestId("primary-action").count()) !== 0
    || (await desktopPage.locator(".onboarding-actions").count()) !== 0
    || (await desktopPage.locator(".onboarding-footer").count()) !== 0
  ) {
    throw new Error("Global onboarding footer must hide during AI team design.");
  }
  checks.push("ai-team-builder-hides-global-footer");
  await desktopPage.getByTestId("builder-goal").fill(
    "帮我持续做产品发布，从资料研究、内容撰写到上线前复核。"
  );
  await desktopPage.getByLabel("发送").click();
  await desktopPage.getByTestId("builder-typing").waitFor();
  checks.push("ai-team-builder-processing-indicator");
  await desktopPage.getByTestId("team-proposal").waitFor();
  await desktopPage.waitForTimeout(350);
  const proposalMemberCount = await desktopPage
    .locator(".proposal-member")
    .count();
  if (proposalMemberCount !== 4) {
    throw new Error(
      `Expected a four-member AI team proposal, found ${proposalMemberCount}.`
    );
  }
  const proposalSlugs = await desktopPage
    .locator(".proposal-member code")
    .allTextContents();
  if (
    JSON.stringify(proposalSlugs) !== JSON.stringify([
      "@launch-lead",
      "@researcher",
      "@content-writer",
      "@brand-reviewer"
    ])
  ) {
    throw new Error(
      `The onboarding proposal slugs do not match desktop: ${proposalSlugs.join(", ")}`
    );
  }
  await desktopPage.getByRole("button", { name: "继续聊着调整" }).waitFor();
  await desktopPage.getByRole("button", { name: "创建并选中" }).waitFor();
  checks.push("ai-team-builder-proposal");
  checks.push("desktop-copy-team-builder");
  await desktopPage.screenshot({
    path: resolve(artifactDir, "team-builder-proposal-dark-wide.png"),
    fullPage: true
  });

  await desktopPage.getByTestId("adjust-proposal").click();
  if ((await desktopPage.locator(".proposal-actions").count()) !== 0) {
    throw new Error(
      "Chatting to adjust must turn the proposal card read-only (no action buttons)."
    );
  }
  const lockedProposalClass = await desktopPage
    .getByTestId("team-proposal")
    .getAttribute("class");
  if (!lockedProposalClass?.includes("team-proposal--readonly")) {
    throw new Error(
      "Read-only proposal card must drop the accent highlight while adjusting."
    );
  }
  checks.push("adjust-proposal-locks-card");
  await desktopPage
    .getByLabel("调整团队提案")
    .fill("让负责人最后给我一份可复核的发布清单");
  const adjustmentBody = "让负责人最后给我一份可复核的发布清单";
  await desktopPage.getByLabel("发送").click();
  const adjustmentMessage = desktopPage.getByTestId("builder-adjustment-user");
  const adjustmentTyping = desktopPage.getByTestId("builder-typing");
  await adjustmentMessage.waitFor();
  await adjustmentTyping.waitFor();
  const messagePrecedesTyping = await adjustmentMessage.evaluate((message, typingTestId) => {
    const typing = document.querySelector(`[data-testid="${typingTestId}"]`);
    return typing !== null
      && (message.compareDocumentPosition(typing) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0;
  }, "builder-typing");
  if (!messagePrecedesTyping) {
    throw new Error("The submitted adjustment must precede the typing indicator.");
  }
  if ((await desktopPage.getByText(adjustmentBody, { exact: true }).count()) !== 1) {
    throw new Error("The pending adjustment body must be visible exactly once.");
  }
  checks.push("adjustment-user-message-precedes-typing");
  await desktopPage.getByTestId("builder-adjustment-reply").waitFor();
  await adjustmentTyping.waitFor({ state: "detached" });
  if ((await desktopPage.getByText(adjustmentBody, { exact: true }).count()) !== 1) {
    throw new Error("The resolved adjustment body must remain visible exactly once.");
  }
  await desktopPage.getByText("已按要求调整方案。", { exact: true }).waitFor();
  checks.push("adjustment-reply-converges-without-duplication");
  await desktopPage.getByTestId("confirm-created-team").click();
  await desktopPage.getByTestId("created-team-card").waitFor();
  checks.push("ai-team-create-and-select");

  await desktopPage.getByTestId("primary-action").click();
  await expectStableStep(desktopPage, 3);
  await desktopPage.getByRole("heading", {
    name: "看看团队如何完成一次接力"
  }).waitFor();
  await desktopPage.getByText(
    "每一次交接都会留下过程、结论和复核证据"
  ).waitFor();
  await desktopPage.getByText("接力演示").waitFor();
  await desktopPage.getByText("对话记录").waitFor();
  await desktopPage
    .getByTestId("relay-stage")
    .getByText("事实、表达和品牌语气均已通过")
    .waitFor();
  await desktopPage
    .getByTestId("relay-stage")
    .getByText("发布内容已完成并通过审校")
    .waitFor();
  const completedRelayItems = await desktopPage
    .locator(".relay-history li.is-complete")
    .count();
  if (completedRelayItems < 4) {
    throw new Error(
      `Expected persistent relay history before closeout, found ${completedRelayItems} completed items.`
    );
  }
  const graphMembers = await desktopPage
    .getByTestId("relay-beat")
    .evaluateAll((beats) => beats.map((beat) => beat.getAttribute("data-member")));
  const expectedGraphMembers = [
    "策略负责人",
    "研究员",
    "内容作者",
    "品牌审校",
    "内容作者",
    "品牌审校",
    "策略负责人"
  ];
  if (JSON.stringify(graphMembers) !== JSON.stringify(expectedGraphMembers)) {
    throw new Error(
      `Relay graph nodes do not match the message order: ${graphMembers.join(" -> ")}`
    );
  }
  const graphConnections = await desktopPage
    .locator(".relay-graph-connector")
    .count();
  if (graphConnections !== expectedGraphMembers.length - 1) {
    throw new Error(
      `Expected one connection per adjacent handoff, found ${graphConnections}.`
    );
  }
  checks.push("relay-graph-aligns-nodes-with-messages");
  await desktopPage.waitForTimeout(700);
  await desktopPage.screenshot({
    path: resolve(artifactDir, "relay-dark-wide.png"),
    fullPage: true
  });

  await desktopPage.getByTestId("replay-relay").click();
  await desktopPage
    .getByTestId("relay-stage")
    .getByText("我来负责这次发布")
    .waitFor();
  checks.push("relay-replay");

  await desktopPage.getByTestId("primary-action").click();
  await expectStableStep(desktopPage, 4);
  await desktopPage.getByTestId("back-action").click();
  await expectStableStep(desktopPage, 3);
  const returnedRelayBeatCount = await desktopPage
    .getByTestId("relay-beat")
    .count();
  if (returnedRelayBeatCount > 1) {
    throw new Error(
      `Returning to relay should replay from the start, found ${returnedRelayBeatCount} visible beats.`
    );
  }
  await desktopPage.getByTestId("primary-action").click();
  await expectStableStep(desktopPage, 4);
  checks.push("step-4-back-replays-relay");
  checks.push("stable-step-transitions");
  await desktopPage.getByTestId("primary-action").click();
  await desktopPage.getByTestId("conversation-destination").waitFor();

  const selectedTeam = await desktopPage
    .getByTestId("selected-team")
    .textContent();
  if (!selectedTeam?.includes("产品发布团队")) {
    throw new Error("Selected team was not carried into the new conversation.");
  }
  checks.push("complete-journey-with-team");
  await desktopPage.screenshot({
    path: resolve(artifactDir, "conversation-dark-wide.png"),
    fullPage: true
  });
  await desktopContext.close();

  const missingContext = await browser.newContext({
    viewport: { width: 1100, height: 760 },
    colorScheme: "light"
  });
  const missingPage = await missingContext.newPage();
  watchExternalRequests(missingPage);
  await missingPage.goto(`${prototypeUrl}?scenario=missing&theme=light`);
  const missingPrimary = missingPage.getByTestId("primary-action");
  if (!(await missingPrimary.isDisabled())) {
    throw new Error("Missing Codex scenario did not disable continue.");
  }
  await missingPage.getByText("未找到 Codex", { exact: true }).waitFor();
  await missingPage.getByText("brew install codex", { exact: true }).waitFor();
  await missingPage.getByRole("button", { name: "复制" }).waitFor();
  await missingPage.getByTestId("recheck").waitFor();
  await missingPage.screenshot({
    path: resolve(artifactDir, "environment-missing-light.png"),
    fullPage: true
  });
  await missingPage.getByTestId("recheck").click();
  await missingPrimary.waitFor({ state: "visible" });
  await missingPage.waitForFunction(() => {
    const button = document.querySelector('[data-testid="primary-action"]');
    return button instanceof HTMLButtonElement && !button.disabled;
  });
  await missingPrimary.click();
  await missingPage.getByTestId("step-2").waitFor();
  await missingPage.screenshot({
    path: resolve(artifactDir, "team-light-wide.png"),
    fullPage: true
  });
  checks.push("missing-codex-hard-gate-and-recheck");
  await missingPage.getByTestId("primary-action").click();
  await expectStableStep(missingPage, 3);
  await missingPage
    .getByTestId("relay-stage")
    .getByText("收尾：统计口径已修正")
    .waitFor();
  const developmentMembers = await missingPage
    .getByTestId("relay-beat")
    .evaluateAll((beats) => beats.map((beat) => beat.getAttribute("data-member")));
  const expectedDevelopmentMembers = [
    "开发经理",
    "开发",
    "软件测试",
    "开发",
    "软件测试",
    "开发经理"
  ];
  if (
    JSON.stringify(developmentMembers) !==
    JSON.stringify(expectedDevelopmentMembers)
  ) {
    throw new Error(
      `Development relay does not match the approved workflow: ${developmentMembers.join(" -> ")}`
    );
  }
  checks.push("development-team-review-revision-loop");
  await missingContext.close();

  const unavailableContext = await browser.newContext({
    viewport: { width: 1100, height: 760 },
    colorScheme: "light"
  });
  const unavailablePage = await unavailableContext.newPage();
  watchExternalRequests(unavailablePage);
  await unavailablePage.goto(`${prototypeUrl}?scenario=unavailable&theme=light`);
  const unavailablePrimary = unavailablePage.getByTestId("primary-action");
  if (!(await unavailablePrimary.isDisabled())) {
    throw new Error("Unavailable Codex scenario did not disable continue.");
  }
  await unavailablePage.getByText("Codex 暂时无法运行", { exact: true }).waitFor();
  await unavailablePage.getByText(
    "请在终端运行 codex，完成登录或按终端提示修复后，再回来重新检查。",
    { exact: true }
  ).waitFor();
  if (
    (await unavailablePage.getByText("brew install codex", { exact: true }).count()) !== 0
    || (await unavailablePage.getByRole("button", { name: "复制" }).count()) !== 0
    || (await unavailablePage.getByText(/\/Users\/|permission denied|stderr/iu).count()) !== 0
  ) {
    throw new Error("Unavailable recovery leaked installation or raw diagnostic content.");
  }
  await unavailablePage.screenshot({
    path: resolve(artifactDir, "environment-unavailable-light.png"),
    fullPage: true
  });
  await unavailablePage.getByTestId("recheck").click();
  await unavailablePage.getByTestId("environment-checking").waitFor();
  if (
    (await unavailablePage.getByText("未找到 Codex", { exact: true }).count()) !== 0
    || (await unavailablePage.getByText("Codex 暂时无法运行", { exact: true }).count()) !== 0
  ) {
    throw new Error("Checking must use a neutral state instead of a stale error card.");
  }
  await unavailablePage.waitForFunction(() => {
    const button = document.querySelector('[data-testid="primary-action"]');
    return button instanceof HTMLButtonElement && !button.disabled;
  });
  await unavailablePrimary.click();
  await unavailablePage.getByTestId("step-2").waitFor();
  checks.push("unavailable-codex-hard-gate-and-safe-recheck");
  await unavailableContext.close();

  const replayContext = await browser.newContext({
    viewport: { width: 1180, height: 760 },
    colorScheme: "dark"
  });
  const replayPage = await replayContext.newPage();
  watchExternalRequests(replayPage);
  await replayPage.goto(`${prototypeUrl}?mode=replay`);
  const replayBaseline = await readReplayFixture(replayPage);
  await replayPage.getByRole("button", { name: "重新查看引导" }).click();
  await replayPage.getByTestId("step-1").waitFor();
  await replayPage.getByText("回看引导", { exact: true }).waitFor();
  await replayPage.getByRole("button", { name: "退出引导回看" }).click();
  const replayAfterExit = await readReplayFixture(replayPage);
  if (JSON.stringify(replayAfterExit) !== JSON.stringify(replayBaseline)) {
    throw new Error("Exiting replay did not restore the deterministic main fixture.");
  }
  checks.push("replay-exit-restores-entry-fixture");

  await replayPage.getByRole("button", { name: "重新查看引导" }).click();
  await replayPage.getByTestId("primary-action").click();
  await replayPage.getByTestId("open-team-builder").click();
  await replayPage.getByTestId("builder-goal").fill(
    "帮我持续做产品发布，从资料研究、内容撰写到上线前复核。"
  );
  await replayPage.getByLabel("发送").click();
  await replayPage.getByTestId("team-proposal").waitFor();
  await replayPage.getByTestId("confirm-created-team").click();
  await replayPage.getByTestId("primary-action").click();
  await expectStableStep(replayPage, 3);
  await replayPage.getByTestId("primary-action").click();
  await expectStableStep(replayPage, 4);
  const replayFinishLabel = (
    await replayPage.getByTestId("primary-action").textContent()
  )?.trim();
  if (!replayFinishLabel?.includes("开始使用") || replayFinishLabel.includes("完成回看")) {
    throw new Error(`Replay step four used the wrong CTA: ${replayFinishLabel ?? ""}`);
  }
  await replayPage.getByTestId("primary-action").click();
  const replayAfterFinish = await readReplayFixture(replayPage);
  if (JSON.stringify(replayAfterFinish) !== JSON.stringify(replayBaseline)) {
    throw new Error("Finishing replay changed the entry project, conversation, draft, or team.");
  }
  checks.push("replay-start-using-restores-entry-fixture");
  await replayPage.screenshot({
    path: resolve(artifactDir, "replay-main-dark.png"),
    fullPage: true
  });
  await replayContext.close();

  const lowContext = await browser.newContext({
    viewport: { width: 1180, height: 560 },
    colorScheme: "dark",
    reducedMotion: "reduce"
  });
  const lowPage = await lowContext.newPage();
  watchExternalRequests(lowPage);
  await lowPage.goto(prototypeUrl);
  await lowPage.getByTestId("primary-action").click();
  await lowPage.getByTestId("primary-action").click();
  await expectStableStep(lowPage, 3);
  await lowPage
    .getByTestId("relay-stage")
    .getByText("收尾：统计口径已修正")
    .waitFor();
  await expectActionGeometry(lowPage, 780);
  const footerTopBeforeScroll = await lowPage
    .locator(".onboarding-footer")
    .evaluate((footer) => footer.getBoundingClientRect().top);
  await lowPage.locator(".onboarding-stage").evaluate((stage) => {
    stage.scrollTop = stage.scrollHeight;
  });
  const footerTopAfterScroll = await lowPage
    .locator(".onboarding-footer")
    .evaluate((footer) => footer.getBoundingClientRect().top);
  if (Math.abs(footerTopBeforeScroll - footerTopAfterScroll) > 0.5) {
    throw new Error("Onboarding footer moved while the low-window stage scrolled.");
  }
  checks.push("low-window-fixed-action-footer");
  await lowPage.screenshot({
    path: resolve(artifactDir, "relay-dark-low.png"),
    fullPage: true
  });
  await lowContext.close();

  const reducedContext = await browser.newContext({
    viewport: { width: 520, height: 860 },
    colorScheme: "dark",
    reducedMotion: "reduce"
  });
  const reducedPage = await reducedContext.newPage();
  watchExternalRequests(reducedPage);
  await reducedPage.goto(prototypeUrl);
  await reducedPage.getByTestId("primary-action").click();
  await expectActionGeometry(reducedPage, null);
  checks.push("narrow-frame-and-footer-actions-remain-aligned");
  await reducedPage.getByTestId("open-team-builder").click();
  await reducedPage.getByTestId("builder-goal").fill(
    "帮我持续做产品发布，从资料研究、内容撰写到上线前复核。"
  );
  await reducedPage.getByLabel("发送").click();
  await reducedPage.getByTestId("team-proposal").waitFor();
  await reducedPage.waitForTimeout(250);
  await reducedPage.screenshot({
    path: resolve(artifactDir, "team-builder-proposal-reduced-narrow.png"),
    fullPage: true
  });
  await reducedPage.getByTestId("confirm-created-team").click();
  await reducedPage.getByTestId("primary-action").click();
  await reducedPage.getByTestId("step-3").waitFor();

  const reduceMatches = await reducedPage.evaluate(() =>
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
  if (!reduceMatches) {
    throw new Error("Reduced-motion verification context was not active.");
  }
  await reducedPage
    .getByTestId("relay-stage")
    .getByText("发布内容已完成并通过审校")
    .waitFor();
  const historyCount = await reducedPage.locator(".relay-history li").count();
  if (historyCount !== 7) {
    throw new Error(
      `Expected persistent relay history with 7 role beats, found ${historyCount} items.`
    );
  }
  checks.push("reduced-motion-equivalent-relay");
  await reducedPage.waitForTimeout(200);
  await reducedPage.screenshot({
    path: resolve(artifactDir, "relay-reduced-narrow.png"),
    fullPage: true
  });
  await reducedContext.close();
} finally {
  await browser.close();
}

if (externalRequests.size > 0) {
  throw new Error(
    `Prototype made external requests: ${[...externalRequests].join(", ")}`
  );
}

const evidence = {
  generatedAt: new Date().toISOString(),
  prototype: "docs/product/pages/onboarding.prototype.html",
  sha256: createHash("sha256").update(html).digest("hex"),
  bytes: Buffer.byteLength(html),
  checks,
  externalRequests: [],
  screenshots: [
    "team-builder-proposal-dark-wide.png",
    "relay-dark-wide.png",
    "conversation-dark-wide.png",
    "environment-missing-light.png",
    "environment-unavailable-light.png",
    "team-light-wide.png",
    "replay-main-dark.png",
    "relay-dark-low.png",
    "team-builder-proposal-reduced-narrow.png",
    "relay-reduced-narrow.png"
  ]
};

await writeFile(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`, "utf8");
process.stdout.write(`Verified onboarding prototype: ${evidencePath}\n`);
