import fs from "node:fs/promises";
import { spawn, type ChildProcess } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { _electron as electron, type ElectronApplication, type Page } from "playwright";

import { waitForValue } from "../../src/testing/wait.js";
import { createAcceptanceOutputDirectory } from "./temp-output.js";

interface ConsoleState {
  activeRuns?: Array<{ sessionId: string; runId: string }>;
  lastError?: string | null;
  projects: Array<{
    projectId: string;
    sessions: Array<{ sessionId: string }>;
  }>;
}

interface SessionView {
  session?: {
    sessionId: string;
    workspaceBinding?: {
      canonicalPath: string;
      branchName: string | null;
      lifecycle: string;
    };
    workspaceRevision?: number;
  };
  messages: Array<{ body: string; role?: string; status?: string }>;
  pendingPrimaryMessages?: Array<{ body: string; status?: string }>;
}

interface WorktreeRecord {
  worktreePath: string;
  branchName: string | null;
}

interface UserActionEvidence {
  environment: "真实 Electron + production preload/local-console/renderer + temporary fake Codex";
  entry: string;
  operation: string;
  screenObservation: string;
  consistent: true;
}

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const desktopRoot = path.join(projectRoot, "desktop");
const outputRoot = await createAcceptanceOutputDirectory("conversation-workspace-shared-lease");
const runtimeRoot = await fs.mkdtemp(path.join(os.tmpdir(), "moebius-workspace-lease-runtime-"));
const fixtureProjectRoot = path.join(runtimeRoot, "fixture-project");
const targetWorktreeRoot = path.join(runtimeRoot, "target-worktree");
const fakeBin = path.join(runtimeRoot, "bin");
const fakeCodexLogPath = path.join(outputRoot, "fake-codex.log");
const evidencePath = path.join(outputRoot, "conversation-workspace-shared-lease-evidence.json");

let application: ElectronApplication | null = null;
let cleanupPromise: Promise<void> | null = null;
let lastSwitchObservation: { branch: string | null; active: boolean; binding: unknown; messages?: unknown; pending?: unknown; lastError?: string | null } = {
  branch: null,
  active: false,
  binding: null,
};

const cleanup = (): Promise<void> => {
  cleanupPromise ??= (async () => {
    if (application !== null) {
      const currentApplication = application;
      application = null;
      const electronProcess = currentApplication.process();
      await Promise.race([
        currentApplication.close().catch(() => undefined),
        new Promise<void>((resolve) => setTimeout(resolve, 2_000)),
      ]);
      if (!await waitForChildExit(electronProcess, 2_000) && electronProcess.exitCode === null) {
        electronProcess.kill("SIGKILL");
        await waitForChildExit(electronProcess, 5_000);
      }
    }
    await terminateProcessesOwnedByRuntime(runtimeRoot);
    await fs.rm(runtimeRoot, { recursive: true, force: true, maxRetries: 8, retryDelay: 100 });
  })();
  return cleanupPromise;
};

async function launchDesktop(): Promise<ElectronApplication> {
  return await electron.launch({
    args: [desktopRoot],
    cwd: desktopRoot,
    env: {
      ...process.env,
      MOEBIUS_DATA_ROOT: runtimeRoot,
      PATH: `${fakeBin}${path.delimiter}${process.env.PATH ?? ""}`,
      ELECTRON_DISABLE_SECURITY_WARNINGS: "true",
    },
  });
}

async function prepareFixture(): Promise<void> {
  await Promise.all([
    fs.mkdir(fixtureProjectRoot, { recursive: true }),
    fs.mkdir(fakeBin, { recursive: true }),
  ]);
  await fs.writeFile(path.join(fixtureProjectRoot, "README.md"), "shared lease baseline\n", "utf8");
  await runProcess("git", ["init", fixtureProjectRoot]);
  await runProcess("git", ["-C", fixtureProjectRoot, "add", "README.md"]);
  await runProcess("git", [
    "-C", fixtureProjectRoot,
    "-c", "user.name=Moebius Acceptance",
    "-c", "user.email=acceptance@moebius.invalid",
    "commit", "-m", "shared lease baseline",
  ]);
  await runProcess("git", [
    "-C", fixtureProjectRoot,
    "worktree", "add", "-b", "feature/workspace-target", targetWorktreeRoot, "HEAD",
  ]);
  await fs.writeFile(path.join(targetWorktreeRoot, "target-only.txt"), "target workspace file\n", "utf8");
  await runProcess("git", ["-C", targetWorktreeRoot, "add", "target-only.txt"]);
  await runProcess("git", [
    "-C", targetWorktreeRoot,
    "-c", "user.name=Moebius Acceptance",
    "-c", "user.email=acceptance@moebius.invalid",
    "commit", "-m", "target workspace fixture",
  ]);
  await fs.writeFile(path.join(runtimeRoot, ".onboarding-completed"), `${new Date().toISOString()}\n`, "utf8");
  await fs.writeFile(path.join(fakeBin, "codex"), fakeCodexSource(fakeCodexLogPath), { mode: 0o755 });
}

try {
  await prepareFixture();
  application = await launchDesktop();
  let page = await application.firstWindow();
  await waitForConsole(page);
  const apiBase = await waitForApiBase(page);
  const project = await createProject(apiBase, fixtureProjectRoot);
  const session = await createSession(apiBase, project.projectId);
  await selectSession(page, session.sessionId);

  const composer = page.getByTestId("main-role-composer").getByRole("textbox", { name: "消息内容" });
  await composer.fill("请切换到 feature/workspace-target 分支对应 worktree 的工作 WORKSPACE_SWITCH");
  assert(await composer.inputValue() === "请切换到 feature/workspace-target 分支对应 worktree 的工作 WORKSPACE_SWITCH", "workspace switch prompt was not entered in the main composer");
  const submitSwitch = page.getByTestId("main-role-composer").getByRole("button", { name: "发送消息" });
  assert(await submitSwitch.isEnabled(), "workspace switch send button is disabled after the real composer input");
  await submitSwitch.click();
  const switchedWhileRunActive = await waitForValue(async () => {
    const [branch, state] = await Promise.all([
      readBranch(page),
      requestJson<ConsoleState>(apiBase, "/api/local-console/state"),
    ]);
    const active = state.activeRuns?.some((run) => run.sessionId === session.sessionId) ?? false;
    const view = await requestJson<SessionView>(
      apiBase,
      `/api/local-console/sessions/${encodeURIComponent(session.sessionId)}/view`,
    );
    lastSwitchObservation = {
      ...lastSwitchObservation,
      branch,
      active,
      binding: view.session?.workspaceBinding ?? null,
      messages: view.messages.map((message) => ({
        body: message.body,
        role: message.role ?? null,
        status: message.status ?? null,
      })),
      pending: view.pendingPrimaryMessages ?? [],
      lastError: state.lastError ?? null,
    };
    return active && branch === "feature/workspace-target"
      ? { branch, active }
      : undefined;
  }, {
    describe: "workspace branch label to follow the MCP switch while the provider run remains active",
    kind: "io",
    timeoutMs: 10_000,
    pollMs: 50,
    snapshot: () => ({ sessionId: session.sessionId, lastSwitchObservation }),
  });
  const worktreesAfterLiveSwitch = await listWorktrees(fixtureProjectRoot);
  const temporaryWorktree = worktreesAfterLiveSwitch.find((record) => record.branchName?.startsWith("moebius/"));
  assert(temporaryWorktree !== undefined, `switch run did not create a temporary worktree: ${JSON.stringify(worktreesAfterLiveSwitch)}`);
  assert(await pathExists(temporaryWorktree.worktreePath), "temporary worktree did not exist while the switch run was active");
  const switchedView = await requestJson<SessionView>(
    apiBase,
    `/api/local-console/sessions/${encodeURIComponent(session.sessionId)}/view`,
  );
  await waitForSessionIdle(apiBase, session.sessionId, "MCP 工作区切换");
  await openProjectFiles(page);
  const switchedFiles = await waitForValue(async () => {
    const value = await readProjectFileState(page);
    return value.fileNames.includes("target-only.txt") ? value : undefined;
  }, {
    describe: "project files panel to reload from the switched workspace",
    kind: "io",
    timeoutMs: 10_000,
    pollMs: 50,
  });
  const targetFile = page.getByTestId("project-files-tab").getByTitle("target-only.txt");
  await targetFile.dispatchEvent("click");
  const targetContent = await waitForValue(async () => {
    const selectedPath = await page.getByTestId("selected-file-path").textContent();
    const content = await page.getByTestId("file-source-scroll").textContent().catch(() => null);
    return selectedPath === "target-only.txt" && content?.includes("target workspace file")
      ? { selectedPath, content }
      : undefined;
  }, {
    describe: "selected target workspace file content to render",
    kind: "io",
    timeoutMs: 10_000,
    pollMs: 50,
  });
  const oldTemporaryPathAfterSwitch = await pathExists(temporaryWorktree.worktreePath);
  assert(!oldTemporaryPathAfterSwitch, `temporary worktree was not moved to Trash after the provider run settled: ${temporaryWorktree.worktreePath}`);

  const afterSwitchAction: UserActionEvidence = {
    environment: "真实 Electron + production preload/local-console/renderer + temporary fake Codex",
    entry: "主会话 composer",
    operation: "输入自然语言要求并发送；真实 Provider 进程通过注入的 Moebius MCP 调用 moebius_switch_workspace",
    screenObservation: `运行中分支标签为 ${switchedWhileRunActive.branch}；工作区文件树包含 target-only.txt，打开后显示目标文件内容；旧临时 worktree 已进入系统 Trash（原路径不存在）。`,
    consistent: true,
  };

  await application.close();
  application = await launchDesktop();
  page = await application.firstWindow();
  await waitForConsole(page);
  await selectSession(page, session.sessionId);
  const persistedBranch = await waitForValue(async () => {
    const branch = await readBranch(page);
    return branch === "feature/workspace-target" ? branch : undefined;
  }, {
    describe: "persisted workspace branch to render after Electron restart",
    kind: "io",
    timeoutMs: 10_000,
    pollMs: 50,
  });
  await openProjectFiles(page);
  const persistedFiles = await waitForValue(async () => {
    const value = await readProjectFileState(page);
    return value.fileNames.includes("target-only.txt") ? value : undefined;
  }, {
    describe: "persisted project files panel to follow the switched workspace after Electron restart",
    kind: "io",
    timeoutMs: 10_000,
    pollMs: 50,
  });
  const persistedTargetFile = page.getByTestId("project-files-tab").getByTitle("target-only.txt");
  await persistedTargetFile.dispatchEvent("click");
  const persistedTargetContent = await waitForValue(async () => {
    const selectedPath = await page.getByTestId("selected-file-path").textContent();
    const content = await page.getByTestId("file-source-scroll").textContent().catch(() => null);
    return selectedPath === "target-only.txt" && content?.includes("target workspace file")
      ? { selectedPath, content }
      : undefined;
  }, {
    describe: "persisted target file content to render after Electron restart",
    kind: "io",
    timeoutMs: 10_000,
    pollMs: 50,
  });

  const evidence = {
    status: "passed" as const,
    environment: "真实 Electron + production preload/local-console/renderer + temporary fake Codex",
    fixture: {
      projectRoot: fixtureProjectRoot,
      targetWorktree: targetWorktreeRoot,
      targetBranch: "feature/workspace-target",
      temporaryWorktree: temporaryWorktree.worktreePath,
    },
    actions: {
      switch: afterSwitchAction,
      restart: {
        environment: "真实 Electron + production preload/local-console/renderer + temporary fake Codex" as const,
        entry: "关闭并重新启动 Electron 应用，重新打开同一会话的项目文件",
        operation: "重启后查看分支标签、项目文件树并读取 target-only.txt",
        screenObservation: `重启后分支为 ${persistedBranch}；文件树包含 ${persistedFiles.fileNames.join(", ")}；目标文件内容仍为 ${persistedTargetContent.selectedPath} / target workspace file。`,
        consistent: true as const,
      },
    },
    observations: {
      switchedWhileRunActive,
      switchedView: switchedView.session?.workspaceBinding ?? null,
      switchedRevision: switchedView.session?.workspaceRevision ?? null,
      switchedFiles,
      targetContent: {
        path: targetContent.selectedPath,
        includesExpectedText: targetContent.content.includes("target workspace file"),
      },
      oldTemporaryPathAfterSwitch,
      persistedBranch,
      persistedFiles,
      persistedTargetContent: {
        path: persistedTargetContent.selectedPath,
        includesExpectedText: persistedTargetContent.content.includes("target workspace file"),
      },
    },
  };
  await fs.writeFile(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`, "utf8");
  console.log(JSON.stringify({ status: evidence.status, evidencePath, temporaryWorktree: temporaryWorktree.worktreePath }));
} catch (error) {
  const failure = {
    status: "failed" as const,
    evidencePath,
    error: error instanceof Error ? error.message : String(error),
    lastSwitchObservation,
    runtimeDiagnostics: await collectRuntimeDiagnostics(runtimeRoot),
  };
  await fs.writeFile(evidencePath, `${JSON.stringify(failure, null, 2)}\n`, "utf8").catch(() => undefined);
  console.error(JSON.stringify(failure));
  process.exitCode = 1;
} finally {
  await cleanup();
}

async function waitForConsole(page: Page): Promise<void> {
  await page.waitForLoadState("domcontentloaded");
  await page.getByRole("button", { name: "设置" }).waitFor({ timeout: 20_000 });
}

async function waitForApiBase(page: Page): Promise<string> {
  return await waitForValue(async () => {
    const value = await page.evaluate(async () =>
      (window as typeof window & { moebius?: { getLocalConsoleUrl?: () => Promise<string | null> } })
        .moebius?.getLocalConsoleUrl?.() ?? null,
    );
    return value === null ? undefined : value;
  }, {
    describe: "desktop preload to expose the local-console URL",
    kind: "io",
    timeoutMs: 20_000,
    pollMs: 100,
  });
}

async function createProject(apiBase: string, folderPath: string): Promise<{ projectId: string }> {
  return (await requestJson<{ project: { projectId: string } }>(apiBase, "/api/local-console/projects", {
    method: "POST",
    body: JSON.stringify({ folderPath, worktreeMode: false }),
  }, 201)).project;
}

async function createSession(apiBase: string, projectId: string): Promise<{ sessionId: string }> {
  return (await requestJson<{ session: { sessionId: string } }>(apiBase, "/api/local-console/sessions", {
    method: "POST",
    body: JSON.stringify({
      projectId,
      title: "workspace shared lease acceptance",
      workspaceMode: "worktree",
      agentTeamOwnership: "system",
      agentTeamId: "general-assistant",
    }),
  }, 201)).session;
}

async function selectSession(page: Page, sessionId: string): Promise<void> {
  const row = page.locator(`[data-testid='conversation-sidebar-session'][data-session-id="${sessionId}"]`);
  await row.waitFor({ timeout: 15_000 });
  await row.click();
  await page.waitForFunction((id) => document.querySelector(
    `[data-testid='conversation-sidebar-session'][data-session-id="${String(id)}"]`,
  )?.getAttribute("aria-current") === "page", sessionId);
}

async function waitForSessionIdle(apiBase: string, sessionId: string, description: string): Promise<SessionView> {
  return await waitForValue(async () => {
    const view = await requestJson<SessionView>(
      apiBase,
      `/api/local-console/sessions/${encodeURIComponent(sessionId)}/view`,
    );
    return view.messages.length >= 2 && !(await hasActiveRun(apiBase, sessionId)) ? view : undefined;
  }, {
    describe: `${description} provider run to settle`,
    kind: "io",
    timeoutMs: 20_000,
    pollMs: 50,
    snapshot: () => ({ sessionId }),
  });
}

async function hasActiveRun(apiBase: string, sessionId: string): Promise<boolean> {
  const state = await requestJson<ConsoleState>(apiBase, "/api/local-console/state");
  return state.activeRuns?.some((run) => run.sessionId === sessionId) ?? false;
}

async function openProjectFiles(page: Page): Promise<void> {
  const mainWindow = page.getByTestId("main-window-drag-region");
  const show = mainWindow.getByRole("button", { name: "显示右侧栏" });
  if (await show.isVisible().catch(() => false)) await show.click();
  const sidebar = page.getByTestId("right-sidebar");
  await sidebar.waitFor();
  const projectFiles = sidebar.getByRole("button", { name: /项目文件/u });
  if (await projectFiles.isVisible().catch(() => false)) await projectFiles.click();
  await page.getByTestId("project-files-tab").waitFor({ timeout: 10_000 });
}

async function readBranch(page: Page): Promise<string | null> {
  return await page.locator("[data-context-entry='branch']").getAttribute("aria-label").then((value) => {
    if (value === null) return null;
    const prefix = "分支：";
    return value.startsWith(prefix) ? value.slice(prefix.length) : value;
  }).catch(() => null);
}

async function readProjectFileState(page: Page): Promise<{ fileNames: string[]; selectedPath: string | null }> {
  const tree = page.getByTestId("workspace-file-tree");
  const fileNames = await tree.locator("button[role='treeitem']").allTextContents();
  return {
    fileNames: fileNames.map((value) => value.trim()).filter((value) => value !== ""),
    selectedPath: await page.getByTestId("selected-file-path").textContent().catch(() => null),
  };
}

async function listWorktrees(repoPath: string): Promise<WorktreeRecord[]> {
  const result = await runProcessWithOutput("git", ["-C", repoPath, "worktree", "list", "--porcelain"]);
  const records: WorktreeRecord[] = [];
  let current: WorktreeRecord | null = null;
  for (const line of result.stdout.split(/\r?\n/u)) {
    if (line.startsWith("worktree ")) {
      if (current !== null) records.push(current);
      current = { worktreePath: line.slice("worktree ".length), branchName: null };
    } else if (current !== null && line.startsWith("branch refs/heads/")) {
      current.branchName = line.slice("branch refs/heads/".length);
    }
  }
  if (current !== null) records.push(current);
  return records;
}

async function requestJson<T = unknown>(apiBase: string, pathname: string, init: RequestInit = {}, expectedStatus = 200): Promise<T> {
  const response = await fetch(new URL(pathname, apiBase), {
    ...init,
    headers: { "content-type": "application/json", ...init.headers },
  });
  if (response.status !== expectedStatus) {
    throw new Error(`${init.method ?? "GET"} ${pathname} failed: ${response.status} ${await response.text()}`);
  }
  return await response.json() as T;
}

async function pathExists(targetPath: string): Promise<boolean> {
  return await fs.access(targetPath).then(() => true).catch(() => false);
}

async function runProcess(command: string, args: string[]): Promise<void> {
  const result = await runProcessWithOutput(command, args);
  if (result.code !== 0) {
    throw new Error(`${command} ${args.join(" ")} exited ${String(result.code)}: ${result.stderr} ${result.stdout}`);
  }
}

async function runProcessWithOutput(command: string, args: string[]): Promise<{ code: number | null; stdout: string; stderr: string }> {
  return await new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"] });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    child.stdout?.on("data", (chunk: Buffer) => stdout.push(chunk));
    child.stderr?.on("data", (chunk: Buffer) => stderr.push(chunk));
    child.once("error", reject);
    child.once("close", (code) => resolve({
      code,
      stdout: Buffer.concat(stdout).toString("utf8"),
      stderr: Buffer.concat(stderr).toString("utf8"),
    }));
  });
}

function waitForChildExit(child: ChildProcess, timeoutMs: number): Promise<boolean> {
  if (child.exitCode !== null || child.signalCode !== null) return Promise.resolve(true);
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      child.off("exit", onExit);
      resolve(false);
    }, timeoutMs);
    const onExit = () => {
      clearTimeout(timer);
      resolve(true);
    };
    child.once("exit", onExit);
  });
}

async function terminateProcessesOwnedByRuntime(runtimePath: string): Promise<void> {
  const rows = await processRows();
  const owned = rows.filter((row) => row.command.includes(runtimePath));
  for (const row of owned) {
    try { process.kill(row.pid, "SIGTERM"); } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error;
    }
  }
  if (owned.length > 0) await new Promise<void>((resolve) => setTimeout(resolve, 500));
  for (const row of (await processRows()).filter((row) => row.command.includes(runtimePath))) {
    try { process.kill(row.pid, "SIGKILL"); } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error;
    }
  }
  await waitForValue(async () => (await processRows()).some((row) => row.command.includes(runtimePath)) ? undefined : true, {
    describe: `acceptance process cleanup for ${runtimePath}`,
    kind: "io",
    timeoutMs: 5_000,
    pollMs: 100,
  });
}

async function processRows(): Promise<Array<{ pid: number; command: string }>> {
  const result = await runProcessWithOutput("/bin/ps", ["-axo", "pid=,command="]);
  return result.stdout.split("\n").flatMap((line) => {
    const match = /^\s*(\d+)\s+(.+)$/u.exec(line);
    return match === null ? [] : [{ pid: Number(match[1]), command: match[2]! }];
  });
}

async function collectRuntimeDiagnostics(root: string): Promise<Array<{ path: string; lines: string[] }>> {
  const result: Array<{ path: string; lines: string[] }> = [];
  const visit = async (directory: string): Promise<void> => {
    for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
      const target = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        await visit(target);
        continue;
      }
      if (!entry.isFile() || !/\.(?:jsonl|log|json)$/u.test(entry.name)) continue;
      const text = await fs.readFile(target, "utf8").catch(() => "");
      const lines = text.split(/\r?\n/u)
        .filter((line) => /error|failed|failure|exception|workspace|spawn/iu.test(line))
        .slice(-20);
      if (lines.length > 0) result.push({ path: target, lines });
    }
  };
  await visit(root).catch(() => undefined);
  return result.slice(-20);
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function fakeCodexSource(logPath: string): string {
  return `#!/usr/bin/env node
const { spawn } = require("node:child_process");
const { appendFileSync } = require("node:fs");
const prompt = process.argv.at(-1) ?? "";
appendFileSync(${JSON.stringify(logPath)}, JSON.stringify({ argv: process.argv, prompt }) + "\\n");
const emit = (event) => process.stdout.write(JSON.stringify(event) + "\\n");
const threadId = "thread-workspace-" + String(process.pid);

function configuredMcp() {
  const commandValue = process.argv.find((value) => value.startsWith("mcp_servers.moebius_managed.command="));
  const argsValue = process.argv.find((value) => value.startsWith("mcp_servers.moebius_managed.args="));
  if (commandValue === undefined || argsValue === undefined) throw new Error("workspace MCP configuration missing");
  return {
    command: JSON.parse(commandValue.slice(commandValue.indexOf("=") + 1)),
    args: JSON.parse(argsValue.slice(argsValue.indexOf("=") + 1)),
  };
}

async function switchWorkspace() {
  const config = configuredMcp();
  const bridge = spawn(config.command, config.args, {
    env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" },
    stdio: ["pipe", "pipe", "pipe"],
  });
  let buffer = "";
  const responses = new Map();
  bridge.stdout.setEncoding("utf8");
  bridge.stdout.on("data", (chunk) => {
    buffer += chunk;
    for (;;) {
      const newline = buffer.indexOf("\\n");
      if (newline < 0) break;
      const line = buffer.slice(0, newline).trim();
      buffer = buffer.slice(newline + 1);
      if (line === "") continue;
      const message = JSON.parse(line);
      const resolve = responses.get(String(message.id));
      if (resolve !== undefined) {
        responses.delete(String(message.id));
        resolve(message);
      }
    }
  });
  bridge.stderr.on("data", () => undefined);
  const request = (id, method, params) => new Promise((resolve, reject) => {
    responses.set(String(id), resolve);
    bridge.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\\n");
    setTimeout(() => {
      if (!responses.has(String(id))) return;
      responses.delete(String(id));
      reject(new Error("workspace MCP bridge request timed out"));
    }, 5000).unref();
  });
  const initialize = await request(1, "initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "acceptance", version: "1" } });
  if (initialize.result === undefined) throw new Error("workspace MCP initialize failed");
  bridge.stdin.write(JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized", params: {} }) + "\\n");
  const tools = await request(2, "tools/list", {});
  if (!(tools.result?.tools ?? []).some((tool) => tool.name === "moebius_switch_workspace")) throw new Error("workspace MCP tool missing");
  const result = await request(3, "tools/call", { name: "moebius_switch_workspace", arguments: { target: "branch", branchName: "feature/workspace-target" } });
  if (result.result?.isError === true) throw new Error(result.result.content?.[0]?.text ?? "workspace switch failed");
  bridge.stdin.end();
  await new Promise((resolve, reject) => {
    bridge.once("error", reject);
    bridge.once("close", (code) => code === 0 ? resolve() : reject(new Error("workspace MCP bridge exited " + String(code))));
  });
}

(async () => {
  emit({ type: "thread.started", thread_id: threadId });
  if (prompt.includes("WORKSPACE_SWITCH")) {
    await switchWorkspace();
    await new Promise((resolve) => setTimeout(resolve, 3000));
    emit({ type: "item.completed", item: { type: "agent_message", text: "已切换到 feature/workspace-target 分支对应的工作区。" } });
  } else {
    emit({ type: "item.completed", item: { type: "agent_message", text: "已准备好当前对话的临时工作区。" } });
  }
  process.exit(0);
})().catch((error) => {
  process.stderr.write(String(error?.stack ?? error) + "\\n");
  process.exit(17);
});
`;
}
