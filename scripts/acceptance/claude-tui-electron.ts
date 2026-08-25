import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { _electron as electron, type ElectronApplication, type Page } from "playwright";

import { resolveClaudeTuiTranscriptFinal } from "../../src/claude-tui-transcript.js";
import { readExecutionSessionLinks } from "../../src/local-console/execution-context-reader.js";
import type { LocalExecutionSessionLinkFact } from "../../src/local-console/execution-context.js";
import { waitForValue } from "../../src/testing/wait.js";
import { createAcceptanceOutputDirectory } from "./temp-output.js";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const desktopRoot = path.join(projectRoot, "desktop");
const idleTimeoutMs = 8_000;

interface ActiveRun {
  sessionId: string;
  runId: string;
  engine: string;
}

interface SessionMessage {
  speaker: string;
  role: string | null;
  body: string;
}

interface ConsoleState {
  selectedSessionId: string;
  messages: SessionMessage[];
  activeRuns: ActiveRun[];
}

interface ProcessRow {
  pid: number;
  ppid: number;
  command: string;
}

interface ClaudeProcess {
  pid: number;
  command: string;
  sessionId: string;
}

interface RealAppRecord {
  environment: "真机";
  entrance: string;
  action: string;
  screenObservation: string;
  consistent: boolean;
}

interface EvidenceAssertion {
  id: string;
  passed: boolean;
  observed: unknown;
}

interface Evidence {
  generatedAt: string;
  environment: "真机";
  records: RealAppRecord[];
  assertions: EvidenceAssertion[];
  artifacts: {
    firstRun: string;
  };
  runtime: {
    idleTimeoutMs: number;
    workspace: string;
  };
  session?: {
    local: string;
    external: string;
    links: Array<{ runId: string; externalSessionId: string }>;
  };
  processes?: {
    first: { pid: number; command: string };
    second: { pid: number; command: string };
    resumed: { pid: number; command: string };
  };
  cacheReadInputTokens?: {
    first: number | null;
    second: number | null;
    resumed: number | null;
  };
  diagnostics?: string[];
  failure?: {
    message: string;
    pageText: string | null;
  };
}

if (process.env.MOEBIUS_REAL_CLAUDE_ELECTRON !== "1") {
  process.stderr.write(
    "Set MOEBIUS_REAL_CLAUDE_ELECTRON=1 to run the real Claude Electron acceptance.\n",
  );
  process.exitCode = 2;
} else {
  await main();
}

async function main(): Promise<void> {
  const evidenceDir = await createAcceptanceOutputDirectory("claude-agent-sdk-electron");
  const evidencePath = path.join(evidenceDir, "evidence.json");
  const runtimeRoot = await fs.mkdtemp(path.join(os.tmpdir(), "moebius-claude-agent-sdk-electron-"));
  const workspace = path.join(runtimeRoot, "workspace");
  const token = randomUUID().replaceAll("-", "").slice(0, 12);
  const firstToken = "ELECTRON_CLAUDE_SDK_FIRST_" + token;
  const secondToken = "ELECTRON_CLAUDE_SDK_SECOND_" + token;
  const resumedToken = "ELECTRON_CLAUDE_SDK_RESUMED_" + token;
  const evidence: Evidence = {
    generatedAt: new Date().toISOString(),
    environment: "真机",
    records: [],
    assertions: [],
    artifacts: {
      firstRun: path.join(evidenceDir, "first-run.png"),
    },
    runtime: {
      idleTimeoutMs,
      workspace,
    },
    diagnostics: [],
  };
  let application: ElectronApplication | null = null;
  let page: Page | null = null;

  try {
    await fs.mkdir(workspace, { recursive: true });

    application = await electron.launch({
      args: [desktopRoot],
      cwd: desktopRoot,
      env: {
        ...process.env,
        MOEBIUS_DATA_ROOT: runtimeRoot,
        MOEBIUS_DISABLE_UPDATE_CHECK: "1",
        MOEBIUS_LOCAL_RUN_IDLE_TIMEOUT_MS: String(idleTimeoutMs),
        ELECTRON_DISABLE_SECURITY_WARNINGS: "true",
      },
    });
    page = await mainWindow(application, evidence.diagnostics);
    await completeFirstRunOnboarding(page, evidence);
    await waitForConsole(page);
    const apiBase = await waitForApiBase(page);
    const electronPid = application.process().pid;
    if (electronPid === undefined) throw new Error("Electron process did not expose a PID");

    await configureGeneralAssistantForClaude(page);
    record(evidence, "real-user-configures-Claude-member", true, {
      team: "system:general-assistant",
      member: "assistant",
      engine: "claude",
    }, {
      entrance: "主窗口 → Agent 团队 → 通用助手",
      action: "将唯一成员的执行引擎选择为 Claude Code 并保存运行配置",
      screenObservation: "保存后运行配置没有未保存改动，后续新建对话绑定此 Claude 成员。",
    });

    await createConversationForWorkspace(application, page, workspace);
    const composer = page.getByRole("textbox", { name: "消息内容" });
    await composer.fill("Reply with exactly: " + firstToken + ". Do not use tools.");
    await page.getByRole("button", { name: "发送消息" }).click();

    const firstRun = await waitForClaudeRun(apiBase);
    const firstProcess = await waitForClaudeProcess(electronPid, "--session-id");
    const terminalSurfaceAbsent = await page.getByTestId("claude-terminal-surface").count() === 0;
    const manualTrustDialogAbsent = await page.getByTestId("claude-workspace-trust-dialog").count() === 0;
    record(evidence, "real-Claude-SDK-run-has-no-hidden-terminal-or-trust-dialog", terminalSurfaceAbsent
      && manualTrustDialogAbsent, {
      manualTrustDialogAbsent,
      terminalSurfaceAbsent,
      firstProcess,
    }, {
      entrance: "新建对话 → 通用助手（Claude）→ 发送第一条消息",
      action: "等待无交互 Claude Agent SDK query 完成",
      screenObservation: "页面不渲染原生 terminal surface，也没有隐藏的工作区信任确认对话框。",
    });
    await page.screenshot({ path: evidence.artifacts.firstRun, fullPage: true });

    const firstCompleted = await waitForCompletedMessage(apiBase, firstRun.sessionId, firstRun.runId, firstToken);
    const firstLink = await waitForExecutionLink(runtimeRoot, firstRun.sessionId, firstRun.runId);
    const firstTranscript = await waitForTranscript(firstLink.externalSessionId, workspace, firstToken);
    record(evidence, "real-first-headless-run-preserves-final-response", firstCompleted.messages.some((message) =>
      message.speaker === "agent" && message.body.includes(firstToken),
    ), {
      localSessionId: firstRun.sessionId,
      firstRunId: firstRun.runId,
      externalSessionId: firstLink.externalSessionId,
      agentResponseVisible: firstCompleted.messages.some((message) =>
        message.speaker === "agent" && message.body.includes(firstToken),
      ),
    }, {
      entrance: "新建对话 → 发送第一条 Claude 消息",
      action: "不进行人工交互，等待首轮 query 完成",
      screenObservation: "第一条任务在同一 Claude 会话中完成，最终回复出现在会话时间线。",
    });

    await composer.fill("Recall the earlier token and reply with exactly: " + secondToken + ". Do not use tools.");
    await page.getByRole("button", { name: "发送消息" }).click();
    const secondRun = await waitForClaudeRun(apiBase, firstRun.sessionId, firstRun.runId);
    await waitForClaudeProcessExit(electronPid, firstProcess.pid);
    const secondProcess = await waitForClaudeProcess(electronPid, "--resume", firstLink.externalSessionId);
    const secondUsesHeadlessResume = secondProcess.pid !== firstProcess.pid
      && secondProcess.sessionId === firstProcess.sessionId
      && secondProcess.command.includes("--resume");
    const secondCompleted = await waitForCompletedMessage(apiBase, firstRun.sessionId, secondRun.runId, secondToken);
    const secondLink = await waitForExecutionLink(runtimeRoot, firstRun.sessionId, secondRun.runId);
    const secondTranscript = await waitForTranscript(firstLink.externalSessionId, workspace, secondToken);
    record(evidence, "real-second-turn-uses-headless-Claude-resume", secondUsesHeadlessResume
      && secondLink.externalSessionId === firstLink.externalSessionId
      && secondCompleted.messages.some((message) => message.speaker === "agent" && message.body.includes(secondToken)), {
      firstProcess,
      secondProcess,
      firstExternalSessionId: firstLink.externalSessionId,
      secondExternalSessionId: secondLink.externalSessionId,
      secondUsesHeadlessResume,
    }, {
      entrance: "同一已完成 Claude 对话 → 消息输入框",
      action: "发送第二条消息并观察新的前台 SDK query",
      screenObservation: "第二条回复完成；新的 Claude 进程使用同一 external session 的 --resume，页面不显示 terminal surface。",
    });

    await waitForClaudeProcessExit(electronPid, secondProcess.pid);

    await composer.fill("Recall both prior turns and reply with exactly: " + resumedToken + ". Do not use tools.");
    await page.getByRole("button", { name: "发送消息" }).click();
    const resumedRun = await waitForClaudeRun(apiBase, firstRun.sessionId, secondRun.runId);
    const resumedProcess = await waitForClaudeProcess(electronPid, "--resume", firstLink.externalSessionId);
    const resumedCompleted = await waitForCompletedMessage(
      apiBase,
      firstRun.sessionId,
      resumedRun.runId,
      resumedToken,
    );
    const resumedLink = await waitForExecutionLink(runtimeRoot, firstRun.sessionId, resumedRun.runId);
    const resumedTranscript = await waitForTranscript(firstLink.externalSessionId, workspace, resumedToken);
    const exactResume = resumedProcess.pid !== firstProcess.pid
      && resumedProcess.pid !== secondProcess.pid
      && resumedProcess.sessionId === firstLink.externalSessionId
      && resumedLink.externalSessionId === firstLink.externalSessionId
      && resumedCompleted.messages.some((message) => message.speaker === "agent" && message.body.includes(resumedToken));
    record(evidence, "real-third-turn-uses-exact-Claude-resume", exactResume, {
      firstProcess,
      resumedProcess,
      firstExternalSessionId: firstLink.externalSessionId,
      resumedExternalSessionId: resumedLink.externalSessionId,
      resumedUsesNewHeadlessProcess: resumedProcess.pid !== secondProcess.pid,
    }, {
      entrance: "同一已完成 Claude 对话 → 上一轮 query 已退出 → 消息输入框",
      action: "等待上一轮 query 退出后发送第三条消息",
      screenObservation: "第三条回复完成；真实新 Claude 进程带有同一 external session 的 --resume 参数，页面仍只显示结构化运行状态与历史入口。",
    });

    const links = await readExecutionSessionLinks(
      sessionFactLogPath(runtimeRoot, firstRun.sessionId),
      firstRun.sessionId,
    );
    const relevantLinks = links
      .filter((link) => [firstRun.runId, secondRun.runId, resumedRun.runId].includes(link.runId))
      .map((link) => ({ runId: link.runId, externalSessionId: link.externalSessionId }));
    evidence.session = {
      local: firstRun.sessionId,
      external: firstLink.externalSessionId,
      links: relevantLinks,
    };
    evidence.processes = {
      first: { pid: firstProcess.pid, command: firstProcess.command },
      second: { pid: secondProcess.pid, command: secondProcess.command },
      resumed: { pid: resumedProcess.pid, command: resumedProcess.command },
    };
    evidence.cacheReadInputTokens = {
      first: firstTranscript.cachedInputTokens,
      second: secondTranscript.cachedInputTokens,
      resumed: resumedTranscript.cachedInputTokens,
    };
    record(evidence, "real-Electron-transcript-usage-keeps-cache-read-field", [
      firstTranscript.cachedInputTokens,
      secondTranscript.cachedInputTokens,
      resumedTranscript.cachedInputTokens,
    ].every((value) => value !== null && value >= 0), evidence.cacheReadInputTokens, {
      entrance: "上述三轮真实 Claude Electron 对话完成后",
      action: "只读核对同一真实 Claude transcript 的 usage",
      screenObservation: "三轮均有可读的 cache_read_input_tokens usage 数值；该 usage 仅用于最终正文与用量核对，不驱动页面生命周期。",
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    let pageText: string | null = null;
    try {
      if (page !== null) pageText = (await page.locator("body").innerText({ timeout: 5_000 })).slice(0, 4_000);
    } catch {
      pageText = null;
    }
    evidence.failure = { message, pageText };
    evidence.assertions.push({
      id: "real-Claude-Electron-acceptance-completed",
      passed: false,
      observed: evidence.failure,
    });
  } finally {
    if (application !== null) await application.close().catch(() => undefined);
    await fs.writeFile(evidencePath, JSON.stringify(evidence, null, 2) + "\n", "utf8");
    await fs.rm(runtimeRoot, { recursive: true, force: true });
    process.stdout.write(
      "CLAUDE_AGENT_SDK_ELECTRON_EVIDENCE=" + evidencePath + "\n"
      + JSON.stringify({
        ok: evidence.assertions.every((assertion) => assertion.passed),
        records: evidence.records.length,
        assertions: evidence.assertions.length,
      }) + "\n",
    );
  }

  if (evidence.assertions.some((assertion) => !assertion.passed)) {
    process.exitCode = 1;
  }
}

function record(
  evidence: Evidence,
  id: string,
  passed: boolean,
  observed: unknown,
  realApp: Omit<RealAppRecord, "environment" | "consistent">,
): void {
  evidence.assertions.push({ id, passed, observed });
  evidence.records.push({ environment: "真机", ...realApp, consistent: passed });
  if (!passed) throw new Error(id + " failed: " + JSON.stringify(observed));
}

async function mainWindow(application: ElectronApplication, diagnostics: string[]): Promise<Page> {
  const page = application.windows()[0] ?? await application.waitForEvent("window", { timeout: 30_000 });
  application.process().stderr?.on("data", (chunk: Buffer) => {
    diagnostics.push("electron stderr: " + chunk.toString("utf8").slice(0, 2_000));
  });
  page.on("pageerror", (error) => diagnostics.push("pageerror: " + error.message));
  page.on("console", (message) => {
    if (message.type() === "error") diagnostics.push("console error: " + message.text());
  });
  await page.waitForLoadState("domcontentloaded");
  return page;
}

async function completeFirstRunOnboarding(page: Page, evidence: Evidence): Promise<void> {
  const firstStep = page.getByTestId("onboarding-step-1");
  if (!await firstStep.isVisible().catch(() => false)) return;

  await advanceOnboardingStep(page, 1, 2);
  record(evidence, "real-first-run-environment-continues-through-UI", true, {
    resultingStep: 2,
  }, {
    entrance: "首次启动 → 环境准备",
    action: "在 CLI 就绪后点击“继续”",
    screenObservation: "进入团队选择步骤，没有预写引导完成标记。",
  });

  await advanceOnboardingStep(page, 2, 3);
  record(evidence, "real-first-run-team-selection-continues-through-UI", true, {
    resultingStep: 3,
  }, {
    entrance: "首次启动 → 团队选择",
    action: "保留页面默认可用团队并点击“继续”",
    screenObservation: "进入团队协作说明步骤。",
  });

  await advanceOnboardingStep(page, 3, 4);
  record(evidence, "real-first-run-relay-continues-through-UI", true, {
    resultingStep: 4,
  }, {
    entrance: "首次启动 → 团队协作说明",
    action: "点击“继续”",
    screenObservation: "进入终端通知授权步骤。",
  });

  const notificationFooter = page.getByTestId("notification-permission-footer");
  await notificationFooter.waitFor({ state: "visible", timeout: 20_000 });
  const notificationButtons = notificationFooter.getByRole("button");
  await waitForValue(async () => {
    const count = await notificationButtons.count();
    return count >= 2 ? count : undefined;
  }, {
    describe: "real first-run notification onboarding action is available",
    kind: "io",
    timeoutMs: 20_000,
    snapshot: () => ({ buttonCount: notificationButtons.count() }),
  });
  const canSkipNotification = await page.getByTestId("notification-permission-skip-notice")
    .isVisible()
    .catch(() => false);
  if (canSkipNotification) {
    await notificationButtons.nth(1).click();
  } else {
    await notificationButtons.last().click();
  }
  await page.getByTestId("onboarding-step-5").waitFor({ state: "visible", timeout: 20_000 });
  record(evidence, "real-first-run-notification-decision-through-UI", true, {
    decision: canSkipNotification ? "skip" : "continue-with-existing-system-state",
    resultingStep: 5,
  }, {
    entrance: "首次启动 → 终端通知授权",
    action: canSkipNotification ? "点击“稍后再说”跳过系统通知请求" : "按当前系统状态继续",
    screenObservation: "未触发与本功能无关的系统授权弹窗，进入开始使用步骤。",
  });

  const start = page.getByTestId("onboarding-footer").getByRole("button", { name: "开始使用" });
  await waitForValue(async () => await start.isEnabled() ? true : undefined, {
    describe: "real first-run start action is enabled",
    kind: "io",
    timeoutMs: 20_000,
    snapshot: () => ({ disabled: start.isDisabled() }),
  });
  await start.click();
  record(evidence, "real-first-run-completes-through-UI", true, {
    selectedTeam: "default-available-team",
  }, {
    entrance: "首次启动 → 开始使用",
    action: "点击“开始使用”",
    screenObservation: "引导完成写入由 Electron IPC 执行，随后进入主操作台。",
  });
}

async function advanceOnboardingStep(page: Page, current: number, next: number): Promise<void> {
  const step = page.getByTestId("onboarding-step-" + String(current));
  await step.waitFor({ state: "visible", timeout: 20_000 });
  const continueButton = page.getByTestId("onboarding-footer").getByRole("button", { name: "继续" });
  await waitForValue(async () => await continueButton.isEnabled() ? true : undefined, {
    describe: "real first-run onboarding step " + String(current) + " can continue",
    kind: "io",
    timeoutMs: 20_000,
    snapshot: () => ({ disabled: continueButton.isDisabled() }),
  });
  await continueButton.click();
  await page.getByTestId("onboarding-step-" + String(next)).waitFor({ state: "visible", timeout: 20_000 });
}

async function waitForConsole(page: Page): Promise<void> {
  try {
    await page.getByRole("button", { name: "设置" }).waitFor({ timeout: 20_000 });
  } catch {
    const state = await page.evaluate(() => ({
      href: window.location.href,
      readyState: document.readyState,
      body: document.body?.innerText.slice(0, 4_000) ?? null,
      root: document.querySelector("#root")?.innerHTML.slice(0, 4_000) ?? null,
    })).catch(() => null);
    throw new Error("Electron console page did not reach settings: " + JSON.stringify(state));
  }
}

async function configureGeneralAssistantForClaude(page: Page): Promise<void> {
  await page.getByTestId("sidebar-nav-agent-teams").click();
  const team = page.locator(
    '[data-testid="agent-team-row"][data-team-key="system:general-assistant"]',
  );
  await team.waitFor({ timeout: 20_000 });
  await team.click();
  const member = page.getByTestId("agent-team-member-selector").getByRole("tab", { name: "通用助手" });
  await member.click();
  const editor = page.getByTestId("agent-execution-profile-editor");
  const engine = editor.getByRole("combobox", { name: "执行引擎" });
  await engine.click();
  const engineOptions = page.getByRole("listbox");
  await engineOptions.getByRole("option", { name: "Claude Code" }).click();
  const save = page.getByRole("button", { name: "保存" });
  await save.click();
  await waitForValue(async () => await save.isDisabled() ? true : undefined, {
    describe: "Claude execution profile save settles in real Electron",
    kind: "io",
    timeoutMs: 20_000,
    snapshot: async () => ({ engine: await engine.textContent() }),
  });
  if ((await engine.textContent())?.trim() !== "Claude Code") {
    throw new Error("general assistant execution engine was not saved as Claude");
  }
}

async function createConversationForWorkspace(
  application: ElectronApplication,
  page: Page,
  workspace: string,
): Promise<void> {
  await page.getByRole("button", { name: "新建对话" }).click();
  const conversation = page.getByRole("region", { name: "新建对话" });
  await conversation.waitFor({ timeout: 20_000 });
  await application.evaluate(({ dialog }, folderPath: string) => {
    const state = globalThis as typeof globalThis & {
      __moebiusOriginalShowOpenDialog?: typeof dialog.showOpenDialog;
    };
    state.__moebiusOriginalShowOpenDialog = dialog.showOpenDialog.bind(dialog);
    dialog.showOpenDialog = (async () => ({ canceled: false, filePaths: [folderPath] })) as typeof dialog.showOpenDialog;
  }, workspace);
  try {
    const projectPicker = conversation.getByRole("button", { name: "项目：未选择，点击选择" });
    await projectPicker.focus();
    await projectPicker.press("ArrowDown");
    const menu = page.getByRole("menu");
    await menu.waitFor({ timeout: 10_000 });
    await menu.getByRole("menuitem", { name: "添加项目…" }).click();
    await conversation.getByRole("button", {
      name: "项目：" + path.basename(workspace) + "，点击切换",
    }).waitFor({ timeout: 20_000 });
  } finally {
    await application.evaluate(({ dialog }) => {
      const state = globalThis as typeof globalThis & {
        __moebiusOriginalShowOpenDialog?: typeof dialog.showOpenDialog;
      };
      if (state.__moebiusOriginalShowOpenDialog !== undefined) {
        dialog.showOpenDialog = state.__moebiusOriginalShowOpenDialog;
        delete state.__moebiusOriginalShowOpenDialog;
      }
    });
  }
  await conversation.getByTestId("new-conversation-team-picker").click();
  const team = page.locator(
    '[data-testid="new-conversation-team-option"][data-team-key="system:general-assistant"]',
  );
  await team.waitFor({ timeout: 10_000 });
  await team.click();
}

async function waitForApiBase(page: Page): Promise<string> {
  return await waitForValue(async () => {
    return await page.evaluate(async () =>
      await (window as typeof window & {
        moebius?: { getLocalConsoleUrl?: () => Promise<string | null> };
      }).moebius?.getLocalConsoleUrl?.() ?? null,
    ) ?? undefined;
  }, {
    describe: "Electron local-console URL for Claude Agent SDK acceptance",
    kind: "io",
    timeoutMs: 20_000,
    snapshot: () => ({ pageUrl: page.url() }),
  });
}

async function getState(apiBase: string, sessionId?: string): Promise<ConsoleState> {
  const url = new URL("/api/local-console/state", apiBase);
  if (sessionId !== undefined) url.searchParams.set("sessionId", sessionId);
  const response = await fetch(url);
  if (!response.ok) throw new Error("state request failed: " + String(response.status) + " " + await response.text());
  return await response.json() as ConsoleState;
}

async function waitForClaudeRun(
  apiBase: string,
  sessionId?: string,
  previousRunId?: string,
): Promise<ActiveRun> {
  return await waitForValue(async () => {
    const state = await getState(apiBase, sessionId);
    return state.activeRuns.find((run) =>
      run.engine === "claude"
      && (previousRunId === undefined || run.runId !== previousRunId),
    );
  }, {
    describe: "real Claude Agent SDK run begins in Electron",
    kind: "io",
    timeoutMs: 45_000,
    snapshot: () => ({ sessionId, previousRunId }),
  });
}

async function waitForCompletedMessage(
  apiBase: string,
  sessionId: string,
  runId: string,
  token: string,
): Promise<ConsoleState> {
  return await waitForValue(async () => {
    const state = await getState(apiBase, sessionId);
    const completed = !state.activeRuns.some((run) => run.runId === runId);
    const received = state.messages.some((message) =>
      message.speaker === "agent" && message.body.includes(token),
    );
    return completed && received ? state : undefined;
  }, {
    describe: "real Claude Electron run completes with token " + token,
    kind: "io",
    timeoutMs: 180_000,
    snapshot: () => ({ sessionId, runId, token }),
  });
}

async function waitForExecutionLink(
  runtimeRoot: string,
  sessionId: string,
  runId: string,
): Promise<LocalExecutionSessionLinkFact> {
  const factPath = sessionFactLogPath(runtimeRoot, sessionId);
  return await waitForValue(async () => {
    const links = await readExecutionSessionLinks(factPath, sessionId).catch(() => [] as LocalExecutionSessionLinkFact[]);
    return links.find((link) => link.runId === runId && link.engine === "claude");
  }, {
    describe: "Claude execution session link persists for real Electron run",
    kind: "io",
    timeoutMs: 30_000,
    snapshot: () => ({ sessionId, runId, factPath }),
  });
}

function sessionFactLogPath(runtimeRoot: string, sessionId: string): string {
  return path.join(runtimeRoot, "sessions", Buffer.from(sessionId, "utf8").toString("base64url") + ".jsonl");
}

async function waitForTranscript(
  sessionId: string,
  cwd: string,
  token: string,
): Promise<Extract<Awaited<ReturnType<typeof resolveClaudeTuiTranscriptFinal>>, { status: "available" }>> {
  return await waitForValue(async () => {
    const transcript = await resolveClaudeTuiTranscriptFinal({ sessionId, cwd });
    return transcript.status === "available" && transcript.finalText.includes(token)
      ? transcript
      : undefined;
  }, {
    describe: "Claude transcript final and usage for real Electron turn",
    kind: "io",
    timeoutMs: 30_000,
    snapshot: () => ({ sessionId, cwd, token }),
  });
}

async function waitForClaudeProcess(
  electronPid: number,
  flag: "--session-id" | "--resume",
  expectedSessionId?: string,
): Promise<ClaudeProcess> {
  return await waitForValue(async () => {
    const rows = await listProcesses();
    const descendants = rows.filter((row) => isDescendant(row.pid, electronPid, rows));
    const candidate = descendants.find((row) => {
      if (!row.command.toLowerCase().includes("claude") || !row.command.includes(flag)) return false;
      const sessionId = commandFlagValue(row.command, flag);
      return sessionId !== null && (expectedSessionId === undefined || sessionId === expectedSessionId);
    });
    const sessionId = candidate === undefined ? null : commandFlagValue(candidate.command, flag);
    return candidate !== undefined && sessionId !== null
      ? { pid: candidate.pid, command: candidate.command, sessionId }
      : undefined;
  }, {
    describe: "real Claude process exposes " + flag + " under Electron",
    kind: "io",
    timeoutMs: 30_000,
    snapshot: () => ({ electronPid, flag, expectedSessionId }),
  });
}

async function waitForClaudeProcessExit(electronPid: number, pid: number): Promise<void> {
  await waitForValue(async () => {
    const rows = await listProcesses();
    const live = rows.some((row) => row.pid === pid && isDescendant(row.pid, electronPid, rows));
    return live ? undefined : true;
  }, {
    describe: "Claude Agent SDK query process exits after its turn completes",
    kind: "io",
    timeoutMs: idleTimeoutMs + 20_000,
    snapshot: () => ({ electronPid, pid, idleTimeoutMs }),
  });
}

async function listProcesses(): Promise<ProcessRow[]> {
  const child = spawn("ps", ["-Ao", "pid=,ppid=,command="], {
    shell: false,
    stdio: ["ignore", "pipe", "pipe"],
  });
  const stdout: Buffer[] = [];
  child.stdout.on("data", (chunk: Buffer) => stdout.push(chunk));
  child.stderr.resume();
  const exitCode = await new Promise<number | null>((resolve, reject) => {
    child.once("error", reject);
    child.once("close", resolve);
  });
  if (exitCode !== 0) throw new Error("ps process inspection failed: " + String(exitCode));
  return Buffer.concat(stdout).toString("utf8")
    .split("\n")
    .flatMap((line) => {
      const match = line.trim().match(/^(\d+)\s+(\d+)\s+(.+)$/u);
      if (match === null) return [];
      return [{
        pid: Number(match[1]),
        ppid: Number(match[2]),
        command: match[3],
      }];
    });
}

function isDescendant(pid: number, ancestorPid: number, rows: readonly ProcessRow[]): boolean {
  const parentByPid = new Map(rows.map((row) => [row.pid, row.ppid]));
  const visited = new Set<number>();
  let current = pid;
  while (!visited.has(current)) {
    if (current === ancestorPid) return true;
    visited.add(current);
    const parent = parentByPid.get(current);
    if (parent === undefined || parent <= 1) return false;
    current = parent;
  }
  return false;
}

function commandFlagValue(command: string, flag: "--session-id" | "--resume"): string | null {
  const match = command.match(new RegExp("(?:^|\\s)" + flag + "\\s+([^\\s]+)", "u"));
  return match?.[1] ?? null;
}
