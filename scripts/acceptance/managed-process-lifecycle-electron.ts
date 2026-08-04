import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, mkdir, readFile, realpath, writeFile } from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";

import { _electron as electron, type ElectronApplication, type Page } from "playwright";

import type { ManagedProcessSummary } from "../../src/local-console/managed-process-contract.js";
import { LaunchdManagedProcessAdapter } from "../../src/local-console/managed-process-launchd-adapter.js";
import { waitForValue } from "../../src/testing/wait.js";

interface ConsoleState {
  projects: Array<{ projectId: string; folderPath: string }>;
  messages: Array<{ speaker: string; status: string }>;
  pendingPrimaryMessages: unknown[];
  activeRuns: unknown[];
}

const projectRoot = path.resolve(".");
const desktopRoot = path.join(projectRoot, "desktop");
const workspace = await resolveMainWorktree();
const dataRoot = await mkdtemp(path.join(os.tmpdir(), "moebius-managed-lifecycle-runtime-"));
const evidenceRoot = await mkdtemp(path.join(os.tmpdir(), "moebius-managed-lifecycle-evidence-"));
const evidencePath = path.join(evidenceRoot, "evidence.json");
await mkdir(dataRoot, { recursive: true });
await writeFile(path.join(dataRoot, ".onboarding-completed"), `${new Date().toISOString()}\n`, "utf8");

const evidence: Record<string, unknown> = { environment: "真实 macOS Electron", dataRoot, workspace, observations: [] };
let application: ElectronApplication | null = null;
try {
  ({ application } = await launchApplication(dataRoot));
  let page = await application.firstWindow();
  let apiBase = await waitForApiBase(page);
  await configureCodex(page);
  let project = await ensureProject(apiBase, workspace);

  const quitPort = await freePort();
  const quitMarker = path.join(evidenceRoot, "quit-start-count.txt");
  const quitSession = await createSession(apiBase, project.projectId, "正常退出验收");
  const quitItem = await startService(apiBase, quitSession.sessionId, "Quit protected server", quitPort, quitMarker);
  await page.bringToFront();
  await pressCommandQ(application.process().pid);
  await clickNativeDialogButton(application.process().pid, "继续工作");
  assert.equal(await fetch(`http://127.0.0.1:${quitPort}/`).then((response) => response.status), 200);
  assert.equal(application.process().exitCode, null);
  await pressCommandQ(application.process().pid);
  await clickNativeDialogButton(application.process().pid, "停止任务并退出");
  const normalExit = await waitForApplicationExit(application, 30_000);
  application = null;
  await waitForPortClosed(quitPort);
  assert.equal(await readFile(quitMarker, "utf8"), "1");

  ({ application } = await launchApplication(dataRoot));
  page = await application.firstWindow();
  apiBase = await waitForApiBase(page);
  assert.equal((await listManaged(apiBase, quitSession.sessionId)).length, 0);
  assert.equal(await readFile(quitMarker, "utf8"), "1");
  pushObservation("A8 正常退出保护", "有托管服务时按 Command+Q，先选择继续工作，再次 Command+Q 后选择停止任务并退出并重启", `首次取消后应用与 HTTP 仍存活；确认后应用退出（${JSON.stringify(normalExit)}）且端口关闭；重启无旧条目，目标命令执行次数仍为 1`, true);

  await configureCodex(page);
  project = await ensureProject(apiBase, workspace);
  const crashPort = await freePort();
  const crashMarker = path.join(evidenceRoot, "crash-start-count.txt");
  const crashSession = await createSession(apiBase, project.projectId, "崩溃恢复验收");
  const crashItem = await startService(apiBase, crashSession.sessionId, "Crash retained server", crashPort, crashMarker);
  application.process().kill("SIGKILL");
  await waitForApplicationExit(application, 10_000);
  application = null;
  assert.equal(await fetch(`http://127.0.0.1:${crashPort}/`).then((response) => response.status), 200);

  ({ application } = await launchApplication(dataRoot));
  page = await application.firstWindow();
  apiBase = await waitForApiBase(page);
  await waitForPortClosed(crashPort);
  assert.equal((await listManaged(apiBase, crashSession.sessionId)).length, 0);
  assert.equal(await readFile(crashMarker, "utf8"), "1");

  await configureCodex(page);
  project = await ensureProject(apiBase, workspace);
  const wrapperPort = await freePort();
  const wrapperMarker = path.join(evidenceRoot, "wrapper-start-count.txt");
  const wrapperSession = await createSession(apiBase, project.projectId, "wrapper 消失验收");
  const wrapperItem = await startService(apiBase, wrapperSession.sessionId, "Wrapper loss server", wrapperPort, wrapperMarker);
  assert(wrapperItem.wrapperPid !== null && wrapperItem.targetPid !== null);
  process.kill(wrapperItem.wrapperPid, "SIGKILL");
  await waitForPortClosed(wrapperPort);
  await waitForPidGone(wrapperItem.targetPid);
  application.process().kill("SIGKILL");
  await waitForApplicationExit(application, 10_000);
  application = null;

  ({ application } = await launchApplication(dataRoot));
  page = await application.firstWindow();
  apiBase = await waitForApiBase(page);
  assert.equal((await listManaged(apiBase, wrapperSession.sessionId)).length, 0);
  assert.equal(await readFile(wrapperMarker, "utf8"), "1");
  pushObservation("A9 崩溃与 wrapper 消失恢复", "强制终止隔离 Electron 后重启；另一次先 SIGKILL ownership wrapper，再强制终止应用并重启", `host 崩溃后服务暂存活但重启 reconciliation 精确清除 processId=${crashItem.id}；wrapper=${wrapperItem.wrapperPid} 消失后 launchd 回收 target=${wrapperItem.targetPid}，重启只清 manifest；两个命令均未重跑`, true);

  evidence.normalQuit = { processId: quitItem.id, targetPid: quitItem.targetPid, wrapperPid: quitItem.wrapperPid, startCount: 1, portClosed: true, restartRegistryCount: 0 };
  evidence.hostCrash = { processId: crashItem.id, targetPid: crashItem.targetPid, wrapperPid: crashItem.wrapperPid, aliveBeforeRestart: true, startCount: 1, portClosedAfterRestart: true, restartRegistryCount: 0 };
  evidence.wrapperLoss = { processId: wrapperItem.id, targetPid: wrapperItem.targetPid, wrapperPid: wrapperItem.wrapperPid, targetGone: true, startCount: 1, restartRegistryCount: 0 };
  await application.close();
  application = null;
  await writeFile(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`, "utf8");
  process.stdout.write(`${JSON.stringify({ ok: true, evidencePath })}\n`);
} finally {
  if (application !== null) {
    const child = application.process();
    await Promise.race([application.close().catch(() => undefined), new Promise((resolve) => setTimeout(resolve, 3_000))]);
    if (child.exitCode === null) child.kill("SIGKILL");
  }
  const cleanup = new LaunchdManagedProcessAdapter({ dataRoot, wrapperProgram: process.execPath, wrapperProgramArgs: [] });
  await cleanup.init().then(async () => await cleanup.reconcile()).catch(() => undefined);
}

function pushObservation(entry: string, action: string, screenObservation: string, consistent: boolean): void {
  (evidence.observations as unknown[]).push({ environment: "真机", entry, action, screenObservation, consistent });
}

async function launchApplication(runtimeRoot: string): Promise<{ application: ElectronApplication }> {
  const application = await electron.launch({
    args: [desktopRoot], cwd: desktopRoot,
    env: { ...process.env, MOEBIUS_DATA_ROOT: runtimeRoot, ELECTRON_DISABLE_SECURITY_WARNINGS: "true" },
  });
  const page = await application.firstWindow();
  await page.waitForLoadState("domcontentloaded");
  await page.getByRole("button", { name: "设置" }).waitFor({ timeout: 20_000 });
  return { application };
}

async function configureCodex(page: Page): Promise<void> {
  await page.evaluate(async () => {
    const api = (window as typeof window & { moebius?: { saveAgentTeamExecutionProfile?: (request: unknown) => Promise<unknown> } }).moebius;
    if (api?.saveAgentTeamExecutionProfile === undefined) throw new Error("desktop profile IPC unavailable");
    await api.saveAgentTeamExecutionProfile({
      teamId: "general-assistant", ownership: "system", memberSlug: "assistant",
      profile: { cli: "codex", model: "gpt-5.6-sol", effort: "high" },
    });
  });
}

async function ensureProject(apiBase: string, folderPath: string): Promise<{ projectId: string; folderPath: string }> {
  const state = await requestJson<ConsoleState>(apiBase, "/api/local-console/state");
  const existing = state.projects.find((candidate) => candidate.folderPath === folderPath);
  if (existing !== undefined) return existing;
  return (await requestJson<{ project: { projectId: string; folderPath: string } }>(apiBase, "/api/local-console/projects", {
    method: "POST", body: JSON.stringify({ folderPath }),
  }, 201)).project;
}

async function createSession(apiBase: string, projectId: string, title: string): Promise<{ sessionId: string }> {
  return (await requestJson<{ session: { sessionId: string } }>(apiBase, "/api/local-console/sessions", {
    method: "POST",
    body: JSON.stringify({ projectId, workspaceMode: "direct", agentTeamOwnership: "system", agentTeamId: "general-assistant", title }),
  }, 201)).session;
}

async function startService(apiBase: string, sessionId: string, label: string, port: number, markerPath: string): Promise<ManagedProcessSummary> {
  const code = `from pathlib import Path; import http.server; p=Path(${JSON.stringify(markerPath)}); p.write_text(str((int(p.read_text()) if p.exists() else 0)+1)); http.server.test(HandlerClass=http.server.SimpleHTTPRequestHandler,port=${port},bind="127.0.0.1")`;
  await requestJson(apiBase, `/api/local-console/sessions/${encodeURIComponent(sessionId)}/messages`, {
    method: "POST",
    body: JSON.stringify({ body: `只使用 managed_process_start 启动 service，不使用终端：label=${JSON.stringify(label)}，executable=python3，args=${JSON.stringify(["-c", code])}，cwd="."，readiness={"type":"tcp","host":"127.0.0.1","port":${port}}，endpoint={"url":"http://127.0.0.1:${port}/"}。回复 id。` }),
  }, 202);
  const item = await waitForValue(async () => {
    const [candidate] = await listManaged(apiBase, sessionId);
    return candidate?.state === "ready" ? candidate : undefined;
  }, { describe: `${label} ready`, kind: "io", timeoutMs: 90_000 });
  assert.equal(await fetch(`http://127.0.0.1:${port}/`).then((response) => response.status), 200);
  return item;
}

async function clickNativeDialogButton(pid: number, label: string): Promise<void> {
  let latestError = "native dialog unavailable";
  try {
    await waitForValue(async () => {
    for (const target of ["sheet 1 of window 1", "window 1"] as const) {
      const result = await run("/usr/bin/osascript", [
        "-e", "tell application \"System Events\"",
        "-e", `tell (first application process whose unix id is ${pid})`,
        "-e", `click button ${JSON.stringify(label)} of ${target}`,
        "-e", "end tell",
        "-e", "end tell",
      ]).catch((error: unknown) => ({ code: null, stdout: "", stderr: String(error) }));
      if (result.code === 0) return true;
      latestError = result.stderr;
    }
    return undefined;
    }, { describe: `native quit dialog button ${label}`, kind: "io", timeoutMs: 15_000 });
  } catch (error) {
    const snapshot = await run("/usr/bin/osascript", [
      "-e", "tell application \"System Events\"",
      "-e", `tell (first application process whose unix id is ${pid}) to get entire contents`,
      "-e", "end tell",
    ]).catch((cause: unknown) => ({ code: null, stdout: "", stderr: String(cause) }));
    throw new Error(`${error instanceof Error ? error.message : String(error)}; latest=${latestError}; ui=${snapshot.stdout.slice(0, 4000)}; uiError=${snapshot.stderr.slice(0, 1000)}`);
  }
}

async function pressCommandQ(pid: number): Promise<void> {
  const result = await run("/usr/bin/osascript", [
    "-e", "tell application \"System Events\"",
    "-e", `tell (first application process whose unix id is ${pid}) to set frontmost to true`,
    "-e", "keystroke \"q\" using command down",
    "-e", "end tell",
  ]);
  assert.equal(result.code, 0, result.stderr);
}

async function waitForApplicationExit(application: ElectronApplication, timeoutMs: number): Promise<{ code: number | null; signal: NodeJS.Signals | null }> {
  const child = application.process();
  if (child.exitCode !== null || child.signalCode !== null) return { code: child.exitCode, signal: child.signalCode };
  return await Promise.race([
    new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolve) => child.once("exit", (code, signal) => resolve({ code, signal }))),
    new Promise<never>((_, reject) => setTimeout(() => reject(new Error("Electron did not exit")), timeoutMs)),
  ]);
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
  }), { describe: `port ${port} closed`, kind: "io", timeoutMs: 20_000 });
}

async function waitForPidGone(pid: number): Promise<void> {
  await waitForValue(async () => {
    try { process.kill(pid, 0); return undefined; } catch { return true; }
  }, { describe: `PID ${pid} gone`, kind: "io", timeoutMs: 15_000 });
}

async function freePort(): Promise<number> {
  return await new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (address === null || typeof address === "string") return reject(new Error("port allocation failed"));
      server.close((error) => error === undefined ? resolve(address.port) : reject(error));
    });
  });
}

async function resolveMainWorktree(): Promise<string> {
  const result = await run("/usr/bin/git", ["rev-parse", "--path-format=absolute", "--git-common-dir"], projectRoot);
  assert.equal(result.code, 0, result.stderr);
  return await realpath(path.dirname(result.stdout.trim()));
}

async function run(command: string, args: readonly string[], cwd = projectRoot): Promise<{ code: number | null; stdout: string; stderr: string }> {
  return await new Promise((resolve, reject) => {
    const child = spawn(command, [...args], { cwd, shell: false, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = ""; let stderr = "";
    child.stdout?.setEncoding("utf8"); child.stderr?.setEncoding("utf8");
    child.stdout?.on("data", (chunk: string) => { stdout += chunk; });
    child.stderr?.on("data", (chunk: string) => { stderr += chunk; });
    child.once("error", reject);
    child.once("close", (code) => resolve({ code, stdout, stderr }));
  });
}
