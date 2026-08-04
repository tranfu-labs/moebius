import fs from "node:fs/promises";
import { spawn, type ChildProcess } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  _electron as electron,
  chromium,
  type Browser,
  type ElectronApplication,
  type Locator,
  type Page,
} from "playwright";

import { waitForValue } from "../../src/testing/wait.js";
import { createAcceptanceOutputDirectory } from "./temp-output.js";

interface SessionSummary {
  sessionId: string;
  title: string;
  unresolvedSystemEventKind?: string | null;
  unreadSince: string | null;
  runningCount: number;
}

interface ConsoleState {
  projects: Array<{
    projectId: string;
    title: string;
    sessions: SessionSummary[];
  }>;
  activeRuns?: Array<{
    sessionId: string;
    runId: string;
    activity?: { action?: string; object?: string } | null;
    liveMarkdown?: string | null;
    lastOutputSummary?: string | null;
  }>;
  pendingPrimaryMessages?: Array<{ body: string }>;
}

interface GeometryEvidence {
  sidebar: Box;
  sidebarWindowControls: Box;
  brand: Box;
  navigationRow: Box;
  projectRow: Box;
  sessionRow: Box;
  mainWindowControls: Box;
  titleHeader: Box;
  title: Box;
  composer: Box;
  pending: Box;
  activeRun: Box;
  userAvatar: Box;
  userMessageContainer: Box;
  userBubble: Box;
  agentAvatar: Box;
  agentBody: Box;
  textarea: Box;
  attachmentButton: Box;
  sendButton: Box;
  stopButton: Box;
  timelineScrollbarWidth: number;
  viewport: { width: number; height: number; scrollWidth: number; scrollHeight: number };
  styles: {
    sidebarBackground: string;
    mainBackground: string;
    sidebarBorderRight: string;
    timelineOverflowX: string;
    timelineOverflowY: string;
    projectListOverflowY: string;
    titlePosition: string;
    sidebarBoxShadow: string;
    composerBoxShadow: string;
    composerBackgroundImage: string;
  };
}

interface DynamicDockEvidence {
  timeline: Box;
  composerDock: Box;
  composer: Box;
  activeRun: Box;
  jumpToBottom: Box;
  textarea: Box;
  timelinePaddingBottom: number;
}

interface ShortWindowEvidence {
  viewport: { width: number; height: number; scrollWidth: number; scrollHeight: number };
  sidebar: Box;
  footer: Box;
  projectList: {
    clientHeight: number;
    scrollHeight: number;
    scrollTop: number;
  };
}

interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface IconMetric {
  host: Box;
  icon: Box;
  centerDeltaX: number;
  centerDeltaY: number;
  strokeWidth: string;
}

interface SelectionGeometryEvidence {
  selected: Box;
  unselected: Box;
  xDelta: number;
  widthDelta: number;
  markerElementCount: number;
  markerTextCount: number;
}

interface TimelineResizeGeometry {
  viewport: { width: number; height: number; scrollWidth: number };
  resizeAnchoring: boolean;
  readingAnchorMessageId: string | null;
  currentRelayMessageId: string | null;
  latestRelayMessageId: string | null;
  jumpToBottomVisible: boolean;
  pane: Box;
  timeline: Box & {
    scrollTop: number;
    scrollHeight: number;
    clientHeight: number;
    bottomDistance: number;
  };
  list: Box;
  rows: Array<{ index: number; messageId: string | null; box: Box }>;
  activeRuns: Box[];
  resultCard: Box | null;
  anchorOffset: number | null;
}

interface TimelineResizeStageEvidence {
  stage: "running" | "terminal";
  middleAnchorMessageId: string;
  middleAnchorOffset: number;
  middle: TimelineResizeGeometry[];
  bottom: TimelineResizeGeometry[];
}

interface TimelineNoInputScrollEvidence {
  afterScroll: TimelineResizeGeometry;
  afterResize: TimelineResizeGeometry;
  afterConversationSwitch: TimelineResizeGeometry[];
}

interface TimelineHeightOnlyResizeEvidence {
  baseline: TimelineResizeGeometry;
  compact: TimelineResizeGeometry;
  compactAfterScroll: TimelineResizeGeometry;
  restored: TimelineResizeGeometry;
  afterStream: TimelineResizeGeometry;
  afterWidthResize: TimelineResizeGeometry;
}

const TIMELINE_FOLLOW_THRESHOLD_PX = 48;
const TIMELINE_RESIZE_WIDTHS = [
  1_180,
  1_050,
  920,
  800,
  700,
  800,
  920,
  1_050,
  1_180,
  1_050,
  920,
  800,
  700,
  800,
  920,
  1_050,
  1_180,
] as const;

const args = process.argv.slice(2);
const hold = args.includes("--hold");
if (args.some((argument) => argument !== "--hold")) {
  throw new Error("Usage: pnpm exec tsx scripts/acceptance/console-dashboard-ui.ts [--hold]");
}

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const desktopRoot = path.join(projectRoot, "desktop");
const outputRoot = await createAcceptanceOutputDirectory("console-dashboard-ui");
const runtimeRoot = await fs.mkdtemp(path.join(os.tmpdir(), "moebius-dashboard-runtime-"));
const fileReferenceRoot = await fs.mkdtemp(path.join("/tmp", "moebius-file-reference-acceptance-"));
const fixtureProjectRoot = path.join(runtimeRoot, "fixture-project");
const secondaryProjectRoot = path.join(runtimeRoot, "secondary-project");
const shortWindowProjectRoots = Array.from(
  { length: 15 },
  (_, index) => path.join(runtimeRoot, `short-window-project-${String(index + 1).padStart(2, "0")}`),
);
const fakeBin = path.join(runtimeRoot, "bin");
const attachmentPath = path.join(runtimeRoot, "dashboard-evidence.txt");
const reportPath = path.join(fileReferenceRoot, "report.txt");
const binaryPath = path.join(fileReferenceRoot, "binary.dat");
const longLinePath = path.join(fileReferenceRoot, "long-line.txt");
const activitySummary = `正在核对 ${reportPath} runId=run-live direct handoff`;
const resizeReleasePath = path.join(runtimeRoot, "release-resize-run");
const resizeStreamReleasePath = path.join(runtimeRoot, "release-resize-height-stream");
const resizeImagePath = path.join(projectRoot, "assets", "brand", "generated", "ui-icon-64.png");
const evidencePath = path.join(outputRoot, "console-dashboard-evidence.json");
const referenceScreenshot = path.join(outputRoot, "dashboard-reference.png");
const wideScreenshot = path.join(outputRoot, "dashboard-wide.png");
const narrowScreenshot = path.join(outputRoot, "dashboard-narrow.png");
const rightSidebarScreenshot = path.join(outputRoot, "dashboard-right-sidebar.png");

await Promise.all([
  fs.mkdir(fixtureProjectRoot, { recursive: true }),
  fs.mkdir(secondaryProjectRoot, { recursive: true }),
  fs.mkdir(fakeBin, { recursive: true }),
  fs.writeFile(reportPath, "第一行\n真实 Electron 目标行\n第三行\n", "utf8"),
  fs.writeFile(binaryPath, Buffer.from([0x4d, 0x6f, 0x65, 0x62, 0x69, 0x75, 0x73, 0x00, 0x73, 0x65, 0x63, 0x72, 0x65, 0x74])),
  fs.writeFile(longLinePath, `${"x".repeat(300 * 1024)}\n`, "utf8"),
  ...shortWindowProjectRoots.map((projectPath) => fs.mkdir(projectPath, { recursive: true })),
]);
await fs.writeFile(path.join(fixtureProjectRoot, "README.md"), "dashboard acceptance baseline\n", "utf8");
await runProcess("git", ["init", fixtureProjectRoot]);
await runProcess("git", ["-C", fixtureProjectRoot, "add", "README.md"]);
await runProcess("git", [
  "-C",
  fixtureProjectRoot,
  "-c",
  "user.name=Moebius Acceptance",
  "-c",
  "user.email=acceptance@moebius.invalid",
  "commit",
  "-m",
  "acceptance baseline",
]);
await fs.writeFile(path.join(runtimeRoot, ".onboarding-completed"), `${new Date().toISOString()}\n`, "utf8");
await fs.writeFile(
  attachmentPath,
  "Dashboard acceptance attachment created in the system temporary directory.\n",
  "utf8",
);
await fs.writeFile(path.join(fakeBin, "codex"), fakeCodexSource({
  reportPath,
  binaryPath,
  longLinePath,
  activitySummary,
  resizeReleasePath,
  resizeStreamReleasePath,
}), { mode: 0o755 });

let application: ElectronApplication | null = null;
let referenceBrowser: Browser | null = null;
let cleanupPromise: Promise<void> | null = null;
let holdInterrupted = false;
const cleanup = (): Promise<void> => {
  cleanupPromise ??= (async () => {
    if (application !== null) {
      const currentApplication = application;
      application = null;
      const electronProcess = currentApplication.process();
      await Promise.race([
        currentApplication.close().catch(() => undefined),
        new Promise<void>((resolve) => setTimeout(resolve, 2_000)),
      ]);
      if (!await waitForChildExit(electronProcess, 2_000) && electronProcess.exitCode === null) {
        electronProcess.kill("SIGKILL");
        await waitForChildExit(electronProcess, 5_000);
      }
    }
    if (referenceBrowser !== null) {
      await referenceBrowser.close().catch(() => undefined);
      referenceBrowser = null;
    }
    await fs.rm(runtimeRoot, {
      recursive: true,
      force: true,
      maxRetries: 8,
      retryDelay: 100,
    });
    await fs.rm(fileReferenceRoot, {
      recursive: true,
      force: true,
      maxRetries: 8,
      retryDelay: 100,
    });
  })();
  return cleanupPromise;
};

try {
  referenceBrowser = await chromium.launch({ headless: true });
  const referencePage = await referenceBrowser.newPage({ viewport: { width: 1_400, height: 900 } });
  const referenceEvidence = await collectReferenceEvidence(referencePage);
  await referencePage.screenshot({ path: referenceScreenshot, fullPage: true });
  await referenceBrowser.close();
  referenceBrowser = null;

  application = await electron.launch({
    args: [desktopRoot],
    cwd: desktopRoot,
    env: {
      ...process.env,
      MOEBIUS_DATA_ROOT: runtimeRoot,
      PATH: `${fakeBin}${path.delimiter}${process.env.PATH ?? ""}`,
      ELECTRON_DISABLE_SECURITY_WARNINGS: "true",
    },
  });
  const page = await application.firstWindow();
  await page.waitForLoadState("domcontentloaded");
  await page.getByRole("button", { name: "设置" }).waitFor({ timeout: 20_000 });
  await setWindowSize(application, 1_400, 900);

  const apiBase = await waitForApiBase(page);
  const initialState = await requestJson<ConsoleState>(apiBase, "/api/local-console/state");
  const primaryProject = initialState.projects[0]
    ?? await createProject(apiBase, fixtureProjectRoot);
  await updateProject(apiBase, primaryProject.projectId, {
    folderPath: fixtureProjectRoot,
    title: "moebius-dashboard",
  });
  const secondaryProject = await createProject(apiBase, secondaryProjectRoot);
  await updateProject(apiBase, secondaryProject.projectId, { title: "dashboard-secondary" });
  await createSession(apiBase, {
    projectId: secondaryProject.projectId,
    title: "折叠项目占位会话",
  });
  for (const [index, projectPath] of shortWindowProjectRoots.entries()) {
    const shortProject = await createProject(apiBase, projectPath);
    await updateProject(apiBase, shortProject.projectId, {
      title: `短窗项目 ${String(index + 1).padStart(2, "0")}`,
    });
  }

  const failed = await createSession(apiBase, {
    projectId: primaryProject.projectId,
    initialMessage: "FAIL dashboard 红点验收",
  });
  await waitForState(apiBase, (state) => {
    const session = findSession(state, failed.sessionId);
    return session?.unresolvedSystemEventKind != null && session.runningCount === 0;
  });

  await page.reload();
  await selectSession(page, failed.sessionId);

  const success = await createSession(apiBase, {
    projectId: primaryProject.projectId,
    initialMessage: "SUCCESS dashboard 蓝点与长消息验收",
  });
  await waitForState(apiBase, (state) => {
    const session = findSession(state, success.sessionId);
    return session?.unreadSince != null && session.runningCount === 0;
  });

  const resize = await createSession(apiBase, {
    projectId: primaryProject.projectId,
    agentTeamId: "development",
    initialMessage: "RESIZE-HISTORY-1 长中文与列表验收",
  });
  await waitForSessionMessage(apiBase, resize.sessionId, "RESIZE_REPLY_1");
  for (const round of [2, 3]) {
    const previousCount = await sessionMessageCount(apiBase, resize.sessionId);
    await postSessionMessage(
      apiBase,
      resize.sessionId,
      `RESIZE-HISTORY-${String(round)} ${Array.from(
        { length: 12 },
        (_, index) => `第 ${String(index + 1)} 段长中文用于窗口缩放重排`,
      ).join("；")}`,
    );
    await waitForSessionMessageCount(apiBase, resize.sessionId, previousCount + 2);
  }

  await selectSession(page, resize.sessionId);
  const imagePreviousCount = await sessionMessageCount(apiBase, resize.sessionId);
  const resizeComposer = page.getByRole("textbox", { name: "消息内容" });
  await resizeComposer.fill("RESIZE-HISTORY-IMAGE 图片附件高度验收");
  await page.getByTestId("main-role-composer").locator("input[type='file']").setInputFiles(resizeImagePath);
  await page.getByRole("article", { name: /ui-icon-64\.png/u }).waitFor();
  await page.getByRole("button", { name: "发送消息" }).click();
  await waitForSessionMessageCount(apiBase, resize.sessionId, imagePreviousCount + 2);

  await postSessionMessage(apiBase, resize.sessionId, "@dev RESIZE-LIVE 保持运行态进行双向缩放");
  await waitForState(apiBase, (state) => findSession(state, resize.sessionId)?.runningCount === 1);
  await selectSession(page, resize.sessionId);
  await page.getByTestId("active-run-block").waitFor();
  const runningResizeEvidence = await exerciseTimelineResizeStage(
    application,
    page,
    "running",
  );
  const heightOnlyResizeEvidence = await exerciseTimelineHeightOnlyResize(
    application,
    page,
    resizeStreamReleasePath,
  );

  await fs.writeFile(resizeReleasePath, "release\n", "utf8");
  await waitForSessionMessage(apiBase, resize.sessionId, "RESIZE_REPLY_TERMINAL");
  await waitForState(apiBase, (state) => findSession(state, resize.sessionId)?.runningCount === 0);
  const terminalPreviousCount = await sessionMessageCount(apiBase, resize.sessionId);
  await postSessionMessage(apiBase, resize.sessionId, "RESIZE-TERMINAL-CLOSEOUT 展示最终结果卡片");
  await waitForSessionMessageCount(apiBase, resize.sessionId, terminalPreviousCount + 2);
  await selectSession(page, resize.sessionId);
  await page.getByTestId("conversation-result-card").waitFor();
  const terminalResizeEvidence = await exerciseTimelineResizeStage(
    application,
    page,
    "terminal",
  );
  const resizeSwitchTarget = await createSession(apiBase, {
    projectId: primaryProject.projectId,
    initialMessage: "RESIZE-SWITCH-TARGET 切换对话后复测",
  });
  await waitForSessionMessage(apiBase, resizeSwitchTarget.sessionId, "fixture completed");
  await waitForState(apiBase, (state) => {
    const session = findSession(state, resizeSwitchTarget.sessionId);
    return session?.runningCount === 0;
  });
  const noInputScrollEvidence = await exerciseTimelineNoInputScrollAfterResize(
    application,
    page,
    resizeSwitchTarget.sessionId,
    resize.sessionId,
  );
  await page.screenshot({ path: path.join(outputRoot, "dashboard-timeline-resize-terminal.png") });

  await setWindowSize(application, 1_400, 900);

  const live = await createSession(apiBase, {
    projectId: primaryProject.projectId,
    initialMessage: [
      "LIVE dashboard 活动记录与待发射验收",
      ...Array.from(
        { length: 30 },
        (_, index) => `真实长时间线复现段落 ${String(index + 1)}：检查底部滚动边界。`,
      ),
    ].join("\n"),
  });
  await waitForState(apiBase, (state) => {
    const session = findSession(state, live.sessionId);
    return session?.runningCount === 1;
  });

  const statusEvidence = await observeStatusDots(page, {
    failed: failed.sessionId,
    success: success.sessionId,
    live: live.sessionId,
  });

  await selectSession(page, success.sessionId);
  const agentMessage = page.locator("[data-testid^='timeline-message-']").last();
  await agentMessage.waitFor();
  const agentAvatar = agentMessage.locator(".h-6.w-6").first();
  const agentBody = agentMessage.locator(".max-w-\\[68ch\\].pl-8").first();
  await agentBody.waitFor();
  const agentGeometry = {
    avatar: await box(agentAvatar),
    body: await box(agentBody),
  };

  await selectSession(page, live.sessionId);
  await page.getByTestId("active-run-block").waitFor();
  await page.getByText("正在核对 dashboard", { exact: true }).waitFor();
  const selectionGeometry = await observeProductionSelectionGeometry(page, live.sessionId, success.sessionId);
  const activeRun = page.getByTestId("active-run-block");
  await activeRun.waitFor();
  await activeRun.getByText("正在核对 dashboard", { exact: true }).waitFor();
  await prepareComposerStates(page, attachmentPath);
  await collapseSecondaryProject(page);

  const wideGeometry = await collectWideGeometry(page, agentGeometry);
  assertWideGeometry(wideGeometry);
  const productionIconEvidence = await collectProductionIconEvidence(page);
  assertProductionIconEvidence(productionIconEvidence);
  await page.screenshot({ path: wideScreenshot, fullPage: true });

  await setWindowSize(application, 900, 620);
  const narrowGeometry = await collectNarrowGeometry(page);
  assertNarrowGeometry(narrowGeometry);
  const dynamicDockGeometry = await collectDynamicDockGeometry(page);
  assertDynamicDockGeometry(dynamicDockGeometry);
  await page.screenshot({ path: narrowScreenshot, fullPage: true });

  await setWindowSize(application, 900, 480);
  const shortWindowGeometry = await collectShortWindowGeometry(page);
  assertShortWindowGeometry(shortWindowGeometry);

  await setWindowSize(application, 1_400, 900);
  const mainStopEvidence = await exerciseMainStop(page);
  const outputButton = page.getByRole("button", { name: "完整输出" }).last();
  await outputButton.waitFor();
  await outputButton.click();
  const rightSidebar = page.getByTestId("right-sidebar");
  await rightSidebar.waitFor();
  const processTab = page.getByTestId("process-tab");
  await processTab.waitFor();
  const rightSidebarEvidence = {
    box: await box(rightSidebar),
    processTabVisible: await processTab.isVisible(),
    mainVariantCount: await rightSidebar.locator("[data-testid='main-role-composer']").count(),
    rootOverflow: await viewportGeometry(page),
  };
  assert(rightSidebarEvidence.processTabVisible, "process tab did not open in the real right sidebar");
  assert(rightSidebarEvidence.mainVariantCount === 0, "main composer variant leaked into the right sidebar");
  assert(
    rightSidebarEvidence.rootOverflow.scrollWidth <= rightSidebarEvidence.rootOverflow.width,
    "right-sidebar layout introduced root horizontal overflow",
  );
  await page.screenshot({ path: rightSidebarScreenshot, fullPage: true });

  await selectSession(page, success.sessionId);
  const exposedSentence = "Send a direct message before handoff.";
  await page.getByText(exposedSentence, { exact: true }).waitFor();
  const exposedMachineTextEvidence = {
    sentence: await page.getByText(exposedSentence, { exact: true }).textContent(),
    hiddenPlaceholderCount: await page.getByText(/\[(?:路径|机器信息|内部标识|工作区类型)已隐藏\]/u).count(),
  };
  assert(
    exposedMachineTextEvidence.sentence === exposedSentence,
    "ordinary direct/handoff sentence was not preserved exactly",
  );
  assert(
    exposedMachineTextEvidence.hiddenPlaceholderCount === 0,
    "machine-text placeholder remained in the real timeline",
  );

  const timeline = page.getByRole("region", { name: "会话时间线" });
  const standaloneRootText = timeline.getByText("单独斜杠 / 保持普通文本。", { exact: true });
  const separatorRootText = timeline.getByText("表达式 A / B 保持普通文本。", { exact: true });
  await standaloneRootText.waitFor();
  await separatorRootText.waitFor();
  const inlineRootCode = timeline.locator("code").filter({ hasText: /^\/$/u });
  await inlineRootCode.waitFor();
  const rootBoundaryEvidence = {
    standaloneText: await standaloneRootText.textContent(),
    separatorText: await separatorRootText.textContent(),
    inlineCodeText: await inlineRootCode.textContent(),
    rootButtonCount: await timeline.getByRole("button", { name: "/", exact: true }).count(),
    explicitRootButtonCount: await timeline.getByRole("button", { name: "根目标", exact: true }).count(),
    fileTabCountBeforeValidReference: await page.getByTestId("file-reference-tab").count(),
  };
  assert(rootBoundaryEvidence.rootButtonCount === 0, "root slash became a file-reference button");
  assert(rootBoundaryEvidence.explicitRootButtonCount === 0, "explicit Markdown root target became a file-reference button");
  assert(rootBoundaryEvidence.inlineCodeText === "/", "inline root code did not preserve its code text");
  assert(
    rootBoundaryEvidence.fileTabCountBeforeValidReference === 0,
    "a root-only target opened a file-reference tab",
  );

  const tmpReference = timeline.getByRole("button", { name: "/tmp", exact: true });
  await tmpReference.waitFor();
  await tmpReference.click();
  const tmpTab = page.getByTestId("file-reference-tab");
  await tmpTab.waitFor();
  const tmpReason = tmpTab.getByText("这个引用没有指向普通文件。", { exact: true });
  await tmpReason.waitFor();
  const tmpDirectoryEvidence = {
    visibleReference: await tmpReference.textContent(),
    canonicalPath: await tmpTab.getByTestId("file-reference-path").textContent(),
    reason: await tmpReason.textContent(),
    targetLineCount: await tmpTab.getByTestId("file-reference-target-line").count(),
  };
  assert(tmpDirectoryEvidence.visibleReference === "/tmp", "/tmp was not preserved as a file reference");
  assert(tmpDirectoryEvidence.targetLineCount === 0, "/tmp directory rendered file content");

  const reportReference = timeline.getByRole("button", { name: `${reportPath}:2:3`, exact: true });
  await reportReference.waitFor();
  await reportReference.click();
  const reportTab = page.getByTestId("file-reference-tab");
  await reportTab.waitFor();
  const reportTargetLine = reportTab.getByTestId("file-reference-target-line");
  await reportTargetLine.waitFor();
  const reportTargetLocation = reportTab.getByText("目标位置：第 2 行，第 3 列", { exact: true });
  await reportTargetLocation.waitFor();
  const reportCanonicalPath = await reportTab.getByTestId("file-reference-path").textContent();
  const reportReferenceEvidence = {
    visibleReference: await reportReference.textContent(),
    canonicalPath: reportCanonicalPath,
    targetLocation: await reportTargetLocation.textContent(),
    targetLineNumber: await reportTargetLine.getAttribute("data-target-line"),
    targetLineText: await reportTargetLine.textContent(),
  };
  assert(
    reportReferenceEvidence.visibleReference === `${reportPath}:2:3`,
    "bare absolute path was not shown unchanged in the timeline",
  );
  assert(
    reportReferenceEvidence.canonicalPath === await fs.realpath(reportPath),
    "right sidebar did not show the canonical path for the /tmp file",
  );
  assert(
    reportReferenceEvidence.targetLineNumber === "true"
      && reportReferenceEvidence.targetLineText?.includes("真实 Electron 目标行") === true,
    "right sidebar did not highlight line 2 from the /tmp text file",
  );

  const binaryReference = page.getByRole("button", { name: binaryPath, exact: true });
  await binaryReference.click();
  const binaryReason = page.getByText("这个文件不是可显示的 UTF-8 文本。", { exact: true });
  await binaryReason.waitFor();
  const binaryGuardEvidence = {
    reason: await binaryReason.textContent(),
    targetLineCount: await page.getByTestId("file-reference-target-line").count(),
    leakedContentCount: await page.getByText(/Moebius.*secret/u).count(),
  };
  assert(binaryGuardEvidence.targetLineCount === 0, "binary file rendered a target line");
  assert(binaryGuardEvidence.leakedContentCount === 0, "binary file content leaked into the sidebar");

  const longLineReference = page.getByRole("button", { name: longLinePath, exact: true });
  await longLineReference.click();
  const longLineReason = page.getByText("目标附近存在过长单行，无法安全显示。", { exact: true });
  await longLineReason.waitFor();
  const longLineGuardEvidence = {
    reason: await longLineReason.textContent(),
    targetLineCount: await page.getByTestId("file-reference-target-line").count(),
  };
  assert(longLineGuardEvidence.targetLineCount === 0, "overlong line rendered file content");

  const summaryLive = await createSession(apiBase, {
    projectId: primaryProject.projectId,
    initialMessage: "SUMMARY dashboard 机器信息活动摘要验收",
  });
  await waitForState(apiBase, (state) => findSession(state, summaryLive.sessionId)?.runningCount === 1);
  await selectSession(page, summaryLive.sessionId);
  const summaryRunBlock = page.getByTestId("active-run-block");
  await summaryRunBlock.waitFor();
  await new Promise((resolve) => setTimeout(resolve, 2_000));
  const summaryRunText = await summaryRunBlock.textContent();
  assert(
    summaryRunText?.includes(activitySummary) === true,
    `active-run block did not contain the expected summary: ${JSON.stringify(summaryRunText)}`,
  );
  const activitySummaryOutput = summaryRunBlock.locator("[data-testid='run-live-output']");
  await activitySummaryOutput.waitFor();
  const activitySummaryEvidence = {
    visibleText: await activitySummaryOutput.textContent(),
    progressFallbackCount: await page.getByText("正在推进这一步…", { exact: true }).count(),
  };
  assert(
    activitySummaryEvidence.visibleText === activitySummary,
    "active-run summary did not preserve the absolute path and internal identifiers",
  );
  assert(
    activitySummaryEvidence.progressFallbackCount === 0,
    "non-blank active-run summary fell back to generic progress copy",
  );
  const summaryStopEvidence = await exerciseMainStop(page);

  const blankLive = await createSession(apiBase, {
    projectId: primaryProject.projectId,
    initialMessage: "BLANK dashboard 空白活动摘要验收",
  });
  await waitForState(apiBase, (state) => findSession(state, blankLive.sessionId)?.runningCount === 1);
  await page.evaluate((sessionId) => {
    const target = window as typeof window & { __moebiusAcceptanceFetch?: typeof window.fetch };
    target.__moebiusAcceptanceFetch = window.fetch;
    const originalFetch = window.fetch.bind(window);
    window.fetch = async (...fetchArgs) => {
      const response = await originalFetch(...fetchArgs);
      const requestUrl = new URL(
        typeof fetchArgs[0] === "string"
          ? fetchArgs[0]
          : fetchArgs[0] instanceof URL
            ? fetchArgs[0].href
            : fetchArgs[0].url,
        window.location.href,
      );
      if (requestUrl.pathname !== "/api/local-console/state" || !response.ok) return response;
      const state = await response.clone().json() as ConsoleState;
      for (const run of state.activeRuns ?? []) {
        if (run.sessionId === sessionId) {
          run.activity = null;
          run.liveMarkdown = null;
          run.lastOutputSummary = "   ";
        }
      }
      return new Response(JSON.stringify(state), {
        status: response.status,
        statusText: response.statusText,
        headers: response.headers,
      });
    };
  }, blankLive.sessionId);
  await selectSession(page, blankLive.sessionId);
  await page.getByTestId("active-run-block").waitFor();
  const blankFallback = page.getByText("正在推进这一步…", { exact: true });
  await blankFallback.waitFor();
  const blankSummaryEvidence = {
    fallback: await blankFallback.textContent(),
    activeRunCount: await page.getByTestId("active-run-block").count(),
  };
  assert(
    blankSummaryEvidence.fallback === "正在推进这一步…",
    "blank active-run summary did not use the generic progress fallback",
  );
  const blankStopEvidence = await exerciseMainStop(page);
  await page.evaluate(() => {
    const target = window as typeof window & { __moebiusAcceptanceFetch?: typeof window.fetch };
    if (target.__moebiusAcceptanceFetch !== undefined) {
      window.fetch = target.__moebiusAcceptanceFetch;
      delete target.__moebiusAcceptanceFetch;
    }
  });

  const evidence = {
    ok: true,
    generatedAt: new Date().toISOString(),
    source: "real Electron + production preload/local-console/renderer + temporary fake Codex",
    runtime: {
      dataRoot: runtimeRoot,
      apiBase,
      projectId: primaryProject.projectId,
      sessions: {
        failed: failed.sessionId,
        success: success.sessionId,
        live: live.sessionId,
        summaryLive: summaryLive.sessionId,
        blankLive: blankLive.sessionId,
      },
    },
    acceptance: {
      sidebarBaseline: {
        passed: true,
        statusDots: statusEvidence,
        selectionGeometry,
        collapsedSecondaryProject: true,
        geometry: {
          sidebar: wideGeometry.sidebar,
          windowControls: wideGeometry.sidebarWindowControls,
          brand: wideGeometry.brand,
          navigationRow: wideGeometry.navigationRow,
          projectRow: wideGeometry.projectRow,
          sessionRow: wideGeometry.sessionRow,
        },
      },
      mainConversationAxis: {
        passed: true,
        wide: {
          title: wideGeometry.title,
          composer: wideGeometry.composer,
          pending: wideGeometry.pending,
          activeRun: wideGeometry.activeRun,
          timelineScrollbarWidth: wideGeometry.timelineScrollbarWidth,
        },
        narrow: narrowGeometry,
      },
      messageHierarchy: {
        passed: true,
        userAvatar: wideGeometry.userAvatar,
        userMessageContainer: wideGeometry.userMessageContainer,
        userBubble: wideGeometry.userBubble,
        agentAvatar: wideGeometry.agentAvatar,
        agentBody: wideGeometry.agentBody,
      },
      composerBehavior: {
        passed: true,
        textarea: wideGeometry.textarea,
        attachmentButton: wideGeometry.attachmentButton,
        sendButton: wideGeometry.sendButton,
        stopButton: wideGeometry.stopButton,
        mentionCompletionObserved: true,
        pendingMessageObserved: true,
        attachmentObserved: "dashboard-evidence.txt",
        dynamicDock: dynamicDockGeometry,
        mainStop: mainStopEvidence,
      },
      iconAlignment: {
        passed: true,
        reference: referenceEvidence,
        production: productionIconEvidence,
        visualObservation: {
          reference: "1400×900 参考页中，图标与所在文字行基线自然，相邻项目操作与 Composer 操作视觉重量一致。",
          electron: "1400×900 真实 Electron 中，项目 disclosure/操作、会话菜单与 Composer 操作视觉重量一致，未见单枚图标上下漂移。",
        },
      },
      shortWindowBehavior: {
        passed: true,
        geometry: shortWindowGeometry,
      },
      excludedRightSidebar: {
        passed: true,
        ...rightSidebarEvidence,
      },
      localFileReferences: {
        passed: true,
        exposedMachineText: exposedMachineTextEvidence,
        rootBoundary: rootBoundaryEvidence,
        tmpDirectory: tmpDirectoryEvidence,
        report: reportReferenceEvidence,
        binaryGuard: binaryGuardEvidence,
        longLineGuard: longLineGuardEvidence,
      },
      activeRunMachineText: {
        passed: true,
        nonBlank: activitySummaryEvidence,
        nonBlankStop: summaryStopEvidence,
        blank: blankSummaryEvidence,
        blankStop: blankStopEvidence,
      },
      timelineResize: {
        passed: true,
        sessionId: resize.sessionId,
        running: runningResizeEvidence,
        heightOnly: heightOnlyResizeEvidence,
        terminal: terminalResizeEvidence,
        noInputScroll: noInputScrollEvidence,
      },
    },
    styles: wideGeometry.styles,
    artifacts: {
      evidence: evidencePath,
      referenceScreenshot,
      wideScreenshot,
      narrowScreenshot,
      rightSidebarScreenshot,
    },
    hold,
  };
  await fs.writeFile(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`, "utf8");
  process.stdout.write(`${JSON.stringify({
    ok: true,
    evidence: evidencePath,
    screenshots: [referenceScreenshot, wideScreenshot, narrowScreenshot, rightSidebarScreenshot],
    hold,
  })}\n`);

  if (hold) {
    const interrupt = waitForInterrupt();
    process.stdout.write("Electron acceptance fixture is ready. Press Ctrl+C to close it.\n");
    await interrupt;
    holdInterrupted = true;
  }
} finally {
  await cleanup();
}
if (holdInterrupted) process.exit(0);

async function collectReferenceEvidence(page: Page): Promise<{
  icons: Record<string, IconMetric>;
  selection: SelectionGeometryEvidence;
  interactions: {
    projectActionsVisibleOnHover: boolean;
    projectActionFocused: boolean;
  };
}> {
  const referencePath = path.join(
    projectRoot,
    "packages",
    "console-ui",
    "design-refs",
    "dashboard.html",
  );
  await page.goto(pathToFileURL(referencePath).href);
  await page.evaluate(async () => document.fonts.ready);

  const projectRow = page.locator("#project-a-row");
  const projectRowContainer = projectRow.locator("xpath=..");
  await projectRow.hover();
  const projectNew = page.locator("[data-od-id='project-a-new']");
  const projectMore = projectRowContainer.locator(".row-actions .icon-btn").last();
  const projectActionsVisibleOnHover = await projectNew.isVisible() && await projectMore.isVisible();
  await projectMore.focus();
  const projectActionFocused = await projectMore.evaluate((element) => element === document.activeElement);

  const icons = {
    sidebarClose: await iconMetric(page.locator("[data-od-id='close-sidebar']")),
    navigation: await iconMetric(page.locator("[data-od-id='nav-new-conversation']")),
    projectDisclosure: await iconMetric(projectRow, projectRow.locator(":scope > .icon.chev")),
    projectNew: await iconMetric(projectNew),
    projectMore: await iconMetric(projectMore),
    mainRightToggle: await iconMetric(page.locator("[data-od-id='toggle-rbar']")),
    messageTool: await iconMetric(page.locator(".msg-tools .icon-btn").first()),
    subSession: await iconMetric(
      page.locator(".subcard-row").first(),
      page.locator(".subcard-row > .icon").first(),
    ),
    systemFact: await iconMetric(
      page.locator(".sys-rec").first(),
      page.locator(".sys-rec > .icon").first(),
    ),
    result: await iconMetric(
      page.locator(".result-card").first(),
      page.locator(".result-card > .icon").first(),
    ),
    context: await iconMetric(
      page.locator(".chip-project").first(),
      page.locator(".chip-project > .icon").first(),
    ),
    attachment: await iconMetric(page.locator("footer.composer [data-od-id='attach']")),
    send: await iconMetric(page.locator("footer.composer [data-od-id='send']")),
  };

  const selectedTitle = page.locator("#conv-landing .name");
  const selected = await box(selectedTitle);
  await page.locator("#conv-copy").click();
  const unselected = await box(selectedTitle);
  const markerElementCount = await page.locator(".sel-mark").count();
  const markerTextCount = await page.locator(".conv-row").evaluateAll((rows) =>
    rows.filter((row) => /»|>>/u.test(row.textContent ?? "")).length);
  const selection = selectionEvidence(selected, unselected, markerElementCount, markerTextCount);

  assert(projectActionsVisibleOnHover, "reference project actions were not visible on hover");
  assert(projectActionFocused, "reference project action did not accept keyboard focus");
  assertIconMetric(icons.sidebarClose, { host: 28, icon: 16 }, "reference sidebar close");
  assertIconMetric(icons.navigation, { hostHeight: 34, icon: 16 }, "reference navigation");
  assertIconMetric(icons.projectDisclosure, { hostHeight: 32, icon: 14 }, "reference project disclosure");
  assertIconMetric(icons.projectNew, { host: 28, icon: 14 }, "reference project new");
  assertIconMetric(icons.projectMore, { host: 28, icon: 14 }, "reference project more");
  assertIconMetric(icons.mainRightToggle, { host: 28, icon: 16 }, "reference main right toggle");
  assertIconMetric(icons.messageTool, { host: 24, icon: 14 }, "reference message tool");
  assertIconMetric(icons.subSession, { icon: 14 }, "reference sub-session");
  assertIconMetric(icons.systemFact, { icon: 15 }, "reference system fact");
  assertIconMetric(icons.result, { icon: 15 }, "reference result");
  assertIconMetric(icons.context, { icon: 13 }, "reference context");
  assertIconMetric(icons.attachment, { host: 32, icon: 16 }, "reference attachment");
  assertIconMetric(icons.send, { host: 32, icon: 16 }, "reference send");
  assertSelectionEvidence(selection, "reference selection");

  return {
    icons,
    selection,
    interactions: {
      projectActionsVisibleOnHover,
      projectActionFocused,
    },
  };
}

async function observeProductionSelectionGeometry(
  page: Page,
  selectedSessionId: string,
  otherSessionId: string,
): Promise<SelectionGeometryEvidence> {
  await selectSession(page, selectedSessionId);
  const row = page.locator(
    `[data-testid='conversation-sidebar-session'][data-session-id="${selectedSessionId}"]`,
  );
  const title = row.getByTestId("conversation-sidebar-session-title");
  const selected = await box(title);
  await selectSession(page, otherSessionId);
  const unselected = await box(title);
  const markerElementCount = await page.locator(".sel-mark").count();
  const markerTextCount = await page.getByTestId("conversation-sidebar-session").evaluateAll((rows) =>
    rows.filter((item) => /»|>>/u.test(item.textContent ?? "")).length);
  const evidence = selectionEvidence(selected, unselected, markerElementCount, markerTextCount);
  assertSelectionEvidence(evidence, "production selection");
  await selectSession(page, selectedSessionId);
  return evidence;
}

async function collectProductionIconEvidence(page: Page): Promise<{
  icons: Record<string, IconMetric>;
  interactions: {
    projectActionsVisibleOnHover: boolean;
    projectActionFocused: boolean;
    sessionMenuVisibleOnHover: boolean;
    sessionMenuFocused: boolean;
  };
}> {
  await page.getByRole("navigation", { name: "项目列表" }).evaluate((element) => {
    element.scrollTop = 0;
  });
  const projectRow = page.getByTestId("conversation-sidebar-project").first();
  await projectRow.hover();
  const projectNew = projectRow.locator("[data-project-row-action='new-conversation']");
  const projectMenu = projectRow.locator("[data-project-row-action='project-menu']");
  const projectActionsVisibleOnHover = await projectNew.isVisible() && await projectMenu.isVisible();
  await projectMenu.focus();
  const projectActionFocused = await projectMenu.evaluate((element) => element === document.activeElement);
  const projectToggle = projectRow.getByTestId("conversation-sidebar-project-toggle");
  const projectIcons = {
    projectDisclosure: await iconMetric(projectRow, projectToggle.locator("svg").first()),
    projectNew: await iconMetric(projectNew),
    projectMore: await iconMetric(projectMenu),
  };

  const sessionContainer = page.getByTestId("conversation-sidebar-session-row").first();
  await sessionContainer.hover();
  const sessionMenu = sessionContainer.locator("button[aria-haspopup='menu']");
  const sessionMenuVisibleOnHover = await sessionMenu.isVisible();
  await sessionMenu.focus();
  const sessionMenuFocused = await sessionMenu.evaluate((element) => element === document.activeElement);

  const icons = {
    sidebarClose: await iconMetric(page.getByTestId("sidebar-window-controls").getByRole("button")),
    navigation: await iconMetric(page.getByTestId("sidebar-app-actions").getByRole("button").first()),
    ...projectIcons,
    sessionMore: await iconMetric(sessionMenu),
    mainRightToggle: await iconMetric(
      page.getByTestId("main-window-drag-region").getByRole("button", { name: "显示右侧栏" }),
    ),
    messageTool: await iconMetric(page.getByRole("button", { name: "完整输出" }).last()),
    attachment: await iconMetric(page.getByRole("button", { name: "添加附件" })),
    send: await iconMetric(page.getByRole("button", { name: "发送消息" })),
    mainStop: await iconMetric(page.getByRole("button", { name: "停下主理人" })),
  };

  assert(projectActionsVisibleOnHover, "production project actions were not visible on hover");
  assert(projectActionFocused, "production project menu did not accept keyboard focus");
  assert(sessionMenuVisibleOnHover, "production session menu was not visible on hover");
  assert(sessionMenuFocused, "production session menu did not accept keyboard focus");

  return {
    icons,
    interactions: {
      projectActionsVisibleOnHover,
      projectActionFocused,
      sessionMenuVisibleOnHover,
      sessionMenuFocused,
    },
  };
}

function assertProductionIconEvidence(value: Awaited<ReturnType<typeof collectProductionIconEvidence>>): void {
  assertIconMetric(value.icons.sidebarClose!, { host: 28, icon: 16 }, "production sidebar close");
  assertIconMetric(value.icons.navigation!, { hostHeight: 34, icon: 16 }, "production navigation");
  assertIconMetric(value.icons.projectDisclosure!, { hostHeight: 32, icon: 14 }, "production project disclosure");
  assertIconMetric(value.icons.projectNew!, { host: 28, icon: 14 }, "production project new");
  assertIconMetric(value.icons.projectMore!, { host: 28, icon: 14 }, "production project more");
  assertIconMetric(value.icons.sessionMore!, { host: 24, icon: 14 }, "production session more");
  assertIconMetric(value.icons.mainRightToggle!, { host: 28, icon: 16 }, "production main right toggle");
  assertIconMetric(value.icons.messageTool!, { host: 24, icon: 14 }, "production message tool");
  assertIconMetric(value.icons.attachment!, { host: 32, icon: 16 }, "production attachment");
  assertIconMetric(value.icons.send!, { host: 32, icon: 16 }, "production send");
  assertIconMetric(value.icons.mainStop!, { host: 32, icon: 16 }, "production main stop");
  assertClose(
    value.icons.projectNew!.icon.width,
    value.icons.projectDisclosure!.icon.width,
    0.5,
    "project disclosure/action visual weight",
  );
  assertClose(
    value.icons.sessionMore!.icon.width,
    value.icons.messageTool!.icon.width,
    0.5,
    "session/message action visual weight",
  );
}

async function exerciseMainStop(page: Page): Promise<{
  clicked: boolean;
  stopControlRemoved: boolean;
  activeRunCount: number;
}> {
  const stop = page.getByRole("button", { name: "停下主理人" });
  await stop.click();
  await page.waitForFunction(() =>
    document.querySelector("[aria-label='停下主理人']") === null, undefined, { timeout: 15_000 });
  const stopControlRemoved = await stop.count() === 0;
  const activeRunCount = await page.getByTestId("active-run-block").count();
  assert(stopControlRemoved, "main stop control remained after interrupt");
  return {
    clicked: true,
    stopControlRemoved,
    activeRunCount,
  };
}

async function iconMetric(host: Locator, icon = host.locator("svg").first()): Promise<IconMetric> {
  const hostBox = await box(host);
  const iconBox = await box(icon);
  const strokeWidth = await icon.evaluate((element) => getComputedStyle(element).strokeWidth);
  return {
    host: hostBox,
    icon: iconBox,
    centerDeltaX: iconBox.x + iconBox.width / 2 - (hostBox.x + hostBox.width / 2),
    centerDeltaY: iconBox.y + iconBox.height / 2 - (hostBox.y + hostBox.height / 2),
    strokeWidth,
  };
}

function selectionEvidence(
  selected: Box,
  unselected: Box,
  markerElementCount: number,
  markerTextCount: number,
): SelectionGeometryEvidence {
  return {
    selected,
    unselected,
    xDelta: selected.x - unselected.x,
    widthDelta: selected.width - unselected.width,
    markerElementCount,
    markerTextCount,
  };
}

function assertSelectionEvidence(value: SelectionGeometryEvidence, label: string): void {
  assertClose(value.xDelta, 0, 0.5, `${label} title x delta`);
  assertClose(value.widthDelta, 0, 0.5, `${label} title width delta`);
  assert(value.markerElementCount === 0, `${label} retained .sel-mark elements`);
  assert(value.markerTextCount === 0, `${label} retained visible » or >> text`);
}

function assertIconMetric(
  value: IconMetric,
  expected: { host?: number; hostHeight?: number; icon: number },
  label: string,
): void {
  if (expected.host !== undefined) {
    assertClose(value.host.width, expected.host, 0.5, `${label} host width`);
    assertClose(value.host.height, expected.host, 0.5, `${label} host height`);
  }
  if (expected.hostHeight !== undefined) {
    assertClose(value.host.height, expected.hostHeight, 0.5, `${label} host height`);
  }
  assertClose(value.icon.width, expected.icon, 0.5, `${label} icon width`);
  assertClose(value.icon.height, expected.icon, 0.5, `${label} icon height`);
  assertClose(value.centerDeltaY, 0, 0.5, `${label} vertical center`);
}

async function prepareComposerStates(page: Page, filePath: string): Promise<void> {
  const input = page.getByRole("textbox", { name: "消息内容" });
  await input.fill("这条消息先进入待发射区");
  await page.getByRole("button", { name: "发送消息" }).click();
  const pending = page.getByTestId("primary-pending-zone");
  await pending.getByText("这条消息先进入待发射区", { exact: true }).waitFor();

  await input.fill("@");
  const completions = page.getByRole("listbox", { name: "角色补全面板" });
  await completions.waitFor();
  assert(await completions.getByRole("option").count() > 0, "mention completion did not expose any team member");

  await input.fill(Array.from(
    { length: 20 },
    (_, index) => `第 ${String(index + 1)} 行用于验证 textarea 达到 120px 上限`,
  ).join("\n"));
  await page.getByTestId("main-role-composer").locator("input[type='file']").setInputFiles(filePath);
  await page.getByText("dashboard-evidence.txt", { exact: true }).waitFor();
  await page.getByRole("button", { name: "发送消息" }).waitFor();
  await page.getByRole("button", { name: "停下主理人" }).waitFor();
}

async function observeStatusDots(
  page: Page,
  sessions: { failed: string; success: string; live: string },
): Promise<Record<keyof typeof sessions, string | null>> {
  const observed = {
    failed: await waitForStatusDot(page, sessions.failed, "red"),
    success: await waitForStatusDot(page, sessions.success, "blue"),
    live: await waitForStatusDot(page, sessions.live, "blink"),
  };
  assert(observed.failed === "red", `expected failed red dot, received ${String(observed.failed)}`);
  assert(observed.success === "blue", `expected success blue dot, received ${String(observed.success)}`);
  assert(observed.live === "blink", `expected live blink dot, received ${String(observed.live)}`);
  return observed;
}

async function collectWideGeometry(
  page: Page,
  agent: { avatar: Box; body: Box },
): Promise<GeometryEvidence> {
  const sidebar = page.getByTestId("operator-sidebar");
  const main = page.getByTestId("operator-main");
  const timeline = page.getByRole("region", { name: "会话时间线" });
  const userMessage = page.locator("[data-testid^='timeline-message-']").first();
  const userAvatar = userMessage.locator(".h-6.w-6").first();
  const userBubble = userMessage.locator(".max-w-\\[75\\%\\]").first();
  const composer = page.getByTestId("main-role-composer");

  return {
    sidebar: await box(sidebar),
    sidebarWindowControls: await box(page.getByTestId("sidebar-window-controls")),
    brand: await box(page.getByTestId("sidebar-brand-region")),
    navigationRow: await box(page.getByTestId("sidebar-app-actions").getByRole("button").first()),
    projectRow: await box(page.getByTestId("conversation-sidebar-project").first()),
    sessionRow: await box(page.locator(`[data-session-id]`).first()),
    mainWindowControls: await box(page.getByTestId("main-window-drag-region")),
    titleHeader: await box(page.getByTestId("conversation-title-header")),
    title: await box(page.getByTestId("conversation-title-header").locator("h1")),
    composer: await box(composer),
    pending: await box(page.getByTestId("primary-pending-zone")),
    activeRun: await box(page.getByTestId("active-run-block").first()),
    userAvatar: await box(userAvatar),
    userMessageContainer: await box(userBubble.locator("..")),
    userBubble: await box(userBubble),
    agentAvatar: agent.avatar,
    agentBody: agent.body,
    textarea: await box(page.getByRole("textbox", { name: "消息内容" })),
    attachmentButton: await box(page.getByRole("button", { name: "添加附件" })),
    sendButton: await box(page.getByRole("button", { name: "发送消息" })),
    stopButton: await box(page.getByRole("button", { name: "停下主理人" })),
    timelineScrollbarWidth: await timeline.evaluate((element) => element.offsetWidth - element.clientWidth),
    viewport: await viewportGeometry(page),
    styles: await page.evaluate(() => {
      const sidebar = document.querySelector<HTMLElement>("[data-testid='operator-sidebar']");
      const main = document.querySelector<HTMLElement>("[data-testid='operator-main']");
      const timeline = document.querySelector<HTMLElement>("[aria-label='会话时间线']");
      const projectList = document.querySelector<HTMLElement>(
        "[data-testid='operator-sidebar'] aside nav",
      );
      const title = document.querySelector<HTMLElement>("[data-testid='conversation-title-header']");
      const composer = document.querySelector<HTMLElement>(
        "[data-testid='main-role-composer'] [data-layout-variant='main']",
      );
      if (
        sidebar === null
        || main === null
        || timeline === null
        || projectList === null
        || title === null
        || composer === null
      ) {
        throw new Error(`dashboard geometry target is missing: ${JSON.stringify({
          sidebar: sidebar !== null,
          main: main !== null,
          timeline: timeline !== null,
          projectList: projectList !== null,
          title: title !== null,
          composer: composer !== null,
        })}`);
      }
      const sidebarStyle = getComputedStyle(sidebar);
      const mainStyle = getComputedStyle(main);
      const timelineStyle = getComputedStyle(timeline);
      const projectListStyle = getComputedStyle(projectList);
      const titleStyle = getComputedStyle(title);
      const composerStyle = getComputedStyle(composer);
      return {
        sidebarBackground: sidebarStyle.backgroundColor,
        mainBackground: mainStyle.backgroundColor,
        sidebarBorderRight: sidebarStyle.borderRightWidth,
        timelineOverflowX: timelineStyle.overflowX,
        timelineOverflowY: timelineStyle.overflowY,
        projectListOverflowY: projectListStyle.overflowY,
        titlePosition: titleStyle.position,
        sidebarBoxShadow: sidebarStyle.boxShadow,
        composerBoxShadow: composerStyle.boxShadow,
        composerBackgroundImage: composerStyle.backgroundImage,
      };
    }),
  };
}

async function collectNarrowGeometry(page: Page): Promise<{
  main: Box;
  title: Box;
  composer: Box;
  gutterLeft: number;
  gutterRight: number;
  timelineScrollbarWidth: number;
  viewport: { width: number; height: number; scrollWidth: number; scrollHeight: number };
}> {
  const main = await box(page.getByTestId("operator-main"));
  const title = await box(page.getByTestId("conversation-title-header").locator("h1"));
  const composer = await box(page.getByTestId("main-role-composer"));
  return {
    main,
    title,
    composer,
    gutterLeft: title.x - main.x,
    gutterRight: main.x + main.width - (title.x + title.width),
    timelineScrollbarWidth: await page.getByRole("region", { name: "会话时间线" })
      .evaluate((element) => element.offsetWidth - element.clientWidth),
    viewport: await viewportGeometry(page),
  };
}

function assertWideGeometry(value: GeometryEvidence): void {
  console.log(JSON.stringify({
    geometryDiagnostic: {
      userBubbleWidth: value.userBubble.width,
      titleWidth: value.title.width,
      userMessageContainerWidth: value.userMessageContainer.width,
    },
  }));
  assertClose(value.sidebar.width, 252, 1, "default sidebar width");
  assertClose(value.sidebarWindowControls.height, 46, 1, "sidebar window controls height");
  assertClose(value.brand.height, 34, 1, "brand row height");
  assertClose(value.navigationRow.height, 34, 1, "navigation row height");
  assertClose(value.projectRow.height, 32, 1, "project row height");
  assertClose(value.sessionRow.height, 32, 1, "session row height");
  assertClose(value.mainWindowControls.height, 46, 1, "main window controls height");
  assertClose(value.titleHeader.height, 46, 1, "sticky title height");
  assertClose(value.title.x, value.activeRun.x, 1, "wide title/message row left edge");
  assertClose(value.composer.x, value.pending.x, 1, "wide dock left edge");
  assertClose(value.composer.width, value.pending.width, 1, "wide dock width");
  assertClose(value.composer.width, value.activeRun.width, 1, "wide content axis width");
  assertClose(
    value.composer.x,
    value.activeRun.x + value.timelineScrollbarWidth / 2,
    1,
    "wide dock/timeline left edge",
  );
  assertClose(value.userAvatar.width, 24, 1, "user avatar width");
  assertClose(value.userAvatar.height, 24, 1, "user avatar height");
  assertClose(value.agentAvatar.width, 24, 1, "agent avatar width");
  assertClose(value.agentAvatar.height, 24, 1, "agent avatar height");
  assert(
    value.userBubble.width <= value.userMessageContainer.width * 0.75 + 1,
    "user bubble exceeded 75 percent",
  );
  assert(value.agentBody.width <= 68 * 14 + 1, "agent body exceeded its 68ch readable bound");
  assert(value.textarea.height >= 32 && value.textarea.height <= 120, "main textarea escaped 32–120px range");
  assertClose(value.attachmentButton.width, 32, 1, "attachment button width");
  assertClose(value.sendButton.width, 32, 1, "send button width");
  assertClose(value.stopButton.width, 32, 1, "stop button width");
  assert(value.viewport.scrollWidth <= value.viewport.width, "wide renderer overflowed horizontally");
  assert(value.styles.sidebarBackground === value.styles.mainBackground, "sidebar and main canvas differ");
  assert(value.styles.sidebarBorderRight === "1px", "sidebar divider is not 1px");
  assert(value.styles.timelineOverflowX === "hidden", "timeline is not horizontally contained");
  assert(value.styles.timelineOverflowY === "auto", "timeline is not the vertical scroll region");
  assert(value.styles.projectListOverflowY === "auto", "project list is not vertically scrollable");
  assert(value.styles.titlePosition === "sticky", "conversation title is not sticky");
  assert(value.styles.sidebarBoxShadow === "none", "sidebar gained a shadow");
  assert(value.styles.composerBoxShadow === "none", "composer gained a shadow");
  assert(value.styles.composerBackgroundImage === "none", "composer gained a gradient");
}

function assertNarrowGeometry(value: Awaited<ReturnType<typeof collectNarrowGeometry>>): void {
  assertClose(value.gutterLeft, 32, 1, "narrow left gutter");
  assertClose(
    value.gutterRight,
    32 + value.timelineScrollbarWidth,
    1,
    "narrow right gutter plus scrollbar",
  );
  assertClose(value.title.x, value.composer.x, 1, "narrow title/composer left edge");
  assertClose(
    value.title.width + value.timelineScrollbarWidth,
    value.composer.width,
    1,
    "narrow title/composer content width",
  );
  assert(value.viewport.scrollWidth <= value.viewport.width, "narrow renderer overflowed horizontally");
}

async function collectDynamicDockGeometry(page: Page): Promise<DynamicDockEvidence> {
  const timeline = page.getByRole("region", { name: "会话时间线" });
  await timeline.evaluate((element) => {
    element.scrollTop = element.scrollHeight;
    element.dispatchEvent(new Event("scroll", { bubbles: true }));
  });
  await page.waitForTimeout(100);

  const composerDock = page.getByTestId("conversation-bottom-dock");
  const composer = page.getByTestId("main-role-composer");
  const activeRun = page.getByTestId("active-run-block").last();
  const bottomState = {
    timeline: await box(timeline),
    composerDock: await box(composerDock),
    composer: await box(composer),
    activeRun: await box(activeRun),
    textarea: await box(page.getByRole("textbox", { name: "消息内容" })),
    timelinePaddingBottom: await timeline.evaluate((element) =>
      Number.parseFloat(getComputedStyle(element).paddingBottom)),
  };

  await timeline.evaluate((element) => {
    element.scrollTop = 0;
    element.dispatchEvent(new Event("scroll", { bubbles: true }));
  });
  const jumpToBottom = page.getByTestId("jump-to-bottom");
  await jumpToBottom.waitFor();
  const jumpBox = await box(jumpToBottom);
  await jumpToBottom.click();

  return {
    ...bottomState,
    jumpToBottom: jumpBox,
  };
}

function assertDynamicDockGeometry(value: DynamicDockEvidence): void {
  const dockTop = value.composerDock.y;
  assertClose(value.textarea.height, 120, 1, "maximum main textarea height");
  assert(value.composerDock.height >= 240, "dynamic composer fixture did not reach its tall state");
  assert(
    value.timelinePaddingBottom >= value.composerDock.height + 11,
    "timeline padding did not follow the measured composer dock",
  );
  assert(
    value.activeRun.y + value.activeRun.height <= dockTop + 1,
    "last timeline item is obscured by the composer dock",
  );
  assert(
    value.jumpToBottom.y + value.jumpToBottom.height <= dockTop - 11,
    "jump-to-bottom control overlaps the composer dock",
  );
  assert(
    value.composer.y > value.activeRun.y,
    "composer evidence resolved to the active RunBlock instead of the main composer",
  );
}

async function collectShortWindowGeometry(page: Page): Promise<ShortWindowEvidence> {
  const projectList = page.getByRole("navigation", { name: "项目列表" });
  await projectList.evaluate((element) => {
    element.scrollTop = element.scrollHeight;
    element.dispatchEvent(new Event("scroll", { bubbles: true }));
  });
  await page.waitForTimeout(50);
  return {
    viewport: await viewportGeometry(page),
    sidebar: await box(page.getByTestId("operator-sidebar")),
    footer: await box(page.getByTestId("sidebar-footer")),
    projectList: await projectList.evaluate((element) => ({
      clientHeight: element.clientHeight,
      scrollHeight: element.scrollHeight,
      scrollTop: element.scrollTop,
    })),
  };
}

function assertShortWindowGeometry(value: ShortWindowEvidence): void {
  assertClose(value.viewport.height, 480, 1, "minimum desktop viewport height");
  assert(
    value.viewport.scrollHeight <= value.viewport.height,
    "minimum-height window introduced root vertical scrolling",
  );
  assert(
    value.sidebar.y + value.sidebar.height <= value.viewport.height,
    "sidebar escaped the minimum-height viewport",
  );
  assert(
    value.footer.y + value.footer.height <= value.viewport.height,
    "sidebar footer is not reachable at the minimum window height",
  );
  assert(
    value.projectList.scrollHeight > value.projectList.clientHeight,
    "short-window fixture did not make the project list independently scrollable",
  );
  assert(value.projectList.scrollTop > 0, "project list did not scroll independently in the short window");
}

async function collapseSecondaryProject(page: Page): Promise<void> {
  const projectName = page.getByText("dashboard-secondary", { exact: true });
  await projectName.waitFor();
  await projectName.click();
  const row = projectName.locator("xpath=ancestor::*[@data-testid='conversation-sidebar-project'][1]");
  await row.getAttribute("data-project-id");
  await page.waitForFunction(() => {
    const names = [...document.querySelectorAll("[data-testid='conversation-sidebar-session']")]
      .map((element) => element.getAttribute("title"));
    return !names.includes("折叠项目占位会话");
  });
}

async function selectSession(page: Page, sessionId: string): Promise<void> {
  const row = page.locator(`[data-testid='conversation-sidebar-session'][data-session-id="${sessionId}"]`);
  await row.waitFor({ timeout: 15_000 });
  await row.click();
  await row.waitFor({ state: "visible" });
  await page.waitForFunction((id) => {
    const target = document.querySelector(
      `[data-testid='conversation-sidebar-session'][data-session-id="${String(id)}"]`,
    );
    return target?.getAttribute("aria-current") === "page";
  }, sessionId);
}

async function statusDot(page: Page, sessionId: string): Promise<string | null> {
  const row = page.locator(`[data-testid='conversation-sidebar-session'][data-session-id="${sessionId}"]`);
  await row.waitFor({ timeout: 15_000 });
  return row.getAttribute("data-status-dot");
}

async function waitForStatusDot(
  page: Page,
  sessionId: string,
  expected: "red" | "blue" | "blink",
): Promise<string | null> {
  await page.waitForFunction(({ id, value }) => {
    const row = document.querySelector(
      `[data-testid='conversation-sidebar-session'][data-session-id="${id}"]`,
    );
    return row?.getAttribute("data-status-dot") === value;
  }, { id: sessionId, value: expected }, { timeout: 15_000 });
  return statusDot(page, sessionId);
}

async function waitForApiBase(page: Page): Promise<string> {
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    const value = await page.evaluate(async () =>
      (window as typeof window & {
        moebius?: { getLocalConsoleUrl?: () => Promise<string | null> };
      }).moebius?.getLocalConsoleUrl?.() ?? null);
    if (value !== null) return value;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("desktop preload did not expose the local-console URL");
}

async function createProject(apiBase: string, folderPath: string): Promise<{
  projectId: string;
  title: string;
  sessions: SessionSummary[];
}> {
  return (await requestJson<{ project: {
    projectId: string;
    title: string;
    sessions: SessionSummary[];
  } }>(apiBase, "/api/local-console/projects", {
    method: "POST",
    body: JSON.stringify({ folderPath, worktreeMode: false }),
  }, 201)).project;
}

async function updateProject(
  apiBase: string,
  projectId: string,
  update: { folderPath?: string; title?: string },
): Promise<void> {
  if (update.folderPath !== undefined) {
    await requestJson(apiBase, `/api/local-console/projects/${encodeURIComponent(projectId)}`, {
      method: "PATCH",
      body: JSON.stringify({ folderPath: update.folderPath }),
    });
  }
  if (update.title !== undefined) {
    await requestJson(apiBase, `/api/local-console/projects/${encodeURIComponent(projectId)}`, {
      method: "PATCH",
      body: JSON.stringify({ title: update.title }),
    });
  }
}

async function createSession(
  apiBase: string,
  input: { projectId: string; agentTeamId?: string; title?: string; initialMessage?: string },
): Promise<{ sessionId: string }> {
  return (await requestJson<{ session: { sessionId: string } }>(
    apiBase,
    "/api/local-console/sessions",
    {
      method: "POST",
      body: JSON.stringify({
        projectId: input.projectId,
        workspaceMode: "direct",
        agentTeamOwnership: "system",
        agentTeamId: input.agentTeamId ?? "general-assistant",
        ...(input.title === undefined ? {} : { title: input.title }),
        ...(input.initialMessage === undefined ? {} : { initialMessage: input.initialMessage }),
      }),
    },
    201,
  )).session;
}

async function waitForState(
  apiBase: string,
  predicate: (state: ConsoleState) => boolean,
  timeoutMs = 20_000,
): Promise<ConsoleState> {
  const deadline = Date.now() + timeoutMs;
  let latest: ConsoleState | null = null;
  while (Date.now() < deadline) {
    latest = await requestJson<ConsoleState>(apiBase, "/api/local-console/state");
    if (predicate(latest)) return latest;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Timed out waiting for local-console state: ${JSON.stringify(latest)}`);
}

async function postSessionMessage(apiBase: string, sessionId: string, body: string): Promise<void> {
  await requestJson(
    apiBase,
    `/api/local-console/sessions/${encodeURIComponent(sessionId)}/messages`,
    {
      method: "POST",
      body: JSON.stringify({ body }),
    },
    202,
  );
}

async function waitForSessionMessage(
  apiBase: string,
  sessionId: string,
  expectedText: string,
): Promise<void> {
  let latestBodies: string[] = [];
  await waitForValue(async () => {
    latestBodies = await sessionMessageBodies(apiBase, sessionId);
    return latestBodies.some((body) => body.includes(expectedText)) ? true : undefined;
  }, {
    describe: `session ${sessionId} message containing ${expectedText}`,
    kind: "io",
    timeoutMs: 15_000,
    pollMs: 50,
    snapshot: () => ({ latestBodies: latestBodies.map((body) => body.slice(0, 120)) }),
  });
}

async function sessionMessageCount(apiBase: string, sessionId: string): Promise<number> {
  return (await sessionMessageBodies(apiBase, sessionId)).length;
}

async function waitForSessionMessageCount(
  apiBase: string,
  sessionId: string,
  expectedCount: number,
): Promise<void> {
  let latestBodies: string[] = [];
  await waitForValue(async () => {
    latestBodies = await sessionMessageBodies(apiBase, sessionId);
    return latestBodies.length >= expectedCount ? true : undefined;
  }, {
    describe: `session ${sessionId} to contain at least ${String(expectedCount)} messages`,
    kind: "io",
    timeoutMs: 15_000,
    pollMs: 50,
    snapshot: () => ({
      expectedCount,
      actualCount: latestBodies.length,
      latestBodies: latestBodies.slice(-3).map((body) => body.slice(0, 120)),
    }),
  });
}

async function sessionMessageBodies(apiBase: string, sessionId: string): Promise<string[]> {
  const value = await requestJson<{ messages: Array<{ body: string }> }>(
    apiBase,
    `/api/local-console/sessions/${encodeURIComponent(sessionId)}/view`,
  );
  return value.messages.map((message) => message.body);
}

function findSession(state: ConsoleState, sessionId: string): SessionSummary | undefined {
  return state.projects.flatMap((project) => project.sessions)
    .find((session) => session.sessionId === sessionId);
}

async function requestJson<T = unknown>(
  apiBase: string,
  pathname: string,
  init: RequestInit = {},
  expectedStatus = 200,
): Promise<T> {
  const response = await fetch(new URL(pathname, apiBase), {
    ...init,
    headers: {
      "content-type": "application/json",
      ...init.headers,
    },
  });
  if (response.status !== expectedStatus) {
    throw new Error(`${init.method ?? "GET"} ${pathname} failed: ${response.status} ${await response.text()}`);
  }
  return await response.json() as T;
}

async function setWindowSize(
  application: ElectronApplication,
  width: number,
  height: number,
): Promise<void> {
  await application.evaluate(({ BrowserWindow }, size) => {
    BrowserWindow.getAllWindows()[0]?.setSize(size.width, size.height);
  }, { width, height });
  await new Promise((resolve) => setTimeout(resolve, 150));
}

async function exerciseTimelineResizeStage(
  application: ElectronApplication,
  page: Page,
  stage: "running" | "terminal",
): Promise<TimelineResizeStageEvidence> {
  await setWindowSizeImmediate(application, 1_180, 820);
  await waitForTimelineLayoutSettled(page, 1_180, null, `${stage} wide baseline`);
  const timeline = page.getByRole("region", { name: "会话时间线" });
  await timeline.evaluate((element) => {
    element.dispatchEvent(new WheelEvent("wheel", { bubbles: true, deltaY: -1 }));
    element.scrollTop = Math.max(0, (element.scrollHeight - element.clientHeight) * 0.45);
    element.dispatchEvent(new Event("scroll", { bubbles: true }));
  });
  const middleBeforeAnchor = await waitForTimelineLayoutSettled(
    page,
    1_180,
    null,
    `${stage} middle before anchor`,
  );
  const anchor = await chooseTimelineAnchor(page, middleBeforeAnchor);
  const middleBaseline = await waitForTimelineLayoutSettled(
    page,
    1_180,
    anchor,
    `${stage} middle anchor baseline`,
  );
  if (middleBaseline.anchorOffset === null) {
    throw new Error(`${stage} timeline anchor ${anchor} was not mounted at baseline`);
  }
  const middleAnchorOffset = middleBaseline.anchorOffset;
  const middle: TimelineResizeGeometry[] = [];
  for (const width of TIMELINE_RESIZE_WIDTHS) {
    await setWindowSizeImmediate(application, width, 820);
    const geometry = await waitForTimelineLayoutSettled(
      page,
      width,
      anchor,
      `${stage} middle at ${String(width)}px`,
    );
    assertTimelineResizeGeometry(geometry, stage);
    assert(
      geometry.anchorOffset !== null
        && Math.abs(geometry.anchorOffset - middleAnchorOffset) <= 1,
      `${stage} middle anchor moved after resize to ${String(width)}px: ${JSON.stringify({
        expected: middleAnchorOffset,
        actual: geometry.anchorOffset,
        anchor,
        appAnchor: geometry.readingAnchorMessageId,
        scrollTop: geometry.timeline.scrollTop,
      })}`,
    );
    middle.push(geometry);
  }

  await timeline.evaluate((element) => {
    element.dispatchEvent(new WheelEvent("wheel", { bubbles: true, deltaY: 1 }));
    element.scrollTop = element.scrollHeight;
    element.dispatchEvent(new Event("scroll", { bubbles: true }));
  });
  await waitForTimelineLayoutSettled(page, 1_180, null, `${stage} bottom baseline`);
  const bottom: TimelineResizeGeometry[] = [];
  for (const width of TIMELINE_RESIZE_WIDTHS) {
    await setWindowSizeImmediate(application, width, 820);
    const geometry = await waitForTimelineLayoutSettled(
      page,
      width,
      null,
      `${stage} bottom at ${String(width)}px`,
    );
    assertTimelineResizeGeometry(geometry, stage);
    assert(
      geometry.timeline.bottomDistance <= 48,
      `${stage} timeline left the 48px bottom-follow threshold at ${String(width)}px: ${JSON.stringify(
        geometry.timeline,
      )}`,
    );
    bottom.push(geometry);
  }

  return {
    stage,
    middleAnchorMessageId: anchor,
    middleAnchorOffset,
    middle,
    bottom,
  };
}

async function exerciseTimelineHeightOnlyResize(
  application: ElectronApplication,
  page: Page,
  streamReleasePath: string,
): Promise<TimelineHeightOnlyResizeEvidence> {
  const timeline = page.getByRole("region", { name: "会话时间线" });
  await setWindowSizeImmediate(application, 1_180, 760);
  await timeline.evaluate((element) => {
    element.dispatchEvent(new WheelEvent("wheel", { bubbles: true, deltaY: 1 }));
    element.scrollTop = element.scrollHeight;
    element.dispatchEvent(new Event("scroll", { bubbles: true }));
  });
  const baseline = await waitForTimelineLayoutSettled(
    page,
    1_180,
    null,
    "height-only resize baseline at 1180x760",
  );
  assertTimelineResizeGeometry(baseline, "running");
  assertTimelineHeightOnlyBookkeeping(baseline, 760, "height-only resize baseline");

  await setWindowSizeImmediate(application, 1_180, 600);
  const compact = await waitForTimelineLayoutSettled(
    page,
    1_180,
    null,
    "height-only resize at 1180x600",
  );
  assertTimelineResizeGeometry(compact, "running");
  assertClose(compact.viewport.height, 600, 1, "height-only resize compact viewport height");
  assert(!compact.resizeAnchoring, "height-only resize compact state left resize anchoring armed");

  await timeline.evaluate((element) => {
    element.scrollTop = element.scrollHeight;
    element.dispatchEvent(new Event("scroll", { bubbles: true }));
  });
  const compactAfterScroll = await waitForTimelineLayoutSettled(
    page,
    1_180,
    null,
    "height-only resize compact state after no-input scroll",
  );
  assertTimelineResizeGeometry(compactAfterScroll, "running");
  assertTimelineHeightOnlyBookkeeping(
    compactAfterScroll,
    600,
    "height-only resize compact state after no-input scroll",
  );

  await setWindowSizeImmediate(application, 1_180, 760);
  const restored = await waitForTimelineLayoutSettled(
    page,
    1_180,
    null,
    "height-only resize restored at 1180x760",
  );
  assertTimelineResizeGeometry(restored, "running");
  assertTimelineHeightOnlyBookkeeping(restored, 760, "height-only resize restored state");

  await fs.writeFile(streamReleasePath, "stream\n", "utf8");
  await page.getByText("RESIZE_REPLY_HEIGHT_STREAM", { exact: false }).waitFor({ timeout: 15_000 });
  await page.getByTestId("active-run-block").waitFor();
  const afterStream = await waitForTimelineLayoutSettled(
    page,
    1_180,
    null,
    "height-only resize after streaming message",
  );
  assertTimelineResizeGeometry(afterStream, "running");
  assertTimelineHeightOnlyBookkeeping(
    afterStream,
    760,
    "height-only resize after streaming message",
  );

  await setWindowSizeImmediate(application, 1_000, 760);
  const afterWidthResize = await waitForTimelineLayoutSettled(
    page,
    1_000,
    null,
    "height-only resize followed by width resize",
  );
  assertTimelineResizeGeometry(afterWidthResize, "running");
  assertTimelineHeightOnlyBookkeeping(
    afterWidthResize,
    760,
    "height-only resize followed by width resize",
  );

  return { baseline, compact, compactAfterScroll, restored, afterStream, afterWidthResize };
}

function assertTimelineHeightOnlyBookkeeping(
  geometry: TimelineResizeGeometry,
  expectedHeight: number,
  description: string,
): void {
  assertClose(geometry.viewport.height, expectedHeight, 1, `${description} viewport height`);
  assert(!geometry.resizeAnchoring, `${description} left resize anchoring armed`);
  assert(
    geometry.readingAnchorMessageId === null,
    `${description} retained a middle-reading anchor: ${String(geometry.readingAnchorMessageId)}`,
  );
  assertTimelineBottomBookkeeping(geometry, description);
}

async function exerciseTimelineNoInputScrollAfterResize(
  application: ElectronApplication,
  page: Page,
  switchSessionId: string,
  resizeSessionId: string,
): Promise<TimelineNoInputScrollEvidence> {
  await setWindowSizeImmediate(application, 1_180, 820);
  await waitForTimelineLayoutSettled(page, 1_180, null, "no-input scroll wide baseline");
  const timeline = page.getByRole("region", { name: "会话时间线" });
  await timeline.evaluate((element) => {
    element.dispatchEvent(new WheelEvent("wheel", { bubbles: true, deltaY: -1 }));
    element.scrollTop = Math.max(0, (element.scrollHeight - element.clientHeight) * 0.45);
    element.dispatchEvent(new Event("scroll", { bubbles: true }));
  });
  await waitForTimelineLayoutSettled(page, 1_180, null, "no-input scroll middle baseline");
  for (const width of [1_000, 1_180]) {
    await setWindowSizeImmediate(application, width, 820);
    const geometry = await waitForTimelineLayoutSettled(
      page,
      width,
      null,
      `no-input scroll resize setup at ${String(width)}px`,
    );
    assertTimelineResizeGeometry(geometry, "terminal");
  }

  await timeline.evaluate((element) => {
    element.scrollTop = element.scrollHeight;
    element.dispatchEvent(new Event("scroll", { bubbles: true }));
  });
  const afterScroll = await waitForTimelineLayoutSettled(
    page,
    1_180,
    null,
    "no-input scroll at bottom",
  );
  assertTimelineResizeGeometry(afterScroll, "terminal");
  assertTimelineBottomBookkeeping(afterScroll, "no-input scroll at bottom");

  await setWindowSizeImmediate(application, 1_000, 820);
  const afterResize = await waitForTimelineLayoutSettled(
    page,
    1_000,
    null,
    "no-input scroll after another resize",
  );
  assertTimelineResizeGeometry(afterResize, "terminal");
  assertTimelineBottomBookkeeping(afterResize, "no-input scroll after another resize");

  await selectSession(page, switchSessionId);
  await selectSession(page, resizeSessionId);
  await page.getByTestId("conversation-result-card").waitFor();
  const expectedLatestRelayMessageId = afterResize.latestRelayMessageId;
  if (expectedLatestRelayMessageId === null) {
    throw new Error(`no-input scroll resize snapshot had no latest Relay message: ${JSON.stringify(afterResize)}`);
  }
  await waitForCurrentRelayMessage(page, expectedLatestRelayMessageId);
  const afterConversationSwitch: TimelineResizeGeometry[] = [];
  for (const width of [1_000, 700, 1_180]) {
    await setWindowSizeImmediate(application, width, 820);
    const geometry = await waitForTimelineLayoutSettled(
      page,
      width,
      null,
      `no-input scroll after conversation switch at ${String(width)}px`,
    );
    assertTimelineResizeGeometry(geometry, "terminal");
    assertTimelineBottomBookkeeping(
      geometry,
      `no-input scroll after conversation switch at ${String(width)}px`,
      expectedLatestRelayMessageId,
    );
    afterConversationSwitch.push(geometry);
  }

  return { afterScroll, afterResize, afterConversationSwitch };
}

async function waitForCurrentRelayMessage(page: Page, expectedMessageId: string): Promise<void> {
  let latestEventId: string | null = null;
  await waitForValue(async () => {
    latestEventId = await page.locator("[data-relay-event][aria-current='location']")
      .getAttribute("data-relay-event");
    return latestEventId === `message-${expectedMessageId}` ? true : undefined;
  }, {
    describe: `current Relay message ${expectedMessageId} after conversation switch`,
    kind: "io",
    timeoutMs: 10_000,
    pollMs: 16,
    snapshot: () => ({ expectedMessageId, latestEventId }),
  });
}

async function setWindowSizeImmediate(
  application: ElectronApplication,
  width: number,
  height: number,
): Promise<void> {
  await application.evaluate(({ BrowserWindow }, size) => {
    BrowserWindow.getAllWindows()[0]?.setSize(size.width, size.height);
  }, { width, height });
}

async function waitForTimelineLayoutSettled(
  page: Page,
  expectedWidth: number,
  anchorMessageId: string | null,
  description: string,
): Promise<TimelineResizeGeometry> {
  let latest: TimelineResizeGeometry | null = null;
  let latestError: string | null = null;
  let previous: TimelineResizeGeometry | null = null;
  let stableFrames = 0;
  return await waitForValue(async () => {
    latest = await collectTimelineResizeGeometry(page, anchorMessageId);
    latestError = null;
    if (Math.abs(latest.viewport.width - expectedWidth) > 1) {
      previous = latest;
      stableFrames = 0;
      return undefined;
    }
    if (latest.resizeAnchoring) {
      previous = latest;
      stableFrames = 0;
      return undefined;
    }
    if (previous !== null && timelineGeometryIsStable(previous, latest)) {
      stableFrames += 1;
    } else {
      stableFrames = 1;
    }
    previous = latest;
    return stableFrames >= 3 ? latest : undefined;
  }, {
    describe: `stable timeline layout for ${description}`,
    kind: "io",
    timeoutMs: 10_000,
    pollMs: 16,
    tick: async () => {
      await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => resolve())));
    },
    onError: (error) => {
      latestError = error instanceof Error ? error.message : String(error);
      return "retry";
    },
    snapshot: () => ({ latest, latestError }),
  });
}

async function collectTimelineResizeGeometry(
  page: Page,
  anchorMessageId: string | null,
): Promise<TimelineResizeGeometry> {
  return await page.evaluate((anchorId) => {
    const timeline = document.querySelector<HTMLElement>("[aria-label='会话时间线']");
    const pane = document.querySelector<HTMLElement>("[data-testid='parent-conversation-pane']");
    const list = document.querySelector<HTMLElement>("[data-testid='virtual-timeline-list']");
    if (timeline === null || pane === null || list === null) {
      throw new Error(`timeline resize target is missing: ${JSON.stringify({
        timeline: timeline !== null,
        pane: pane !== null,
        list: list !== null,
      })}`);
    }
    const paneRect = pane.getBoundingClientRect();
    const timelineRect = timeline.getBoundingClientRect();
    const listRect = list.getBoundingClientRect();
    const rows = [...list.querySelectorAll<HTMLElement>(":scope > [data-index]")]
      .map((element) => {
        const rect = element.getBoundingClientRect();
        return {
          index: Number(element.dataset.index),
          messageId: element.querySelector<HTMLElement>("[data-message-id]")?.dataset.messageId ?? null,
          box: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
        };
      })
      .sort((left, right) => left.index - right.index);
    const activeRuns = [...timeline.querySelectorAll<HTMLElement>("[data-testid='active-run-block']")]
      .map((element) => {
        const rect = element.getBoundingClientRect();
        return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
      });
    const resultElement = timeline.querySelector<HTMLElement>("[data-testid='conversation-result-card']");
    const resultRect = resultElement?.getBoundingClientRect() ?? null;
    const currentRelayEvent = document.querySelector<HTMLElement>(
      "[data-relay-event][aria-current='location']",
    )?.dataset.relayEvent ?? null;
    const relayMessageIds = [...document.querySelectorAll<HTMLElement>("[data-relay-event]")]
      .map((element) => element.dataset.relayEvent?.match(/^message-(\d+)$/)?.[1] ?? null)
      .filter((messageId): messageId is string => messageId !== null);
    const anchorElement = anchorId === null
      ? null
      : [...list.querySelectorAll<HTMLElement>("[data-message-id]")]
        .find((element) => element.dataset.messageId === anchorId) ?? null;
    const bottomDistance = timeline.scrollHeight - timeline.scrollTop - timeline.clientHeight;
    return {
      viewport: {
        width: window.innerWidth,
        height: window.innerHeight,
        scrollWidth: document.documentElement.scrollWidth,
      },
      resizeAnchoring: timeline.dataset.resizeAnchoring === "true",
      readingAnchorMessageId: timeline.dataset.readingAnchorMessageId ?? null,
      currentRelayMessageId: currentRelayEvent?.match(/^message-(\d+)$/)?.[1] ?? null,
      latestRelayMessageId: relayMessageIds.at(-1) ?? null,
      jumpToBottomVisible: timeline.querySelector("[data-testid='jump-to-bottom']") !== null,
      pane: { x: paneRect.x, y: paneRect.y, width: paneRect.width, height: paneRect.height },
      timeline: {
        x: timelineRect.x,
        y: timelineRect.y,
        width: timelineRect.width,
        height: timelineRect.height,
        scrollTop: timeline.scrollTop,
        scrollHeight: timeline.scrollHeight,
        clientHeight: timeline.clientHeight,
        bottomDistance,
      },
      list: { x: listRect.x, y: listRect.y, width: listRect.width, height: listRect.height },
      rows,
      activeRuns,
      resultCard: resultRect === null
        ? null
        : { x: resultRect.x, y: resultRect.y, width: resultRect.width, height: resultRect.height },
      anchorOffset: anchorElement === null
        ? null
        : anchorElement.getBoundingClientRect().top - timeline.getBoundingClientRect().top,
    };
  }, anchorMessageId);
}

async function chooseTimelineAnchor(page: Page, geometry: TimelineResizeGeometry): Promise<string> {
  const resizeAnchorMessageId = await page
    .getByRole("region", { name: "会话时间线" })
    .getAttribute("data-reading-anchor-message-id");
  if (
    resizeAnchorMessageId !== null
    && geometry.rows.some((row) => row.messageId === resizeAnchorMessageId)
  ) {
    return resizeAnchorMessageId;
  }
  const currentRelayEvent = await page
    .locator("[data-relay-event][aria-current='location']")
    .getAttribute("data-relay-event");
  const currentMessageId = currentRelayEvent?.match(/^message-(\d+)$/)?.[1];
  if (
    currentMessageId !== undefined
    && geometry.rows.some((row) => row.messageId === currentMessageId)
  ) {
    return currentMessageId;
  }
  const targetY = geometry.timeline.y + geometry.timeline.height / 2;
  const candidate = geometry.rows
    .filter((row) => row.messageId !== null)
    .sort((left, right) => (
      Math.abs(left.box.y + left.box.height / 2 - targetY)
      - Math.abs(right.box.y + right.box.height / 2 - targetY)
    ))[0];
  if (candidate?.messageId == null) {
    throw new Error(`timeline has no mounted message anchor: ${JSON.stringify(geometry)}`);
  }
  return candidate.messageId;
}

function timelineGeometryIsStable(
  previous: TimelineResizeGeometry,
  current: TimelineResizeGeometry,
): boolean {
  if (
    previous.resizeAnchoring !== current.resizeAnchoring
    || previous.readingAnchorMessageId !== current.readingAnchorMessageId
    || previous.currentRelayMessageId !== current.currentRelayMessageId
    || previous.latestRelayMessageId !== current.latestRelayMessageId
    || previous.jumpToBottomVisible !== current.jumpToBottomVisible
    || previous.rows.length !== current.rows.length
    || previous.activeRuns.length !== current.activeRuns.length
    || (previous.resultCard === null) !== (current.resultCard === null)
    || previous.rows.some((row, index) => (
      row.index !== current.rows[index]?.index
      || row.messageId !== current.rows[index]?.messageId
    ))
  ) {
    return false;
  }
  const previousNumbers = timelineGeometryNumbers(previous);
  const currentNumbers = timelineGeometryNumbers(current);
  return previousNumbers.length === currentNumbers.length
    && previousNumbers.every((value, index) => Math.abs(value - (currentNumbers[index] ?? value)) <= 0.5);
}

function timelineGeometryNumbers(geometry: TimelineResizeGeometry): number[] {
  const boxNumbers = (value: Box): number[] => [value.x, value.y, value.width, value.height];
  return [
    geometry.viewport.width,
    geometry.viewport.height,
    geometry.viewport.scrollWidth,
    ...boxNumbers(geometry.pane),
    ...boxNumbers(geometry.timeline),
    geometry.timeline.scrollTop,
    geometry.timeline.scrollHeight,
    geometry.timeline.clientHeight,
    geometry.timeline.bottomDistance,
    ...boxNumbers(geometry.list),
    ...geometry.rows.flatMap((row) => boxNumbers(row.box)),
    ...geometry.activeRuns.flatMap(boxNumbers),
    ...(geometry.resultCard === null ? [] : boxNumbers(geometry.resultCard)),
    ...(geometry.anchorOffset === null ? [] : [geometry.anchorOffset]),
  ];
}

function assertTimelineBottomBookkeeping(
  geometry: TimelineResizeGeometry,
  description: string,
  expectedLatestRelayMessageId = geometry.latestRelayMessageId,
): void {
  assert(
    geometry.timeline.bottomDistance <= TIMELINE_FOLLOW_THRESHOLD_PX,
    `${description} left the bottom-follow threshold: ${JSON.stringify(geometry.timeline)}`,
  );
  assert(!geometry.jumpToBottomVisible, `${description} kept the jump-to-bottom control visible`);
  assert(
    expectedLatestRelayMessageId !== null
      && geometry.currentRelayMessageId === expectedLatestRelayMessageId,
    `${description} did not persist the latest Relay reading position: ${JSON.stringify({
      current: geometry.currentRelayMessageId,
      latest: geometry.latestRelayMessageId,
      expected: expectedLatestRelayMessageId,
    })}`,
  );
}

function assertTimelineResizeGeometry(
  geometry: TimelineResizeGeometry,
  stage: "running" | "terminal",
): void {
  const listBottom = geometry.list.y + geometry.list.height;
  for (let index = 1; index < geometry.rows.length; index += 1) {
    const previous = geometry.rows[index - 1]!;
    const current = geometry.rows[index]!;
    assert(
      current.box.y >= previous.box.y + previous.box.height - 1,
      `${stage} timeline rows overlap: ${JSON.stringify({ previous, current })}`,
    );
  }
  for (const row of geometry.rows) {
    assert(
      row.box.y + row.box.height <= listBottom + 1,
      `${stage} timeline row escapes measured list: ${JSON.stringify({ row, list: geometry.list })}`,
    );
  }
  assert(
    geometry.viewport.scrollWidth <= geometry.viewport.width,
    `${stage} timeline introduced horizontal overflow: ${JSON.stringify(geometry.viewport)}`,
  );
  if (stage === "running") {
    assert(geometry.activeRuns.length > 0, "running resize stage has no active run block");
    assert(geometry.resultCard === null, "running resize stage unexpectedly shows the result card");
    assert(
      geometry.activeRuns[0]!.y >= listBottom - 1,
      `active run overlaps the virtual timeline list: ${JSON.stringify({
        activeRun: geometry.activeRuns[0],
        list: geometry.list,
      })}`,
    );
    for (let index = 1; index < geometry.activeRuns.length; index += 1) {
      const previous = geometry.activeRuns[index - 1]!;
      const current = geometry.activeRuns[index]!;
      assert(
        current.y >= previous.y + previous.height - 1,
        `active run blocks overlap: ${JSON.stringify({ previous, current })}`,
      );
    }
    return;
  }
  assert(geometry.activeRuns.length === 0, "terminal resize stage still shows an active run block");
  assert(geometry.resultCard !== null, "terminal resize stage has no result card");
  assert(
    geometry.resultCard.y >= listBottom - 1,
    `result card overlaps the virtual timeline list: ${JSON.stringify({
      resultCard: geometry.resultCard,
      list: geometry.list,
    })}`,
  );
}

async function box(locator: Locator): Promise<Box> {
  const value = await locator.boundingBox();
  if (value === null) throw new Error(`Element has no layout box: ${await locator.evaluate((element) => element.outerHTML)}`);
  return value;
}

async function viewportGeometry(page: Page): Promise<{
  width: number;
  height: number;
  scrollWidth: number;
  scrollHeight: number;
}> {
  return page.evaluate(() => ({
    width: window.innerWidth,
    height: window.innerHeight,
    scrollWidth: document.documentElement.scrollWidth,
    scrollHeight: document.documentElement.scrollHeight,
  }));
}

function assertClose(actual: number, expected: number, tolerance: number, label: string): void {
  assert(
    Math.abs(actual - expected) <= tolerance,
    `${label}: expected ${String(expected)}±${String(tolerance)}, received ${String(actual)}`,
  );
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

async function runProcess(command: string, args: string[]): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"] });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    child.stdout?.on("data", (chunk: Buffer) => stdout.push(chunk));
    child.stderr?.on("data", (chunk: Buffer) => stderr.push(chunk));
    child.once("error", reject);
    child.once("close", (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(
        `${command} ${args.join(" ")} exited ${String(code)}: `
        + `${Buffer.concat(stderr).toString("utf8")} ${Buffer.concat(stdout).toString("utf8")}`,
      ));
    });
  });
}

function waitForChildExit(child: ChildProcess, timeoutMs: number): Promise<boolean> {
  if (child.exitCode !== null || child.signalCode !== null) {
    return Promise.resolve(true);
  }
  return new Promise((resolve) => {
    const finish = (exited: boolean) => {
      clearTimeout(timer);
      child.off("exit", onExit);
      resolve(exited);
    };
    const onExit = () => finish(true);
    const timer = setTimeout(() => finish(false), timeoutMs);
    child.once("exit", onExit);
  });
}

function waitForInterrupt(): Promise<void> {
  return new Promise((resolve) => {
    let settled = false;
    const stdin = process.stdin;
    const rawMode = stdin.isTTY && typeof stdin.setRawMode === "function";
    const finish = () => {
      if (settled) return;
      settled = true;
      process.off("SIGINT", finish);
      process.off("SIGTERM", finish);
      stdin.off("data", onData);
      if (rawMode) {
        stdin.setRawMode(false);
        stdin.pause();
      }
      resolve();
    };
    const onData = (chunk: Buffer | string) => {
      const bytes = typeof chunk === "string" ? Buffer.from(chunk) : chunk;
      if (bytes.includes(3)) finish();
    };
    process.once("SIGINT", finish);
    process.once("SIGTERM", finish);
    if (rawMode) {
      stdin.setRawMode(true);
      stdin.resume();
      stdin.on("data", onData);
    }
  });
}

function fakeCodexSource(input: {
  reportPath: string;
  binaryPath: string;
  longLinePath: string;
  activitySummary: string;
  resizeReleasePath: string;
  resizeStreamReleasePath: string;
}): string {
  const reportReference = `${input.reportPath}:2:3`;
  return `#!/usr/bin/env node
const prompt = process.argv.at(-1) ?? "";
const emit = (event) => process.stdout.write(JSON.stringify(event) + "\\n");
const resumeIndex = process.argv.indexOf("resume");
const threadId = resumeIndex >= 0
  ? process.argv.at(-2)
  : "thread-dashboard-" + String(process.pid);

if (prompt.includes("SUMMARY dashboard")) {
  emit({
    type: "summary",
    summary: ${JSON.stringify(input.activitySummary)}
  });
  setInterval(() => {}, 1000);
  return;
}

if (prompt.includes("BLANK dashboard")) {
  setInterval(() => {}, 1000);
  return;
}

if (prompt.includes("RESIZE-HISTORY") && !prompt.includes("RESIZE-LIVE")) {
  const round = prompt.includes("RESIZE-HISTORY-IMAGE")
    ? "IMAGE"
    : prompt.match(/RESIZE-HISTORY-(\\d+)/)?.[1] ?? "UNKNOWN";
  emit({ type: "thread.started", thread_id: threadId });
  emit({
    type: "item.completed",
    item: {
      type: "agent_message",
      text: [
        "RESIZE_REPLY_" + round,
        "",
        "这是一段用于验证长会话在窄窗口重新换行的中文回复。",
        "",
        ...Array.from({ length: 14 }, (_, index) =>
          "- 第 " + String(index + 1) + " 项包含较长说明、内联代码和连续中文内容，宽度变化后必须重新测量真实高度。"
        )
      ].join("\\n")
    }
  });
  process.exit(0);
}

if (prompt.includes("RESIZE-LIVE")) {
  const { existsSync, writeFileSync } = require("node:fs");
  let heightStreamReleased = false;
  emit({ type: "thread.started", thread_id: threadId });
  emit({
    type: "item.started",
    item: { type: "command_execution", command: "timeline resize acceptance" }
  });
  emit({
    type: "item.completed",
    item: {
      type: "agent_message",
      text: [
        "RESIZE_REPLY_RUNNING",
        "",
        ...Array.from({ length: 16 }, (_, index) =>
          "- 运行态稳定输出 " + String(index + 1) + "：窗口缩放期间保持内容不再增长。"
        )
      ].join("\\n")
    }
  });
  const timer = setInterval(() => {
    if (!heightStreamReleased && existsSync(${JSON.stringify(input.resizeStreamReleasePath)})) {
      heightStreamReleased = true;
      emit({
        type: "item.completed",
        item: {
          type: "agent_message",
          text: [
            "RESIZE_REPLY_HEIGHT_STREAM",
            "",
            ...Array.from({ length: 8 }, (_, index) =>
              "- 纯高度缩放后的流式追加 " + String(index + 1) + "：仍需保持底部跟随和阅读簿记。"
            )
          ].join("\\n")
        }
      });
    }
    if (!existsSync(${JSON.stringify(input.resizeReleasePath)})) return;
    clearInterval(timer);
    writeFileSync("resize-result.txt", "timeline resize acceptance result\\n", "utf8");
    emit({
      type: "item.completed",
      item: {
        type: "agent_message",
        text: [
          "RESIZE_REPLY_TERMINAL",
          "",
          "运行态结束后，结果卡片必须位于完整最后回复之后。",
          "",
          ...Array.from({ length: 12 }, (_, index) =>
            "- 终态结果段落 " + String(index + 1) + " 保持真实高度和正确顺序。"
          )
        ].join("\\n")
      }
    });
    process.exit(0);
  }, 20);
  return;
}

emit({ type: "thread.started", thread_id: threadId });

if (prompt.includes("FAIL dashboard")) {
  process.stderr.write("deterministic dashboard failure\\n");
  process.exit(17);
}

if (prompt.includes("SUCCESS dashboard")) {
  setTimeout(() => {
    emit({
      type: "item.completed",
      item: {
        type: "agent_message",
        text: [
          "## Dashboard 对齐完成",
          "",
          "这是一段用于真实 Electron 验收的长回复。它验证 Agent 正文保持 32px 缩进和 68ch 可读宽度，同时保留 Markdown 与完整输出入口。",
          "",
          "- 标题、消息与 composer 共用内容轴",
          "- 窄窗口不产生根级横向滚动",
          "- 右侧栏继续使用 embedded 密度",
          "",
          "单独斜杠 / 保持普通文本。",
          "",
          "表达式 A / B 保持普通文本。",
          "",
          "inline code \`/\` 保持代码视觉。",
          "",
          "显式 [根目标](/) 不进入文件引用。",
          "",
          "目录目标 /tmp。",
          "",
          "产物位于 ${reportReference}。",
          "",
          "Send a direct message before handoff.",
          "",
          "二进制文件 ${input.binaryPath}。",
          "",
          "超长行文件 ${input.longLinePath}。"
        ].join("\\n")
      }
    });
    process.exit(0);
  }, 3000);
  return;
}

if (prompt.includes("LIVE dashboard")) {
  emit({
    type: "item.started",
    item: { type: "command_execution", command: "pnpm test --filter dashboard" }
  });
  setTimeout(() => emit({
    type: "item.completed",
    item: {
      type: "agent_message",
      text: [
        "## 正在核对 dashboard",
        "",
        "活动记录保持原地更新，等待用户继续输入。",
        "",
        ...Array.from({ length: 24 }, (_, index) =>
          "- 真实 Electron 长时间线检查 " + String(index + 1)
        )
      ].join("\\n")
    }
  }), 100);
  setInterval(() => {}, 1000);
  return;
}

emit({
  type: "item.completed",
  item: { type: "agent_message", text: "fixture completed" }
});
`;
}
