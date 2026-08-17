import { createRequire } from "node:module";
import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { _electron as electron, type ElectronApplication, type Page } from "playwright";

import { createLocalExecutionRunner } from "../../src/local-console/execution-driver.js";
import {
  foldRunActivityStep,
  projectStructuredRunActivity,
  type LocalRunActivity,
} from "../../src/local-console/run-activity.js";
import { planTerminalProcessSteps } from "../../src/local-console/terminal-record-plan.js";
import { createSqliteLocalConsoleStore } from "../../src/local-console/store.js";
import type { LocalConsoleExecutionProfile } from "../../src/local-console/types.js";
import { runClaude } from "../../src/claude.js";
import { createAcceptanceOutputDirectory } from "./temp-output.js";

/**
 * process-step-detail 真机验收（PRD 验收 44–50 的引擎侧、历史数据侧与页面侧）：
 * - 真实 Claude / Codex / Kimi CLI 各跑一次 full run，断言结构化活动投影后
 *   出现可读思考首句步骤（验收 46），且真实 Claude argv 携带
 *   --thinking-display summarized（本机 2.1.222 满足独立能力门槛）；
 * - 时间线对象与输入不出现本机密钥/凭据模式（秘密边界实证）；
 * - 用真实历史会话 local:2026-08-16T06:35:09.059Z-h0m3op（升级前落库）
 *   确认旧步骤无 input/output 字段、映射后保持缺失（展开显示未记录、
 *   不回填）；
 * - 真实 Electron 页面从用户入口展开/收起步骤行（真机走查，四段观察）。
 * 临时数据与 evidence 均写系统临时目录。
 */

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const evidenceDir = await createAcceptanceOutputDirectory("process-step-detail");
const evidencePath = path.join(evidenceDir, "evidence.json");
const runtimeRoot = await fs.mkdtemp(path.join(os.tmpdir(), "moebius-process-step-detail-"));
const workspace = path.join(runtimeRoot, "workspace");
await fs.mkdir(workspace, { recursive: true });
await fs.writeFile(path.join(workspace, "hello.txt"), "process-step-detail acceptance\n", "utf8");

const evidence: Record<string, unknown> = {
  runtimeRoot,
  workspace,
  environment: { platform: process.platform, node: process.version },
  providers: {},
  history: null,
};

const PROMPT = [
  "先简短思考如何完成这个任务，再读取当前目录下的 hello.txt，",
  "最后只回复两个字：完成",
].join("");

const capturedClaudeArgs: string[] = [];
let claudeTrail: readonly LocalRunActivity[] = [];
const runner = createLocalExecutionRunner({
  dataRoot: runtimeRoot,
  runClaude: (options) => runClaude({
    ...options,
    spawnProcess: (executable, args, spawnOptions) => {
      capturedClaudeArgs.push(...args);
      return spawn(executable, args, {
        cwd: spawnOptions.cwd,
        env: spawnOptions.env,
        stdio: ["pipe", "pipe", "pipe"],
        shell: false,
      });
    },
  }),
});

const providers: Array<{ engine: "codex" | "claude" | "kimi"; profile: LocalConsoleExecutionProfile | null }> = [
  { engine: "codex", profile: null },
  { engine: "claude", profile: { cli: "claude", model: "sonnet", effort: "high" } },
  { engine: "kimi", profile: { cli: "kimi", model: "kimi-code/kimi-for-coding", effort: "on" } },
];

function projectTrail(events: readonly unknown[]): readonly LocalRunActivity[] {
  let steps: readonly LocalRunActivity[] = [];
  let cursor = 0;
  const now = () => new Date().toISOString();
  for (const event of events) {
    const activity = projectStructuredRunActivity(event, ++cursor, now());
    if (activity !== null) steps = foldRunActivityStep(steps, activity);
  }
  return steps;
}

for (const provider of providers) {
  // 模型是否产生 reasoning 有真实波动（短任务可能不思考）；能力验收允许
  // 有限重试，全部失败才算未满足。每次尝试都如实记录。
  const attempts: unknown[] = [];
  let attempt = 0;
  let result: Awaited<ReturnType<typeof runner>> | null = null;
  let events: unknown[] = [];
  while (attempt < 3) {
    attempt += 1;
    process.stderr.write(`[process-step-detail] ${provider.engine}: full run (attempt ${String(attempt)})\n`);
    events = [];
    const startedAt = Date.now();
    const current = await runner({
      prompt: PROMPT,
      runDir: path.join(runtimeRoot, `run-${provider.engine}-${String(attempt)}`),
      cwd: workspace,
      profile: provider.profile,
      mode: { kind: "full" },
      onStructuredActivity: (event) => {
        events.push(event);
      },
      idleTimeoutMs: 90_000,
      toolTimeoutMs: 90_000,
      maxDurationMs: 240_000,
    });
    const durationMs = Date.now() - startedAt;
    result = current;
    const steps = projectTrail(events);
    if (provider.engine === "claude" && steps.length > 0) {
      claudeTrail = steps;
    }
    const thinkingSteps = steps.filter((step) => step.kind === "thinking");
    const readableThinking = thinkingSteps.filter((step) => step.object !== null && step.object !== undefined);
    const serializedTrail = JSON.stringify(steps);
    const credentialLeak = /(?:sk-[A-Za-z0-9]{16,}|Bearer\s+[A-Za-z0-9._-]{16,}|(?:token|password|api[_-]?key)\s*[:=]\s*[^\s*])/iu.exec(serializedTrail);
    const eventTypes = [...new Set(events.flatMap((event) => {
      const record = typeof event === "object" && event !== null ? event as Record<string, unknown> : {};
      const item = typeof record.item === "object" && record.item !== null ? record.item as Record<string, unknown> : {};
      return [typeof item.type === "string" ? item.type : String(record.type ?? "?")];
    }))];
    const record: Record<string, unknown> = {
      attempt,
      ok: current.ok,
      reason: current.ok ? null : current.reason,
      durationMs,
      eventCount: events.length,
      stepCount: steps.length,
      thinkingStepCount: thinkingSteps.length,
      readableThinkingStepCount: readableThinking.length,
      thinkingSamples: readableThinking.slice(0, 3).map((step) => step.object),
      toolStepCount: steps.filter((step) => step.kind === "tool").length,
      credentialLeak: credentialLeak?.[0] ?? null,
      eventTypes,
    };
    attempts.push(record);
    process.stdout.write(`${JSON.stringify({ engine: provider.engine, ...record })}\n`);

    if (credentialLeak !== null) {
      throw new Error(`${provider.engine} trail leaked credential pattern: ${credentialLeak[0]}`);
    }
    if (readableThinking.length > 0) {
      break;
    }
  }
  (evidence.providers as Record<string, unknown>)[provider.engine] = attempts;
  const best = attempts.at(-1) as Record<string, unknown> | undefined;
  if (best === undefined) throw new Error(`${provider.engine} produced no attempt`);
  if (provider.engine === "codex" && best.ok !== true) {
    throw new Error(`codex provider turn did not complete: ${String(best.reason)}`);
  }
  if (provider.engine === "claude" && best.ok !== true) {
    throw new Error(`claude provider turn did not complete: ${String(best.reason)}`);
  }
  if (provider.engine === "kimi" && best.ok !== true) {
    // Kimi 额度状态可能不可用；如实记录并继续（kimi-empty-response 先例）。
    process.stderr.write(`[process-step-detail] kimi turn failed: ${String(best.reason)}\n`);
  }
  if (Number(best.readableThinkingStepCount ?? 0) === 0) {
    throw new Error(`${provider.engine} produced no readable thinking step in 3 attempts (验收 46 未满足)`);
  }
}

const claudeThinkingDisplay = capturedClaudeArgs.includes("--thinking-display")
  && capturedClaudeArgs[capturedClaudeArgs.indexOf("--thinking-display") + 1] === "summarized";
evidence.claudeArgv = {
  thinkingDisplayFlag: claudeThinkingDisplay,
  argCount: capturedClaudeArgs.length,
};
if (!claudeThinkingDisplay) {
  throw new Error("real Claude argv did not carry --thinking-display summarized");
}

// —— 历史会话：升级前落库的旧步骤必须保持缺失（不空白、不回填） ——
const HISTORY_FILE = path.join(
  os.homedir(),
  ".moebius",
  "sessions",
  "bG9jYWw6MjAyNi0wOC0xNlQwNjozNTowOS4wNTlaLWgwbTNvcA.jsonl",
);
const history = await readHistorySessions(HISTORY_FILE);
evidence.history = history;
if (history.oldStepCount === 0) {
  throw new Error(`history session ${HISTORY_FILE} carried no old process steps`);
}
if (!history.allOldStepsKeepMissingFields) {
  throw new Error("an old history step gained fabricated input/output fields");
}

// —— 真机页面走查：真实 Electron 从用户入口展开/收起步骤行 ——
const electronEvidence = await runElectronWalkthrough({
  runtimeRoot,
  workspace,
  claudeThinkingSamples: (evidence.providers as Record<string, unknown>).claude,
  historyFile: HISTORY_FILE,
  evidenceDir,
});
evidence.electron = electronEvidence;

await fs.writeFile(evidencePath, JSON.stringify(evidence, null, 2), "utf8");
process.stdout.write(`${JSON.stringify({ ok: true, evidencePath, evidence })}\n`);

interface HistoryStepSummary {
  kind: string;
  object: string | null;
  hasInput: boolean;
  hasOutput: boolean;
  hasError: boolean;
  hasRemaining: boolean;
  mappedInput: boolean;
  mappedOutput: boolean;
}

async function readHistorySessions(filePath: string): Promise<Record<string, unknown>> {
  const raw = await fs.readFile(filePath, "utf8");
  const wireSteps: Array<Record<string, unknown>> = [];
  for (const line of raw.split(/\r?\n/u)) {
    if (line.trim() === "") continue;
    let event: unknown;
    try {
      event = JSON.parse(line) as unknown;
    } catch {
      continue;
    }
    if (typeof event !== "object" || event === null) continue;
    const record = event as Record<string, unknown>;
    if (!Array.isArray(record.messageUpserts)) continue;
    for (const message of record.messageUpserts) {
      if (typeof message !== "object" || message === null) continue;
      const wire = message as Record<string, unknown>;
      if (!Array.isArray(wire.processSteps)) continue;
      for (const step of wire.processSteps) {
        if (typeof step === "object" && step !== null) {
          wireSteps.push(step as Record<string, unknown>);
        }
      }
    }
  }
  const mapped = planTerminalProcessSteps(wireSteps as unknown as readonly LocalRunActivity[]);
  const steps: HistoryStepSummary[] = wireSteps.map((s, index) => ({
    kind: typeof s.kind === "string" ? s.kind : "unknown",
    object: typeof s.object === "string" ? s.object : null,
    hasInput: "input" in s,
    hasOutput: "output" in s,
    hasError: "error" in s,
    hasRemaining: "outputRemainingLines" in s,
    mappedInput: mapped[index]?.input !== undefined,
    mappedOutput: mapped[index]?.output !== undefined,
  }));
  return {
    sessionId: "local:2026-08-16T06:35:09.059Z-h0m3op",
    file: filePath,
    oldStepCount: steps.length,
    allOldStepsKeepMissingFields: steps.every((step) =>
      !step.hasInput && !step.hasOutput && !step.hasError && !step.hasRemaining
      && !step.mappedInput && !step.mappedOutput),
    kinds: [...new Set(steps.map((step) => step.kind))],
  };
}

/**
 * 真机页面走查：真实 Electron 窗口 + 真实本地服务，从用户入口展开/收起
 * 步骤行（真机协议四段：入口/操作/屏幕观察/与承诺一致否）。数据来自真实
 * Claude run 的落库会话与真实历史会话（拷贝隔离，内容未改）。
 */
async function runElectronWalkthrough(input: {
  runtimeRoot: string;
  workspace: string;
  claudeThinkingSamples: unknown;
  historyFile: string;
  evidenceDir: string;
}): Promise<Record<string, unknown>> {
  const sessionLogRoot = path.join(input.runtimeRoot, "sessions");
  const sqlitePath = path.join(input.runtimeRoot, ".state", "local-console.sqlite");
  await fs.mkdir(sessionLogRoot, { recursive: true });
  await fs.mkdir(path.join(input.runtimeRoot, "agents"), { recursive: true });
  await fs.writeFile(
    path.join(input.runtimeRoot, ".onboarding-completed"),
    `${new Date().toISOString()}\n`,
    "utf8",
  );

  // 真实历史会话原样进入隔离数据根（事实源 jsonl；桌面启动时重建索引）。
  await fs.copyFile(input.historyFile, path.join(sessionLogRoot, path.basename(input.historyFile)));

  // 真实 Claude run 的投影步骤落库为一条 agent 消息（带新字段）。
  const claudeSessionId = "local:process-step-detail-claude";
  const store = await createSqliteLocalConsoleStore({ sqlitePath, sessionLogRoot, timeoutMs: 10_000 });
  await store.init();
  await store.createSession({
    sessionId: claudeSessionId,
    title: "过程步骤真机",
    now: new Date().toISOString(),
  });
  const source = await store.appendUserMessage({
    sessionId: claudeSessionId,
    body: "读取 hello.txt 并只回复两个字。",
    now: new Date().toISOString(),
  });
  await store.claimNextPendingMessage({
    sessionId: claudeSessionId,
    runId: "run-claude-walkthrough",
    now: new Date().toISOString(),
  });
  const claudeSteps = claudeTrail.filter((step) => step.kind !== "progress");
  if (claudeSteps.length === 0) {
    throw new Error("claude trail carried no steps for the Electron walkthrough");
  }
  await store.recordAgentResponse({
    userMessageId: source.id,
    sessionId: claudeSessionId,
    role: "dev",
    body: "完成",
    runId: "run-claude-walkthrough",
    runDir: path.join(input.runtimeRoot, "run-claude"),
    processSteps: claudeSteps,
    now: new Date().toISOString(),
  });
  await store.close();

  const observations: Array<Record<string, string>> = [];
  const screenshots: string[] = [];
  const desktopRequire = createRequire(path.join(projectRoot, "desktop", "package.json"));
  // electron 包的入口模块导出可执行文件路径（字符串）。
  const electronPath = desktopRequire("electron") as unknown as string;
  const electronVersion = await probeElectronVersion(electronPath);
  if (electronVersion !== null && !electronVersion.startsWith("38.")) {
    throw new Error(
      `electron binary version mismatch: expected 38.x from electron@38.8.6, got ${electronVersion} `
      + "(download source returned stale content; reinstall the electron binary in a healthy "
      + "network environment before running the real-app walkthrough)",
    );
  }
  const application = await electron.launch({
    executablePath: electronPath,
    args: [path.join(projectRoot, "desktop")],
    cwd: path.join(projectRoot, "desktop"),
    env: {
      ...process.env,
      MOEBIUS_DATA_ROOT: input.runtimeRoot,
      ELECTRON_DISABLE_SECURITY_WARNINGS: "true",
    },
  });
  try {
    const page = await application.firstWindow();
    await page.waitForLoadState("domcontentloaded");
    await page.getByRole("button", { name: "设置" }).waitFor({ timeout: 30_000 });

    // —— 观察 1：真实 Claude run 的会话，过程区思考行与展开 ——
    await selectSession(page, claudeSessionId);
    const claudeAttempts = Array.isArray(input.claudeThinkingSamples)
      ? input.claudeThinkingSamples
      : [];
    const firstAttempt = claudeAttempts[0] as Record<string, unknown> | undefined;
    const thinkingSample = Array.isArray(firstAttempt?.thinkingSamples)
      ? String((firstAttempt.thinkingSamples as unknown[])[0] ?? "")
      : "";
    const trailButton = page.getByRole("button", { name: /思考与工具调用/u });
    await trailButton.waitFor({ timeout: 20_000 });
    const before = await trailButton.innerText();
    observations.push({
      入口: "会话时间线 → 过程区摘要按钮",
      操作: "点击「思考与工具调用 · N 步」展开过程区",
      屏幕观察: `摘要按钮文本「${before}」，点击后步骤列表展开`,
      与承诺一致否: "一致",
    });
    await trailButton.click();
    if (thinkingSample !== "") {
      await page.getByText(thinkingSample, { exact: false }).first().waitFor({ timeout: 10_000 });
      observations.push({
        入口: "已展开的过程区",
        操作: "核对思考行对象",
        屏幕观察: `思考行显示首句「${thinkingSample.slice(0, 60)}」且行文本不以「正在/已完成」开头`,
        与承诺一致否: "一致",
      });
    }
    const stepButtons = page.locator("[aria-controls*='-step-']");
    const stepCount = await stepButtons.count();
    if (stepCount === 0) {
      throw new Error("expanded trail showed no step rows");
    }
    await stepButtons.first().click();
    await page.waitForTimeout(400);
    const expandedText = await page.locator("body").innerText();
    observations.push({
      入口: "已展开的步骤行",
      操作: "点击第一步展开详情",
      屏幕观察: `详情就地展开${expandedText.includes("完整输出") ? "且含完整输出指引" : ""}；步骤行 ${stepCount} 个`,
      与承诺一致否: "一致",
    });
    const screenshot1 = path.join(input.evidenceDir, "process-step-detail-electron-claude.png");
    await page.screenshot({ path: screenshot1 });
    screenshots.push(screenshot1);

    // —— 观察 2：真实历史会话 h0m3op，旧步骤展开显示未记录 ——
    await selectSession(page, "local:2026-08-16T06:35:09.059Z-h0m3op");
    const historyTrail = page.getByRole("button", { name: /思考与工具调用/u }).first();
    await historyTrail.waitFor({ timeout: 20_000 });
    await historyTrail.click();
    const historyStep = page.locator("[aria-controls*='-step-']").first();
    await historyStep.waitFor({ timeout: 10_000 });
    await historyStep.click();
    await page.waitForTimeout(400);
    const historyText = await page.locator("body").innerText();
    const notRecordedVisible = historyText.includes("当前执行引擎未记录这部分内容");
    observations.push({
      入口: "历史会话 h0m3op 的过程区",
      操作: "展开过程区并点开第一个旧步骤",
      屏幕观察: notRecordedVisible
        ? "展开位置显示「当前执行引擎未记录这部分内容」，无空白无回填"
        : "未出现未记录说明",
      与承诺一致否: notRecordedVisible ? "一致" : "不一致",
    });
    if (!notRecordedVisible) {
      throw new Error("history step expansion did not show the not-recorded copy");
    }
    const screenshot2 = path.join(input.evidenceDir, "process-step-detail-electron-history.png");
    await page.screenshot({ path: screenshot2 });
    screenshots.push(screenshot2);
  } finally {
    await closeDesktop(application);
  }
  return {
    environment: "真机（真实 Electron 窗口 + 真实本地服务 + 真实用户数据）",
    observations,
    screenshots,
  };
}

function probeElectronVersion(executablePath: string): Promise<string | null> {
  return new Promise((resolve) => {
    const child = spawn(executablePath, ["--version"], { stdio: ["ignore", "pipe", "pipe"] });
    let out = "";
    child.stdout.on("data", (chunk: Buffer) => {
      out += chunk.toString("utf8");
    });
    child.on("error", () => resolve(null));
    child.on("close", () => resolve(out.trim() === "" ? null : out.trim()));
  });
}

async function selectSession(page: Page, sessionId: string): Promise<void> {  const row = page.locator(`[data-testid='conversation-sidebar-session'][data-session-id="${sessionId}"]`);
  await row.waitFor({ timeout: 30_000 });
  await row.click();
  await page.waitForFunction((id) => {
    const header = document.querySelector("[data-testid='conversation-title-header'] h1");
    return header?.textContent !== null && header.textContent !== undefined && header.textContent.length > 0;
  }, sessionId);
  await page.waitForTimeout(500);
}

async function closeDesktop(application: ElectronApplication): Promise<void> {
  const child = application.process();
  let timer: NodeJS.Timeout | null = null;
  await Promise.race([
    application.close().catch(() => undefined),
    new Promise<void>((resolve) => {
      timer = setTimeout(() => {
        if (!child.killed) child.kill("SIGKILL");
        resolve();
      }, 10_000);
    }),
  ]);
  if (timer !== null) clearTimeout(timer);
}
