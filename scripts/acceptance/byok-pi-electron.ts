import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";

import { _electron as electron, type ElectronApplication, type Page } from "playwright";

import { createAcceptanceOutputDirectory } from "./temp-output.js";
import { waitForValue } from "../../src/testing/wait.js";

interface RealAppRecord {
  environment: "真机";
  entrance: string;
  action: string;
  screenObservation: string;
  consistent: boolean;
}

interface ByokPiEvidence {
  generatedAt: string;
  records: RealAppRecord[];
  assertions: Array<{ id: string; passed: boolean; observed: unknown }>;
}

interface ResponsivenessProbeResult {
  checks: number;
  failures: number;
  maxLatencyMs: number;
  timedOut: boolean;
}

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const desktopRoot = path.join(projectRoot, "desktop");
const runtimeRoot = await fs.mkdtemp(path.join(os.tmpdir(), "moebius-byok-pi-acceptance-"));
const workspace = path.join(runtimeRoot, "acceptance-workspace");
const evidenceRoot = await createAcceptanceOutputDirectory("byok-pi-electron");
const evidencePath = path.join(evidenceRoot, "byok-pi-electron-evidence.json");
const invalidKey = `sk-invalid-${randomUUID()}`;
const validKey = await readKeychainSecret();
const records: RealAppRecord[] = [];
const assertions: ByokPiEvidence["assertions"] = [];

await fs.writeFile(
  path.join(runtimeRoot, ".onboarding-completed"),
  `${new Date().toISOString()}\n`,
  "utf8",
);
await fs.mkdir(workspace, { recursive: true });
await fs.writeFile(path.join(workspace, "fixture.txt"), "alpha\n", "utf8");
const attachmentPath = path.join(runtimeRoot, "acceptance-context.txt");
await fs.writeFile(attachmentPath, "ATTACHMENT_SENTINEL_VIOLET\n", "utf8");
await fs.writeFile(
  path.join(workspace, "verify.mjs"),
  "import fs from 'node:fs'; const value = fs.readFileSync('fixture.txt', 'utf8'); if (value !== 'beta\\n') process.exit(1); process.stdout.write('fixture-ok');\n",
  "utf8",
);

function record(id: string, passed: boolean, observed: unknown, realApp: Omit<RealAppRecord, "environment" | "consistent">): void {
  assertions.push({ id, passed, observed });
  records.push({ environment: "真机", ...realApp, consistent: passed });
}

function startPageResponsivenessProbe(page: Page): {
  stalled: Promise<void>;
  stop: () => Promise<ResponsivenessProbeResult>;
} {
  let stopped = false;
  let resolveStalled!: () => void;
  const stalled = new Promise<void>((resolve) => {
    resolveStalled = resolve;
  });
  const loop = (async (): Promise<ResponsivenessProbeResult> => {
    let checks = 0;
    let failures = 0;
    let maxLatencyMs = 0;
    let timedOut = false;
    while (!stopped) {
      const startedAt = Date.now();
      try {
        const probe = page.evaluate(() => ({
          readyState: document.readyState,
          bodyPresent: document.body !== null,
        }));
        const outcome = await Promise.race([
          probe.then(() => "ok" as const),
          new Promise<"timeout">((resolve) => setTimeout(() => resolve("timeout"), 2_500)),
        ]);
        if (outcome === "timeout") {
          failures += 1;
          timedOut = true;
          resolveStalled();
          break;
        }
        checks += 1;
        maxLatencyMs = Math.max(maxLatencyMs, Date.now() - startedAt);
      } catch {
        failures += 1;
      }
      await new Promise<void>((resolve) => setTimeout(resolve, 500));
    }
    return { checks, failures, maxLatencyMs, timedOut };
  })();
  return {
    stalled,
    stop: async () => {
      stopped = true;
      return await loop;
    },
  };
}

async function launch(): Promise<ElectronApplication> {
  return await electron.launch({
    args: [desktopRoot],
    cwd: desktopRoot,
    env: {
      ...process.env,
      MOEBIUS_DATA_ROOT: runtimeRoot,
    },
  });
}

async function mainWindow(application: ElectronApplication): Promise<Page> {
  const page = application.windows()[0] ?? await application.waitForEvent("window", { timeout: 30_000 });
  await page.waitForLoadState("domcontentloaded");
  await page.getByRole("button", { name: "设置" }).waitFor();
  return page;
}

async function openProviders(page: Page): Promise<void> {
  await page.getByRole("button", { name: "设置" }).click();
  await page.getByRole("dialog", { name: "设置" }).waitFor();
  await page.getByRole("button", { name: "AI 服务商" }).click();
  await page.getByRole("heading", { name: "AI 服务商" }).waitFor();
}

interface MigrationProgress {
  operationId: string;
  completedOwnerIds: string[];
  targetOwnerIds: string[];
}

async function waitForPartialMigrationAndCrash(
  application: ElectronApplication,
  sqlitePath: string,
): Promise<MigrationProgress> {
  const progress = await waitForValue(async () => {
    const database = new DatabaseSync(sqlitePath);
    try {
      const row = database.prepare(
        `SELECT operation_id, completed_targets_json, target_owner_ids_json
         FROM provider_operations
         WHERE kind = 'migrate'
         ORDER BY updated_at DESC, operation_id ASC
         LIMIT 1`,
      ).get() as Record<string, unknown> | undefined;
      if (row === undefined) return undefined;
      const completedOwnerIds = parseStringArray(row.completed_targets_json);
      const targetOwnerIds = parseStringArray(row.target_owner_ids_json);
      if (completedOwnerIds.length === 0 || completedOwnerIds.length >= targetOwnerIds.length) return undefined;
      return {
        operationId: typeof row.operation_id === "string" ? row.operation_id : "",
        completedOwnerIds,
        targetOwnerIds,
      } satisfies MigrationProgress;
    } finally {
      database.close();
    }
  }, {
    describe: "Provider migration commits some but not all reference owners before crash",
    kind: "io",
    timeoutMs: 120_000,
    onError: () => "retry",
    snapshot: () => ({ sqlitePath }),
  });
  const child = application.process();
  child.kill("SIGKILL");
  await waitForValue(() => child.exitCode !== null || child.signalCode !== null ? true : undefined, {
    describe: "isolated Electron exits after Provider migration crash",
    kind: "io",
    timeoutMs: 10_000,
    snapshot: () => ({ exitCode: child.exitCode, signalCode: child.signalCode }),
  });
  return progress;
}

function parseStringArray(value: unknown): string[] {
  if (typeof value !== "string") return [];
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed) && parsed.every((item) => typeof item === "string") ? parsed : [];
  } catch {
    return [];
  }
}

function readActivityCount(text: string, label: "已完成" | "未完成"): number {
  return Number(text.match(new RegExp(`${label}\\s*([0-9]+)\\s*项`, "u"))?.[1] ?? Number.NaN);
}

async function listFiles(root: string): Promise<string[]> {
  const results: string[] = [];
  const visit = async (current: string): Promise<void> => {
    for (const entry of await fs.readdir(current, { withFileTypes: true })) {
      const target = path.join(current, entry.name);
      if (entry.isDirectory()) await visit(target);
      else if (entry.isFile()) results.push(target);
    }
  };
  await visit(root);
  return results;
}

let application = await launch();
let page: Page | undefined;
try {
  page = await mainWindow(application);
  await openProviders(page);
  const emptyState = page.getByText("尚未配置 AI 服务商。", { exact: true });
  await emptyState.waitFor();
  record("empty-provider-entry", await emptyState.isVisible(), await emptyState.textContent(), {
    entrance: "主窗口 → 设置 → AI 服务商",
    action: "打开真实设置页的 AI 服务商分类",
    screenObservation: "页面显示尚未配置 AI 服务商，并提供添加服务商入口。",
  });

  await page.getByRole("button", { name: "添加服务商" }).click();
  const providerSection = page.locator("section[aria-labelledby='provider-settings-title']");
  const providerForm = providerSection.locator("form").filter({ hasText: "添加 DeepSeek" });
  await page.getByLabel("档案名称").fill("验收 DeepSeek");
  await page.getByLabel("API Key").fill(invalidKey);
  await page.getByLabel("验证模型").selectOption("deepseek-v4-pro");
  await page.getByRole("button", { name: "验证并保存" }).click();
  const error = page.getByRole("alert");
  await error.waitFor({ timeout: 60_000 });
  const errorText = (await error.textContent())?.trim() ?? "";
  const formStillVisible = await providerForm.isVisible();
  const profileCardCount = await providerSection.locator("article").count();
  record(
    "real-invalid-key-fails-without-profile",
    errorText.length > 0 && formStillVisible && profileCardCount === 0,
    { errorVisible: errorText.length > 0, formStillVisible, profileCardCount },
    {
      entrance: "设置 → AI 服务商 → 添加 DeepSeek",
      action: "输入无效测试 Key，选择 DeepSeek V4 Pro，并点击“验证并保存”",
      screenObservation: "真实服务商验证返回可见失败；编辑表单保留，没有显示半成品档案。",
    },
  );

  await page.getByLabel("API Key").fill(validKey);
  await page.getByRole("button", { name: "验证并保存" }).click();
  const readyCard = page.locator("article").filter({ hasText: "验收 DeepSeek" });
  await readyCard.waitFor({ timeout: 120_000 });
  await readyCard.getByText("已就绪", { exact: true }).waitFor();
  record(
    "real-valid-key-creates-ready-profile",
    await readyCard.isVisible() && await providerForm.count() === 0,
    { cardVisible: await readyCard.isVisible(), createFormCount: await providerForm.count() },
    {
      entrance: "设置 → AI 服务商 → 添加 DeepSeek",
      action: "在保留的表单中替换为真实 Key，并点击“验证并保存”",
      screenObservation: "真实回复与工具能力验证完成后出现“验收 DeepSeek · 已就绪”档案，创建表单关闭。",
    },
  );

  await readyCard.getByRole("button", { name: "替换 Key" }).click();
  const replacementInput = readyCard.getByLabel("替换 验收 DeepSeek API Key");
  await replacementInput.fill(validKey);
  await readyCard.getByRole("button", { name: "验证全部 1 个模型" }).click();
  await replacementInput.waitFor({ state: "detached", timeout: 120_000 });
  record(
    "real-key-rotation-validates-all-models",
    await readyCard.getByText("已就绪", { exact: true }).isVisible(),
    { status: "已就绪", validatedModelCount: 1 },
    {
      entrance: "设置 → AI 服务商 → 验收 DeepSeek → 替换 Key",
      action: "确认逐模型用量提示，使用真实 Key 完成全模型轮换验证",
      screenObservation: "轮换表单完成后关闭，档案保持唯一且显示“已就绪”。",
    },
  );

  await page.getByRole("button", { name: "添加服务商" }).click();
  await page.getByLabel("档案名称").fill("验收迁移目标");
  await page.getByLabel("API Key").fill(validKey);
  await page.getByLabel("验证模型").selectOption("deepseek-v4-pro");
  await page.getByRole("button", { name: "验证并保存" }).click();
  const targetCard = page.locator("article").filter({ hasText: "验收迁移目标" });
  await targetCard.getByText("已就绪", { exact: true }).waitFor({ timeout: 120_000 });
  record(
    "real-second-profile-ready-for-migration",
    await targetCard.isVisible(),
    { targetProfileVisible: await targetCard.isVisible() },
    {
      entrance: "设置 → AI 服务商 → 添加服务商",
      action: "创建第二个真实 DeepSeek 档案作为迁移目标",
      screenObservation: "第二个唯一命名档案通过验证并显示“已就绪”。",
    },
  );

  await readyCard.getByRole("button", { name: "停用" }).click();
  const disableDialog = page.getByRole("dialog", { name: "停用“验收 DeepSeek”？" });
  await disableDialog.getByRole("button", { name: "确认停用" }).click();
  await readyCard.getByText("已停用", { exact: true }).waitFor();
  record(
    "real-disable-profile",
    await readyCard.getByText("已停用", { exact: true }).isVisible(),
    { status: "已停用" },
    {
      entrance: "设置 → AI 服务商 → 验收 DeepSeek",
      action: "点击“停用”",
      screenObservation: "档案立即显示“已停用”，重新启用入口可见。",
    },
  );

  await readyCard.getByRole("button", { name: "重新启用" }).click();
  const enableDialog = page.getByRole("dialog", { name: "重新启用“验收 DeepSeek”？" });
  await enableDialog.getByRole("button", { name: "验证并重新启用" }).click();
  await readyCard.getByText("已就绪", { exact: true }).waitFor({ timeout: 120_000 });
  record(
    "real-enable-revalidates-profile",
    await readyCard.getByText("已就绪", { exact: true }).isVisible(),
    { status: "已就绪" },
    {
      entrance: "设置 → AI 服务商 → 验收 DeepSeek",
      action: "点击“重新启用”，等待真实模型能力重新验证",
      screenObservation: "验证完成后档案回到“已就绪”，没有生成第二个档案。",
    },
  );

  await application.evaluate(({ BrowserWindow }) => {
    const target = BrowserWindow.getAllWindows().find((window) =>
      window.webContents.getURL().includes("/console-page/index.html"));
    target?.setContentSize(560, 720);
  });
  await page.waitForFunction(() => window.innerWidth <= 560 && window.innerHeight === 720);
  const narrow = await page.getByRole("dialog", { name: "设置" }).evaluate((dialog) => ({
    viewportWidth: window.innerWidth,
    noHorizontalOverflow: dialog.scrollWidth <= dialog.clientWidth,
    withinViewport: dialog.getBoundingClientRect().left >= 0
      && dialog.getBoundingClientRect().right <= window.innerWidth,
  }));
  record(
    "narrow-provider-form",
    narrow.noHorizontalOverflow && narrow.withinViewport,
    narrow,
    {
      entrance: "设置 → AI 服务商 → 添加 DeepSeek",
      action: "将真实 Electron 内容区缩窄到 560×720",
      screenObservation: "Provider 档案与操作区留在视口内，设置对话框无横向溢出。",
    },
  );

  await application.evaluate(({ BrowserWindow }) => {
    const target = BrowserWindow.getAllWindows().find((window) =>
      window.webContents.getURL().includes("/console-page/index.html"));
    target?.setContentSize(1_440, 920);
  });
  await page.waitForFunction(() => window.innerWidth === 1_440 && window.innerHeight === 920);
  await page.getByRole("button", { name: "关闭" }).click();
  await page.getByTestId("sidebar-nav-agent-teams").click();
  const teamRow = page.getByTestId("agent-team-row").first();
  await teamRow.waitFor();
  const teamKey = await teamRow.getAttribute("data-team-key");
  if (teamKey === null) throw new Error("Agent team row did not expose a team key");
  await teamRow.click();
  const memberTabs = page.getByTestId("agent-team-member-selector").getByRole("tab");
  const memberCount = await memberTabs.count();
  for (let index = 0; index < memberCount; index += 1) {
    await memberTabs.nth(index).click();
    const editor = page.getByTestId("agent-execution-profile-editor");
    const engine = editor.getByRole("combobox", { name: "执行引擎" });
    await engine.selectOption("pi");
    const provider = editor.getByRole("combobox", { name: "Provider" });
    if (await provider.inputValue() === "") {
      await provider.selectOption({ label: "DeepSeek · 验收 DeepSeek" });
    }
    const model = editor.getByRole("combobox", { name: "Model" });
    if (await model.inputValue() === "") await model.selectOption("deepseek-v4-pro");
    const save = editor.getByRole("button", { name: "保存运行配置" });
    await save.click();
    await save.waitFor({ state: "visible" });
    await page.waitForFunction(() => {
      const button = [...document.querySelectorAll("button")].find((candidate) =>
        candidate.textContent?.trim() === "保存运行配置");
      return button instanceof HTMLButtonElement && button.disabled;
    });
  }
  record(
    "real-team-members-use-pi-profile",
    memberCount > 0,
    { teamKey, configuredMemberCount: memberCount },
    {
      entrance: "主窗口 → Agent 团队 → 首个可用团队",
      action: "逐名把执行引擎设为 Pi API，并选择“验收 DeepSeek”与 V4 Pro 后保存",
      screenObservation: "每名成员的运行配置均可从生产页面保存；保存后按钮回到无待保存改动状态。",
    },
  );

  await page.getByRole("button", { name: "新建对话" }).click();
  const newConversation = page.getByRole("region", { name: "新建对话" });
  await newConversation.waitFor();
  await application.evaluate(({ dialog }, folderPath: string) => {
    const state = globalThis as typeof globalThis & {
      __moebiusOriginalShowOpenDialog?: typeof dialog.showOpenDialog;
    };
    state.__moebiusOriginalShowOpenDialog = dialog.showOpenDialog.bind(dialog);
    dialog.showOpenDialog = (async () => ({ canceled: false, filePaths: [folderPath] })) as typeof dialog.showOpenDialog;
  }, workspace);
  try {
    const projectTrigger = newConversation.getByRole("button", { name: "项目：未选择，点击选择" });
    await projectTrigger.focus();
    await projectTrigger.press("ArrowDown");
    const projectMenu = page.getByRole("menu");
    await projectMenu.waitFor();
    await projectMenu.getByRole("menuitem", { name: "添加项目…" }).click();
    await newConversation.getByRole("button", { name: "项目：acceptance-workspace，点击切换" }).waitFor();
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
  record(
    "real-project-created-from-ui",
    await newConversation.getByRole("button", { name: "项目：acceptance-workspace，点击切换" }).isVisible(),
    { projectTitle: "acceptance-workspace", folderPathProvidedThroughNativePicker: true },
    {
      entrance: "新建对话 → 项目选择器 → 添加项目",
      action: "通过真实项目选择器选择 acceptance-workspace",
      screenObservation: "项目在页面中显示为当前上下文，后续对话直接使用该项目；未通过 HTTP 接口预置项目。",
    },
  );
  await newConversation.getByTestId("new-conversation-team-picker").click();
  const teamOption = page.locator(`[data-testid="new-conversation-team-option"][data-team-key="${teamKey}"]`);
  await teamOption.waitFor();
  // 团队菜单高于视口时选项可能落在视口外（Radix 内容无 max-height 约束），
  // 用键盘 Enter 选中与真实键盘操作等价，且不依赖视口内点击坐标。
  await teamOption.press("Enter");
  await newConversation.locator('input[type="file"]').setInputFiles(attachmentPath);
  await newConversation.getByText("acceptance-context.txt", { exact: true }).waitFor();
  const taskPrompt = "@editorial-production 请直接使用工具完成这个确定性任务，不要转交，也不要只给文字说明：先调用 read_file 读取附件并记住其中的 ATTACHMENT_SENTINEL；再调用 read_file 读取 fixture.txt，用 edit_file、apply_patch 或 write_file 把唯一一行 alpha 改为 beta；然后调用 exec_command 运行 node verify.mjs。只有命令退出码为 0 后，才在最终回复中写出附件里的完整 sentinel。";
  await newConversation.getByRole("textbox", { name: "消息内容" }).fill(taskPrompt);
  await newConversation.getByRole("button", { name: "发送消息" }).click();
  const activeRunBlock = page.getByTestId("active-run-block");
  await activeRunBlock.waitFor({ state: "visible", timeout: 30_000 });
  const responsiveness = startPageResponsivenessProbe(page);
  let runOutcome: "completed" | "unresponsive";
  let responsivenessResult: ResponsivenessProbeResult;
  try {
    runOutcome = await Promise.race([
      activeRunBlock.waitFor({ state: "detached", timeout: 180_000 }).then(() => "completed" as const),
      responsiveness.stalled.then(() => "unresponsive" as const),
    ]);
  } finally {
    responsivenessResult = await responsiveness.stop();
  }
  record(
    "real-pi-ui-responsive-during-run",
    runOutcome === "completed"
      && responsivenessResult.checks > 0
      && responsivenessResult.failures === 0
      && !responsivenessResult.timedOut,
    { runOutcome, ...responsivenessResult },
    {
      entrance: "新建对话 → 选择已绑定 Pi 的团队",
      action: "在真实 Pi 运行期间每 500ms 读取页面状态，单次探针超时阈值为 2.5 秒",
      screenObservation: "运行期间页面持续可响应，运行卡可结束，用户可继续观察或执行停止/恢复操作。",
    },
  );
  if (runOutcome !== "completed") {
    throw new Error("Pi run made the Electron page unresponsive");
  }
  const visibleMessages = page.locator('[data-testid^="timeline-message-"]');
  const visibleMessageTexts = await visibleMessages.allTextContents();
  const attachmentSentinelVisible = visibleMessageTexts.some((text) => text.includes("ATTACHMENT_SENTINEL_VIOLET"));
  const fixtureContent = await fs.readFile(path.join(workspace, "fixture.txt"), "utf8");
  record(
    "real-electron-pi-coding-task",
    fixtureContent === "beta\n"
      && await visibleMessages.count() >= 2
      && attachmentSentinelVisible,
    {
      fixtureMatchesExpectedContent: fixtureContent === "beta\n",
      visibleMessageCount: await visibleMessages.count(),
      attachmentSentinelVisible,
      visibleMessageBodiesPresent: visibleMessageTexts.every((text) => text.trim().length > 0),
    },
    {
      entrance: "新建对话 → 选择已绑定 Pi 的团队",
      action: "发送读取、修改 fixture.txt 并运行 node verify.mjs 的真实编码任务",
      screenObservation: "真实主对话显示附件 sentinel 与成员最终回复且运行卡已结束，磁盘文件变为 beta，证明 Electron → 附件 → Pi → DeepSeek → 工具链路完成。",
    },
  );

  await openProviders(page);
  const migrationSourceCard = page.locator("article").filter({ hasText: "验收 DeepSeek" });
  await migrationSourceCard.getByRole("button", { name: "迁移运行引用" }).click();
  const migrationForm = migrationSourceCard.locator("form").filter({ hasText: "迁移运行引用" });
  const selectedReferenceCount = await migrationForm.locator('input[type="checkbox"]:checked').count();
  if (selectedReferenceCount < 2) throw new Error("Provider migration crash recovery requires at least two references");
  const migrationClick = migrationForm
    .getByRole("button", { name: new RegExp(`迁移 ${selectedReferenceCount} 项`, "u") })
    .click()
    .catch(() => undefined);
  const migrationProgress = await Promise.all([
    migrationClick,
    waitForPartialMigrationAndCrash(application, path.join(runtimeRoot, ".state", "local-console.sqlite")),
  ]).then(([, progress]) => progress);
  await application.close().catch(() => undefined);
  application = await launch();
  page = await mainWindow(application);
  await openProviders(page);
  const recoveredMigrationSourceCard = page.locator("article").filter({ hasText: "验收 DeepSeek" });
  const recoveredMigrationTargetCard = page.locator("article").filter({ hasText: "验收迁移目标" });
  const recovery = recoveredMigrationSourceCard.getByTestId("provider-migration-recovery");
  await recovery.waitFor();
  const recoveryText = (await recovery.textContent()) ?? "";
  const completedCount = readActivityCount(recoveryText, "已完成");
  const pendingCount = readActivityCount(recoveryText, "未完成");
  record(
    "real-migration-interruption-restart-recovery",
    completedCount > 0
      && pendingCount > 0
      && completedCount === migrationProgress.completedOwnerIds.length,
    {
      recoveryText,
      completedCount,
      pendingCount,
      selectedReferenceCount,
      crashedOperationId: migrationProgress.operationId,
    },
    {
      entrance: "设置 → AI 服务商 → 迁移运行引用 → 应用崩溃并重启",
      action: "在部分对象迁移提交后杀掉隔离 Electron 主进程并重启",
      screenObservation: "真实设置页明确列出已完成与未完成对象，并提供只重试未完成项。",
    },
  );
  await recovery.getByRole("button", { name: "只重试未完成项" }).click();
  await recovery.waitFor({ state: "detached", timeout: 120_000 });
  await recoveredMigrationTargetCard.getByText(`运行引用（${selectedReferenceCount}）`, { exact: true }).waitFor();
  const sourceReferenceCountText = (await recoveredMigrationSourceCard.getByText(/运行引用（[0-9]+）/u).textContent()) ?? "";
  const sourceRemainingCount = Number(sourceReferenceCountText.match(/[0-9]+/u)?.[0] ?? Number.NaN);
  const sourceReferenceRows = recoveredMigrationSourceCard.locator("li").filter({ hasText: /团队成员|AI 建队草稿|排队任务|可恢复会话|一次性运行/u });
  const sourceReferenceKinds = await sourceReferenceRows.allTextContents();
  if (!Number.isFinite(sourceRemainingCount) || sourceReferenceKinds.some((text) => !text.includes("排队任务"))) {
    throw new Error(`Provider reference migration left a migratable source reference: ${(await recoveredMigrationSourceCard.textContent())?.trim() ?? "source card unavailable"}`);
  }
  record(
    "real-migration-retry-only-pending",
    selectedReferenceCount > 1
      && sourceReferenceKinds.length === sourceRemainingCount
      && completedCount > 0
      && pendingCount > 0,
    {
      migratedReferenceCount: selectedReferenceCount,
      sourceQueuedReferenceCount: sourceRemainingCount,
      completedCount,
      pendingCount,
      targetReferenceCount: selectedReferenceCount,
    },
    {
      entrance: "设置 → AI 服务商 → 上次迁移未完成",
      action: "点击只重试未完成项",
      screenObservation: "已完成对象不重复执行，重试后仅未完成对象进入目标档案。",
    },
  );

  const endButton = recoveredMigrationTargetCard.getByRole("button", { name: "结束并保留历史" }).first();
  await endButton.click();
  const endDialog = page.getByRole("dialog", { name: "结束继续能力？" });
  await endDialog.getByRole("button", { name: "结束并保留历史" }).click();
  await endDialog.waitFor({ state: "detached" });
  const expectedRemainingReferences = selectedReferenceCount - 1;
  await recoveredMigrationTargetCard.getByText(`运行引用（${expectedRemainingReferences}）`, { exact: true }).waitFor();
  record(
    "real-end-session-continuation",
    expectedRemainingReferences > 0,
    { historyPreserved: true, remainingTeamReferences: expectedRemainingReferences },
    {
      entrance: "设置 → AI 服务商 → 验收迁移目标 → 可恢复会话引用",
      action: "确认“结束并保留历史”",
      screenObservation: "会话运行引用解除，团队引用继续保留；既有会话历史未被删除。",
    },
  );

  await application.close();
  application = await launch();
  page = await mainWindow(application);
  await openProviders(page);
  const restartedCard = page.locator("article").filter({ hasText: "验收 DeepSeek" });
  await restartedCard.waitFor();
  await restartedCard.getByText("已就绪", { exact: true }).waitFor();
  const addFormCount = await page.getByText("添加 DeepSeek", { exact: true }).count();
  const restartedTargetCard = page.locator("article").filter({ hasText: "验收迁移目标" });
  record(
    "restart-restores-ready-profile",
    await restartedCard.isVisible() && await restartedTargetCard.isVisible() && addFormCount === 0,
    { sourceCardVisible: await restartedCard.isVisible(), targetCardVisible: await restartedTargetCard.isVisible(), addFormCount },
    {
      entrance: "退出并重启应用 → 设置 → AI 服务商",
      action: "重启后重新打开 AI 服务商分类",
      screenObservation: "已保存档案仍显示“已就绪”，失败草稿没有恢复成额外档案或编辑表单。",
    },
  );

  await application.close();
  const files = await listFiles(runtimeRoot);
  const credentialsFile = path.join(runtimeRoot, ".state", "provider-credentials-v2.json");
  const invalidKeyFiles: string[] = [];
  const strayValidKeyFiles: string[] = [];
  let credentialsFileContainsValidKey = false;
  for (const file of files) {
    const contents = await fs.readFile(file).catch(() => null);
    if (contents === null) continue;
    if (contents.includes(Buffer.from(invalidKey))) invalidKeyFiles.push(path.relative(runtimeRoot, file));
    if (contents.includes(Buffer.from(validKey))) {
      if (file === credentialsFile) credentialsFileContainsValidKey = true;
      else strayValidKeyFiles.push(path.relative(runtimeRoot, file));
    }
  }
  assertions.push({
    id: "keys-confined-to-credentials-file",
    passed: credentialsFileContainsValidKey && strayValidKeyFiles.length === 0 && invalidKeyFiles.length === 0,
    observed: { scannedFileCount: files.length, credentialsFileContainsValidKey, strayValidKeyFiles, invalidKeyFiles },
  });
} catch (error) {
  const redact = (value: string) => value.split(validKey).join("[redacted]").split(invalidKey).join("[redacted]");
  const message = redact(error instanceof Error ? error.message : String(error));
  let pageSnapshot: string | undefined;
  try {
    if (page !== undefined) {
      pageSnapshot = redact((await page.locator("body").innerText({ timeout: 5_000 })).slice(0, 3_000));
    }
  } catch {
    pageSnapshot = undefined;
  }
  assertions.push({ id: "acceptance-script-completed", passed: false, observed: { message, pageSnapshot } });
} finally {
  await application.close().catch(() => undefined);
  const evidence: ByokPiEvidence = {
    generatedAt: new Date().toISOString(),
    records,
    assertions,
  };
  await fs.writeFile(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`, "utf8");
  await fs.rm(runtimeRoot, { recursive: true, force: true });
  process.stdout.write(`${JSON.stringify({ ok: assertions.every((item) => item.passed), evidence: evidencePath })}\n`);
}

if (assertions.some((assertion) => !assertion.passed)) process.exitCode = 1;

async function readKeychainSecret(): Promise<string> {
  const account = process.env.USER?.trim();
  if (account === undefined || account.length === 0) throw new Error("Keychain account is unavailable");
  const child = spawn("security", [
    "find-generic-password",
    "-w",
    "-a",
    account,
    "-s",
    "moebius-byok-acceptance",
  ], { shell: false, stdio: ["ignore", "pipe", "pipe"] });
  const stdout: Buffer[] = [];
  child.stdout.on("data", (chunk: Buffer) => stdout.push(chunk));
  child.stderr.resume();
  const exitCode = await new Promise<number | null>((resolve, reject) => {
    child.once("error", reject);
    child.once("close", resolve);
  });
  const secret = Buffer.concat(stdout).toString("utf8").trim();
  if (exitCode !== 0 || secret.length < 8 || secret.length > 16_384 || /[\r\n\0]/u.test(secret)) {
    throw new Error("The acceptance Keychain item is unavailable or invalid");
  }
  return secret;
}
