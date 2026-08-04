import assert from "node:assert/strict";
import { mkdtemp, mkdir, realpath, writeFile, chmod } from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";

import { _electron as electron, type ElectronApplication, type Page } from "playwright";

import type { ManagedProcessSummary } from "../../src/local-console/managed-process-contract.js";
import { LaunchdManagedProcessAdapter } from "../../src/local-console/managed-process-launchd-adapter.js";
import { waitForValue } from "../../src/testing/wait.js";

interface ConsoleState {
  projects: Array<{ projectId: string; folderPath: string }>;
  messages: Array<{ speaker: string; status: string; error?: string | null; body: string }>;
  activeRuns: unknown[];
}

const projectRoot = path.resolve(".");
const desktopRoot = path.join(projectRoot, "desktop");
const workspace = await resolveMainWorktree();
const dataRoot = await mkdtemp(path.join(os.tmpdir(), "moebius-managed-kimi-hang-runtime-"));
const evidenceRoot = await mkdtemp(path.join(os.tmpdir(), "moebius-managed-kimi-hang-evidence-"));
const evidencePath = path.join(evidenceRoot, "evidence.json");
const binRoot = path.join(evidenceRoot, "bin");
const servicePort = await freePort();
await mkdir(binRoot, { recursive: true });
await writeFile(path.join(dataRoot, ".onboarding-completed"), `${new Date().toISOString()}\n`, "utf8");
await writeKimiHangFixture(path.join(binRoot, "kimi"), servicePort);

let application: ElectronApplication | null = null;
try {
  application = await electron.launch({
    args: [desktopRoot], cwd: desktopRoot,
    env: {
      ...process.env,
      PATH: `${binRoot}:${process.env.PATH ?? ""}`,
      MOEBIUS_DATA_ROOT: dataRoot,
      ELECTRON_DISABLE_SECURITY_WARNINGS: "true",
    },
  });
  const page = await application.firstWindow();
  await page.waitForLoadState("domcontentloaded");
  await page.getByRole("button", { name: "设置" }).waitFor({ timeout: 20_000 });
  const apiBase = await waitForApiBase(page);
  await configureKimi(page);
  const project = await ensureProject(apiBase, workspace);
  const session = await createSession(apiBase, project.projectId);
  await selectSession(page, session.sessionId);

  const input = page.getByRole("textbox", { name: "消息内容" });
  await input.fill("请只用 managed_process_start 启动一个服务；工具成功后等待，不要输出成功正文。");
  const startedAt = Date.now();
  await page.getByRole("button", { name: "发送消息" }).click();
  const item = await waitForValue(async () => {
    const [candidate] = await listManaged(apiBase, session.sessionId);
    return candidate?.state === "ready" ? candidate : undefined;
  }, { describe: "Kimi fixture MCP tool returned ready", kind: "io", timeoutMs: 30_000 });
  assert.equal(await fetch(`http://127.0.0.1:${servicePort}/`).then((response) => response.status), 200);

  const terminal = await waitForValue(async () => {
    const state = await requestJson<ConsoleState>(apiBase, `/api/local-console/state?sessionId=${encodeURIComponent(session.sessionId)}`);
    return state.activeRuns.length === 0 && state.messages.some((message) => message.status === "stuck" && message.error === "kimi-acp-timeout")
      ? state
      : undefined;
  }, { describe: "Kimi post-tool hang reaches bounded terminal", kind: "io", timeoutMs: 35_000 });
  const elapsedMs = Date.now() - startedAt;
  assert(elapsedMs < 35_000, `Kimi hang was not bounded: ${elapsedMs}`);
  assert(terminal.messages.every((message) => !(message.speaker === "agent" && message.status === "completed")));
  assert(terminal.messages.some((message) => message.status === "stuck" && message.error === "kimi-acp-timeout"));
  await page.getByRole("button", { name: "重试" }).waitFor({ timeout: 15_000 });
  assert.equal((await listManaged(apiBase, session.sessionId))[0]?.id, item.id);
  assert.equal(await fetch(`http://127.0.0.1:${servicePort}/`).then((response) => response.status), 200);

  const indicator = page.getByTestId("managed-process-indicator");
  await indicator.click();
  await page.getByRole("button", { name: "停止 · Kimi hanging service" }).click();
  await waitForPortClosed(servicePort);
  const exited = await waitForValue(async () => {
    const [candidate] = await listManaged(apiBase, session.sessionId);
    return candidate?.state === "exited" ? candidate : undefined;
  }, { describe: "Kimi hanging service stopped from panel", kind: "io", timeoutMs: 20_000 });

  await writeFile(evidencePath, `${JSON.stringify({
    ok: true,
    environment: "真实 Electron + 协议兼容 Kimi ACP hang fixture",
    dataRoot,
    sessionId: session.sessionId,
    processId: item.id,
    targetPid: item.targetPid,
    wrapperPid: item.wrapperPid,
    mcpStateBeforeTimeout: item.state,
    providerTerminalElapsedMs: elapsedMs,
    noCompletedAgentMessage: true,
    retryVisible: true,
    processSurvivedProviderTimeout: true,
    panelStopState: exited.state,
    portClosed: true,
    observation: {
      entry: "真实 Electron 主会话（Kimi profile）",
      action: "发送会触发 managed_process_start 后故意不结束 ACP prompt 的消息，等待有界失败，再从运行项面板停止",
      screenObservation: "MCP 返回后运行项 ready 且 HTTP 200；短收敛闸后页面退出忙态并显示 kimi-acp-timeout 可重试终局，无 completed Agent 正文；运行项继续存在，面板停止后端口关闭",
      consistent: true,
    },
  }, null, 2)}\n`, "utf8");
  process.stdout.write(`${JSON.stringify({ ok: true, evidencePath })}\n`);
  await application.close();
  application = null;
} finally {
  if (application !== null) {
    const child = application.process();
    await Promise.race([application.close().catch(() => undefined), new Promise((resolve) => setTimeout(resolve, 3_000))]);
    if (child.exitCode === null) child.kill("SIGKILL");
  }
  const cleanup = new LaunchdManagedProcessAdapter({ dataRoot, wrapperProgram: process.execPath, wrapperProgramArgs: [] });
  await cleanup.init().then(async () => await cleanup.reconcile()).catch(() => undefined);
}

async function writeKimiHangFixture(filePath: string, port: number): Promise<void> {
  const source = [
    `#!${process.execPath}`,
    'const { spawn } = require("node:child_process");',
    'const readline = require("node:readline");',
    `const port = ${port};`,
    'const configOptions = [',
    '  { id: "model", currentValue: "kimi-code/k3", options: [{ value: "kimi-code/k3" }] },',
    '  { id: "thinking", currentValue: "high", options: [{ value: "high" }] },',
    '  { id: "mode", currentValue: "auto", options: [{ value: "auto" }] },',
    '];',
    'let server = null;',
    'const input = readline.createInterface({ input: process.stdin });',
    'const reply = (id, result) => process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id, result }) + "\\n");',
    'function startManaged() {',
    '  const bridge = spawn(server.command, server.args, { env: { ...process.env }, stdio: ["pipe", "pipe", "inherit"], shell: false });',
    '  const lines = readline.createInterface({ input: bridge.stdout });',
    '  let stage = 0;',
    '  lines.on("line", (line) => {',
    '    const message = JSON.parse(line);',
    '    if (message.id === 1 && stage === 0) { stage = 1; bridge.stdin.write(JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized", params: {} }) + "\\n"); bridge.stdin.write(JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "managed_process_start", arguments: { kind: "service", label: "Kimi hanging service", executable: "python3", args: ["-m", "http.server", String(port), "--bind", "127.0.0.1"], cwd: ".", readiness: { type: "tcp", host: "127.0.0.1", port }, endpoint: { url: "http://127.0.0.1:" + port + "/" } } } }) + "\\n"); }',
    '  });',
    '  bridge.stdin.write(JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "kimi-hang-fixture", version: "1" } } }) + "\\n");',
    '}',
    'input.on("line", (line) => {',
    '  const request = JSON.parse(line);',
    '  if (request.method === "initialize") reply(request.id, { protocolVersion: 1 });',
    '  else if (request.method === "session/new") { server = request.params.mcpServers[0]; reply(request.id, { sessionId: "kimi-managed-hang", configOptions }); }',
    '  else if (request.method === "session/resume") { server = request.params.mcpServers[0]; reply(request.id, { sessionId: request.params.sessionId, configOptions }); }',
    '  else if (request.method === "session/prompt") startManaged();',
    '  else if (request.id !== undefined) reply(request.id, {});',
    '});',
    '',
  ].join("\n");
  await writeFile(filePath, source, "utf8");
  await chmod(filePath, 0o755);
}

async function configureKimi(page: Page): Promise<void> {
  await page.evaluate(async () => {
    const api = (window as typeof window & { moebius?: { saveAgentTeamExecutionProfile?: (request: unknown) => Promise<unknown> } }).moebius;
    if (api?.saveAgentTeamExecutionProfile === undefined) throw new Error("desktop profile IPC unavailable");
    await api.saveAgentTeamExecutionProfile({ teamId: "general-assistant", ownership: "system", memberSlug: "assistant", profile: { cli: "kimi", model: "kimi-code/k3", effort: "high" } });
  });
}

async function ensureProject(apiBase: string, folderPath: string): Promise<{ projectId: string; folderPath: string }> {
  const state = await requestJson<ConsoleState>(apiBase, "/api/local-console/state");
  return state.projects.find((candidate) => candidate.folderPath === folderPath)
    ?? (await requestJson<{ project: { projectId: string; folderPath: string } }>(apiBase, "/api/local-console/projects", { method: "POST", body: JSON.stringify({ folderPath }) }, 201)).project;
}

async function createSession(apiBase: string, projectId: string): Promise<{ sessionId: string }> {
  return (await requestJson<{ session: { sessionId: string } }>(apiBase, "/api/local-console/sessions", {
    method: "POST", body: JSON.stringify({ projectId, workspaceMode: "direct", agentTeamOwnership: "system", agentTeamId: "general-assistant", title: "Kimi managed hang" }),
  }, 201)).session;
}

async function selectSession(page: Page, sessionId: string): Promise<void> {
  const row = page.locator(`[data-testid='conversation-sidebar-session'][data-session-id='${sessionId}']`);
  await row.waitFor({ timeout: 15_000 });
  await row.click();
}

async function listManaged(apiBase: string, sessionId: string): Promise<ManagedProcessSummary[]> {
  return (await requestJson<{ processes: ManagedProcessSummary[] }>(apiBase, `/api/local-console/sessions/${encodeURIComponent(sessionId)}/managed-processes`)).processes;
}

async function waitForApiBase(page: Page): Promise<string> {
  return await waitForValue(async () => await page.evaluate(async () => (window as typeof window & { moebius?: { getLocalConsoleUrl?: () => Promise<string | null> } }).moebius?.getLocalConsoleUrl?.() ?? null) ?? undefined, {
    describe: "Electron local-console URL", kind: "io", timeoutMs: 20_000,
  });
}

async function requestJson<T>(apiBase: string, pathname: string, init: RequestInit = {}, expected = 200): Promise<T> {
  const response = await fetch(new URL(pathname, apiBase), { ...init, headers: { "content-type": "application/json", ...init.headers } });
  const text = await response.text();
  assert.equal(response.status, expected, text);
  return JSON.parse(text) as T;
}

async function waitForPortClosed(port: number): Promise<void> {
  await waitForValue(async () => await new Promise<true | undefined>((resolve) => {
    const socket = net.createConnection({ host: "127.0.0.1", port });
    socket.once("connect", () => { socket.destroy(); resolve(undefined); });
    socket.once("error", () => resolve(true));
  }), { describe: `Kimi hang port ${port} closed`, kind: "io", timeoutMs: 15_000 });
}

async function freePort(): Promise<number> {
  return await new Promise((resolve, reject) => {
    const server = net.createServer(); server.once("error", reject);
    server.listen(0, "127.0.0.1", () => { const address = server.address(); if (address === null || typeof address === "string") return reject(new Error("no port")); server.close((error) => error === undefined ? resolve(address.port) : reject(error)); });
  });
}

async function resolveMainWorktree(): Promise<string> {
  return await new Promise((resolve, reject) => {
    const git = spawn("/usr/bin/git", ["rev-parse", "--path-format=absolute", "--git-common-dir"], { cwd: projectRoot, shell: false, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = ""; git.stdout?.setEncoding("utf8"); git.stdout?.on("data", (chunk: string) => { stdout += chunk; });
    git.once("error", reject); git.once("exit", (code) => code === 0 ? void realpath(path.dirname(stdout.trim())).then(resolve, reject) : reject(new Error("git rev-parse failed")));
  });
}
