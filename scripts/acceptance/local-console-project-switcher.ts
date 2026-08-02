import fs from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import type { CodexRunOptions, CodexRunResult } from "../../src/codex.js";
import { startLocalConsoleServer } from "../../src/local-console/start.js";
import { createAcceptanceOutputDirectory } from "./temp-output.js";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const artifactDir = await createAcceptanceOutputDirectory("project-switcher");
const runtimeRoot = await fs.mkdtemp(path.join(os.tmpdir(), "moebius-project-switcher-"));
const alphaFolder = path.join(runtimeRoot, "project-alpha");
const betaFolder = path.join(runtimeRoot, "project-beta");
await fs.mkdir(path.join(runtimeRoot, "agents"), { recursive: true });
await fs.writeFile(path.join(runtimeRoot, "agents", "dev.md"), "# Dev\n\nReply concisely.", "utf8");
await fs.mkdir(alphaFolder, { recursive: true });
await fs.mkdir(betaFolder, { recursive: true });
await fs.mkdir(artifactDir, { recursive: true });

const started = await startLocalConsoleServer({
  projectRoot: runtimeRoot,
  port: 0,
  runCodex: fakeCodex,
  makeRunDir: (count) => path.join(runtimeRoot, "runs", `run-${String(count)}`),
  storeTimeoutMs: 2_000,
});
const staticServer = await startStaticServer(path.join(projectRoot, "desktop", "dist", "console-page"));
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1360, height: 860 }, deviceScaleFactor: 1 });
const pageErrors: string[] = [];
page.on("pageerror", (error) => pageErrors.push(error.message));

const artifacts = {
  projectRowCreate: path.join(artifactDir, "new-session-project-row.png"),
  projectDropdown: path.join(artifactDir, "new-session-project-dropdown.png"),
  lockedContext: path.join(artifactDir, "new-session-project-locked.png"),
  evidence: path.join(artifactDir, "new-session-project-switcher-evidence.json"),
};

try {
  const alpha = await createProject(alphaFolder);
  const beta = await createProject(betaFolder);
  const alphaSession = await createSession(alpha.projectId, "Alpha seed");
  const seededState = await getState(alpha.projectId, alphaSession.sessionId);

  const pageUrl = new URL("index.html", staticServer.url);
  pageUrl.searchParams.set("api", started.url);
  await page.goto(pageUrl.toString());
  const alphaSessionRow = page.locator(`[data-testid="conversation-sidebar-session"][data-session-id="${alphaSession.sessionId}"]`);
  try {
    await alphaSessionRow.click({ timeout: 5_000 });
  } catch (error) {
    throw new Error([
      `alpha session row unavailable: ${error instanceof Error ? error.message : String(error)}`,
      `page errors: ${pageErrors.join(" | ") || "none"}`,
      `visible text: ${(await page.locator("body").innerText()).slice(0, 2_000)}`,
      `seeded state: ${JSON.stringify(seededState)}`,
    ].join("\n"));
  }
  await page.getByRole("button", { name: "在 project-beta 中新建会话" }).click();
  await page.getByRole("button", { name: "项目：project-beta，点击切换" }).waitFor();
  await page.getByRole("button", { name: "新会话，静止" }).waitFor();
  await page.screenshot({ path: artifacts.projectRowCreate, fullPage: true });

  const composer = page.getByLabel("消息内容");
  await composer.fill("未发送草稿保持不变");
  const projectTrigger = page.getByRole("button", { name: "项目：project-beta，点击切换" });
  await projectTrigger.click();
  await page.getByRole("menuitemcheckbox", { name: "project-alpha" }).waitFor();
  await page.screenshot({ path: artifacts.projectDropdown, fullPage: true });
  await page.getByRole("menuitemcheckbox", { name: "project-alpha" }).click();
  await page.getByRole("button", { name: "项目：project-alpha，点击切换" }).waitFor();
  if ((await composer.inputValue()) !== "未发送草稿保持不变") {
    throw new Error("composer draft was lost during project rebind");
  }

  await composer.fill("@dev lock this session project");
  await page.getByRole("button", { name: "发送消息" }).click();
  await page.getByText("project context locked", { exact: true }).waitFor();
  await page.getByLabel("项目：project-alpha，已锁定").waitFor();
  await page.screenshot({ path: artifacts.lockedContext, fullPage: true });

  const state = await getState(alpha.projectId, alphaSession.sessionId);
  const movedSession = state.projects
    .flatMap((project: any) => project.sessions)
    .find((session: any) => session.title === "新会话");
  await fs.writeFile(
    artifacts.evidence,
    JSON.stringify({
      artifacts,
      projectIds: { alpha: alpha.projectId, beta: beta.projectId },
      movedSession,
      draftPreserved: true,
      lockedAfterMessage: true,
    }, null, 2),
    "utf8",
  );
  process.stdout.write(`${JSON.stringify({ ok: true, artifacts })}\n`);
} finally {
  await page.close();
  await browser.close();
  await staticServer.close();
  await started.close();
}

async function createProject(folderPath: string): Promise<{ projectId: string }> {
  const response = await fetch(new URL("/api/local-console/projects", started.url), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ folderPath, worktreeMode: false }),
  });
  if (!response.ok) {
    throw new Error(`create project failed: ${response.status} ${await response.text()}`);
  }
  return ((await response.json()) as { project: { projectId: string } }).project;
}

async function createSession(projectId: string, title: string): Promise<{ sessionId: string }> {
  const response = await fetch(new URL("/api/local-console/sessions", started.url), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ projectId, title }),
  });
  if (!response.ok) {
    throw new Error(`create session failed: ${response.status} ${await response.text()}`);
  }
  return ((await response.json()) as { session: { sessionId: string } }).session;
}

async function getState(projectId: string, sessionId: string): Promise<any> {
  const url = new URL("/api/local-console/state", started.url);
  url.searchParams.set("projectId", projectId);
  url.searchParams.set("sessionId", sessionId);
  const response = await fetch(url);
  return await response.json();
}

async function fakeCodex(options: CodexRunOptions): Promise<CodexRunResult> {
  await fs.mkdir(options.runDir, { recursive: true });
  await fs.writeFile(path.join(options.runDir, "stdout.jsonl"), "", "utf8");
  await fs.writeFile(path.join(options.runDir, "stderr.log"), "", "utf8");
  return {
    ok: true,
    finalText: [
      "## 结论",
      "project context locked",
      "",
      "## 依据",
      "message persisted",
      "",
      "## 下一步",
      "等待真人：查看锁定态",
      "",
      "<!-- moebius:stage=in-progress -->",
    ].join("\n"),
    threadId: null,
    cachedInputTokens: null,
    runDir: options.runDir,
    stdoutPath: path.join(options.runDir, "stdout.jsonl"),
    stderrPath: path.join(options.runDir, "stderr.log"),
  };
}

async function startStaticServer(root: string): Promise<{ url: string; close(): Promise<void> }> {
  const server = http.createServer((request, response) => {
    void (async () => {
      const requestUrl = new URL(request.url ?? "/", "http://127.0.0.1");
      const relativePath = requestUrl.pathname === "/" ? "index.html" : decodeURIComponent(requestUrl.pathname.slice(1));
      const filePath = path.resolve(root, relativePath);
      if (!filePath.startsWith(path.resolve(root) + path.sep)) {
        response.writeHead(403).end("Forbidden");
        return;
      }
      try {
        const body = await fs.readFile(filePath);
        response.writeHead(200, { "content-type": contentType(filePath) });
        response.end(body);
      } catch {
        response.writeHead(404).end("Not found");
      }
    })();
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve());
  });
  const address = server.address();
  if (address === null || typeof address === "string") {
    throw new Error("static server did not expose a port");
  }
  return {
    url: `http://127.0.0.1:${String(address.port)}/`,
    close: async () => await new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

function contentType(filePath: string): string {
  if (filePath.endsWith(".html")) return "text/html; charset=utf-8";
  if (filePath.endsWith(".js")) return "text/javascript; charset=utf-8";
  if (filePath.endsWith(".css")) return "text/css; charset=utf-8";
  return "application/octet-stream";
}
