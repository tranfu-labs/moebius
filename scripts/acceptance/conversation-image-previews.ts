import { spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { _electron as electron, type ElectronApplication, type Locator, type Page } from "playwright";

import { createAcceptanceOutputDirectory } from "./temp-output.js";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const desktopRoot = path.join(projectRoot, "desktop");
const runtimeRoot = await fs.mkdtemp(path.join(os.tmpdir(), "moebius-image-previews-runtime-"));
const fixtureRoot = path.join(runtimeRoot, "workspace");
const externalRoot = await fs.mkdtemp(path.join(os.tmpdir(), "moebius-image-previews-external-"));
const outputRoot = await createAcceptanceOutputDirectory("conversation-image-previews");
const evidencePath = path.join(outputRoot, "conversation-image-previews-evidence.json");
const fakeBin = path.join(runtimeRoot, "bin");

const diagramPath = path.join(fixtureRoot, "assets", "diagram.png");
const iconSvgPath = path.join(fixtureRoot, "assets", "icon.svg");
const fakePngPath = path.join(fixtureRoot, "assets", "fake.png");
const brokenSvgPath = path.join(fixtureRoot, "assets", "broken.svg");
const missingPngPath = path.join(fixtureRoot, "assets", "missing.png");
const externalSvgPath = path.join(externalRoot, "external-logo.svg");
const agentNotePath = path.join(fixtureRoot, "assets", "agent-note.txt");
const faviconIcoPath = path.join(fixtureRoot, "assets", "favicon-20260730.ico");
const consoleErrors: string[] = [];

await fs.mkdir(path.dirname(diagramPath), { recursive: true });
await fs.mkdir(fakeBin, { recursive: true });
await fs.mkdir(externalRoot, { recursive: true });
await fs.writeFile(path.join(runtimeRoot, ".onboarding-completed"), `${new Date().toISOString()}\n`, "utf8");

const realPng = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl2nGQAAAAASUVORK5CYII=",
  "base64",
);
await fs.writeFile(diagramPath, realPng);
await fs.writeFile(iconSvgPath, '<?xml version="1.0"?><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect width="32" height="32" fill="#1f2937"/></svg>', "utf8");
await fs.writeFile(fakePngPath, "<html><body>not an image</body></html>", "utf8");
// A server-recognized SVG whose XML parsing fails deterministically (NUL byte) so the
// renderer cannot derive a preview and the staging item falls back to an ordinary file.
await fs.writeFile(brokenSvgPath, Buffer.concat([
  Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10">', "utf8"),
  Buffer.from([0x00]),
  Buffer.from("</svg>", "utf8"),
]));
await fs.writeFile(externalSvgPath, '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 8 8"><circle cx="4" cy="4" r="3" fill="#7c3aed"/></svg>', "utf8");
await fs.writeFile(faviconIcoPath, buildMinimalIco(16), "binary");

await run("git", ["init", "-q"], fixtureRoot);
await run("git", ["config", "user.name", "Moebius Acceptance"], fixtureRoot);
await run("git", ["config", "user.email", "acceptance@localhost"], fixtureRoot);
await run("git", ["add", "assets"], fixtureRoot);
await run("git", ["commit", "-qm", "image preview baseline"], fixtureRoot);
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
  consoleErrors.length = 0;
  page.on("console", (message) => {
    if (message.type() === "error" || message.type() === "warning") consoleErrors.push(message.text());
  });
  await page.getByRole("button", { name: "设置" }).waitFor({ timeout: 20_000 });
  await application.evaluate(({ BrowserWindow }) => {
    BrowserWindow.getAllWindows()[0]?.setSize(1_440, 960);
  });
  const apiBase = await waitForApiBase(page);
  await createProject(apiBase, fixtureRoot);
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.getByRole("button", { name: "设置" }).waitFor({ timeout: 20_000 });

  const acceptance: Record<string, unknown> = {};

  // --- User attachments: PNG + safe SVG render as image cards; broken SVG falls back to a file card. ---
  const { sessionId } = await startConversationWithAttachments(
    page,
    apiBase,
    "@dev 看看这三份附件",
    [diagramPath, iconSvgPath, brokenSvgPath],
  );
  const messageState = await requestJson<{ messages: Array<{ speaker: string; attachments?: unknown[] }> }>(
    apiBase,
    `/api/local-console/state?sessionId=${encodeURIComponent(sessionId)}`,
    {},
    200,
  );
  const userMessage = messageState.messages.find((message) => message.speaker === "user");
  process.stderr.write(`user message attachments: ${JSON.stringify(userMessage?.attachments)}\n`);
  const timeline = page.getByRole("region", { name: "会话时间线" });
  await timeline.waitFor({ timeout: 20_000 });
  const imageCards = timeline.getByTestId("conversation-image-preview");
  await imageCards.first().waitFor({ timeout: 20_000 });
  await expectCount(imageCards, 2, "user message image cards");
  acceptance["7.1"] = observation("用户附件 PNG 与正常 SVG", "一次发送三份附件（PNG、SVG、损坏 SVG）", "时间线显示 2 张图片卡（PNG+SVG 派生成功）与 1 张普通文件卡（SVG 降级），无第三张图片卡");
  const brokenCard = timeline.getByLabel(/^broken\.svg，已准备/u);
  await brokenCard.waitFor({ timeout: 20_000 }).catch(async (error) => {
    process.stderr.write(`timeline state: ${await timeline.innerText()}\n`);
    const labels = await timeline.getByRole("article").evaluateAll((articles) =>
      articles.map((article) => article.getAttribute("aria-label") ?? article.textContent ?? ""));
    process.stderr.write(`timeline articles: ${JSON.stringify(labels)}\n`);
    throw error;
  });

  // --- Lightbox: open, zoom, switch to the next image, close. ---
  await imageCards.first().click();
  const dialog = page.getByRole("dialog", { name: "图片预览" });
  await dialog.waitFor({ timeout: 20_000 });
  await dialog.getByText(/第 1 张，共 2 张/u).first().waitFor();
  await dialog.getByRole("button", { name: "放大图片" }).click();
  await dialog.getByRole("button", { name: "恢复适应窗口" }).click();
  await dialog.getByRole("button", { name: "下一张图片" }).click();
  await dialog.getByText(/第 2 张，共 2 张/u).first().waitFor();
  await dialog.getByRole("button", { name: "关闭大图" }).click();
  await dialog.waitFor({ state: "hidden", timeout: 20_000 });
  acceptance["7.2"] = observation("Lightbox 大图查看", "打开首张图片卡，放大、恢复、切到下一张，再关闭", "对话框打开显示 1/2；缩放按钮生效；下一张显示 2/2；关闭后对话框消失");

  // --- Agent local image references: workspace PNG, external SVG, disguised and missing files. ---
  await waitForSessionResult(apiBase, sessionId);
  await page.locator(
    `[data-testid='conversation-sidebar-session'][data-session-id="${sessionId}"]`,
  ).click();
  await page.getByTestId("conversation-result-card").waitFor({ timeout: 20_000 });
  await page.getByRole("region", { name: "会话时间线" }).getByText("附件已核验。").waitFor({ timeout: 20_000 });
  const agentImageCards = page.getByRole("region", { name: "会话时间线" }).getByTestId("conversation-image-preview");
  await expectCount(agentImageCards, 4, "agent reference image cards");
  const missingCards = page.getByRole("region", { name: "会话时间线" }).getByLabel(/找不到/u);
  await expectCount(missingCards, 1, "agent reference missing cards");
  const failedCards = page.getByRole("region", { name: "会话时间线" }).getByLabel(/这张图片暂时显示不了/u);
  await expectCount(failedCards, 1, "agent reference failed cards");
  const missingCardBox = await missingCards.first().boundingBox();
  assert(
    missingCardBox !== null && Math.abs(missingCardBox.height - 160) <= 1,
    `missing status card height should be 160px, received ${String(missingCardBox?.height)}`,
  );
  const failedCardBox = await failedCards.first().boundingBox();
  assert(
    failedCardBox !== null && Math.abs(failedCardBox.height - 160) <= 1,
    `failed status card height should be 160px, received ${String(failedCardBox?.height)}`,
  );
  acceptance["7.3"] = observation("Agent 回复中的本地图片引用", "fake Codex 回复引用工作空间 PNG、外部 SVG、伪装 PNG 与缺失 PNG", "PNG 与外部 SVG 各成图片卡（共 4 张含用户附件）；缺失 PNG 成「找不到」状态卡、伪装 PNG 成「暂时显示不了」失败卡（均与图片卡同高 160px），不显示任何字节");

  // --- Open file from a failed status card uses the existing file-reference boundary. ---
  await failedCards.first().getByRole("button", { name: "打开文件" }).click();
  const fileTab = page.getByTestId("file-reference-tab");
  await fileTab.waitFor({ timeout: 20_000 });
  await expectAttribute(fileTab, "data-file-scope", "workspace-file");
  await fileTab.getByText("<html><body>not an image</body></html>").waitFor({ timeout: 20_000 });
  acceptance["7.4"] = observation("失败卡「打开文件」", "点击伪装 PNG 失败卡的打开文件", "右侧栏打开既有 file-reference 边界视图；伪装 PNG 按 workspace-file 显示其 HTML 文本而非图片字节");

  // --- Folded gallery: eight attachments (wide SVG first, then seven PNGs) show six equal-height cards plus a view-all entry. ---
  const wideBannerPath = path.join(fixtureRoot, "assets", "wide-banner.svg");
  await fs.writeFile(
    wideBannerPath,
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 160"><rect width="800" height="160" fill="#334155"/></svg>',
    "utf8",
  );
  const manyPngPaths: string[] = [];
  for (let index = 0; index < 7; index += 1) {
    const filePath = path.join(fixtureRoot, "assets", `many-${index}.png`);
    await fs.writeFile(filePath, realPng);
    manyPngPaths.push(filePath);
  }
  await run("git", ["add", "assets"], fixtureRoot);
  await run("git", ["commit", "-qm", "add many image fixtures"], fixtureRoot);
  const { sessionId: manySessionId } = await startConversationWithAttachments(
    page,
    apiBase,
    "@dev 八张图片",
    [wideBannerPath, ...manyPngPaths],
    8,
    async () => {
      // Draft cards follow the same 160px height rule before sending.
      const composer = page.getByTestId("main-role-composer");
      const draftImage = composer.locator("article img").first();
      const draftBox = await draftImage.boundingBox();
      assert(
        draftBox !== null && Math.abs(draftBox.height - 160) <= 1,
        `draft image height should be 160px, received ${String(draftBox?.height)}`,
      );
    },
  );
  await waitForSessionResult(apiBase, manySessionId);
  await page.locator(
    `[data-testid='conversation-sidebar-session'][data-session-id="${manySessionId}"]`,
  ).click();
  await page.getByTestId("conversation-result-card").waitFor({ timeout: 20_000 });
  const manyTimeline = page.getByRole("region", { name: "会话时间线" });
  const manyImageCards = manyTimeline.getByTestId("conversation-image-preview");
  const viewAll = manyTimeline.getByRole("button", { name: "查看全部图片（共 8 张）" });
  await viewAll.waitFor({ timeout: 20_000 });
  // 6 folded user cards + 2 Agent reference image cards (diagram.png and external-logo.svg).
  await expectCount(manyImageCards, 8, "folded message image cards");
  const wideCardBox = await manyImageCards.first().boundingBox();
  assert(
    wideCardBox !== null && Math.abs(wideCardBox.height - 160) <= 1,
    `wide banner card height should be 160px, received ${String(wideCardBox?.height)}`,
  );
  assert(
    wideCardBox !== null && wideCardBox.width <= 321,
    `wide banner card width should be capped at 320px, received ${String(wideCardBox?.width)}`,
  );
  const squareCardBox = await manyImageCards.nth(1).boundingBox();
  assert(
    squareCardBox !== null
    && Math.abs(squareCardBox.height - 160) <= 1
    && Math.abs(squareCardBox.width - 160) <= 1,
    `a 1:1 preview keeps its aspect ratio at 160x160, received ${String(squareCardBox?.width)}x${String(squareCardBox?.height)}`,
  );
  await viewAll.click();
  const manyDialog = page.getByRole("dialog", { name: "图片预览" });
  await manyDialog.waitFor({ timeout: 20_000 });
  await manyDialog.getByText(/第 1 张，共 10 张/u).first().waitFor();
  for (let step = 0; step < 7; step += 1) {
    await manyDialog.getByRole("button", { name: "下一张图片" }).click();
  }
  await manyDialog.getByText(/第 8 张，共 10 张/u).first().waitFor();
  await manyDialog.getByRole("button", { name: "关闭大图" }).click();
  await manyDialog.waitFor({ state: "hidden", timeout: 20_000 });
  const activeLabel = await page.evaluate(
    () => document.activeElement?.getAttribute("aria-label") ?? null,
  );
  assert(
    activeLabel === "查看全部图片（共 8 张）",
    `focus should return to the view-all entry, received ${String(activeLabel)}`,
  );
  acceptance["7.5"] = observation(
    "多图折叠、等高与比例、焦点返回",
    "发送 8 张附件（宽幅 SVG + 7 张 1:1 PNG），查看时间线并打开折叠入口",
    "草稿卡与消息卡均等高 160px；1:1 PNG 卡 160×160 保持比例；宽幅 SVG 卡宽 ≤320px；时间线显示 6 张图片卡与「查看全部图片（共 8 张）」；Lightbox 从第 1 张切到第 8 张（共 10 张）后关闭，焦点回到折叠入口",
  );

  // --- ICO attachment renders as an image card (extended format support). ---
  const { sessionId: icoSessionId } = await startConversationWithAttachments(
    page,
    apiBase,
    "@dev 图标附件",
    [faviconIcoPath],
    1,
  );
  await waitForSessionResult(apiBase, icoSessionId);
  await page.locator(
    `[data-testid='conversation-sidebar-session'][data-session-id="${icoSessionId}"]`,
  ).click();
  await page.getByTestId("conversation-result-card").waitFor({ timeout: 20_000 });
  const icoTimeline = page.getByRole("region", { name: "会话时间线" });
  const icoCard = icoTimeline.getByRole("button", { name: "查看大图：favicon-20260730.ico" });
  await icoCard.waitFor({ timeout: 20_000 });
  const icoBox = await icoCard.boundingBox();
  assert(
    icoBox !== null && Math.abs(icoBox.height - 160) <= 1,
    `ICO card height should be 160px, received ${String(icoBox?.height)}`,
  );
  acceptance["7.6"] = observation(
    "ICO 附件显示图片预览",
    "发送 favicon-20260730.ico 附件",
    "ICO 附件显示为 160px 等高图片卡（ICO 为文件类图片：不进 provider imagePaths、派生失败可降级普通文件）",
  );
  const report = {
    ok: true,
    generatedAt: new Date().toISOString(),
    environment: "真机：真实 Electron 窗口 + production preload/local-console/SQLite/filesystem；provider 回复使用临时 Codex 进程；附件上传、SVG 解码、Agent 引用端点、Lightbox 均为真实链路",
    fixture: { fixtureRoot, externalRoot, sessionId },
    acceptance,
    evidence: evidencePath,
  };
  await fs.writeFile(evidencePath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  process.stdout.write(`${JSON.stringify({ ok: true, evidence: evidencePath })}\n`);
} finally {
  if (application !== null) await closeApplication(application);
  await fs.rm(runtimeRoot, { recursive: true, force: true, maxRetries: 8, retryDelay: 100 });
  await fs.rm(externalRoot, { recursive: true, force: true, maxRetries: 8, retryDelay: 100 });
}

async function startConversationWithAttachments(
  page: Page,
  apiBase: string,
  body: string,
  attachmentPaths: string[],
  expectedReadyCount?: number,
  onDraftReady?: () => Promise<void>,
): Promise<{ sessionId: string }> {
  const newConversation = page.getByRole("button", { name: "在 workspace 中新建会话" });
  await newConversation.waitFor({ timeout: 20_000 });
  await newConversation.click();
  await page.getByRole("region", { name: "新建对话" }).waitFor();
  const fileInput = page.locator('input[type="file"]');
  await fileInput.setInputFiles(await Promise.all(attachmentPaths.map(async (filePath) => ({
    name: path.basename(filePath),
    mimeType: filePath.endsWith(".svg") ? "image/svg+xml" : filePath.endsWith(".png") ? "image/png" : "application/octet-stream",
    buffer: await fs.readFile(filePath),
  }))));
  const composerAttachments = page.getByTestId("main-role-composer");
  await composerAttachments.getByRole("article").first().waitFor({ timeout: 20_000 });
  const ready = composerAttachments.getByText(/已准备/u);
  const expectedReady = expectedReadyCount ?? attachmentPaths.length - 1; // the undecodable SVG falls back to a file card without the ready label
  for (let attempt = 0; attempt < 20; attempt += 1) {
    if (await ready.count() === expectedReady) break;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  if (await ready.count() !== expectedReady) {
    process.stderr.write(`composer state: ${await composerAttachments.innerText()}\n`);
    process.stderr.write(`console errors: ${JSON.stringify(consoleErrors)}\n`);
    throw new Error(`ready composer attachments: expected ${String(expectedReady)}, received ${String(await ready.count())}`);
  }
  if (onDraftReady !== undefined) await onDraftReady();
  const textbox = page.getByRole("textbox", { name: "消息内容" });
  await textbox.fill(body);
  const send = page.getByRole("button", { name: "发送消息" });
  await send.waitFor({ timeout: 20_000 });
  for (let attempt = 0; attempt < 40; attempt += 1) {
    if (await send.isEnabled()) break;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  if (!await send.isEnabled()) {
    process.stderr.write(`composer state: ${await composerAttachments.innerText()}\n`);
    throw new Error("send button stayed disabled: an attachment did not become ready");
  }
  await send.click();
  const sessionId = await waitForCreatedSession(apiBase, body);
  return { sessionId };
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

async function waitForSessionResult(apiBase: string, sessionId: string): Promise<void> {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    const state = await requestJson<{
      activeRuns: unknown[];
      messages: Array<{ speaker: string; status: string; body: string }>;
      workspaceDiff: { available: boolean; fileCount: number | null };
    }>(apiBase, `/api/local-console/state?sessionId=${encodeURIComponent(sessionId)}`, {}, 200);
    if (
      state.activeRuns.length === 0
      && state.messages.some((message) => message.speaker === "agent" && (message.status === "completed" || message.status === "displayed"))
      && state.messages.some((message) => message.speaker === "agent" && message.body.includes("附件已核验"))
      && state.workspaceDiff.available
      && (state.workspaceDiff.fileCount ?? 0) > 0
    ) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("session did not settle with the verified attachment reply");
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

async function expectCount(locator: Locator, expected: number, label: string): Promise<void> {
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    if (await locator.count() === expected) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`${label}: expected ${String(expected)} elements, received ${String(await locator.count())}`);
}

function observation(entry: string, action: string, screen: string): Record<string, string> {
  return { environment: "真机", entry, action, screen, consistent: "是" };
}

/** Builds a minimal 32-bit ICO file with a single square image (Chromium decodes it natively). */
function buildMinimalIco(size: number): Buffer {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(1, 2); // type: icon
  header.writeUInt16LE(1, 4); // count
  const entry = Buffer.alloc(16);
  entry.writeUInt8(size >= 256 ? 0 : size, 0);
  entry.writeUInt8(size >= 256 ? 0 : size, 1);
  entry.writeUInt16LE(1, 4); // planes
  entry.writeUInt16LE(32, 6); // bit count
  const imageBytes = 40 + size * size * 4 + size * size / 8; // BITMAPINFOHEADER + BGRA + AND mask
  entry.writeUInt32LE(imageBytes, 8);
  entry.writeUInt32LE(22, 12); // image offset
  const info = Buffer.alloc(40);
  info.writeUInt32LE(40, 0);
  info.writeInt32LE(size, 4);
  info.writeInt32LE(size * 2, 8); // doubled height incl. AND mask
  info.writeUInt16LE(1, 12);
  info.writeUInt16LE(32, 14);
  info.writeUInt32LE(size * size * 4, 20);
  const pixels = Buffer.alloc(size * size * 4);
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const offset = (y * size + x) * 4;
      pixels[offset] = 0x6b; // B
      pixels[offset + 1] = 0x9a; // G
      pixels[offset + 2] = 0x3f; // R
      pixels[offset + 3] = 0xff; // A
    }
  }
  const mask = Buffer.alloc(size * size / 8);
  return Buffer.concat([header, entry, info, pixels, mask]);
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
emit({ type: "thread.started", thread_id: "image-previews-acceptance" });
const fixture = ${JSON.stringify(fixtureRoot)};
const external = ${JSON.stringify(externalRoot)};
setTimeout(() => {
  fs.appendFileSync(path.join(fixture, "assets", "agent-note.txt"), "verified by agent\\n");
  emit({ type: "item.completed", item: { type: "agent_message", text: [
    "附件已核验。",
    "工作空间图：见 " + path.join(fixture, "assets", "diagram.png") + "。",
    "外部 SVG：见 " + path.join(external, "external-logo.svg") + "。",
    "伪装：见 " + path.join(fixture, "assets", "fake.png") + "。",
    "缺失：见 " + path.join(fixture, "assets", "missing.png") + "。"
  ].join("\\n") } });
  process.exit(0);
}, 8000);
`;
}
