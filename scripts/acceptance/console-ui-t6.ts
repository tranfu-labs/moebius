import fs from "node:fs/promises";
import { execFile } from "node:child_process";
import http from "node:http";
import path from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { chromium, type Page } from "playwright";
import { createAcceptanceOutputDirectory } from "./temp-output.js";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const artifactDir = await createAcceptanceOutputDirectory("console-ui-t6");
const desktopDist = path.join(projectRoot, "desktop", "dist", "console-page");
const storybookStatic = path.join(artifactDir, "t6-storybook-static");
const execFileAsync = promisify(execFile);

const artifacts = {
  desktop: path.join(artifactDir, "t6-desktop-renderer.png"),
  gallery: path.join(artifactDir, "t6-component-gallery.png"),
  storybookCard: path.join(artifactDir, "t6-storybook-card.png"),
  storybookBadge: path.join(artifactDir, "t6-storybook-badge.png"),
  storybookOperatorConsole: path.join(artifactDir, "t6-storybook-operator-console.png"),
  storybookAcceptCard: path.join(artifactDir, "t6-storybook-accept-card.png"),
  evidence: path.join(artifactDir, "t6-evidence.json"),
};

await fs.mkdir(artifactDir, { recursive: true });
await buildStorybook();

const server = await startServer();
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1360, height: 900 }, deviceScaleFactor: 1 });
const galleryPage = await browser.newPage({ viewport: { width: 1360, height: 900 }, deviceScaleFactor: 1 });
const storybookPage = await browser.newPage({ viewport: { width: 1120, height: 820 }, deviceScaleFactor: 1 });

try {
  const desktopUrl = new URL("/desktop/index.html", server.url);
  desktopUrl.searchParams.set("api", `${server.url}/`);
  await page.goto(desktopUrl.toString());
  await page.getByText("运行直播").waitFor();
  await page.getByText("live tail from codex").waitFor();
  await page.getByText("普通时间线消息").waitFor();
  await page.screenshot({ path: artifacts.desktop, fullPage: true });

  await galleryPage.goto(new URL("/gallery", server.url).toString());
  await galleryPage.getByText("Card / Badge / OperatorConsole / AcceptCard").waitFor();
  await galleryPage.screenshot({ path: artifacts.gallery, fullPage: true });

  await screenshotStory(storybookPage, server.url, "component-ui-card--console-panel", "运行记录", artifacts.storybookCard);
  await screenshotStory(storybookPage, server.url, "component-ui-badge--console-states", "运行中", artifacts.storybookBadge);
  await screenshotStory(
    storybookPage,
    server.url,
    "page-console-operatorconsole--t-65-running",
    "运行直播",
    artifacts.storybookOperatorConsole,
  );
  await screenshotStory(
    storybookPage,
    server.url,
    "component-console-acceptcard--mixed-decisions",
    "轮到你了",
    artifacts.storybookAcceptCard,
  );

  const evidence = {
    artifacts,
    desktopRenderer: {
      source: "desktop/dist/console-page/index.html with fake /api/local-console/state",
      covers: [
        "active RunLiveBlock",
        "ordinary TimelineMessage",
        "running status Badge",
        "failed status Badge",
        "stuck status Badge",
        "interrupted status Badge",
        "pending status Badge",
        "completed status Badge",
        "displayed status Badge",
      ],
    },
    componentGallery: {
      source: "static page using desktop console CSS token output",
      covers: [
        "flat Card baseline",
        "status Badge semantics including waiting",
        "OperatorConsole-like flat timeline card",
        "AcceptCard-like acceptance surface",
      ],
    },
    storybook: {
      source: "static Storybook build screenshots",
      covers: ["UI/Card", "UI/Badge", "Console/OperatorConsole", "Console/AcceptCard"],
    },
  };
  await fs.writeFile(artifacts.evidence, JSON.stringify(evidence, null, 2), "utf8");
  process.stdout.write(`${JSON.stringify({ ok: true, artifacts })}\n`);
} finally {
  await browser.close();
  await server.close();
  await fs.rm(storybookStatic, { recursive: true, force: true });
}

async function buildStorybook(): Promise<void> {
  await fs.rm(storybookStatic, { recursive: true, force: true });
  await execFileAsync(
    "pnpm",
    ["--filter", "@moebius/console-ui", "exec", "storybook", "build", "--output-dir", storybookStatic],
    { cwd: projectRoot, maxBuffer: 10 * 1024 * 1024 },
  );
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
  await page.goto(storyUrl.toString());
  await page.getByText(waitForText).first().waitFor();
  await page.screenshot({ path: artifactPath, fullPage: true });
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
        writeJson(response, buildState());
        return;
      }
      if (requestUrl.pathname === "/gallery") {
        response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
        response.end(galleryHtml());
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
    throw new Error("Failed to start T6 evidence server");
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
  if (filePath.endsWith(".map")) return "application/json; charset=utf-8";
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

function buildState() {
  const sessions = [
    session("session-main", "T6 扁平锚验收", "running", 1, 0, 0, 0),
    session("session-waiting", "等待验收", "waiting", 0, 1, 0, 0),
    session("session-failed", "失败构造", "failed", 0, 0, 0, 1),
    session("session-stuck", "卡住构造", "stuck", 0, 0, 1, 0),
  ];
  const project = {
    projectId: "local",
    sourceType: "local-folder",
    title: "moebius",
    folderPath: projectRoot,
    worktreeMode: true,
    workspaceCwd: "/tmp/moebius-local-worktree",
    workspaceMode: "worktree",
    worktreePath: "/tmp/moebius-local-worktree",
    worktreeUnavailableReason: null,
    workspaceUpdatedAt: "2026-07-10T15:00:00.000Z",
    sessions,
    runningCount: 1,
    waitingCount: 1,
    stuckCount: 1,
    errorCount: 1,
  };
  return {
    projects: [project],
    project,
    selectedProjectId: "local",
    selectedSessionId: "session-main",
    selectedSession: sessions[0],
    messages: [
      message(1, "user", null, "displayed", "普通时间线消息：请把 console-ui 扁平锚归位。"),
      message(2, "agent", "dev", "pending", "排队中的 agent 消息。"),
      message(3, "agent", "dev", "completed", "已完成组件回收。"),
      message(4, "agent", "dev", "displayed", "已显示的普通回复。"),
      message(5, "system", null, "failed", "Codex failed: exit:42", "exit:42"),
      message(6, "system", null, "stuck", "Codex stuck: idle-timeout:10ms", "idle-timeout:10ms"),
      message(7, "user", null, "interrupted", "用户已中断本轮运行。", "interrupted:user-interrupted"),
    ],
    activeRun: {
      sessionId: "session-main",
      runId: "run-t6",
      role: "dev",
      status: "running",
      startedAt: "2026-07-10T15:00:00.000Z",
      elapsedMs: 43_000,
      runDir: "/tmp/moebius-t6-run",
      cwd: "/tmp/moebius-local-worktree",
      workspaceMode: "worktree",
      worktreeUnavailableReason: null,
      stdoutTail: "live tail from codex",
      stderrTail: null,
      lastOutputSummary: "live tail from codex",
      tailDiagnostic: null,
      interruptible: true,
    },
    sqlitePath: "/tmp/moebius-t6.sqlite",
    lastError: null,
  };
}

function session(
  sessionId: string,
  title: string,
  status: "idle" | "running" | "waiting" | "stuck" | "failed" | "interrupted",
  runningCount: number,
  waitingCount: number,
  stuckCount: number,
  errorCount: number,
) {
  return {
    sessionId,
    projectId: "local",
    parentSessionId: null,
    title,
    status,
    runningCount,
    waitingCount,
    stuckCount,
    errorCount,
    interruptedCount: 0,
    createdAt: "2026-07-10T15:00:00.000Z",
    updatedAt: "2026-07-10T15:01:00.000Z",
  };
}

function message(
  id: number,
  speaker: "user" | "agent" | "system",
  role: string | null,
  status: "pending" | "running" | "completed" | "failed" | "interrupted" | "stuck" | "displayed",
  body: string,
  error: string | null = null,
) {
  return {
    id,
    sessionId: "session-main",
    speaker,
    role,
    body,
    status,
    runId: `run-${id}`,
    runDir: `/tmp/moebius-t6-run-${id}`,
    error,
    createdAt: "2026-07-10T15:00:00.000Z",
    updatedAt: "2026-07-10T15:01:00.000Z",
  };
}

function galleryHtml(): string {
  return `<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>T6 component gallery</title>
    <link rel="stylesheet" href="/desktop/app.css" />
    <link rel="stylesheet" href="/desktop/console.css" />
    <style>
      body { margin: 0; background: var(--canvas); color: var(--ink); font-family: Inter, ui-sans-serif, system-ui, sans-serif; }
      .page { padding: 28px; display: grid; gap: 18px; }
      .card { border: 1px solid var(--line); background: var(--card); padding: 16px; border-radius: 0; }
      .row { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
      .badge { display: inline-flex; height: 24px; align-items: center; border-radius: 2px; border: 1px solid var(--line); padding: 0 8px; font-size: 12px; font-weight: 500; }
      .running { border-color: var(--accent); color: var(--accent); }
      .waiting, .pending { border-color: var(--line-strong); background: var(--sel); color: var(--ink); }
      .failed, .stuck { border-color: var(--danger); color: var(--danger); }
      .interrupted, .idle, .completed, .displayed { color: var(--sub); }
      .split { display: grid; grid-template-columns: 1fr 1fr; gap: 18px; }
      .title { margin: 0 0 10px; font-size: 14px; font-weight: 650; }
      .copy { margin: 0; font-size: 13px; line-height: 1.55; color: var(--sub); }
      .accept-row { display: grid; grid-template-columns: 24px minmax(0, 1fr) auto; gap: 10px; align-items: center; padding: 8px 0; }
      .segment { display: inline-flex; gap: 2px; background: var(--hover); padding: 2px; border-radius: 2px; }
      .segment span { padding: 6px 10px; font-size: 12px; }
      .segment .selected { background: var(--sel); color: var(--pass); font-weight: 650; }
      pre { margin: 10px 0 0; padding: 10px; background: var(--sunken); white-space: pre-wrap; font-size: 12px; line-height: 1.45; }
    </style>
  </head>
  <body>
    <main class="page">
      <h1 class="title">Card / Badge / OperatorConsole / AcceptCard</h1>
      <section class="card">
        <p class="title">Flat Card + status Badge baseline</p>
        <div class="row">
          <span class="badge running">running</span>
          <span class="badge waiting">waiting</span>
          <span class="badge pending">pending</span>
          <span class="badge failed">failed</span>
          <span class="badge stuck">stuck</span>
          <span class="badge interrupted">interrupted</span>
          <span class="badge completed">completed</span>
          <span class="badge displayed">displayed</span>
          <span class="badge idle">idle</span>
        </div>
      </section>
      <section class="split">
        <div class="card">
          <p class="title">OperatorConsole timeline card</p>
          <div class="row"><strong>dev</strong><span class="badge completed">已完成</span><span class="copy">15:01:00</span></div>
          <p class="copy">时间线消息和 RunLiveBlock 都使用同一方角、细边、紧凑基线。</p>
          <pre>live tail from codex</pre>
        </div>
        <div class="card">
          <p class="title">AcceptCard surface</p>
          <p class="copy"><strong>改了什么</strong> · Card 默认扁平化，Badge 变为 status 语义。</p>
          <div class="accept-row"><strong>1</strong><span>回归 AcceptCard 规范样例视觉与交互</span><span class="segment"><span class="selected">通过</span><span>不通过</span></span></div>
          <div class="accept-row"><strong>2</strong><span>状态徽章不复用验收 pass/fail 语义</span><span class="segment"><span class="selected">通过</span><span>不通过</span></span></div>
        </div>
      </section>
    </main>
  </body>
</html>`;
}
