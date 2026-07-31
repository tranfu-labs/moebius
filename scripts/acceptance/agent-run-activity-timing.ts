import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { _electron as electron } from "playwright";
import { createAcceptanceOutputDirectory } from "./temp-output.js";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const artifactDir = await createAcceptanceOutputDirectory("agent-run-activity-evidence");
const screenshotPath = path.join(artifactDir, "electron-wide-light.png");
const narrowScreenshotPath = path.join(artifactDir, "electron-narrow-dark-reduced.png");
const evidencePath = path.join(artifactDir, "evidence.json");
const dataRoot = await fs.mkdtemp(path.join(os.tmpdir(), "moebius-agent-run-activity-"));
const electronExecutable = path.join(
  projectRoot,
  "desktop",
  "node_modules",
  "electron",
  "dist",
  "Electron.app",
  "Contents",
  "MacOS",
  "Electron",
);

await fs.mkdir(artifactDir, { recursive: true });
await fs.writeFile(path.join(dataRoot, ".onboarding-completed"), `${new Date().toISOString()}\n`, "utf8");

const electronApp = await electron.launch({
  executablePath: electronExecutable,
  args: [path.join(projectRoot, "desktop")],
  env: {
    ...process.env,
    MOEBIUS_DATA_ROOT: dataRoot,
    ELECTRON_DISABLE_SECURITY_WARNINGS: "true",
  },
});

try {
  const page = await electronApp.firstWindow();
  await page.route("**/api/local-console/state*", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(buildState()),
    });
  });
  await page.reload();
  await page.getByText("Agent 工作状态验收", { exact: true }).click();

  try {
    await page.getByText("正在运行测试").waitFor();
  } catch (error) {
    const diagnostic = {
      url: page.url(),
      title: await page.title().catch(() => ""),
      body: (await page.locator("body").innerText().catch(() => "")).slice(0, 2_000),
    };
    process.stderr.write(`${JSON.stringify(diagnostic)}\n`);
    throw error;
  }
  await page.getByText("pnpm test").waitFor();
  await page.getByText("正在读取").waitFor();
  await page.getByText("耗时 02:18").waitFor();
  await page.getByLabel(/耗时 02:18，完成于/u).focus();

  const visibleText = await page.locator("body").innerText();
  const activityRows = await page.getByTestId("run-activity").count();
  const codexRun = page.getByText("正在运行测试").locator("xpath=ancestor::div[contains(@class,'max-w-')][1]");
  const kimiRun = page.getByText("正在读取").locator("xpath=ancestor::div[contains(@class,'max-w-')][1]");
  const codexOutputButtons = await codexRun.getByLabel("完整输出").count();
  const kimiOutputButtons = await kimiRun.getByLabel("完整输出").count();
  const stopButtons = await page.getByLabel(/^停下/u).count();
  const layout = await page.evaluate(() => ({
    width: window.innerWidth,
    scrollWidth: document.documentElement.scrollWidth,
    height: window.innerHeight,
    scrollHeight: document.documentElement.scrollHeight,
  }));

  if (activityRows !== 2) throw new Error(`Expected two current activity rows, received ${String(activityRows)}`);
  if (codexOutputButtons !== 1) {
    throw new Error(`Expected one Codex output button, received ${String(codexOutputButtons)}`);
  }
  if (kimiOutputButtons !== 1) {
    throw new Error(`Expected one Kimi output button, received ${String(kimiOutputButtons)}`);
  }
  if (stopButtons !== 2) throw new Error(`Expected one stop target per active Agent, received ${String(stopButtons)}`);
  if (visibleText.includes("%")) throw new Error("The Agent activity surface must not show a percentage");
  if (layout.scrollWidth > layout.width) {
    throw new Error(`Desktop renderer overflowed horizontally: ${String(layout.scrollWidth)} > ${String(layout.width)}`);
  }

  await page.screenshot({ path: screenshotPath, fullPage: true });
  await page.emulateMedia({ colorScheme: "dark", reducedMotion: "reduce" });
  await electronApp.evaluate(({ BrowserWindow }) => {
    BrowserWindow.getAllWindows()[0]?.setSize(900, 560);
  });
  await page.waitForTimeout(100);
  const narrowLayout = await page.evaluate(() => ({
    width: window.innerWidth,
    scrollWidth: document.documentElement.scrollWidth,
    height: window.innerHeight,
    scrollHeight: document.documentElement.scrollHeight,
  }));
  if (narrowLayout.scrollWidth > narrowLayout.width) {
    throw new Error(
      `Narrow desktop renderer overflowed horizontally: ${String(narrowLayout.scrollWidth)} > ${String(narrowLayout.width)}`,
    );
  }
  await page.screenshot({ path: narrowScreenshotPath, fullPage: true });
  const evidence = {
    ok: true,
    source: "real Electron BrowserWindow with intercepted local-console state",
    assertions: {
      currentActivityRows: activityRows,
      codexOutputButtons,
      kimiOutputButtons,
      stopTargets: stopButtons,
      noPercentage: true,
      noHorizontalOverflow: true,
      narrowDarkReducedMotion: true,
      terminalDuration: "耗时 02:18",
      completionTimeAccessible: true,
      kimiOutputAvailable: true,
    },
    layout,
    narrowLayout,
    artifacts: {
      screenshot: screenshotPath,
      narrowScreenshot: narrowScreenshotPath,
    },
    evidencePath,
  };
  await fs.writeFile(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`, "utf8");
  process.stdout.write(`${JSON.stringify(evidence)}\n`);
} finally {
  await electronApp.close().catch(() => undefined);
  await fs.rm(dataRoot, { recursive: true, force: true });
}

function buildState() {
  const now = new Date();
  const completedAt = new Date(now.getTime() - 60_000).toISOString();
  const session = {
    sessionId: "session-main",
    projectId: "local",
    parentSessionId: null,
    title: "Agent 工作状态验收",
    status: "running",
    awaitsHumanReason: null,
    unreadSince: null,
    runningCount: 2,
    waitingCount: 0,
    stuckCount: 0,
    errorCount: 0,
    interruptedCount: 0,
    childCount: 0,
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
  };
  const project = {
    projectId: "local",
    sourceType: "local-folder",
    title: "moebius",
    folderPath: projectRoot,
    worktreeMode: true,
    workspaceCwd: projectRoot,
    workspaceMode: "direct",
    worktreePath: null,
    worktreeUnavailableReason: null,
    workspaceUpdatedAt: now.toISOString(),
    sessions: [session],
    runningCount: 2,
    waitingCount: 0,
    stuckCount: 0,
    errorCount: 0,
  };
  const activeRuns = [
    {
      sessionId: session.sessionId,
      runId: "run-codex",
      role: "implementation-lead",
      status: "running",
      createdAt: now.toISOString(),
      startedAt: now.toISOString(),
      elapsedMs: 84_000,
      stepId: "message:1",
      attempt: 1,
      engine: "codex",
      processOutputAvailable: true,
      activity: {
        cursor: 4,
        source: "tool",
        action: "正在运行测试",
        object: "pnpm test",
        occurredAt: now.toISOString(),
      },
      runDir: "/tmp/moebius-run-codex",
      cwd: projectRoot,
      workspaceMode: "direct",
      worktreeUnavailableReason: null,
      branchName: null,
      baseRef: null,
      stdoutTail: null,
      stderrTail: null,
      liveMarkdown: null,
      lastOutputSummary: null,
      tailDiagnostic: null,
      interruptible: true,
    },
    {
      sessionId: session.sessionId,
      runId: "run-kimi",
      role: "functional-qa",
      status: "running",
      createdAt: now.toISOString(),
      startedAt: now.toISOString(),
      elapsedMs: 3_724_000,
      stepId: "message:2",
      attempt: 1,
      engine: "kimi",
      processOutputAvailable: false,
      activity: {
        cursor: 2,
        source: "tool",
        action: "正在读取",
        object: "runtime.ts",
        occurredAt: now.toISOString(),
      },
      runDir: "/tmp/moebius-run-kimi",
      cwd: projectRoot,
      workspaceMode: "direct",
      worktreeUnavailableReason: null,
      branchName: null,
      baseRef: null,
      stdoutTail: null,
      stderrTail: null,
      liveMarkdown: null,
      lastOutputSummary: null,
      tailDiagnostic: null,
      interruptible: true,
    },
  ];
  return {
    projects: [project],
    project,
    selectedProjectId: project.projectId,
    selectedSessionId: session.sessionId,
    selectedSession: session,
    messages: [
      {
        id: 1,
        sessionId: session.sessionId,
        speaker: "user",
        role: null,
        body: "让两名成员分别实现和验收 Agent 工作状态。",
        status: "displayed",
        runId: null,
        runDir: null,
        error: null,
        systemEventKind: "other",
        failureCount: 0,
        lastFailureReason: null,
        createdAt: now.toISOString(),
        updatedAt: now.toISOString(),
      },
      {
        id: 2,
        sessionId: session.sessionId,
        speaker: "agent",
        role: "product-delivery-lead",
        body: "实现已完成，交给验收。",
        status: "completed",
        runId: "run-completed",
        runDir: "/tmp/moebius-run-completed",
        error: null,
        systemEventKind: "other",
        failureCount: 0,
        lastFailureReason: null,
        runTiming: {
          stepId: "message:1",
          attempt: 1,
          createdAt: now.toISOString(),
          startedAt: now.toISOString(),
          elapsedMs: 138_000,
          completedAt,
          status: "completed",
          engine: "codex",
          processOutputAvailable: true,
        },
        createdAt: now.toISOString(),
        updatedAt: now.toISOString(),
      },
    ],
    activeRuns,
    activeRun: activeRuns[0],
    sqlitePath: "/tmp/moebius-agent-run-activity.sqlite",
    lastError: null,
  };
}
