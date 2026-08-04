import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { mkdtemp, readFile, realpath, writeFile } from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";

import type { ManagedProcessSummary } from "../../src/local-console/managed-process-contract.js";
import { LaunchdManagedProcessAdapter } from "../../src/local-console/managed-process-launchd-adapter.js";
import { waitForValue } from "../../src/testing/wait.js";

interface ConsoleState {
  projects: Array<{ projectId: string; folderPath: string }>;
  activeRuns: unknown[];
  messages: Array<{ speaker: string; status: string }>;
  pendingPrimaryMessages: unknown[];
}

const projectRoot = path.resolve(".");
const workspace = await resolveMainWorktree();
const dataRoot = await mkdtemp(path.join(os.tmpdir(), "moebius-managed-cli-runtime-"));
const evidenceRoot = await mkdtemp(path.join(os.tmpdir(), "moebius-managed-cli-evidence-"));
const evidencePath = path.join(evidenceRoot, "evidence.json");
const markerPath = path.join(evidenceRoot, "target-start-count.txt");
const servicePort = await freePort();
const consolePort = await freePort();
const output: string[] = [];
let child: ChildProcess | null = null;

try {
  child = spawn("pnpm", ["start"], {
    cwd: projectRoot,
    env: {
      ...process.env,
      MOEBIUS_DATA_ROOT: dataRoot,
      LOCAL_CONSOLE_PORT: String(consolePort),
    },
    shell: false,
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout?.setEncoding("utf8");
  child.stderr?.setEncoding("utf8");
  child.stdout?.on("data", (chunk: string) => output.push(chunk));
  child.stderr?.on("data", (chunk: string) => output.push(chunk));
  const apiBase = await waitForValue(async () => {
    const text = output.join("");
    return text.includes("local-console-started") ? `http://127.0.0.1:${consolePort}` : undefined;
  }, { describe: "pnpm start local console ready", kind: "io", timeoutMs: 30_000 });

  const state = await requestJson<ConsoleState>(apiBase, "/api/local-console/state");
  const project = state.projects.find((candidate) => candidate.folderPath === workspace)
    ?? await createProject(apiBase, workspace);
  const session = await createSession(apiBase, project.projectId);
  const code = `from pathlib import Path; import http.server; p=Path(${JSON.stringify(markerPath)}); p.write_text(str((int(p.read_text()) if p.exists() else 0)+1)); http.server.test(HandlerClass=http.server.SimpleHTTPRequestHandler,port=${servicePort},bind="127.0.0.1")`;
  await send(apiBase, session.sessionId, `只使用 managed_process_start 启动 service，不使用终端：label="CLI managed server"，executable=python3，args=${JSON.stringify(["-c", code])}，cwd="."，readiness={"type":"tcp","host":"127.0.0.1","port":${servicePort}}，endpoint={"url":"http://127.0.0.1:${servicePort}/"}。回复 id。`);
  const [started] = await waitForValue(async () => {
    const items = await listManaged(apiBase, session.sessionId);
    return items.length === 1 && items[0]?.state === "ready" ? items : undefined;
  }, { describe: "CLI managed service ready", kind: "io", timeoutMs: 90_000 });
  assert(started !== undefined);
  assert.equal(await fetch(`http://127.0.0.1:${servicePort}/`).then((response) => response.status), 200);
  await waitForAgentSettled(apiBase, session.sessionId);
  await send(apiBase, session.sessionId, "只使用 managed_process_list 和 managed_process_inspect 查询现有运行项，不使用终端，不启动或停止。回复 id 和状态。");
  await waitForAgentSettled(apiBase, session.sessionId);
  const [resumed] = await listManaged(apiBase, session.sessionId);
  assert.equal(resumed?.id, started.id);

  child.kill("SIGTERM");
  const exit = await waitForChildExit(child, 30_000);
  child = null;
  assert(exit.signal === "SIGTERM" || exit.code === 0, `local entry exited unexpectedly: ${JSON.stringify(exit)}`);
  await waitForPortClosed(servicePort);
  assert.equal(await readFile(markerPath, "utf8"), "1");
  const adapter = new LaunchdManagedProcessAdapter({ dataRoot, wrapperProgram: process.execPath, wrapperProgramArgs: [] });
  await adapter.init();
  await adapter.reconcile();

  await writeFile(evidencePath, `${JSON.stringify({
    ok: true,
    environment: "真实 macOS pnpm start",
    dataRoot,
    workspace,
    sessionId: session.sessionId,
    processId: started.id,
    targetPid: started.targetPid,
    wrapperPid: started.wrapperPid,
    sameProcessAfterResume: resumed?.id === started.id,
    httpStatus: 200,
    localEntryExit: exit,
    targetStartCount: 1,
    portClosed: true,
    observation: {
      entry: "pnpm start 提供的 loopback local console",
      action: "通过现有 HTTP 会话入口让真实 Codex 启动服务、下一回合查询，再向 local entry 发送 SIGTERM",
      screenObservation: "同一 processId 跨回合 ready 且 HTTP 200；entry 退出后 launchd job 与端口消失，命令只执行一次",
      consistent: true,
    },
  }, null, 2)}\n`, "utf8");
  process.stdout.write(`${JSON.stringify({ ok: true, evidencePath })}\n`);
} finally {
  if (child !== null && child.exitCode === null && child.signalCode === null) {
    child.kill("SIGTERM");
    await waitForChildExit(child, 5_000).catch(() => child?.kill("SIGKILL"));
  }
  const cleanup = new LaunchdManagedProcessAdapter({ dataRoot, wrapperProgram: process.execPath, wrapperProgramArgs: [] });
  await cleanup.init().then(async () => await cleanup.reconcile()).catch(() => undefined);
}

async function createProject(apiBase: string, folderPath: string): Promise<{ projectId: string; folderPath: string }> {
  return (await requestJson<{ project: { projectId: string; folderPath: string } }>(apiBase, "/api/local-console/projects", {
    method: "POST", body: JSON.stringify({ folderPath }),
  }, 201)).project;
}

async function createSession(apiBase: string, projectId: string): Promise<{ sessionId: string }> {
  return (await requestJson<{ session: { sessionId: string } }>(apiBase, "/api/local-console/sessions", {
    method: "POST", body: JSON.stringify({ projectId, workspaceMode: "direct", title: "CLI managed acceptance" }),
  }, 201)).session;
}

async function send(apiBase: string, sessionId: string, body: string): Promise<void> {
  await requestJson(apiBase, `/api/local-console/sessions/${encodeURIComponent(sessionId)}/messages`, {
    method: "POST", body: JSON.stringify({ body }),
  }, 202);
}

async function waitForAgentSettled(apiBase: string, sessionId: string): Promise<void> {
  await waitForValue(async () => {
    const state = await requestJson<ConsoleState>(apiBase, `/api/local-console/state?sessionId=${encodeURIComponent(sessionId)}`);
    const lastUser = state.messages.findLastIndex((message) => message.speaker === "user");
    const terminal = state.messages.slice(lastUser + 1).some((message) =>
      message.speaker === "agent" && ["completed", "failed", "interrupted", "stuck", "displayed"].includes(message.status));
    return lastUser >= 0 && terminal && state.activeRuns.length === 0 && state.pendingPrimaryMessages.length === 0 ? true : undefined;
  }, {
    describe: "local CLI provider turn settled", kind: "io", timeoutMs: 120_000,
  });
}

async function listManaged(apiBase: string, sessionId: string): Promise<ManagedProcessSummary[]> {
  return (await requestJson<{ processes: ManagedProcessSummary[] }>(apiBase, `/api/local-console/sessions/${encodeURIComponent(sessionId)}/managed-processes`)).processes;
}

async function requestJson<T = unknown>(apiBase: string, pathname: string, init?: RequestInit, expected = 200): Promise<T> {
  const response = await fetch(new URL(pathname, apiBase), { ...init, headers: { "content-type": "application/json", ...init?.headers } });
  const body = await response.json() as T & { error?: string };
  assert.equal(response.status, expected, body.error ?? `${pathname} returned ${response.status}`);
  return body;
}

async function waitForChildExit(process: ChildProcess, timeoutMs: number): Promise<{ code: number | null; signal: NodeJS.Signals | null }> {
  if (process.exitCode !== null || process.signalCode !== null) return { code: process.exitCode, signal: process.signalCode };
  return await new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("local CLI did not exit")), timeoutMs);
    process.once("exit", (code, signal) => {
      clearTimeout(timer);
      resolve({ code, signal });
    });
  });
}

async function waitForPortClosed(port: number): Promise<void> {
  await waitForValue(async () => await new Promise<true | undefined>((resolve) => {
    const socket = net.createConnection({ host: "127.0.0.1", port });
    socket.once("connect", () => { socket.destroy(); resolve(undefined); });
    socket.once("error", () => resolve(true));
  }), { describe: `managed CLI port ${port} closed`, kind: "io", timeoutMs: 15_000 });
}

async function freePort(): Promise<number> {
  return await new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (address === null || typeof address === "string") return reject(new Error("no port"));
      server.close((error) => error === undefined ? resolve(address.port) : reject(error));
    });
  });
}

async function resolveMainWorktree(): Promise<string> {
  const common = await new Promise<string>((resolve, reject) => {
    const git = spawn("git", ["rev-parse", "--git-common-dir"], { cwd: projectRoot, shell: false, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    git.stdout?.setEncoding("utf8");
    git.stdout?.on("data", (chunk: string) => { stdout += chunk; });
    git.once("error", reject);
    git.once("exit", (code) => code === 0 ? resolve(stdout.trim()) : reject(new Error("git rev-parse failed")));
  });
  return await realpath(path.dirname(path.resolve(projectRoot, common)));
}
