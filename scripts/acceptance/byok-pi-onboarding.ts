import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { _electron as electron, type ElectronApplication, type Page } from "playwright";

import { createAcceptanceOutputDirectory } from "./temp-output.js";

interface RealAppRecord {
  environment: "真机";
  entrance: string;
  action: string;
  screenObservation: string;
  consistent: boolean;
}

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const desktopRoot = path.join(projectRoot, "desktop");
const packagedApp = readOption("--app");
const runtimeRoot = await fs.mkdtemp(path.join(os.tmpdir(), "moebius-byok-onboarding-"));
const isolatedHome = path.join(runtimeRoot, "home");
const isolatedBin = path.join(runtimeRoot, "empty-bin");
await Promise.all([
  fs.mkdir(isolatedHome, { recursive: true }),
  fs.mkdir(isolatedBin, { recursive: true }),
]);
const evidenceRoot = await createAcceptanceOutputDirectory("byok-pi-onboarding");
const evidencePath = path.join(evidenceRoot, "byok-pi-onboarding-evidence.json");
const apiKey = await readKeychainSecret();
const records: RealAppRecord[] = [];
const assertions: Array<{ id: string; passed: boolean; observed: unknown }> = [];

const record = (
  id: string,
  passed: boolean,
  observed: unknown,
  realApp: Omit<RealAppRecord, "environment" | "consistent">,
): void => {
  assertions.push({ id, passed, observed });
  records.push({ environment: "真机", ...realApp, consistent: passed });
};

async function launch(): Promise<ElectronApplication> {
  const launchOptions = {
    cwd: desktopRoot,
    env: {
      ...process.env,
      HOME: isolatedHome,
      USERPROFILE: isolatedHome,
      PATH: [isolatedBin, "/usr/bin", "/bin", "/usr/sbin", "/sbin"].join(path.delimiter),
      SHELL: "/bin/false",
      MOEBIUS_DATA_ROOT: runtimeRoot,
    },
  };
  return packagedApp === null
    ? await electron.launch({ ...launchOptions, args: [desktopRoot] })
    : await electron.launch({
        ...launchOptions,
        executablePath: path.join(path.resolve(packagedApp), "Contents", "MacOS", "Moebius"),
        args: [],
      });
}

async function onboardingPage(application: ElectronApplication): Promise<Page> {
  const page = application.windows()[0] ?? await application.waitForEvent("window", { timeout: 30_000 });
  await page.waitForLoadState("domcontentloaded");
  await page.getByTestId("onboarding-step-1").waitFor();
  return page;
}

let application = await launch();
try {
  let page = await onboardingPage(application);
  await page.waitForFunction(() => document.querySelectorAll('[data-testid^="cli-"][data-testid$="-checking"]').length === 0);
  const cliStatuses = await page.locator('[data-testid^="cli-"]').evaluateAll((elements) =>
    elements.map((element) => ({
      testId: element.getAttribute("data-testid") ?? "",
      text: element.textContent?.replace(/\s+/gu, " ").trim() ?? "",
    })),
  );
  const readyCliCount = cliStatuses.filter((status) => status.testId.endsWith("-ready")).length;
  const expectedCliIds = ["codex", "claude", "kimi"];
  const observedCliIds = new Set(cliStatuses.map((status) => status.testId.split("-")[1] ?? ""));
  const allCliRowsPresent = cliStatuses.length === expectedCliIds.length
    && expectedCliIds.every((cli) => observedCliIds.has(cli));
  const apiOnlyCliIsolated = allCliRowsPresent && readyCliCount === 0;
  record(
    "api-only-cli-isolation",
    apiOnlyCliIsolated,
    { readyCliCount, cliStatuses, allCliRowsPresent, isolatedHome: true },
    {
      entrance: "首次启动 → 执行环境",
      action: "在隔离 HOME 与 PATH 的真实 Electron 引导页等待三套 CLI 检查完成",
      screenObservation: "Codex、Claude Code、Kimi 均显示为非 ready，API Provider 是唯一可用执行环境。",
    },
  );
  if (!apiOnlyCliIsolated) {
    throw new Error(
      `API-only acceptance requires all three CLIs to be non-ready; observed ${readyCliCount} ready rows`,
    );
  }
  await page.getByRole("button", { name: "添加服务商" }).click();
  await page.getByLabel("档案名称").fill("引导 DeepSeek");
  await page.getByLabel("API Key").fill(apiKey);
  await page.getByLabel("验证模型").selectOption("deepseek-v4-pro");
  await page.getByRole("button", { name: "验证并保存" }).click();
  const readyCard = page.locator("article").filter({ hasText: "引导 DeepSeek" });
  await readyCard.getByText("已就绪", { exact: true }).waitFor({ timeout: 120_000 });
  const continueButton = page.getByRole("button", { name: "继续" });
  record(
    "onboarding-provider-enables-continuation",
    await continueButton.isEnabled() && readyCliCount === 0,
    { readyCliCount, cliStatuses, providerReady: true, continueEnabled: await continueButton.isEnabled() },
    {
      entrance: "首次启动 → 执行环境 → 添加服务商",
      action: "在真实引导页输入 Key，选择 DeepSeek V4 Pro，并点击“验证并保存”",
      screenObservation: "引导页出现“引导 DeepSeek · 已就绪”，Provider 独立满足执行环境门槛并启用继续按钮。",
    },
  );

  await continueButton.click();
  await page.getByTestId("onboarding-step-2").waitFor();
  const replaceButton = page.getByRole("button", { name: "改用这个 API" });
  const replacementVisible = await replaceButton.isVisible();
  if (replacementVisible) {
    await replaceButton.click();
    await page.getByTestId("onboarding-api-replacement").waitFor({ state: "detached", timeout: 30_000 });
  }
  const selectedTeam = page
    .getByTestId("onboarding-step-2")
    .getByRole("button")
    .filter({ has: page.getByText("已选择", { exact: true }) });
  await selectedTeam.waitFor();
  const compatibilityWarningCount = await selectedTeam.getByTestId("team-compatibility-warning").count();
  const selectedTeamText = (await selectedTeam.innerText()).replace(/\s+/gu, " ").trim();
  record(
    "api-only-team-replacement",
    replacementVisible && compatibilityWarningCount === 0,
    {
      replacementVisible,
      replacementActionClosed: await page.getByTestId("onboarding-api-replacement").count() === 0,
      compatibilityWarningCount,
      selectedTeamText,
    },
    {
      entrance: "首次启动 → 选择 Agent 团队",
      action: "对当前团队点击“改用这个 API”并等待原子保存完成",
      screenObservation: "不可用 CLI 成员被显式改为 Pi API，页面不再显示替换操作。",
    },
  );

  await page.getByRole("button", { name: "继续" }).click();
  await page.getByTestId("onboarding-step-3").waitFor();
  await page.getByRole("button", { name: "继续" }).click();
  await page.getByTestId("onboarding-step-4").waitFor();
  await page.getByRole("button", { name: "开始使用" }).click();
  await page.getByRole("button", { name: "设置" }).waitFor();
  record(
    "provider-onboarding-completes",
    true,
    { mainConsoleVisible: true },
    {
      entrance: "首次启动 → 准备就绪",
      action: "点击“开始使用”",
      screenObservation: "真实主操作台打开，使用 API Provider 的用户完成首次引导。",
    },
  );

  await application.close();
  application = await launch();
  page = await application.firstWindow();
  await page.getByRole("button", { name: "设置" }).waitFor();
  await page.getByRole("button", { name: "设置" }).click();
  await page.getByRole("button", { name: "AI 服务商" }).click();
  await page.locator("article").filter({ hasText: "引导 DeepSeek" }).getByText("已就绪", { exact: true }).waitFor();
  const onboardingDidNotReturn = await page.getByTestId("onboarding-step-1").count() === 0;
  record(
    "provider-onboarding-restart",
    onboardingDidNotReturn,
    { onboardingDidNotReturn, providerReadyAfterRestart: true },
    {
      entrance: "完成引导后退出并重启应用",
      action: "重启后打开设置 → AI 服务商",
      screenObservation: "应用直接进入主操作台，Provider 仍为“已就绪”，证明引导进度与 Provider 凭据可恢复。",
    },
  );

  const rootPid = application.process().pid;
  const processTree = await readProcessTree(rootPid);
  await application.close();
  await new Promise((resolve) => setTimeout(resolve, 500));
  const remainingPids = processTree.filter(isProcessAlive);
  record(
    "packaged-process-tree-cleanup",
    remainingPids.length === 0,
    { launchMode: packagedApp === null ? "dev" : "packaged-arm64", observedProcessCount: processTree.length, remainingPids },
    {
      entrance: "运行完成后的真实应用进程树",
      action: "退出应用并等待有界清理",
      screenObservation: "应用窗口关闭，已观察到的主进程与 helper/Pi 子进程均不再存活。",
    },
  );

  const files = await listFiles(runtimeRoot);
  const credentialsFile = path.join(runtimeRoot, ".state", "provider-credentials-v2.json");
  const keyBytes = Buffer.from(apiKey);
  const strayKeyFiles: string[] = [];
  let credentialsFileContainsKey = false;
  for (const file of files) {
    const bytes = await fs.readFile(file).catch(() => null);
    if (bytes?.includes(keyBytes) !== true) continue;
    if (file === credentialsFile) credentialsFileContainsKey = true;
    else strayKeyFiles.push(path.relative(runtimeRoot, file));
  }
  assertions.push({
    id: "onboarding-key-confined-to-credentials-file",
    passed: credentialsFileContainsKey && strayKeyFiles.length === 0,
    observed: { scannedFileCount: files.length, credentialsFileContainsKey, strayKeyFiles },
  });
} catch (error) {
  assertions.push({
    id: "acceptance-script-completed",
    passed: false,
    observed: { message: (error instanceof Error ? error.message : String(error)).split(apiKey).join("[redacted]") },
  });
} finally {
  await application.close().catch(() => undefined);
  await fs.writeFile(evidencePath, `${JSON.stringify({
    generatedAt: new Date().toISOString(),
    environment: packagedApp === null ? "真实 Electron dev 等价应用" : "真实签名 macOS arm64 Electron 应用",
    records,
    assertions,
  }, null, 2)}\n`, "utf8");
  await fs.rm(runtimeRoot, { recursive: true, force: true });
  process.stdout.write(`${JSON.stringify({ ok: assertions.every((item) => item.passed), evidence: evidencePath })}\n`);
}

if (assertions.some((assertion) => !assertion.passed)) process.exitCode = 1;

function readOption(name: string): string | null {
  const index = process.argv.indexOf(name);
  if (index < 0) return null;
  const value = process.argv[index + 1]?.trim();
  if (!value) throw new Error(`${name} requires a value`);
  return value;
}

async function readKeychainSecret(): Promise<string> {
  const account = process.env.USER?.trim();
  if (!account) throw new Error("Keychain account is unavailable");
  const child = spawn("security", ["find-generic-password", "-w", "-a", account, "-s", "moebius-byok-acceptance"], {
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
  const secret = Buffer.concat(stdout).toString("utf8").trim();
  if (exitCode !== 0 || secret.length < 8 || secret.length > 16_384 || /[\r\n\0]/u.test(secret)) {
    throw new Error("The acceptance Keychain item is unavailable or invalid");
  }
  return secret;
}

async function readProcessTree(rootPid: number): Promise<number[]> {
  const child = spawn("ps", ["-axo", "pid=,ppid="], { shell: false, stdio: ["ignore", "pipe", "pipe"] });
  const stdout: Buffer[] = [];
  child.stdout.on("data", (chunk: Buffer) => stdout.push(chunk));
  child.stderr.resume();
  await new Promise<void>((resolve, reject) => {
    child.once("error", reject);
    child.once("close", () => resolve());
  });
  const children = new Map<number, number[]>();
  for (const line of Buffer.concat(stdout).toString("utf8").split("\n")) {
    const [pidText, ppidText] = line.trim().split(/\s+/u);
    const pid = Number(pidText);
    const ppid = Number(ppidText);
    if (!Number.isInteger(pid) || !Number.isInteger(ppid)) continue;
    children.set(ppid, [...(children.get(ppid) ?? []), pid]);
  }
  const result = [rootPid];
  for (let index = 0; index < result.length; index += 1) {
    result.push(...(children.get(result[index]!) ?? []));
  }
  return [...new Set(result)];
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function listFiles(root: string): Promise<string[]> {
  const files: string[] = [];
  const visit = async (current: string): Promise<void> => {
    for (const entry of await fs.readdir(current, { withFileTypes: true })) {
      const target = path.join(current, entry.name);
      if (entry.isDirectory()) await visit(target);
      else if (entry.isFile()) files.push(target);
    }
  };
  await visit(root);
  return files;
}
