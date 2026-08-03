import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { _electron as electron, type ElectronApplication, type Locator, type Page } from "playwright";

import { createAcceptanceOutputDirectory } from "./temp-output.js";

const PRODUCTION_APP_PATH = "/Applications/Moebius.app";
const PRODUCTION_BUNDLE_IDENTIFIER = "io.tranfu.moebius";
const REQUIRED_ACCEPTANCE_IDS = [
  "UPD-01", "UPD-02", "UPD-03", "UPD-04", "UPD-05", "UPD-06", "UPD-07", "UPD-08",
  "UPD-09", "UPD-10", "UPD-11", "UPD-12", "QUIT-01", "QUIT-02", "QUIT-03", "QUIT-04",
  "UI-01", "UI-02", "REL-01", "REL-02", "REL-03", "REL-04",
] as const;

type AcceptanceId = (typeof REQUIRED_ACCEPTANCE_IDS)[number];
type AcceptanceEnvironment = "real-app" | "real-app-blocked";

interface Assertion {
  id: AcceptanceId;
  entry: string;
  action: string;
  screenObservation: string;
  consistent: boolean | null;
  environment: AcceptanceEnvironment;
  evidencePath: string;
  observed: unknown;
}

interface SafeAppTarget {
  inputPath: string;
  realPath: string;
  executablePath: string;
  bundleIdentifier: string;
  bundleExecutable: string;
}

interface CommandResult {
  code: number | null;
  signal: NodeJS.Signals | null;
  stdout: string;
  stderr: string;
}

interface ViewportObservation {
  width: number;
  height: number;
  horizontalOverflow: boolean;
  dialogVisible: boolean;
  closeButtonVisible: boolean;
  aboutButtonVisible: boolean;
  installButtonCount: number;
}

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const requestedAppPath = parseArgs(process.argv.slice(2));
const evidenceRoot = await createAcceptanceOutputDirectory("desktop-auto-update-shutdown");
const evidencePath = path.join(evidenceRoot, "desktop-auto-update-shutdown-evidence.json");
const assertions = new Map<AcceptanceId, Assertion>();
const safetyAssertions: Array<{ id: string; passed: boolean; observed: unknown }> = [];

function record(
  id: AcceptanceId,
  input: Omit<Assertion, "id" | "evidencePath">,
): void {
  assertions.set(id, { id, ...input, evidencePath });
}

function recordBlocked(id: AcceptanceId, entry: string, action: string, reason: string, observed: unknown = {}): void {
  record(id, {
    entry,
    action,
    screenObservation: `未执行：${reason}`,
    consistent: null,
    environment: "real-app-blocked",
    observed: { ...observed as Record<string, unknown>, blockedReason: reason },
  });
}

function safetyCheck(id: string, passed: boolean, observed: unknown): void {
  safetyAssertions.push({ id, passed, observed });
  if (!passed) {
    throw new Error(`${id} failed`);
  }
}

async function runCommand(command: string, args: readonly string[], timeoutMs = 5_000): Promise<CommandResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, [...args], {
      cwd: projectRoot,
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      reject(new Error(`${command} timed out`));
    }, timeoutMs);
    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    child.once("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.once("exit", (code, signal) => {
      clearTimeout(timer);
      resolve({ code, signal, stdout, stderr });
    });
  });
}

async function readPlistValue(plistPath: string, key: string): Promise<string> {
  const result = await runCommand("plutil", ["-extract", key, "raw", "-o", "-", plistPath]);
  if (result.code !== 0) {
    throw new Error(`could not read ${key} from Info.plist: ${result.stderr.trim()}`);
  }
  const value = result.stdout.trim();
  if (value === "") {
    throw new Error(`Info.plist ${key} is empty`);
  }
  return value;
}

function isWithin(parent: string, candidate: string): boolean {
  const relative = path.relative(parent, candidate);
  return relative === "" || (relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative));
}

async function validateSafeAppTarget(inputPath: string): Promise<SafeAppTarget> {
  const realTemporaryRoots = await Promise.all([
    fs.realpath(os.tmpdir()),
    fs.realpath("/tmp"),
  ]);
  const realPath = await fs.realpath(inputPath);
  const stat = await fs.stat(realPath);
  safetyCheck("REAL-SAFETY-app-is-directory", stat.isDirectory() && realPath.endsWith(".app"), { inputPath, realPath });
  safetyCheck("REAL-SAFETY-app-is-under-system-temp", realTemporaryRoots.some((root) => isWithin(root, realPath)), {
    realTemporaryRoots,
    realPath,
  });

  const productionPath = await fs.realpath(PRODUCTION_APP_PATH).catch(() => path.resolve(PRODUCTION_APP_PATH));
  safetyCheck("REAL-SAFETY-app-not-production-path", !isWithin(productionPath, realPath) && !isWithin(realPath, productionPath), {
    productionPath,
    realPath,
  });

  const plistPath = path.join(realPath, "Contents", "Info.plist");
  const bundleIdentifier = await readPlistValue(plistPath, "CFBundleIdentifier");
  const bundleExecutable = await readPlistValue(plistPath, "CFBundleExecutable");
  safetyCheck("REAL-SAFETY-bundle-id-is-literal", /^[A-Za-z0-9.-]+$/.test(bundleIdentifier), {
    bundleIdentifier,
  });
  safetyCheck("REAL-SAFETY-bundle-id-is-non-production", bundleIdentifier !== PRODUCTION_BUNDLE_IDENTIFIER, {
    bundleIdentifier,
    productionBundleIdentifier: PRODUCTION_BUNDLE_IDENTIFIER,
  });

  const executablePath = await fs.realpath(path.join(realPath, "Contents", "MacOS", bundleExecutable));
  safetyCheck("REAL-SAFETY-executable-is-inside-bundle", isWithin(realPath, executablePath), {
    executablePath,
    realPath,
  });
  await fs.realpath(path.join(realPath, "Contents", "Resources", "app.asar"));
  safetyCheck("REAL-SAFETY-app-asar-is-inside-bundle", true, { realPath });

  return {
    inputPath: path.resolve(inputPath),
    realPath,
    executablePath,
    bundleIdentifier,
    bundleExecutable,
  };
}

async function validateRuntimeRoot(runtimeRoot: string): Promise<void> {
  const realTemporaryRoot = await fs.realpath(os.tmpdir());
  const realRuntimeRoot = await fs.realpath(runtimeRoot);
  safetyCheck("REAL-SAFETY-data-root-is-temporary", isWithin(realTemporaryRoot, realRuntimeRoot), {
    realTemporaryRoot,
    realRuntimeRoot,
  });
  safetyCheck("REAL-SAFETY-data-root-is-not-production", !isWithin(path.dirname(PRODUCTION_APP_PATH), realRuntimeRoot), {
    realRuntimeRoot,
    productionAppPath: PRODUCTION_APP_PATH,
  });
}

async function readProcessCommand(pid: number): Promise<string> {
  const result = await runCommand("ps", ["-p", String(pid), "-o", "command="]);
  return result.stdout.trim();
}

async function validateOwnedProcess(pid: number, target: SafeAppTarget): Promise<void> {
  const command = await readProcessCommand(pid);
  safetyCheck("REAL-SAFETY-process-is-owned-by-target", command.includes(target.executablePath), {
    pid,
    command,
    executablePath: target.executablePath,
  });
  safetyCheck("REAL-SAFETY-process-is-not-production", !command.includes(PRODUCTION_APP_PATH), {
    pid,
    command,
    productionAppPath: PRODUCTION_APP_PATH,
  });
}

async function launch(target: SafeAppTarget, runtimeRoot: string): Promise<ElectronApplication> {
  await fs.writeFile(path.join(runtimeRoot, ".onboarding-completed"), `${new Date().toISOString()}\n`, "utf8");
  return electron.launch({
    executablePath: target.executablePath,
    args: [],
    timeout: 20_000,
    cwd: projectRoot,
    env: {
      ...process.env,
      MOEBIUS_DATA_ROOT: runtimeRoot,
    },
  });
}

async function waitForMainWindow(application: ElectronApplication): Promise<Page> {
  const page = await Promise.race([
    application.firstWindow(),
    new Promise<Page>((_resolve, reject) => {
      setTimeout(() => reject(new Error("isolated Electron did not create a window within 20 seconds")), 20_000);
    }),
  ]);
  await page.waitForLoadState("domcontentloaded");
  await page.getByRole("button", { name: /设置|Settings/ }).waitFor({ state: "visible", timeout: 20_000 });
  return page;
}

async function openSettings(page: Page, locale: "zh-CN" | "en"): Promise<Locator> {
  const settings = page.getByRole("button", { name: locale === "zh-CN" ? "设置" : "Settings" }).first();
  await settings.focus();
  await page.keyboard.press("Enter");
  const dialog = page.getByRole("dialog", { name: locale === "zh-CN" ? "设置" : "Settings" });
  await dialog.waitFor({ state: "visible" });
  return dialog;
}

async function openAbout(page: Page, locale: "zh-CN" | "en"): Promise<Locator> {
  const dialog = await openSettings(page, locale);
  await dialog.getByRole("button", { name: locale === "zh-CN" ? "关于" : "About" }).click();
  return dialog;
}

async function closeSettings(dialog: Locator, locale: "zh-CN" | "en"): Promise<void> {
  await dialog.getByRole("button", { name: locale === "zh-CN" ? "关闭" : "Close" }).click();
  await dialog.waitFor({ state: "hidden" });
}

async function pollDialogText(
  dialog: Locator,
  predicate: (text: string) => boolean,
  timeoutMs = 30_000,
): Promise<{ text: string; snapshots: string[] }> {
  const deadline = Date.now() + timeoutMs;
  const snapshots: string[] = [];
  while (Date.now() < deadline) {
    const text = (await dialog.textContent().catch(() => "")) ?? "";
    if (snapshots.at(-1) !== text) snapshots.push(text);
    if (predicate(text)) return { text, snapshots };
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`timed out waiting for update state; snapshots=${JSON.stringify(snapshots.slice(-8))}`);
}

function isUpdateFailure(text: string): boolean {
  const normalized = text.toLowerCase();
  return text.includes("检查更新失败") || normalized.includes("update check failed");
}

function isChecking(text: string): boolean {
  return text.includes("正在检查更新") || text.includes("更新正在检查") || text.includes("Checking for updates");
}

function isUpdateLatest(text: string): boolean {
  const normalized = text.toLowerCase();
  return text.includes("当前已是最新版") || text.includes("已是最新版") || normalized.includes("you're up to date");
}

function isUpdateAvailable(text: string): boolean {
  return text.includes("新版") || text.toLowerCase().includes("is available");
}

function isUpdateDownloading(text: string): boolean {
  return text.includes("正在下载") || text.toLowerCase().includes("downloading version");
}

function isUpdateReady(text: string): boolean {
  return text.includes("已准备好") || text.includes("is ready");
}

function hasMonotonicDownloadProgress(snapshots: readonly string[]): boolean {
  const progress = snapshots.flatMap((text) => [...text.matchAll(/(\d{1,3})%/g)].map((match) => Number(match[1])));
  return progress.length > 0 && progress.every((value, index) => index === 0 || value >= progress[index - 1]!);
}

async function sendAppleEventQuit(bundleIdentifier: string): Promise<CommandResult> {
  const script = `tell application id "${bundleIdentifier}" to quit`;
  return runCommand("osascript", ["-e", script], 10_000);
}

function recordBlockedUpdateRows(reason: string): void {
  recordBlocked("UPD-02", "启动后自动更新检查 / 关于页", "等待真实下载进度", reason);
  recordBlocked("UPD-03", "关于页与设置页切换", "在下载期间切换页面并观察恢复", reason);
  recordBlocked("UPD-05", "关于页与左侧 Sidebar", "观察 ready 状态和独立安装按钮", reason);
  recordBlocked("UPD-07", "Sidebar 安装更新按钮", "点击并取消安装确认", reason);
  recordBlocked("UPD-08", "Sidebar 安装更新按钮 / 运行任务", "点击并观察重启安装专用确认", reason);
  recordBlocked("UPD-09", "重启安装专用确认", "点击继续工作", reason);
  recordBlocked("UPD-10", "重启安装专用确认", "停止任务并重启安装", reason);
  recordBlocked("UPD-11", "重启安装专用确认 / 清理失败", "观察失败后的应用、会话和 ready 状态", reason);
  recordBlocked("UPD-12", "普通重启后关于页与 Sidebar", "重启并观察 ready marker 恢复", reason);
}

function recordBlockedQuitRows(reason: string): void {
  recordBlocked("QUIT-02", "隔离实例 Command+Q / 运行任务", "取消退出保护弹窗", reason);
  recordBlocked("QUIT-03", "隔离实例 Command+Q / 运行任务", "确认停止任务并退出", reason);
  recordBlocked("QUIT-04", "隔离实例生命周期事件", "触发第二轮 before-quit/window close", reason);
}

function recordBlockedUiReadyRows(reason: string): void {
  if (!assertions.has("UI-02")) {
    recordBlocked("UI-02", "中文/英文关于页与 Sidebar", "在 downloading/ready 视图检查三种视口", reason);
  }
}

function fillMissingRows(reason: string): void {
  const catalog: Record<AcceptanceId, [string, string]> = {
    "UPD-01": ["隔离已打包应用启动", "启动后观察自动检查"],
    "UPD-02": ["关于页", "等待目标版本和下载进度"],
    "UPD-03": ["设置页/关于页切换", "切换页面并观察下载连续性"],
    "UPD-04": ["关于页失败状态", "点击重试/重新下载"],
    "UPD-05": ["关于页和 Sidebar", "观察 ready 与安装入口"],
    "UPD-06": ["Sidebar 与右下角", "观察无通知、红点和新页面"],
    "UPD-07": ["Sidebar 安装更新", "取消安装确认"],
    "UPD-08": ["Sidebar 安装更新", "观察有任务时的专用确认"],
    "UPD-09": ["安装确认", "点击继续工作"],
    "UPD-10": ["安装确认", "停止任务并重启安装"],
    "UPD-11": ["安装确认", "观察清理失败降级"],
    "UPD-12": ["普通重启后关于页", "观察 ready marker 恢复"],
    "QUIT-01": ["隔离实例 Command+Q", "按一次 Command+Q"],
    "QUIT-02": ["隔离实例 Command+Q / 运行任务", "取消退出保护"],
    "QUIT-03": ["隔离实例 Command+Q / 运行任务", "确认停止任务并退出"],
    "QUIT-04": ["隔离实例生命周期", "触发重复生命周期事件"],
    "UI-01": ["中文/英文设置页", "键盘打开、切换关于、关闭确认"],
    "UI-02": ["三种视口设置页", "检查关于页和 Sidebar 可达性"],
    "REL-01": ["Release staging 目录", "生成并校验 latest-mac.yml"],
    "REL-02": ["隔离应用启动", "读取真实 Release 元数据"],
    "REL-03": ["本地 Release 目录", "验证中间文件被拒绝"],
    "REL-04": ["远端 Draft Release", "下载并校验远端资产"],
  };
  for (const id of REQUIRED_ACCEPTANCE_IDS) {
    if (!assertions.has(id)) {
      const [entry, action] = catalog[id];
      recordBlocked(id, entry, action, reason);
    }
  }
}

async function observeViewport(page: Page, width: number, height: number): Promise<ViewportObservation> {
  await page.setViewportSize({ width, height });
  return page.evaluate(({ width: expectedWidth, height: expectedHeight }) => {
    const dialog = document.querySelector('[role="dialog"]');
    const closeButton = dialog?.querySelector('button[aria-label="关闭"], button[aria-label="Close"]');
    const aboutButton = dialog?.querySelector('button[aria-current="page"]');
    const installButton = document.querySelector('[data-testid="sidebar-install-update"]');
    return {
      width: expectedWidth,
      height: expectedHeight,
      horizontalOverflow: document.documentElement.scrollWidth > window.innerWidth + 1,
      dialogVisible: dialog !== null,
      closeButtonVisible: closeButton !== null,
      aboutButtonVisible: aboutButton !== null,
      installButtonCount: installButton === null ? 0 : 1,
    };
  }, { width, height });
}

async function main(): Promise<void> {
  let target: SafeAppTarget | null = null;
  let runtimeRoot: string | null = null;
  let application: ElectronApplication | null = null;
  let pid: number | undefined;
  let processExited = false;
  let runError: string | null = null;

  try {
    target = await validateSafeAppTarget(requestedAppPath);
    runtimeRoot = await fs.mkdtemp(path.join(os.tmpdir(), "moebius-update-shutdown-"));
    await validateRuntimeRoot(runtimeRoot);
    application = await launch(target, runtimeRoot);
    pid = application.process().pid;
    if (pid === undefined) throw new Error("isolated Electron did not expose a PID");
    await validateOwnedProcess(pid, target);

    let page = await waitForMainWindow(application);
    const dialog = await openAbout(page, "zh-CN");
    const initial = await pollDialogText(
      dialog,
      (text) => isUpdateFailure(text) || isUpdateLatest(text) || isUpdateAvailable(text) || isUpdateDownloading(text) || isUpdateReady(text),
    );
    record("UPD-01", {
      entry: "隔离已打包 macOS arm64 实例启动后打开 设置 → 关于",
      action: "启动应用并观察自动检查状态",
      screenObservation: `页面状态序列包含${initial.snapshots.some(isChecking) ? "正在检查更新，随后" : "未捕获检查中瞬间，最终"}${initial.text}`,
      consistent: initial.snapshots.some(isChecking),
      environment: "real-app",
      observed: { snapshots: initial.snapshots.slice(-12), finalText: initial.text },
    });

    const sidebarInstallCount = await page.locator('[data-testid="sidebar-install-update"]').count();
    const notificationCount = await page.locator('[data-testid="settings-notifications"]').count();
    const invalidReleaseObserved = isUpdateFailure(initial.text);
    record("REL-02", {
      entry: "隔离实例启动后的 设置 → 关于",
      action: "通过生产 electron-updater 读取真实 GitHub Release",
      screenObservation: invalidReleaseObserved
        ? `显示失败状态：${initial.text}`
        : `真实 Release 已进入更新状态：${initial.text}`,
      consistent: invalidReleaseObserved ? sidebarInstallCount === 0 : null,
      environment: invalidReleaseObserved ? "real-app" : "real-app-blocked",
      observed: {
        updateText: initial.text,
        sidebarInstallCount,
        notificationCount,
        validReleasePath: !invalidReleaseObserved,
      },
    });
    record("UPD-04", {
      entry: "设置 → 关于的失败状态",
      action: "点击重试并等待真实网络再次返回",
      screenObservation: invalidReleaseObserved
        ? "重试按钮可见，点击后更新状态再次进入检查/失败路径"
        : "有效 Release 路径不适用失败重试断言；下载链路继续由真实状态驱动",
      consistent: invalidReleaseObserved ? false : null,
      environment: invalidReleaseObserved ? "real-app" : "real-app-blocked",
      observed: { retryButtonCount: 0, retry: invalidReleaseObserved ? "pending" : "not-applicable" },
    });
    record("UPD-06", {
      entry: "设置 → 关于与 Sidebar",
      action: "观察失败状态下右下角和侧栏",
      screenObservation: invalidReleaseObserved
        ? "无更新完成通知，侧栏无安装更新按钮"
        : "有效 Release 路径继续观察真实下载完成后的通知和侧栏",
      consistent: invalidReleaseObserved ? notificationCount === 0 && sidebarInstallCount === 0 : null,
      environment: invalidReleaseObserved ? "real-app" : "real-app-blocked",
      observed: { notificationCount, sidebarInstallCount },
    });

    const retryButton = dialog.getByRole("button", { name: "重试" });
    const retryButtonCount = await retryButton.count();
    if (invalidReleaseObserved && retryButtonCount === 1) {
      await retryButton.click();
      const retried = await pollDialogText(dialog, (text) => isUpdateFailure(text));
      record("UPD-04", {
        entry: "设置 → 关于的失败状态",
        action: "点击重试并等待真实网络再次返回",
        screenObservation: `重试后再次显示失败：${retried.text}`,
        consistent: isUpdateFailure(retried.text),
        environment: "real-app",
        observed: { retryButtonCount, snapshots: retried.snapshots.slice(-12) },
      });
    } else if (invalidReleaseObserved) {
      record("UPD-04", {
        entry: "设置 → 关于的失败状态",
        action: "点击重试并等待真实网络再次返回",
        screenObservation: "失败状态没有提供重试按钮",
        consistent: false,
        environment: "real-app",
        observed: { retryButtonCount },
      });
    }

    let validReleaseOutcome = initial;
    if (!invalidReleaseObserved && !isUpdateLatest(initial.text)) {
      validReleaseOutcome = await pollDialogText(
        dialog,
        (text) => isUpdateFailure(text) || isUpdateLatest(text) || isUpdateReady(text),
        120_000,
      );
      const snapshots = [...initial.snapshots, ...validReleaseOutcome.snapshots];
      const downloaded = isUpdateReady(validReleaseOutcome.text);
      record("UPD-02", {
        entry: "隔离实例 设置 → 关于",
        action: "等待生产 electron-updater 的真实后台下载完成",
        screenObservation: downloaded
          ? `真实下载由进度状态进入已准备好：${validReleaseOutcome.text}`
          : `真实更新链路未完成：${validReleaseOutcome.text}`,
        consistent: downloaded && snapshots.some(isUpdateDownloading) && hasMonotonicDownloadProgress(snapshots),
        environment: "real-app",
        observed: {
          snapshots: snapshots.slice(-20),
          finalText: validReleaseOutcome.text,
          progressMonotonic: hasMonotonicDownloadProgress(snapshots),
        },
      });
      if (downloaded) {
        await closeSettings(dialog, "zh-CN");
        const reopenedDialog = await openAbout(page, "zh-CN");
        const reopenedText = (await reopenedDialog.textContent()) ?? "";
        record("UPD-03", {
          entry: "设置页与关于页",
          action: "关闭并重新打开关于页，观察同一真实下载状态",
          screenObservation: `关于页重新打开后显示：${reopenedText}`,
          consistent: isUpdateReady(reopenedText),
          environment: "real-app",
          observed: { finalText: validReleaseOutcome.text, reopenedText, providerLifecycle: "single startup check" },
        });
      } else {
        record("UPD-03", {
          entry: "设置页与关于页",
          action: "重新打开关于页并观察同一真实下载状态",
          screenObservation: "真实下载未完成，未伪造 ready 状态",
          consistent: false,
          environment: "real-app",
          observed: { finalText: validReleaseOutcome.text },
        });
        recordBlockedUpdateRows("真实 Release 已被读取，但下载未进入 ready，未伪造安装包或 ready 状态");
        record("UPD-02", {
          entry: "隔离实例 设置 → 关于",
          action: "等待生产 electron-updater 的真实后台下载完成",
          screenObservation: `真实下载未完成：${validReleaseOutcome.text}`,
          consistent: false,
          environment: "real-app",
          observed: { snapshots: snapshots.slice(-20) },
        });
      }
    } else if (!invalidReleaseObserved) {
      recordBlockedUpdateRows("当前隔离构建已是最新版本，缺少真实 N−1→N Release，未伪造下载状态");
    }

    await dialog.getByRole("button", { name: "常规" }).click();
    await dialog.getByText("English", { exact: true }).click();
    await page.waitForFunction(() => document.documentElement.lang === "en");
    const englishDialog = page.getByRole("dialog", { name: "Settings" });
    await englishDialog.waitFor({ state: "visible" });
    await englishDialog.getByRole("button", { name: "About" }).click();
    const englishText = (await englishDialog.textContent()) ?? "";
    const englishCloseCount = await englishDialog.getByRole("button", { name: "Close" }).count();
    const englishAboutCount = await englishDialog.getByRole("button", { name: "About" }).count();
    const englishStateObserved = isUpdateFailure(englishText)
      || isUpdateLatest(englishText)
      || isUpdateDownloading(englishText)
      || isUpdateReady(englishText)
      || isUpdateAvailable(englishText);
    record("UI-01", {
      entry: "中文/英文设置页，通过键盘聚焦设置并打开",
      action: "切换 English，打开 About，观察状态和关闭入口",
      screenObservation: `英文标题、About、当前更新状态和 Close 可访问名称可见：${englishText}`,
      consistent: englishAboutCount === 1 && englishCloseCount === 1 && englishStateObserved,
      environment: "real-app",
      observed: {
        documentLanguage: await page.locator("html").getAttribute("lang"),
        englishText,
        englishAboutCount,
        englishCloseCount,
      },
    });

    const viewportObservations: ViewportObservation[] = [];
    for (const [width, height] of [[900, 640], [560, 640], [900, 480]] as const) {
      viewportObservations.push(await observeViewport(page, width, height));
    }
    record("UI-02", {
      entry: "英文 About 页面，视口 900×640、560×640、900×480",
      action: "逐一调整视口并观察关于页和侧栏可达性",
      screenObservation: isUpdateReady(validReleaseOutcome.text) || isUpdateDownloading(validReleaseOutcome.text)
        ? "真实更新状态页面无水平滚动，标题、关闭、状态和当前 About 入口可达"
        : "失败状态页面无水平滚动，ready/download 状态尚未由真实链路产生",
      consistent: isUpdateReady(validReleaseOutcome.text) || isUpdateDownloading(validReleaseOutcome.text)
        ? viewportObservations.every((observation) => !observation.horizontalOverflow && observation.dialogVisible && observation.closeButtonVisible)
        : null,
      environment: isUpdateReady(validReleaseOutcome.text) || isUpdateDownloading(validReleaseOutcome.text)
        ? "real-app"
        : "real-app-blocked",
      observed: {
        viewportObservations,
        readyAndDownloading: isUpdateReady(validReleaseOutcome.text) || isUpdateDownloading(validReleaseOutcome.text),
      },
    });

    await closeSettings(englishDialog, "en");
    if (invalidReleaseObserved || isUpdateLatest(initial.text)) {
      recordBlockedUpdateRows(invalidReleaseObserved
        ? "没有可供本次真机验收使用的有效 N−1→N GitHub Release：真实远端 v0.2.0 缺少 latest-mac.yml；未注入 ready、未替换网络或 IPC。"
        : "当前隔离构建已是最新版本，缺少真实 N−1→N Release；未注入 ready、未替换网络或 IPC。");
      recordBlockedUiReadyRows("没有有效 Release，无法由真实下载链路产生 downloading/ready 页面状态；不注入状态。");
    } else if (isUpdateReady(validReleaseOutcome.text)) {
      const readySidebarCount = await page.locator('[data-testid="sidebar-install-update"]').count();
      record("UPD-05", {
        entry: "隔离实例主工作区左侧 Sidebar",
        action: "关闭设置后观察真实 ready 状态的并列安装入口",
        screenObservation: "Sidebar 显示独立的安装更新按钮，设置按钮未被嵌套",
        consistent: readySidebarCount === 1,
        environment: "real-app",
        observed: { readySidebarCount },
      });
      record("UPD-06", {
        entry: "隔离实例主工作区",
        action: "观察真实下载完成后的通知区域与 Sidebar",
        screenObservation: "没有下载完成通知；更新入口仅保留在 Sidebar",
        consistent: await page.locator('[data-testid="settings-notifications"]').count() === 0 && readySidebarCount === 1,
        environment: "real-app",
        observed: { readySidebarCount },
      });
      recordBlocked("UPD-07", "Sidebar 安装更新按钮", "点击并取消安装确认", "安装确认由原生 message box 提供，本轮未使用 Accessibility 自动点击");
      recordBlocked("UPD-08", "Sidebar 安装更新按钮 / 运行任务", "点击并观察重启安装专用确认", "缺少通过真实用户入口产生的运行中任务");
      recordBlocked("UPD-09", "重启安装专用确认", "点击继续工作", "缺少真实运行任务与原生确认框自动化权限");
      recordBlocked("UPD-10", "重启安装专用确认", "停止任务并重启安装", "缺少真实运行任务与有效签名 N→N+1 Release 安装前提");
      recordBlocked("UPD-11", "重启安装专用确认 / 清理失败", "观察失败后的应用、会话和 ready 状态", "清理失败需受控故障注入，不能在真机验收中伪造");
      const restartChild = application.process();
      const restartExitPromise = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolve) => {
        if (restartChild.exitCode !== null || restartChild.signalCode !== null) {
          resolve({ code: restartChild.exitCode, signal: restartChild.signalCode });
          return;
        }
        restartChild.once("exit", (code, signal) => resolve({ code, signal }));
      });
      const restartQuit = await sendAppleEventQuit(target.bundleIdentifier);
      const restartExit = await Promise.race([
        restartExitPromise,
        new Promise<null>((resolve) => setTimeout(() => resolve(null), 15_000)),
      ]);
      if (restartQuit.code === 0 && restartExit !== null) {
        processExited = true;
        application = await launch(target, runtimeRoot);
        pid = application.process().pid;
        if (pid === undefined) throw new Error("isolated Electron did not expose a restarted PID");
        await validateOwnedProcess(pid, target);
        page = await waitForMainWindow(application);
        const restartedDialog = await openAbout(page, "en");
        const restartedText = (await restartedDialog.textContent()) ?? "";
        const restartedSidebarCount = await page.locator('[data-testid="sidebar-install-update"]').count();
        record("UPD-12", {
          entry: "普通 quit AppleEvent 后重新启动的隔离实例 设置 → About 与 Sidebar",
          action: "在同一临时 data root 重启应用，观察 ready marker 和更新事件",
          screenObservation: `重启后关于页显示：${restartedText}；Sidebar 安装按钮数：${restartedSidebarCount}`,
          consistent: isUpdateReady(restartedText) && restartedSidebarCount === 1,
          environment: "real-app",
          observed: {
            previousPid: restartChild.pid,
            restartQuit: { code: restartQuit.code, stderr: restartQuit.stderr.trim() },
            restartExit,
            restartedPid: pid,
            restartedText,
            restartedSidebarCount,
            downloadEventsAfterRestart: "not incremented by marker restore path",
          },
        });
        await closeSettings(restartedDialog, "en");
        processExited = false;
      } else {
        record("UPD-12", {
          entry: "普通重启后的隔离实例",
          action: "对隔离实例发送 quit AppleEvent 并等待重启前进程结束",
          screenObservation: "普通重启前的真实退出未完成，未伪造 marker 恢复结果",
          consistent: false,
          environment: "real-app",
          observed: {
            restartQuit: { code: restartQuit.code, stderr: restartQuit.stderr.trim() },
            restartExit,
          },
        });
      }
    }
    recordBlockedQuitRows("本轮没有通过真实用户入口产生可控的运行中 Agent/CLI 任务；未注入任务或生命周期事件。");
    recordBlocked("REL-01", "Release staging 目录", "生成并校验 latest-mac.yml", "本次脚本只验证桌面真实运行；请用 release:prepare-update 与 release:validate-update 的独立证据");
    recordBlocked("REL-03", "本地 Release 目录", "验证中间文件被拒绝", "本次脚本只验证桌面真实运行；请用 release:validate-update 的独立证据");
    recordBlocked("REL-04", "远端 Draft Release", "下载并校验远端资产", "真实远端 v0.2.0 缺少 latest-mac.yml，远端校验安全失败");

    const child = application.process();
    const exitPromise = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolve) => {
      if (child.exitCode !== null || child.signalCode !== null) {
        processExited = true;
        resolve({ code: child.exitCode, signal: child.signalCode });
        return;
      }
      child.once("exit", (code, signal) => {
        processExited = true;
        resolve({ code, signal });
      });
    });
    const nativeKey = await sendAppleEventQuit(target.bundleIdentifier);
    const exitResult = await Promise.race([
      exitPromise,
      new Promise<null>((resolve) => setTimeout(() => resolve(null), 15_000)),
    ]);
    const processCommandAfter = await readProcessCommand(pid).catch(() => "process exited");
    record("QUIT-01", {
      entry: "隔离实例主工作区",
      action: "向已通过 realpath/bundle ID 校验的隔离实例发送一次真实 quit AppleEvent（等价触发应用 before-quit）",
      screenObservation: exitResult === null
        ? "一次 quit AppleEvent 后进程仍存在，未满足单次退出"
        : "一次 quit AppleEvent 后主进程结束；Dock 固定状态需人工观察，未用图标存在性冒充运行状态",
      consistent: exitResult !== null,
      environment: "real-app",
      observed: {
        pid,
        nativeKey: { code: nativeKey.code, stderr: nativeKey.stderr.trim() },
        exit: exitResult,
        processExited,
        processCommandAfter,
        dockRunningIndicator: "not independently asserted by icon presence",
      },
    });
  } catch (error) {
    runError = error instanceof Error ? error.message : String(error);
    const reason = `真实隔离验收在启动/页面流程中止：${runError}`;
    fillMissingRows(reason);
  } finally {
    if (application !== null && !processExited) {
      await application.close().catch(() => undefined);
    }
    fillMissingRows(runError ?? "本行没有在本次真实运行中执行");
    const evidence = {
      generatedAt: new Date().toISOString(),
      appInputPath: requestedAppPath,
      appPath: target?.realPath ?? null,
      bundleIdentifier: target?.bundleIdentifier ?? null,
      bundleExecutable: target?.bundleExecutable ?? null,
      executablePath: target?.executablePath ?? null,
      runtimeRoot,
      pid,
      assertions: REQUIRED_ACCEPTANCE_IDS.map((id) => assertions.get(id)),
      safety: {
        currentApplicationPathTouched: false,
        productionAppPath: PRODUCTION_APP_PATH,
        safetyAssertions,
        isolatedDataRoot: runtimeRoot,
      },
      error: runError,
    };
    await fs.writeFile(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`, "utf8");
    const ok = runError === null
      && safetyAssertions.every((item) => item.passed)
      && REQUIRED_ACCEPTANCE_IDS.every((id) => assertions.get(id)?.consistent === true);
    process.stdout.write(`${JSON.stringify({ ok, evidence: evidencePath, pid })}\n`);
    if (!ok) process.exitCode = 1;
  }
}

function parseArgs(argv: string[]): string {
  const index = argv.indexOf("--app");
  const value = index >= 0 ? argv[index + 1] : undefined;
  if (value === undefined || value.startsWith("-")) {
    throw new Error("usage: --app /absolute/path/to/isolated/Moebius.app");
  }
  return path.resolve(value);
}

await main();
