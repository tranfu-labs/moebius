import { spawn } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium, type Page } from "playwright";
import { createAcceptanceOutputDirectory } from "./temp-output.js";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const artifactDir = await createAcceptanceOutputDirectory("local-console-t65");
const desktopDist = path.join(projectRoot, "desktop", "dist", "console-page");
const storybookStatic = path.join(artifactDir, "t65-storybook-static");

const artifacts = {
  agentMessage: path.join(artifactDir, "t65-agent-message.png"),
  runBlock: path.join(artifactDir, "t65-run-block.png"),
  runOutcomes: path.join(artifactDir, "t65-run-outcomes.png"),
  sidebar: path.join(artifactDir, "t65-sidebar.png"),
  roleComposer: path.join(artifactDir, "t65-role-composer.png"),
  storybook: path.join(artifactDir, "t65-storybook-operator-console.png"),
  visibleCopy: path.join(artifactDir, "t65-visible-copy.txt"),
  accessibilitySnapshot: path.join(artifactDir, "t65-accessibility-snapshot.yml"),
  evidence: path.join(artifactDir, "t65-evidence.json"),
  evidenceSha256: path.join(artifactDir, "t65-evidence.sha256"),
} as const;

type Scenario = "running" | "outcomes" | "empty";

interface Evidence {
  runId: string;
  startedAt: string;
  finishedAt: string;
  baseHead: string;
  testedSourceDigest: string;
  scenarios: Record<string, unknown>;
  hardGate: {
    forbiddenMachineTerms: string[];
    visibleCopyMatches: string[];
    accessibilityMatches: string[];
    englishAuthorLabels: string[];
  };
  artifacts: Record<string, string>;
  payloadArtifacts: Array<{
    path: string;
    bytes: number;
    sha256: string;
  }>;
}

const runId = `t65-${new Date().toISOString().replace(/[:.]/gu, "-")}-${crypto.randomBytes(3).toString("hex")}`;
const startedAt = new Date().toISOString();
let scenario: Scenario = "running";

await fs.mkdir(artifactDir, { recursive: true });
await cleanupArtifacts();
await buildStorybook();

const baseHead = (await run("git", ["rev-parse", "HEAD"])).trim();
const sourceManifest = await testedSourceManifest(baseHead);
await verifyProcessTreeCleanup();
const server = await startServer();
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1360, height: 900 }, deviceScaleFactor: 1 });
const storybookPage = await browser.newPage({ viewport: { width: 1280, height: 900 }, deviceScaleFactor: 1 });

try {
  const scenarios: Evidence["scenarios"] = {};

  scenario = "running";
  await loadDesktop(page, server.url);
  await page.getByText("已把复合组件接入真实操作台。").first().waitFor({ timeout: 15_000 });
  await assertNotVisible(page, /moebius:stage=code-verified/u);
  await page
    .getByText("已把复合组件接入真实操作台。")
    .first()
    .locator("xpath=ancestor::details[1]")
    .screenshot({ path: absoluteArtifact(artifacts.agentMessage) });
  scenarios.agentMessage = {
    collapsedSummary: await page.getByText("已把复合组件接入真实操作台。").first().isVisible(),
    rawProtocolHidden: !(await page.getByText(/moebius:stage=code-verified/u).first().isVisible()),
  };
  await page.getByText("点开全文").first().click();
  await page.getByText(/moebius:stage=code-verified/u).first().waitFor({ timeout: 10_000 });

  await loadDesktop(page, server.url);
  await page.getByText("正在整合复合组件").first().waitFor({ timeout: 15_000 });
  await page.getByRole("button", { name: /中断开发运行/u }).waitFor({ timeout: 10_000 });
  await page
    .getByRole("button", { name: /中断开发运行/u })
    .locator("xpath=ancestor::div[contains(@class, 'max-w')][1]")
    .screenshot({ path: absoluteArtifact(artifacts.runBlock) });
  await page.getByText("查看原始输出").first().click();
  await page.getByText(/运行目录：\/tmp\/t65-runDir-sentinel/u).waitFor({ timeout: 10_000 });
  scenarios.runBlock = {
    summaryVisible: true,
    rawOutputExpandable: true,
  };

  await loadDesktop(page, server.url);
  await page.getByText("已完成 (1)").first().waitFor({ timeout: 10_000 });
  await assertNotVisible(page, "已归档任务");
  await page.locator("aside").first().screenshot({ path: absoluteArtifact(artifacts.sidebar) });
  await page.getByRole("button", { name: /已完成/u }).click();
  await page.getByText("已归档任务").first().waitFor({ timeout: 10_000 });
  scenarios.sidebar = {
    directoryNameVisible: await page.getByText("moebius-console").first().isVisible(),
    completedCollapsedByDefault: true,
    completedExpandable: true,
  };

  scenario = "outcomes";
  await loadDesktop(page, server.url);
  await page.getByText("运行失败").first().waitFor({ timeout: 15_000 });
  await page.getByText("运行长时间无响应").first().waitFor({ timeout: 10_000 });
  await page.getByText("运行已中断").first().waitFor({ timeout: 10_000 });
  await page.getByText("多次尝试仍失败，已停止自动重试").first().waitFor({ timeout: 10_000 });
  await page.screenshot({ path: absoluteArtifact(artifacts.runOutcomes), fullPage: true });
  await page.getByText("查看详情").first().click();
  await page.getByText(/exit:42/u).first().waitFor({ timeout: 10_000 });
  scenarios.runOutcomes = {
    failedVisible: true,
    stuckVisible: true,
    interruptedVisible: true,
    deadLetterVisible: true,
    rawReasonExpandable: true,
  };

  scenario = "empty";
  await loadDesktop(page, server.url);
  const composer = page.getByPlaceholder("描述你的目标，@ 一个角色开始…").first();
  await composer.waitFor({ timeout: 15_000 });
  await composer.fill("@");
  await page.getByRole("option", { name: /开发/u }).waitFor({ timeout: 10_000 });
  await page.screenshot({ path: absoluteArtifact(artifacts.roleComposer), fullPage: true });
  await page.getByRole("option", { name: /开发/u }).click();
  const composerValue = await composer.inputValue();
  await composer.fill("@dev @");
  const secondPanelCount = await page.getByRole("listbox", { name: "角色补全面板" }).count();
  scenarios.roleComposer = {
    selectedValue: composerValue,
    secondMentionPanelBlocked: secondPanelCount === 0,
  };

  const storyId = await findStoryId("Page/Console/OperatorConsole", "T 65 Running");
  await screenshotStory(storybookPage, server.url, storyId, "正在整合复合组件", artifacts.storybook);
  scenarios.storybook = { storyId };

  scenario = "running";
  await loadDesktop(page, server.url);
  const visibleCopy = await collectVisibleText(page);
  const accessibilitySnapshot = await page.locator("body").ariaSnapshot({ timeout: 10_000 });
  await fs.writeFile(absoluteArtifact(artifacts.visibleCopy), visibleCopy, "utf8");
  await fs.writeFile(absoluteArtifact(artifacts.accessibilitySnapshot), accessibilitySnapshot, "utf8");

  const hardGate = runHardGate(visibleCopy, accessibilitySnapshot);
  if (
    hardGate.visibleCopyMatches.length > 0 ||
    hardGate.accessibilityMatches.length > 0 ||
    hardGate.englishAuthorLabels.length > 0
  ) {
    throw new Error(`T6.5 visible copy hard gate failed: ${JSON.stringify(hardGate)}`);
  }

  const payloadPaths = [
    artifacts.agentMessage,
    artifacts.runBlock,
    artifacts.runOutcomes,
    artifacts.sidebar,
    artifacts.roleComposer,
    artifacts.storybook,
    artifacts.visibleCopy,
    artifacts.accessibilitySnapshot,
  ];
  const payloadArtifacts = await Promise.all(payloadPaths.map(artifactDigest));
  const evidence: Evidence = {
    runId,
    startedAt,
    finishedAt: new Date().toISOString(),
    baseHead,
    testedSourceDigest: sourceManifest.digest,
    scenarios,
    hardGate,
    artifacts,
    payloadArtifacts,
  };

  const evidenceJson = `${JSON.stringify(evidence, null, 2)}\n`;
  await fs.writeFile(absoluteArtifact(artifacts.evidence), evidenceJson, "utf8");
  const evidenceDigest = sha256(Buffer.from(evidenceJson));
  await fs.writeFile(absoluteArtifact(artifacts.evidenceSha256), `${evidenceDigest}  ${artifacts.evidence}\n`, "utf8");

  process.stdout.write(JSON.stringify({ ok: true, runId, artifacts }, null, 2));
  process.stdout.write("\n");
} finally {
  await browser.close();
  await server.close();
  await fs.rm(storybookStatic, { recursive: true, force: true });
}

async function cleanupArtifacts(): Promise<void> {
  await Promise.all(Object.values(artifacts).map((artifactPath) => fs.rm(absoluteArtifact(artifactPath), { force: true })));
  await fs.rm(storybookStatic, { recursive: true, force: true });
}

async function buildStorybook(): Promise<void> {
  await runProcess(
    "pnpm",
    ["--filter", "@moebius/console-ui", "exec", "storybook", "build", "--output-dir", storybookStatic],
    180_000,
  );
}

async function loadDesktop(page: Page, serverUrl: string): Promise<void> {
  const desktopUrl = new URL("/desktop/index.html", serverUrl);
  desktopUrl.searchParams.set("api", `${serverUrl}/`);
  await page.goto(desktopUrl.toString(), { waitUntil: "networkidle", timeout: 15_000 });
}

async function screenshotStory(
  page: Page,
  serverUrl: string,
  storyId: string,
  waitForText: string,
  artifactPath: string,
): Promise<void> {
  const storyUrl = new URL("/storybook/iframe.html", serverUrl);
  storyUrl.searchParams.set("id", storyId);
  storyUrl.searchParams.set("viewMode", "story");
  await page.goto(storyUrl.toString(), { waitUntil: "networkidle", timeout: 15_000 });
  await page.getByText(waitForText).first().waitFor({ timeout: 15_000 });
  await page.screenshot({ path: absoluteArtifact(artifactPath), fullPage: true });
}

async function findStoryId(title: string, storyName: string): Promise<string> {
  const indexPath = path.join(storybookStatic, "index.json");
  const raw = await fs.readFile(indexPath, "utf8");
  const index = JSON.parse(raw) as {
    entries?: Record<string, { title?: string; name?: string; exportName?: string; type?: string }>;
  };
  for (const [id, entry] of Object.entries(index.entries ?? {})) {
    if (
      entry.type === "story" &&
      entry.title === title &&
      (entry.name === storyName || entry.exportName === storyName)
    ) {
      return id;
    }
  }
  throw new Error(`Story not found: ${title} / ${storyName}`);
}

async function startServer(): Promise<{ url: string; close(): Promise<void> }> {
  const server = http.createServer(async (request, response) => {
    try {
      const requestUrl = new URL(request.url ?? "/", "http://127.0.0.1");
      if (request.method === "OPTIONS") {
        writeCors(response);
        response.writeHead(204).end();
        return;
      }
      if (requestUrl.pathname === "/api/local-console/state") {
        writeJson(response, buildState(scenario));
        return;
      }
      if (requestUrl.pathname.startsWith("/api/local-console/")) {
        writeJson(response, { ok: true });
        return;
      }
      if (requestUrl.pathname.startsWith("/desktop/")) {
        const relative = requestUrl.pathname.replace(/^\/desktop\//u, "");
        await serveFile(path.join(desktopDist, relative), response);
        return;
      }
      if (requestUrl.pathname.startsWith("/storybook/")) {
        const relative = requestUrl.pathname.replace(/^\/storybook\//u, "");
        await serveFile(path.join(storybookStatic, relative), response);
        return;
      }
      response.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
      response.end("not found");
    } catch (error) {
      response.writeHead(500, { "content-type": "text/plain; charset=utf-8" });
      response.end(error instanceof Error ? error.stack : String(error));
    }
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (address === null || typeof address === "string") {
    throw new Error("Failed to start T6.5 evidence server");
  }
  return {
    url: `http://127.0.0.1:${address.port}`,
    close: () => new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve())),
  };
}

async function serveFile(filePath: string, response: http.ServerResponse): Promise<void> {
  const bytes = await fs.readFile(filePath);
  response.writeHead(200, { "content-type": contentType(filePath) });
  response.end(bytes);
}

function contentType(filePath: string): string {
  if (filePath.endsWith(".html")) return "text/html; charset=utf-8";
  if (filePath.endsWith(".js")) return "text/javascript; charset=utf-8";
  if (filePath.endsWith(".css")) return "text/css; charset=utf-8";
  if (filePath.endsWith(".json")) return "application/json; charset=utf-8";
  if (filePath.endsWith(".map")) return "application/json; charset=utf-8";
  if (filePath.endsWith(".png")) return "image/png";
  if (filePath.endsWith(".svg")) return "image/svg+xml";
  return "application/octet-stream";
}

function writeCors(response: http.ServerResponse): void {
  response.setHeader("access-control-allow-origin", "*");
  response.setHeader("access-control-allow-methods", "GET,POST,PATCH,OPTIONS");
  response.setHeader("access-control-allow-headers", "content-type");
}

function writeJson(response: http.ServerResponse, value: unknown): void {
  writeCors(response);
  response.writeHead(200, { "content-type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(value));
}

function buildState(activeScenario: Scenario) {
  const sessions = [
    session("waiting", "等待验收", "waiting", 0, 1, 0, 0),
    session("running", "集成收尾", "running", 1, 0, 0, 0, { childCount: 1 }),
    session("idle", "截图走查", "idle", 0, 0, 0, 0, { parentSessionId: "running" }),
    session("completed", "已归档任务", "completed", 0, 0, 0, 0),
  ];
  const selectedSessionId = activeScenario === "empty" ? "idle" : "running";
  const selectedSession = sessions.find((item) => item.sessionId === selectedSessionId) ?? sessions[1]!;
  const project = {
    projectId: "local",
    sourceType: "local-folder",
    title: "moebius-console",
    folderPath: "/Users/example/moebius-console",
    worktreeMode: true,
    workspaceCwd: "/tmp/t65-cwd-sentinel",
    workspaceMode: "worktree",
    worktreePath: "/tmp/t65-worktree-sentinel",
    worktreeUnavailableReason: null,
    workspaceUpdatedAt: "2026-07-11T10:04:00.000Z",
    sessions,
    runningCount: activeScenario === "running" ? 1 : 0,
    waitingCount: 1,
    stuckCount: 0,
    errorCount: activeScenario === "outcomes" ? 1 : 0,
  };
  return {
    projects: [project],
    project,
    selectedProjectId: "local",
    selectedSessionId,
    selectedSession,
    messages: messagesFor(activeScenario),
    activeRun: activeScenario === "running" ? activeRun() : null,
    sqlitePath: "/tmp/t65-local-console.sqlite",
    lastError: null,
  };
}

function messagesFor(activeScenario: Scenario) {
  if (activeScenario === "empty") {
    return [];
  }
  if (activeScenario === "outcomes") {
    return [
      message(10, "system", null, "failed", "Codex failed: exit:42", "exit:42"),
      message(11, "system", null, "stuck", "Codex stuck: idle-timeout:10ms", "idle-timeout:10ms"),
      message(12, "system", null, "interrupted", "Interrupted by user", "interrupted:user-interrupted"),
      message(13, "system", null, "failed", "dead-letter body handoff raw", "dead-letter: repeated exit"),
    ];
  }
  return [
    message(1, "user", null, "displayed", "请完成 T6.5 集成收尾。"),
    message(2, "agent", "dev", "displayed", agentMarkdown(), null, "/tmp/t65-runDir-sentinel"),
  ];
}

function activeRun() {
  return {
    sessionId: "running",
    runId: "run-t65",
    role: "dev",
    status: "running",
    startedAt: "2026-07-11T10:01:00.000Z",
    elapsedMs: 94_000,
    runDir: "/tmp/t65-runDir-sentinel",
    cwd: "/tmp/t65-cwd-sentinel",
    workspaceMode: "worktree",
    worktreeUnavailableReason: null,
    stdoutTail: "stdout tail with raw detail",
    stderrTail: null,
    lastOutputSummary: "正在整合复合组件",
    tailDiagnostic: null,
    interruptible: true,
  };
}

function session(
  sessionId: string,
  title: string,
  status: "idle" | "running" | "waiting" | "completed",
  runningCount: number,
  waitingCount: number,
  stuckCount: number,
  errorCount: number,
  extra: { parentSessionId?: string | null; childCount?: number } = {},
) {
  return {
    sessionId,
    projectId: "local",
    parentSessionId: extra.parentSessionId ?? null,
    title,
    status,
    runningCount,
    waitingCount,
    stuckCount,
    errorCount,
    interruptedCount: 0,
    childCount: extra.childCount,
    createdAt: "2026-07-11T10:00:00.000Z",
    updatedAt: "2026-07-11T10:04:00.000Z",
  };
}

function message(
  id: number,
  speaker: "user" | "agent" | "system",
  role: string | null,
  status: "pending" | "running" | "completed" | "failed" | "interrupted" | "stuck" | "displayed",
  body: string,
  error: string | null = null,
  runDir: string | null = null,
) {
  return {
    id,
    sessionId: "running",
    speaker,
    role,
    body,
    status,
    runId: `run-${id}`,
    runDir,
    error,
    createdAt: "2026-07-11T10:00:00.000Z",
    updatedAt: "2026-07-11T10:04:00.000Z",
  };
}

function agentMarkdown(): string {
  return [
    "## 结论",
    "已把复合组件接入真实操作台。",
    "",
    "## 依据",
    "- packages/console-ui/src/console/operator-console.tsx",
    "",
    "## 下一步",
    "交棒：@qa 请按验收场景走查",
    "",
    "<!-- moebius:stage=code-verified -->",
  ].join("\n");
}

async function collectVisibleText(page: Page): Promise<string> {
  return page.locator("body").evaluate((body) => {
    const lines: string[] = [];
    const walker = document.createTreeWalker(body, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const parent = node.parentElement;
      const text = node.textContent?.replace(/\s+/gu, " ").trim();
      if (!parent || !text) {
        continue;
      }
      if (parent.closest("details:not([open]) :not(summary)")) {
        continue;
      }
      const style = window.getComputedStyle(parent);
      if (style.display === "none" || style.visibility === "hidden") {
        continue;
      }
      if (parent.getClientRects().length === 0) {
        continue;
      }
      lines.push(text);
    }
    return lines.join("\n");
  });
}

function runHardGate(visibleCopy: string, accessibilitySnapshot: string): Evidence["hardGate"] {
  const machinePattern = /worktree|direct|cwd|runDir|dead-letter|handoff/giu;
  const authorPattern = /^(user|agent|system)$/iu;
  return {
    forbiddenMachineTerms: ["worktree", "direct", "cwd", "runDir", "dead-letter", "handoff"],
    visibleCopyMatches: matches(visibleCopy, machinePattern),
    accessibilityMatches: matches(accessibilitySnapshot, machinePattern),
    englishAuthorLabels: visibleCopy
      .split(/\r?\n/u)
      .map((line) => line.trim())
      .filter((line) => authorPattern.test(line)),
  };
}

function matches(text: string, pattern: RegExp): string[] {
  const found = new Set<string>();
  for (const match of text.matchAll(pattern)) {
    found.add(match[0]);
  }
  return [...found].sort();
}

async function assertNotVisible(page: Page, text: string | RegExp): Promise<void> {
  const locator = typeof text === "string" ? page.getByText(text) : page.getByText(text);
  if (await locator.first().isVisible({ timeout: 1_000 }).catch(() => false)) {
    throw new Error(`Expected text to be hidden: ${String(text)}`);
  }
}

async function artifactDigest(artifactPath: string): Promise<{ path: string; bytes: number; sha256: string }> {
  const filePath = absoluteArtifact(artifactPath);
  const bytes = await fs.readFile(filePath);
  return { path: artifactPath, bytes: bytes.byteLength, sha256: sha256(bytes) };
}

async function testedSourceManifest(baseHead: string): Promise<{ digest: string; files: unknown[] }> {
  const tracked = (await run("git", [
    "ls-files",
    "packages/console-ui/src",
    "scripts/acceptance",
    "openspec/changes/desktop-console-t65-integration-closeout",
  ])).split(/\r?\n/u).filter(Boolean);
  const changed = (await run("git", ["status", "--porcelain", "--untracked-files=all"]))
    .split(/\r?\n/u)
    .map((line) => line.slice(3).trim())
    .filter((filePath) =>
      filePath.startsWith("packages/console-ui/src/") ||
      filePath.startsWith("scripts/acceptance/") ||
      filePath.startsWith("openspec/changes/desktop-console-t65-integration-closeout/"),
    );
  const files = [...new Set([...tracked, ...changed])].sort();
  const manifest = [];
  for (const filePath of files) {
    const absolutePath = path.join(projectRoot, filePath);
    const stat = await fs.stat(absolutePath).catch(() => null);
    if (!stat?.isFile()) {
      continue;
    }
    const bytes = await fs.readFile(absolutePath);
    manifest.push({
      path: filePath,
      mode: stat.mode & 0o777,
      bytes: bytes.byteLength,
      sha256: sha256(bytes),
    });
  }
  const body = JSON.stringify({ baseHead, files: manifest });
  return { digest: sha256(Buffer.from(body)), files: manifest };
}

async function run(command: string, args: string[]): Promise<string> {
  const { stdout } = await runProcess(command, args, 30_000);
  return stdout;
}

function absoluteArtifact(artifactPath: string): string {
  return artifactPath;
}

function sha256(bytes: Buffer): string {
  return crypto.createHash("sha256").update(bytes).digest("hex");
}

async function runProcess(
  command: string,
  args: string[],
  timeoutMs: number,
): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: projectRoot,
      detached: process.platform !== "win32",
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    let settled = false;
    let cleanupPromise: Promise<void> | undefined;

    const timer = setTimeout(() => {
      timedOut = true;
      cleanupPromise = terminateProcessTree(child.pid);
    }, timeoutMs);

    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk: string) => {
      stderr += chunk;
    });
    child.on("error", (error) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      reject(error);
    });
    child.on("exit", async (code, signal) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      if (timedOut) {
        await cleanupPromise;
        reject(new Error(`${command} timed out after ${timeoutMs}ms`));
        return;
      }
      if (code === 0) {
        resolve({ stdout, stderr });
        return;
      }
      reject(new Error(`${command} exited with code ${String(code)} signal ${String(signal)}\n${stderr}`));
    });
  });
}

async function terminateProcessTree(pid: number | undefined): Promise<void> {
  if (pid === undefined) {
    return;
  }
  if (process.platform === "win32") {
    await new Promise<void>((resolve) => {
      const killer = spawn("taskkill", ["/PID", String(pid), "/T", "/F"], { stdio: "ignore" });
      const timer = setTimeout(resolve, 5_000);
      killer.on("exit", () => {
        clearTimeout(timer);
        resolve();
      });
      killer.on("error", () => {
        clearTimeout(timer);
        resolve();
      });
    });
    return;
  }
  try {
    process.kill(-pid, "SIGTERM");
  } catch {
    return;
  }
  await delay(2_000);
  try {
    process.kill(-pid, "SIGKILL");
  } catch {
    // Already gone.
  }
}

async function verifyProcessTreeCleanup(): Promise<void> {
  const marker = path.join(artifactDir, `.t65-grandchild-${process.pid}.txt`);
  const grandchildCode = [
    "const fs = require('fs');",
    "const marker = process.argv[1];",
    "process.on('SIGTERM', () => {});",
    "setInterval(() => fs.writeFileSync(marker, String(Date.now())), 50);",
  ].join(" ");
  const parentCode = [
    "const { spawn } = require('child_process');",
    "const marker = process.argv[1];",
    "spawn(process.execPath, ['-e', process.argv[2], marker], { stdio: 'ignore' });",
    "setInterval(() => {}, 1000);",
  ].join(" ");
  try {
    await runProcess(process.execPath, ["-e", parentCode, marker, grandchildCode], 500);
    throw new Error("process-tree cleanup fixture exited unexpectedly");
  } catch (error) {
    if (!(error instanceof Error) || !error.message.includes("timed out")) {
      throw error;
    }
  }
  const before = await fs.stat(marker).catch(() => null);
  await delay(350);
  const after = await fs.stat(marker).catch(() => null);
  await fs.rm(marker, { force: true });
  if (before && after && after.mtimeMs !== before.mtimeMs) {
    throw new Error("process-tree cleanup left a writing grandchild alive");
  }
}

async function delay(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}
