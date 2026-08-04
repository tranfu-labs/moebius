import { spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { _electron as electron, type ElectronApplication, type Locator, type Page } from "playwright";

import { createAcceptanceOutputDirectory } from "./temp-output.js";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const desktopRoot = path.join(projectRoot, "desktop");
const runtimeRoot = await fs.mkdtemp(path.join(os.tmpdir(), "moebius-file-reading-runtime-"));
const fixtureRoot = path.join(runtimeRoot, "workspace");
const externalRoot = await fs.mkdtemp(path.join(os.tmpdir(), "moebius-file-reading-external-"));
const outputRoot = await createAcceptanceOutputDirectory("file-reading-modes");
const evidencePath = path.join(outputRoot, "file-reading-modes-evidence.json");
const fakeBin = path.join(runtimeRoot, "bin");

const sourcePath = path.join(fixtureRoot, "src", "reader.ts");
const readmePath = path.join(fixtureRoot, "README.md");
const guidePath = path.join(fixtureRoot, "GUIDE.markdown");
const largePath = path.join(fixtureRoot, "large.txt");
const binaryPath = path.join(fixtureRoot, "binary.dat");
const directoryPath = path.join(fixtureRoot, "directory-target");
const missingPath = path.join(fixtureRoot, "missing.txt");
const unreadablePath = path.join(fixtureRoot, "unreadable.txt");
const reportPath = path.join(externalRoot, "report.txt");
const longLinePath = path.join(externalRoot, "long-line.txt");
const responseBudgetPath = path.join(externalRoot, "response-budget.txt");
const scanBudgetPath = path.join(externalRoot, "scan-budget.txt");
const workspaceExternalLink = path.join(fixtureRoot, "external-report-link.txt");
const externalWorkspaceAlias = path.join(externalRoot, "workspace-reader-alias.ts");

await fs.mkdir(path.dirname(sourcePath), { recursive: true });
await fs.mkdir(directoryPath, { recursive: true });
await fs.mkdir(fakeBin, { recursive: true });
await fs.writeFile(path.join(runtimeRoot, ".onboarding-completed"), `${new Date().toISOString()}\n`, "utf8");

const sourceV1 = Array.from({ length: 60 }, (_, index) =>
  index === 41 ? "export const targetLine42 = true;" : `export const line${String(index + 1)} = ${String(index + 1)};`
).join("\n") + "\n";
await fs.writeFile(sourcePath, sourceV1, "utf8");
await fs.writeFile(guidePath, "# Guide\n\n- Preview default\n- Source available\n", "utf8");
await fs.writeFile(
  reportPath,
  `${Array.from({ length: 120 }, (_, index) => {
    const lineNumber = index + 1;
    return lineNumber === 60
      ? "external line 60 target"
      : `external line ${String(lineNumber)} distant`;
  }).join("\n")}\n`,
  "utf8",
);
await fs.writeFile(longLinePath, `${"x".repeat(300 * 1024)}\n`, "utf8");
await fs.writeFile(
  responseBudgetPath,
  Array.from({ length: 45 }, (_, index) => `${String(index + 1)}:${"r".repeat(30 * 1024)}`).join("\n"),
  "utf8",
);
await writeScanBudgetFixture(scanBudgetPath);
await fs.writeFile(largePath, "l".repeat(2 * 1024 * 1024 + 1), "utf8");
await fs.writeFile(binaryPath, Buffer.from([0x4d, 0x6f, 0x65, 0x62, 0x69, 0x75, 0x73, 0x00]));
await fs.writeFile(unreadablePath, "cannot read", { encoding: "utf8", mode: 0o000 });
await fs.symlink(reportPath, workspaceExternalLink);
await fs.symlink(sourcePath, externalWorkspaceAlias);
const canonicalReportPath = await fs.realpath(reportPath);

const readmeV1 = markdownFixture("V1");
await fs.writeFile(readmePath, readmeV1, "utf8");
await run("git", ["init", "-q"], fixtureRoot);
await run("git", ["config", "user.name", "Moebius Acceptance"], fixtureRoot);
await run("git", ["config", "user.email", "acceptance@localhost"], fixtureRoot);
await run("git", ["add", "README.md", "GUIDE.markdown", "src/reader.ts"], fixtureRoot);
await run("git", ["commit", "-qm", "acceptance baseline"], fixtureRoot);
await fs.writeFile(path.join(fakeBin, "codex"), fakeCodexSource(), { mode: 0o755 });

let application: ElectronApplication | null = null;
try {
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
  await application.evaluate(({ BrowserWindow }) => {
    BrowserWindow.getAllWindows()[0]?.setSize(1_440, 960);
  });
  const apiBase = await waitForApiBase(page);
  await createProject(apiBase, fixtureRoot);
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.getByRole("button", { name: "设置" }).waitFor({ timeout: 20_000 });

  const referenceMessage = [
    `[TS bare](${sourcePath}) [TS line 42](${sourcePath}:42)`,
    `[README bare](${readmePath}) [README line 42](${readmePath}:42)`,
    `[external report](${reportPath}:60) [workspace symlink external](${workspaceExternalLink}:60)`,
    `[external alias workspace](${externalWorkspaceAlias})`,
    `[workspace large](${largePath}) [workspace binary](${binaryPath})`,
    `[workspace directory](${directoryPath}) [workspace missing](${missingPath}) [workspace unreadable](${unreadablePath})`,
    `[external long line](${longLinePath}:1) [external response budget](${responseBudgetPath}:22)`,
    `[external scan budget](${scanBudgetPath}:40000000)`,
  ].join("\n\n");
  const session = await startConversation(page, apiBase, referenceMessage);
  const timeline = page.getByRole("region", { name: "会话时间线" });
  await timeline.getByRole("button", { name: "TS bare" }).waitFor({ timeout: 20_000 });

  await fs.writeFile(sourcePath, (await fs.readFile(sourcePath, "utf8")).replace("line30 = 30", "line30 = 3000"), "utf8");
  const showRightSidebar = page.getByTestId("main-window-drag-region").getByRole("button", { name: "显示右侧栏" });
  if (await showRightSidebar.isVisible().catch(() => false)) await showRightSidebar.click();
  await page.getByRole("button", { name: "新建空白标签" }).click();
  await page.getByRole("button", { name: /^改动/u }).click();
  let changeTab = page.getByTestId("change-tab");
  await changeTab.waitFor();
  await changeTab.getByText("团队正在工作，这份列表截至上一轮结束。").waitFor();
  await changeTab.getByTitle("src/reader.ts").click();
  let diffScroll = changeTab.getByTestId("file-diff-scroll");
  await diffScroll.waitFor();
  await diffScroll.evaluate((element) => {
    element.scrollTop = 80;
    element.dispatchEvent(new Event("scroll"));
  });
  const workingScrollTop = await diffScroll.evaluate((element) => element.scrollTop);
  await fs.writeFile(sourcePath, (await fs.readFile(sourcePath, "utf8")).replace("line20 = 20", "line20 = 2000"), "utf8");
  await changeTab.getByRole("button", { name: "刷新" }).click();
  await changeTab.getByRole("button", { name: "有新改动，点击后查看" }).waitFor();
  assert(await changeTab.getByTitle("src/reader.ts").getAttribute("aria-selected") === "true", "working refresh changed the selected file before acceptance");
  assert(await diffScroll.evaluate((element) => element.scrollTop) === workingScrollTop, "working refresh changed the reading position before acceptance");
  await changeTab.getByRole("button", { name: "有新改动，点击后查看" }).click();
  await changeTab.getByText("export const line20 = 2000;").waitFor();
  assert(await changeTab.getByTitle("src/reader.ts").getAttribute("aria-selected") === "true", "accepted refresh changed the selected file");
  assert(await diffScroll.evaluate((element) => element.scrollTop) === workingScrollTop, "accepted refresh changed the reading position");

  await waitForSessionResult(apiBase, session.sessionId);
  await page.locator(
    `[data-testid='conversation-sidebar-session'][data-session-id="${session.sessionId}"]`,
  ).click();
  await page.getByTestId("conversation-result-card").waitFor({ timeout: 20_000 });

  const acceptance: Record<string, unknown> = {};

  await activateTimelineReference(timeline, "TS bare");
  let fileTab = page.getByTestId("file-reference-tab");
  await expectAttribute(fileTab, "data-file-scope", "workspace-file");
  const sourceScroll = fileTab.getByTestId("file-source-scroll");
  await sourceScroll.getByText("export const line1 = 1;").waitFor();
  await sourceScroll.getByText("export const line60 = 60;").waitFor();
  assert(await sourceScroll.locator("[data-testid='file-source-target-line']").count() === 0, "bare TS unexpectedly had a target line");
  assert(await fileTab.getByTestId("external-file-preview-label").count() === 0, "workspace file displayed an external preview label");
  assert(await sourceScroll.locator(".text-pass, .text-danger").count() === 0, "source view inherited diff colors");
  acceptance["5.1"] = observation("主会话用户消息中的工作区 TS 裸路径", "点击 TS bare", "首尾 1/60 行可见；单列当前行号；无外部预览及 Review 增删色");

  await activateTimelineReference(timeline, "TS line 42");
  fileTab = page.getByTestId("file-reference-tab");
  const target42 = fileTab.getByTestId("file-source-target-line");
  await target42.waitFor();
  assert((await target42.textContent())?.includes("targetLine42") === true, "TS line 42 did not locate the target");
  assert(await target42.getAttribute("aria-current") === "location", "TS target lacked a non-color location signal");
  await assertSelectableText(fileTab.getByTestId("selected-file-path"), sourcePath, "workspace source path");
  await assertSelectableText(target42, "targetLine42", "workspace source text");
  acceptance["5.2"] = observation("主会话用户消息中的 TS:42", "点击 TS line 42，并在真实 DOM 选择路径与目标源码", "源码直接打开；第 42 行带 aria-current 与边框/底色定位；路径和源码文本均可选择");

  await activateTimelineReference(timeline, "README bare");
  fileTab = page.getByTestId("file-reference-tab");
  const initialPreviewButton = fileTab.getByRole("button", { name: "Preview" });
  await initialPreviewButton.waitFor();
  assert(await pressed(initialPreviewButton), "bare README did not default to Preview before user interaction");
  await fileTab.getByRole("heading", { name: "Acceptance V1" }).waitFor();
  await fileTab.getByRole("button", { name: "源码" }).click();
  await fileTab.getByText("# Acceptance V1").waitFor();
  acceptance["5.5"] = observation("主会话用户消息中的 README.md 裸路径", "首次打开后不操作模式控件，立即检查选中态，再切换源码", "Preview 在首次用户交互前已经选中并渲染标题/列表；源码显示同一完整 V1 原文");

  await activateTimelineReference(timeline, "README line 42");
  fileTab = page.getByTestId("file-reference-tab");
  await fileTab.getByTestId("file-source-target-line").waitFor();
  assert(await pressed(fileTab.getByRole("button", { name: "源码" })), "explicit README line did not default to source");
  await fileTab.getByRole("button", { name: "Preview" }).click();
  await fileTab.getByRole("button", { name: "源码" }).click();
  await fileTab.getByTestId("file-source-target-line").waitFor();
  acceptance["5.6"] = observation("主会话用户消息中的 README.md:42", "点击后切 Preview 再切源码", "显式行号首开源码且第 42 行定位；往返后目标重新进入视图");

  for (const [label, expectedPath] of [["external report", canonicalReportPath], ["workspace symlink external", canonicalReportPath]] as const) {
    await activateTimelineReference(timeline, label);
    fileTab = page.getByTestId("file-reference-tab");
    await expectAttribute(fileTab, "data-file-scope", "external-preview");
    await fileTab.getByTestId("external-file-preview-label").waitFor();
    const canonicalPath = (await fileTab.getByTestId("file-reference-path").textContent())?.trim() ?? "";
    assert(canonicalPath === expectedPath, `${label} did not canonicalize to the external target: ${canonicalPath}`);
    const previewScroll = fileTab.getByTestId("file-source-scroll");
    const previewTarget = previewScroll.getByTestId("file-source-target-line");
    await previewTarget.waitFor();
    assert((await previewTarget.textContent())?.includes("external line 60 target") === true, `${label} did not include the target line`);
    assert(await previewScroll.getByText("external line 1 distant", { exact: true }).count() === 0, `${label} included the distant first line`);
    assert(await previewScroll.getByText("external line 120 distant", { exact: true }).count() === 0, `${label} included the distant last line`);
    assert(await fileTab.getByRole("button", { name: "Preview" }).count() === 0, `${label} offered Markdown Preview`);
  }
  acceptance["5.8"] = observation("正文中的 120 行外部文件及工作区内指外 symlink", "分别点击第 60 行引用", "两者 canonical 到同一外部文件；第 60 行存在而第 1/120 行不存在；标签/内容明确预览且无 Markdown 切换");

  await activateTimelineReference(timeline, "external alias workspace");
  fileTab = page.getByTestId("file-reference-tab");
  await expectAttribute(fileTab, "data-file-scope", "workspace-file");
  await fileTab.getByText("export const line60 = 60;").waitFor();
  acceptance["5.9"] = observation("工作区外 symlink 指回工作区源码", "点击 external alias workspace", "按 workspace-file 完整打开并可到达末行；无外部预览标识");

  const workspaceFailures = [
    ["workspace large", "这个文件太大，无法在这里显示。"],
    ["workspace binary", "这个文件不是可显示的 UTF-8 文本。"],
    ["workspace directory", "这个引用没有指向普通文件。"],
    ["workspace missing", "这个文件已经不存在。"],
    ["workspace unreadable", "当前工作空间不可用，暂时无法读取文件。"],
  ] as const;
  for (const [label, copy] of workspaceFailures) {
    await activateTimelineReference(timeline, label);
    await page.getByTestId("file-reference-tab").getByText(copy, { exact: true }).waitFor();
    assert(await page.getByTestId("file-reference-tab").getByRole("button", { name: "重试" }).count() === 1, `${label} did not expose retry`);
    assert(await page.getByTestId("file-reference-tab").getByText("export const line60 = 60;").count() === 0, `${label} retained stale content`);
  }
  acceptance["5.10"] = observation("正文中的超预算/二进制/目录/不存在/不可读工作区目标", "逐一点击五个引用", "均显示既有原因与重试；上一文件不残留；大文件未降级为附近预览");

  const externalFailures = [
    ["external long line", "目标附近存在过长单行，无法安全显示。"],
    ["external response budget", "目标附近内容超过本次安全显示范围。"],
    ["external scan budget", "目标行超出本次安全读取范围。"],
  ] as const;
  for (const [label, copy] of externalFailures) {
    await activateTimelineReference(timeline, label);
    const failedPreview = page.getByTestId("file-reference-tab");
    await failedPreview.getByText(copy, { exact: true }).waitFor({ timeout: 20_000 });
    await expectAttribute(failedPreview, "data-file-scope", "external-preview");
    await failedPreview.getByTestId("external-file-preview-label").waitFor();
    await failedPreview.getByText("仅显示目标行附近内容", { exact: true }).waitFor();
    const activeFailureTabTitle = (await page.getByRole("tab", { selected: true }).textContent())?.trim() ?? "";
    assert(activeFailureTabTitle.startsWith("预览 · "), `${label} tab lost its preview identity: ${activeFailureTabTitle}`);
    assert(await failedPreview.getByTestId("file-source-scroll").count() === 0, `${label} displayed partial content`);
  }
  acceptance["5.11"] = observation("正文中的外部单行/响应/扫描预算夹具", "逐一点击三个目标", "分别显示 line-too-large / response-too-large / scan-limit；失败标签和内容区仍明确为预览，且不显示部分内容");

  await activateTimelineReference(timeline, "README bare");
  fileTab = page.getByTestId("file-reference-tab");
  await expectAttribute(fileTab, "data-file-scope", "workspace-file");
  const previewButton = fileTab.getByRole("button", { name: "Preview" });
  await previewButton.waitFor();
  if (!await pressed(previewButton)) await previewButton.click();
  await fileTab.getByRole("heading", { name: "Acceptance V1" }).waitFor();
  await fs.writeFile(readmePath, markdownFixture("V2"), "utf8");
  assert(await fileTab.getByRole("heading", { name: "Acceptance V2" }).count() === 0, "open Preview changed without a user reload");
  await page.getByRole("button", { name: "关闭标签：README.md", exact: true }).click();
  await activateTimelineReference(timeline, "README bare");
  fileTab = page.getByTestId("file-reference-tab");
  await expectAttribute(fileTab, "data-file-scope", "workspace-file");
  await fileTab.getByRole("heading", { name: "Acceptance V2" }).waitFor();
  assert(await fileTab.getByRole("heading", { name: "Acceptance V1" }).count() === 0, "reopened Preview retained V1");
  await fileTab.getByRole("button", { name: "源码" }).click();
  const reopenedV2Source = fileTab.getByTestId("file-source-scroll");
  await reopenedV2Source.getByText("# Acceptance V2", { exact: true }).waitFor();
  assert(await reopenedV2Source.getByText("# Acceptance V1", { exact: true }).count() === 0, "reopened source retained V1");
  acceptance["5.12"] = observation("README Preview 保持打开时修改磁盘文件", "先观察 V1，写入 V2，重新打开后依次检查 Preview 与源码", "打开页未自动替换；重新打开后 Preview 和源码均显示 V2，且两种模式都无 V1 残留");

  fileTab = page.getByTestId("file-reference-tab");
  await fileTab.getByRole("button", { name: "Preview" }).click();
  await fileTab.getByRole("button", { name: "workspace absolute" }).click();
  await expectAttribute(page.getByTestId("file-reference-tab"), "data-file-scope", "workspace-file");
  await page.getByRole("tab", { name: "README.md", exact: true }).click();
  fileTab = page.getByTestId("file-reference-tab");
  await fileTab.getByRole("button", { name: "external absolute" }).click();
  await expectAttribute(page.getByTestId("file-reference-tab"), "data-file-scope", "external-preview");
  await page.getByRole("tab", { name: "README.md", exact: true }).click();
  fileTab = page.getByTestId("file-reference-tab");
  await fileTab.getByRole("button", { name: "HTTPS" }).click();
  await page.getByRole("dialog", { name: "确认打开外部链接" }).waitFor();
  await page.getByRole("button", { name: "取消" }).click();
  assert(await fileTab.getByRole("button", { name: "danger" }).count() === 0, "dangerous Markdown URL became actionable");
  assert(await fileTab.getByRole("button", { name: "relative" }).count() === 0, "relative Markdown URL became actionable");
  assert(await fileTab.locator("img[src*='images/local.png']").count() === 0, "local image was read into Preview");
  acceptance["5.14"] = observation("README Preview 的绝对本地/HTTPS/危险/相对链接与本地图片", "依次点击可操作链接并检查其余节点", "工作区链接完整打开；外部链接有界预览；HTTPS 出确认；javascript/相对链接不导航；本地图片未读取");

  await page.getByRole("button", { name: "新建空白标签" }).click();
  await page.getByRole("button", { name: /项目文件/u }).click();
  const projectFiles = page.getByTestId("project-files-tab");
  await projectFiles.waitFor();
  await projectFiles.getByTitle("src/reader.ts").click();
  await projectFiles.getByText("export const changedAfterStart = true;").waitFor();
  assert(await projectFiles.getByTestId("file-diff-scroll").count() === 0, "project source used the diff view");
  assert(await projectFiles.locator("[data-line-kind]").count() === 0, "project source inherited Review line semantics");
  assert(await projectFiles.getByTestId("file-source-scroll").locator(".w-24").count() === 0, "changed project source used a double-line-number gutter");
  assert(await projectFiles.getByTestId("file-source-scroll").locator(".w-16").count() > 0, "changed project source lacked its single line-number gutter");

  await projectFiles.getByTitle("GUIDE.markdown").click();
  await projectFiles.getByRole("heading", { name: "Guide" }).waitFor();
  assert(await pressed(projectFiles.getByRole("button", { name: "Preview" })), "project .markdown did not default to Preview");
  await projectFiles.getByRole("button", { name: "源码" }).click();
  await projectFiles.getByText("# Guide").waitFor();
  const guideSource = projectFiles.getByTestId("file-source-scroll");
  assert(await projectFiles.getByTestId("file-diff-scroll").count() === 0, "unchanged project file used the diff view");
  assert(await projectFiles.locator("[data-line-kind]").count() === 0, "unchanged project file inherited Review line semantics");
  assert(await guideSource.locator(".w-24").count() === 0, "unchanged project file used a double-line-number gutter");
  assert(await guideSource.locator(".w-16").count() > 0, "unchanged project file lacked its single line-number gutter");
  acceptance["5.3"] = observation("右侧栏 + → 项目文件 → 已改动 src/reader.ts 与未改动 GUIDE.markdown", "分别选择文件并检查源码结构", "两者都显示完整当前内容；源码为一列行号且无双行号、增删背景或 diff 容器");
  await page.getByRole("tab", { name: "README.md", exact: true }).click();
  await page.getByRole("tab", { name: "项目文件", exact: true }).click();
  const reopenedProjectFiles = page.getByTestId("project-files-tab");
  await reopenedProjectFiles.getByTitle("GUIDE.markdown").click();
  await reopenedProjectFiles.getByText("# Guide").waitFor();
  assert(await pressed(reopenedProjectFiles.getByRole("button", { name: "源码" })), "project .markdown mode was not restored after switching tabs");
  acceptance["5.7"] = observation("项目文件中的 GUIDE.markdown", "选择后切换源码，再切走并返回项目文件标签", "默认 Preview，可切完整源码；按路径恢复该标签内模式；内容区始终无 Review 语义");

  const viewResult = page.getByTestId("conversation-result-card").getByRole("button", { name: "查看" });
  await viewResult.focus();
  await viewResult.press("Enter");
  changeTab = page.getByTestId("change-tab");
  await changeTab.waitFor();
  await changeTab.getByTitle("src/reader.ts").click();
  diffScroll = changeTab.getByTestId("file-diff-scroll");
  await diffScroll.waitFor();
  assert(await diffScroll.locator('[data-line-kind="addition"], [data-line-kind="deletion"]').count() > 0, "ChangeTab lost diff row semantics");
  assert(await diffScroll.locator(".w-7.text-right").count() >= 2, "ChangeTab lost old/new line-number columns");
  acceptance["5.4"] = observation("团队工作中的改动标签；主会话结束结果卡片 → 查看 → src/reader.ts", "工作中刷新并接受新改动；结束后从结果卡一步进入改动标签", "截至说明与新改动提示可见，选择/滚动位置保持；累计 diff 保留删除/增加/上下文和旧新双行号");

  acceptance["5.15"] = observation("文件阅读模式 change 的真实 Electron 验收脚本", "执行全部 5.x 用户入口并写出结构化记录", `入口、动作、可观察信号与一致性均记录到 ${evidencePath}`);

  const report = {
    ok: true,
    generatedAt: new Date().toISOString(),
    environment: "真机：真实 Electron 窗口 + production preload/local-console/SQLite/filesystem；仅 provider 回复使用临时 Codex 进程，文件打开动作与读取链路无网络/IPC stub",
    fixture: { fixtureRoot, externalRoot, sessionId: session.sessionId },
    acceptance,
    evidence: evidencePath,
  };
  await fs.writeFile(evidencePath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  process.stdout.write(`${JSON.stringify({ ok: true, evidence: evidencePath })}\n`);
} finally {
  if (application !== null) await closeApplication(application);
  await fs.chmod(unreadablePath, 0o600).catch(() => undefined);
  await fs.rm(runtimeRoot, { recursive: true, force: true, maxRetries: 8, retryDelay: 100 });
  await fs.rm(externalRoot, { recursive: true, force: true, maxRetries: 8, retryDelay: 100 });
}

function markdownFixture(version: "V1" | "V2"): string {
  const lines = [
    `# Acceptance ${version}`,
    "",
    "- rendered list",
    "- stable snapshot",
    "",
    `[workspace absolute](${sourcePath})`,
    `[external absolute](${reportPath}:60)`,
    "[HTTPS](https://example.com/docs)",
    "[danger](javascript:alert(1))",
    "[relative](docs/guide.md)",
    "![local image](images/local.png)",
  ];
  while (lines.length < 41) lines.push(`filler ${String(lines.length + 1)}`);
  lines.push("explicit README line 42");
  while (lines.length < 50) lines.push(`tail ${String(lines.length + 1)}`);
  return `${lines.join("\n")}\n`;
}

async function writeScanBudgetFixture(filePath: string): Promise<void> {
  const handle = await fs.open(filePath, "w");
  const chunk = Buffer.from("x\n".repeat(32 * 1024));
  try {
    for (let index = 0; index < 1_030; index += 1) await handle.write(chunk);
  } finally {
    await handle.close();
  }
}

async function startConversation(
  page: Page,
  apiBase: string,
  body: string,
): Promise<{ sessionId: string }> {
  const newConversation = page.getByRole("button", { name: "在 workspace 中新建会话" });
  await newConversation.waitFor({ timeout: 20_000 });
  await newConversation.click();
  await page.getByRole("region", { name: "新建对话" }).waitFor();
  const textbox = page.getByRole("textbox", { name: "消息内容" });
  await textbox.fill(body);
  await page.getByRole("button", { name: "发送消息" }).click();
  const sessionId = await waitForCreatedSession(apiBase, body);
  const timeline = page.getByRole("region", { name: "会话时间线" });
  if (!await timeline.isVisible().catch(() => false)) {
    const row = page.locator(`[data-testid='conversation-sidebar-session'][data-session-id="${sessionId}"]`);
    await row.waitFor({ timeout: 20_000 });
    await row.click();
  }
  await timeline.waitFor({ timeout: 20_000 });
  return { sessionId };
}

async function activateTimelineReference(timeline: Locator, name: string): Promise<void> {
  const reference = timeline.getByRole("button", { name });
  await reference.waitFor({ timeout: 20_000 });
  await reference.focus();
  await reference.press("Enter");
}

async function waitForCreatedSession(apiBase: string, body: string): Promise<string> {
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    const state = await requestJson<{
      selectedSessionId: string;
      messages: Array<{ speaker: string; body: string }>;
    }>(apiBase, "/api/local-console/state", {}, 200);
    if (state.selectedSessionId !== "" && state.messages.some((message) => message.speaker === "user" && message.body === body)) {
      return state.selectedSessionId;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("new conversation did not create a selected session with the submitted message");
}

async function waitForApiBase(page: Page): Promise<string> {
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    const value = await page.evaluate(async () => await (window as typeof window & {
      moebius?: { getLocalConsoleUrl?: () => Promise<string | null> };
    }).moebius?.getLocalConsoleUrl?.() ?? null);
    if (value !== null) return value;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("desktop preload did not expose local-console URL");
}

async function createProject(apiBase: string, folderPath: string): Promise<{ projectId: string }> {
  return (await requestJson<{ project: { projectId: string } }>(apiBase, "/api/local-console/projects", {
    method: "POST",
    body: JSON.stringify({ folderPath, worktreeMode: false }),
  }, 201)).project;
}

async function requestJson<T>(apiBase: string, pathname: string, init: RequestInit, expectedStatus: number): Promise<T> {
  const response = await fetch(new URL(pathname, apiBase), {
    ...init,
    headers: { "content-type": "application/json", ...init.headers },
  });
  if (response.status !== expectedStatus) throw new Error(`${init.method ?? "GET"} ${pathname}: ${response.status} ${await response.text()}`);
  return await response.json() as T;
}

async function waitForSessionResult(apiBase: string, sessionId: string): Promise<Record<string, unknown>> {
  const deadline = Date.now() + 20_000;
  let summary: Record<string, unknown> = {};
  while (Date.now() < deadline) {
    const state = await requestJson<{
      selectedSession: { status: string; runningCount: number } | null;
      activeRuns: unknown[];
      messages: Array<{ speaker: string; role: string | null; status: string; body: string }>;
      workspaceDiff: { available: boolean; fileCount: number | null; reason: string | null };
      lastError: string | null;
    }>(apiBase, `/api/local-console/state?sessionId=${encodeURIComponent(sessionId)}`, {}, 200);
    summary = {
      selectedSession: state.selectedSession,
      activeRunCount: state.activeRuns.length,
      messages: state.messages.map((message) => ({
        speaker: message.speaker,
        role: message.role,
        status: message.status,
        body: message.body.slice(0, 80),
      })),
      workspaceDiff: state.workspaceDiff,
      lastError: state.lastError,
    };
    if (
      state.activeRuns.length === 0
      && state.messages.some((message) =>
        message.speaker === "agent" && (message.status === "completed" || message.status === "displayed")
      )
      && state.workspaceDiff.available
      && (state.workspaceDiff.fileCount ?? 0) > 0
    ) return summary;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`session did not settle with a workspace diff: ${JSON.stringify(summary)}`);
}

async function expectAttribute(locator: Locator, name: string, expected: string): Promise<void> {
  const deadline = Date.now() + 20_000;
  let value: string | null = null;
  while (Date.now() < deadline) {
    if (await locator.count() > 0) value = await locator.getAttribute(name);
    if (value === expected) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`${name}: expected ${expected}, received ${String(value)}`);
}

async function assertSelectableText(locator: Locator, expectedSnippet: string, label: string): Promise<void> {
  const result = await locator.evaluate((element, snippet) => {
    let current: Element | null = element;
    let blocked = false;
    let selectable = false;
    while (current !== null) {
      const userSelect = window.getComputedStyle(current).userSelect;
      blocked ||= userSelect === "none";
      selectable ||= userSelect === "text" || userSelect === "auto";
      current = current.parentElement;
    }
    const selection = window.getSelection();
    const range = document.createRange();
    range.selectNodeContents(element);
    selection?.removeAllRanges();
    selection?.addRange(range);
    const selectedText = selection?.toString() ?? "";
    selection?.removeAllRanges();
    return { blocked, selectable, selectedText, snippet };
  }, expectedSnippet);
  assert(!result.blocked && result.selectable, `${label} is blocked from text selection`);
  assert(result.selectedText.includes(result.snippet), `${label} could not be selected from the real DOM`);
}

async function pressed(locator: Locator): Promise<boolean> {
  return await locator.getAttribute("aria-pressed") === "true";
}

function observation(entry: string, action: string, screen: string): Record<string, string> {
  return { environment: "真机", entry, action, screen, consistent: "是" };
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

async function run(command: string, args: string[], cwd: string): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child = spawn(command, args, { cwd, stdio: ["ignore", "pipe", "pipe"] });
    let stderr = "";
    child.stderr.on("data", (chunk: Buffer) => { stderr += chunk.toString("utf8"); });
    child.once("error", reject);
    child.once("exit", (code) => code === 0 ? resolve() : reject(new Error(`${command} exited ${String(code)}: ${stderr}`)));
  });
}

async function closeApplication(application: ElectronApplication): Promise<void> {
  const process = application.process();
  await Promise.race([
    application.close().catch(() => undefined),
    new Promise<void>((resolve) => setTimeout(resolve, 2_000)),
  ]);
  if (process.exitCode === null && process.signalCode === null) {
    process.kill("SIGKILL");
    await waitForChildExit(process, 5_000);
  }
}

function waitForChildExit(child: ChildProcess, timeoutMs: number): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return Promise.resolve();
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, timeoutMs);
    child.once("exit", () => {
      clearTimeout(timer);
      resolve();
    });
  });
}

function fakeCodexSource(): string {
  return `#!/usr/bin/env node
if (process.argv.includes("--version")) { process.stdout.write("codex-cli 0.0.0-acceptance\\n"); process.exit(0); }
const fs = require("node:fs");
const path = require("node:path");
const emit = (value) => process.stdout.write(JSON.stringify(value) + "\\n");
emit({ type: "thread.started", thread_id: "file-reading-acceptance" });
const sourcePath = path.join(process.cwd(), "src", "reader.ts");
setTimeout(() => {
  fs.appendFileSync(sourcePath, "export const changedAfterStart = true;\\n", "utf8");
  emit({ type: "item.completed", item: { type: "agent_message", text: "文件阅读入口已准备。" } });
  process.exit(0);
}, 8000);
`;
}
