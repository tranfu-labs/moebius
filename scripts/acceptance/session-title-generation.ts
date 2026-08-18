/**
 * 真机验收：桌面端「新对话 → 首条消息」自动生成标题（create + initialMessage 触发面）。
 *
 * 入口与动作全部走真实用户路径：侧边栏「新建对话」→ 项目选择器（原生对话框 stub 提供文件夹）→
 * 输入首条消息 → 点击「发送消息」→ 观察标题从默认截断变为模型生成（真实 codex one-shot）。
 *
 * 使用隔离数据根（MOEBIUS_DATA_ROOT）启动真实 Electron（dev 形态），不影响用户日常数据根；
 * evidence 写入系统临时目录并打印路径。标题生成依赖本机可用执行引擎（codex 登录态或 Pi）；
 * 引擎不可用导致 one-shot 失败时如实报告「前提不成立」，不冒充通过。
 *
 * 用法：pnpm exec tsx scripts/acceptance/session-title-generation.ts [--hold]
 */
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { _electron as electron, type ElectronApplication, type Page } from "playwright";

const args = process.argv.slice(2);
const hold = args.includes("--hold");
if (args.length > 0 && !hold) {
  throw new Error("Usage: pnpm exec tsx scripts/acceptance/session-title-generation.ts [--hold]");
}

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const desktopRoot = path.join(projectRoot, "desktop");
const runtimeRoot = await fs.mkdtemp(path.join(os.tmpdir(), "moebius-title-acceptance-"));
const fixtureProjectRoot = path.join(runtimeRoot, "fixture-project");
const reportDir = await fs.mkdtemp(path.join(os.tmpdir(), "moebius-title-acceptance-evidence-"));

const FIRST_MESSAGE = "推特效果平平，想改进推广策略，先看竞品怎么做";
// 默认标题 = 首条消息按显示宽度 32 截断（同一算法），模型生成的提炼标题不应等于它。
const DEFAULT_TITLE_PREFIX = "推特效果平平，想改进推广策略，先看竞品怎";

interface SessionSummary {
  sessionId: string;
  title: string;
  runningCount: number;
}

interface ConsoleState {
  selectedSession: { sessionId: string; title: string } | null;
  projects: Array<{ sessions: SessionSummary[] }>;
}

async function runProcess(command: string, argsList: string[]): Promise<void> {
  const { spawn } = await import("node:child_process");
  await new Promise<void>((resolve, reject) => {
    const child = spawn(command, argsList, { stdio: "ignore" });
    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${command} exited with ${String(code)}`));
    });
  });
}

async function requestJson<T = unknown>(
  apiBase: string,
  pathname: string,
  init: RequestInit = {},
  expectedStatus = 200,
): Promise<T> {
  const response = await fetch(new URL(pathname, apiBase), {
    ...init,
    headers: { "content-type": "application/json", ...init.headers },
  });
  if (response.status !== expectedStatus) {
    throw new Error(`${init.method ?? "GET"} ${pathname} failed: ${response.status} ${await response.text()}`);
  }
  return await response.json() as T;
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

async function waitForState(
  apiBase: string,
  predicate: (state: ConsoleState) => string | null,
  describe: string,
  timeoutMs: number,
): Promise<string> {
  const deadline = Date.now() + timeoutMs;
  let last: string | null = null;
  while (Date.now() < deadline) {
    const state = await requestJson<ConsoleState>(apiBase, "/api/local-console/state");
    const value = predicate(state);
    if (value !== null) return value;
    last = state.selectedSession?.title ?? null;
    await new Promise((resolve) => setTimeout(resolve, 400));
  }
  throw new Error(`timed out waiting for ${describe} (last title: ${String(last)})`);
}

const evidence: Record<string, unknown> = {};
const observations: Array<{ entrance: string; action: string; screenObservation: string }> = [];

function record(name: string, ok: boolean, payload: Record<string, unknown>, note: string): void {
  evidence[name] = { ok, ...payload };
  console.log(`${ok ? "PASS" : "FAIL"} ${name}: ${JSON.stringify(payload)}`);
  observations.push({
    entrance: "主窗口 → 新建对话 → 项目选择器 → composer",
    action: name,
    screenObservation: note,
  });
}

let application: ElectronApplication | null = null;

try {
  await fs.mkdir(fixtureProjectRoot, { recursive: true });
  await fs.writeFile(path.join(fixtureProjectRoot, "README.md"), "session title acceptance baseline\n", "utf8");
  await runProcess("git", ["init", fixtureProjectRoot]);
  await runProcess("git", ["-C", fixtureProjectRoot, "add", "README.md"]);
  // 跳过 onboarding（数据根初始化的既有前置；项目添加走真实 UI，不预置会话）
  await fs.writeFile(path.join(runtimeRoot, ".onboarding-completed"), `${new Date().toISOString()}\n`, "utf8");

  // 排除宿主环境的 ELECTRON_RUN_AS_NODE（会让 Electron 二进制以 Node 模式运行，无法启动主进程）
  const { ELECTRON_RUN_AS_NODE: _ignored, ...launchEnv } = process.env;
  application = await electron.launch({
    args: [desktopRoot],
    cwd: desktopRoot,
    env: {
      ...launchEnv,
      MOEBIUS_DATA_ROOT: runtimeRoot,
      ELECTRON_DISABLE_SECURITY_WARNINGS: "true",
    },
  });
  const page = await application.firstWindow();

  // 1) 用户入口：侧边栏「新建对话」
  await page.getByRole("button", { name: "新建对话" }).click();
  const newConversation = page.getByRole("region", { name: "新建对话" });
  await newConversation.waitFor();

  // 2) 项目选择器（真实 UI + 原生对话框 stub 提供文件夹路径）
  await application.evaluate(({ dialog }, folderPath: string) => {
    const state = globalThis as typeof globalThis & {
      __moebiusTitleAcceptanceOriginalDialog?: typeof dialog.showOpenDialog;
    };
    state.__moebiusTitleAcceptanceOriginalDialog = dialog.showOpenDialog.bind(dialog);
    dialog.showOpenDialog = (async () => ({ canceled: false, filePaths: [folderPath] })) as typeof dialog.showOpenDialog;
  }, fixtureProjectRoot);
  try {
    const projectTrigger = newConversation.getByRole("button", { name: "项目：未选择，点击选择" });
    await projectTrigger.focus();
    await projectTrigger.press("ArrowDown");
    const projectMenu = page.getByRole("menu");
    await projectMenu.waitFor();
    await projectMenu.getByRole("menuitem", { name: "添加项目…" }).click();
    await newConversation.getByRole("button", { name: "项目：fixture-project，点击切换" }).waitFor();
  } finally {
    await application.evaluate(({ dialog }) => {
      const state = globalThis as typeof globalThis & {
        __moebiusTitleAcceptanceOriginalDialog?: typeof dialog.showOpenDialog;
      };
      if (state.__moebiusTitleAcceptanceOriginalDialog !== undefined) {
        dialog.showOpenDialog = state.__moebiusTitleAcceptanceOriginalDialog;
        delete state.__moebiusTitleAcceptanceOriginalDialog;
      }
    });
  }

  // 3) 真实用户动作：输入首条消息并发送
  const composer = newConversation.getByRole("textbox", { name: "消息内容" });
  await composer.fill(FIRST_MESSAGE);
  await newConversation.getByRole("button", { name: "发送消息" }).click();
  const sentAt = Date.now();

  // 4) 观察：会话出现（默认截断标题）→ 标题被模型生成标题替换
  const apiBase = await waitForApiBase(page);
  const defaultTitleSeen = await waitForState(
    apiBase,
    (state) => (state.selectedSession?.title ?? "").startsWith(DEFAULT_TITLE_PREFIX)
      ? state.selectedSession!.title
      : null,
    "created session with default truncated title",
    30_000,
  ).catch(() => null); // 生成可能快于首次轮询，允许直接进入生成态

  const generatedTitle = await waitForState(
    apiBase,
    (state) => {
      const title = state.selectedSession?.title ?? "";
      if (title === "" || title === "新对话") return null;
      if (title.startsWith(DEFAULT_TITLE_PREFIX)) return null;
      return title;
    },
    "generated title replacing the default truncation",
    150_000,
  );
  const generatedInMs = Date.now() - sentAt;
  record(
    "desktop-new-conversation-auto-title",
    true,
    { firstMessage: FIRST_MESSAGE, defaultTitleSeen, generatedTitle, generatedInMs },
    `发送首条消息后 ${generatedInMs}ms，标题从默认截断（${String(defaultTitleSeen)}）变为模型生成「${generatedTitle}」；主界面与 API 状态一致（见下）。`,
  );

  // 5) UI 侧一致性：主界面可见同一生成标题
  await page.getByText(generatedTitle, { exact: true }).first().waitFor({ timeout: 15_000 });
  record(
    "generated-title-visible-in-ui",
    true,
    { generatedTitle },
    `主内容/侧栏可见与 API 一致的标题「${generatedTitle}」。`,
  );

  // 6) 收尾：等待主流程 run 结束（标题生成与主 run 并行；主 run 为真实 codex 回复）。
  //    主 run 慢不阻塞验收结论——本次验收对象是标题生成；超时只记录不失败。
  const primaryRunSettled = await waitForState(
    apiBase,
    (state) => {
      const session = state.projects.flatMap((project) => project.sessions)
        .find((entry) => entry.sessionId === state.selectedSession?.sessionId);
      return session !== undefined && session.runningCount === 0 ? "settled" : null;
    },
    "primary run to finish",
    240_000,
  ).catch(() => null);
  evidence.primaryRunSettled = primaryRunSettled !== null;
  await page.waitForTimeout(1_000);

  const screenshotPath = path.join(reportDir, "final.png");
  await page.screenshot({ path: screenshotPath }).catch(() => undefined);
  evidence.screenshotPath = screenshotPath;

  if (hold) {
    console.log(`HOLD: 窗口保留（${runtimeRoot}），Ctrl+C 结束`);
    await new Promise((resolve) => setTimeout(resolve, 600_000));
  }
} catch (error) {
  evidence.failure = error instanceof Error ? error.message : String(error);
  console.error(`FAILED: ${evidence.failure}`);
} finally {
  await application?.close().catch(() => undefined);
}

const reportPath = path.join(reportDir, "evidence.json");
await fs.writeFile(reportPath, JSON.stringify({ evidence, observations }, null, 2), "utf8");
console.log(`Evidence: ${reportPath}`);
if (evidence.failure !== undefined) process.exitCode = 1;
