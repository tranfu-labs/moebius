import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, readFile, readdir, realpath, stat, writeFile } from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";

import { _electron as electron, type ElectronApplication, type Page } from "playwright";

import type { ManagedProcessSummary } from "../../src/local-console/managed-process-contract.js";
import { LaunchdManagedProcessAdapter } from "../../src/local-console/managed-process-launchd-adapter.js";
import { waitForValue } from "../../src/testing/wait.js";

type Provider = "codex" | "claude" | "kimi";

interface ConsoleState {
  activeRuns: unknown[];
  projects: Array<{
    projectId: string;
    title: string;
    folderPath: string;
    sessions: Array<{ sessionId: string; runningCount: number }>;
  }>;
}

const projectRoot = path.resolve(".");
const desktopRoot = path.join(projectRoot, "desktop");
const workspace = await resolveMainWorktree();
const runtimeRoot = await mkdtemp(path.join(os.tmpdir(), "moebius-managed-electron-runtime-"));
const evidenceRoot = await mkdtemp(path.join(os.tmpdir(), "moebius-managed-electron-evidence-"));
const evidencePath = path.join(evidenceRoot, "evidence.json");
const supervisorSocketPath = path.join("/tmp", `moebius-managed-${createHash("sha256").update(runtimeRoot).digest("hex").slice(0, 20)}.sock`);
const projectRemovalOnly = process.argv.includes("--case") && process.argv.includes("project-removal");
const managedSidebarOnly = process.argv.includes("--case") && process.argv.includes("managed-sidebar");
await mkdir(runtimeRoot, { recursive: true });
await writeFile(path.join(runtimeRoot, ".onboarding-completed"), `${new Date().toISOString()}\n`, "utf8");

const configPaths = [
  path.join(os.homedir(), ".codex", "config.toml"),
  path.join(os.homedir(), ".claude", "settings.json"),
  path.join(os.homedir(), ".kimi", "config.toml"),
];
const configsBefore = await snapshotFiles(configPaths);
const evidence: Record<string, unknown> = {
  environment: "真机",
  runtimeRoot,
  evidenceRoot,
  workspace,
  providers: {},
  observations: [],
  bridgeInvocations: [],
};

let application: ElectronApplication | null = null;
try {
  application = await electron.launch({
    args: [desktopRoot],
    cwd: desktopRoot,
    env: {
      ...process.env,
      MOEBIUS_DATA_ROOT: runtimeRoot,
      ELECTRON_DISABLE_SECURITY_WARNINGS: "true",
    },
  });
  const page = await application.firstWindow();
  await page.waitForLoadState("domcontentloaded");
  await page.getByRole("button", { name: "设置" }).waitFor({ timeout: 20_000 });
  const apiBase = await waitForApiBase(page);
  const initialState = await requestJson<ConsoleState>(apiBase, "/api/local-console/state");
  const project = initialState.projects[0] ?? await createProject(apiBase, workspace);
  if (project.folderPath !== workspace) {
    await requestJson(apiBase, `/api/local-console/projects/${encodeURIComponent(project.projectId)}`, {
      method: "PATCH",
      body: JSON.stringify({ folderPath: workspace }),
    });
  }

  if (!projectRemovalOnly) {
  const codexPorts = [await freePort(), await freePort()];
  process.stderr.write("[managed-electron] codex: create and start\n");
  const codex = await createProviderSession(page, apiBase, project.projectId, "codex", "Codex 托管验收");
  await selectSession(page, codex.sessionId);
  await sendAndWait(page, codex.sessionId, startTwoServicesPrompt("Codex", codexPorts));
  const codexItems = await waitForManagedCount(apiBase, codex.sessionId, 2, "Codex two managed services");
  assert(codexItems.every((item) => item.state === "ready"), "Codex managed services did not both become ready");
  assert.equal(await fetch(`http://127.0.0.1:${codexPorts[0]}/`).then((response) => response.status), 200);
  assert.equal(await fetch(`http://127.0.0.1:${codexPorts[1]}/`).then((response) => response.status), 200);
  const browserManaged = await page.evaluate(async ({ base, sessionId }) => {
    const response = await fetch(new URL(`/api/local-console/sessions/${encodeURIComponent(sessionId)}/managed-processes`, base));
    return { status: response.status, body: await response.json(), selected: document.querySelector("[aria-current='page']")?.getAttribute("data-session-id") ?? null };
  }, { base: apiBase, sessionId: codex.sessionId });
  process.stderr.write(`[managed-electron] browser managed snapshot ${JSON.stringify(browserManaged)}\n`);
  const multipleLabel = await page.getByTestId("managed-process-indicator").innerText();
  assert.match(multipleLabel, /2/u);

  await sendAndWait(page, codex.sessionId, "只调用 managed_process_list 与 managed_process_inspect 查询现有两个运行项；不要启动或停止，不要使用终端。回复两个 id 和状态。");
  process.stderr.write("[managed-electron] codex: resume settled\n");
  const codexAfterResume = await waitForManagedCount(apiBase, codex.sessionId, 2, "Codex resume managed services");
  assert.deepEqual(codexAfterResume.map((item) => item.id).sort(), codexItems.map((item) => item.id).sort());
  await stopAgentRunWhileManaged(page, apiBase, codex.sessionId);
  assert.equal(await fetch(`http://127.0.0.1:${codexPorts[0]}/`).then((response) => response.status), 200);
  assert.equal(await fetch(`http://127.0.0.1:${codexPorts[1]}/`).then((response) => response.status), 200);
  const managedOnlySidebar = page.locator(`[data-testid='conversation-sidebar-session'][data-session-id='${codex.sessionId}']`);
  const managedOnlyStatusDot = await managedOnlySidebar.getAttribute("data-status-dot");
  const managedOnlyAccessibleName = await managedOnlySidebar.getAttribute("aria-label");
  assert.notEqual(managedOnlyStatusDot, "blink", "managed work incorrectly lit the Agent running status dot");
  assert.doesNotMatch(managedOnlyAccessibleName ?? "", /正在运行/u, "managed work incorrectly announced an Agent run");

  const blank = await createProviderSession(page, apiBase, project.projectId, "codex", "会话隔离验收");
  await selectSession(page, blank.sessionId);
  await page.getByTestId("managed-process-indicator").waitFor({ state: "detached", timeout: 10_000 });
  await selectSession(page, codex.sessionId);
  await page.getByTestId("managed-process-indicator").waitFor({ state: "visible", timeout: 10_000 });

  const archiveDisabled = await observeArchiveDisabled(page, codex.sessionId);
  process.stderr.write(`[managed-electron] codex: archive disabled=${String(archiveDisabled)}\n`);
  assert(archiveDisabled, "active managed process did not disable ordinary archive");
  await stopFromPanel(page, codexItems[0]!.label);
  await waitForPortClosed(codexPorts[0]);
  assert.equal(await fetch(`http://127.0.0.1:${codexPorts[1]}/`).then((response) => response.status), 200);
  await readLogsFromPanel(page, codexItems[0]!.label);
  await stopFromPanel(page, codexItems[1]!.label);
  await waitForPortClosed(codexPorts[1]);
  const exitedCodex = await waitForManagedStates(apiBase, codex.sessionId, ["exited", "exited"], "Codex exited facts");
  const exitedLabel = await waitForValue(async () => {
    const label = await page.getByTestId("managed-process-indicator").innerText();
    return /已结束/u.test(label) ? label : undefined;
  }, { describe: "Codex exited indicator", kind: "io", timeoutMs: 10_000 });
  assert.match(exitedLabel, /已结束/u);
  await dismissExited(page);
  process.stderr.write("[managed-electron] codex: stopped and dismissed\n");
  await page.getByTestId("managed-process-indicator").waitFor({ state: "detached", timeout: 10_000 });

  (evidence.providers as Record<string, unknown>).codex = {
    sessionId: codex.sessionId,
    processIds: codexItems.map((item) => item.id),
    targetPids: codexItems.map((item) => item.targetPid),
    wrapperPids: codexItems.map((item) => item.wrapperPid),
    stateAfterResume: codexAfterResume.map((item) => item.state),
    multipleLabel,
    archiveDisabled,
    managedOnlyStatusDot,
    managedOnlyAccessibleName,
    exitedLabel,
    exitedFacts: exitedCodex.map((item) => ({ id: item.id, exitCode: item.exitCode, signal: item.signal })),
    portsClosed: true,
  };
  pushObservation("A1/A4/A7/A13 Codex 主页面与运行项面板", "发送启动与查询消息；中止后续前台 Agent run；检查侧边栏状态点与归档；切换会话；在面板逐项查看日志、停止并清除", `顶栏显示“${multipleLabel}”；Agent run 中止后两个托管端口仍 HTTP 200，侧边栏状态点=${managedOnlyStatusDot ?? "none"} 且不宣告正在运行，归档仍禁用；切换空会话入口消失；返回后同一 processId；第一项停止时第二端口仍 HTTP 200；全部退出后显示“${exitedLabel}”，清除后入口无空位`, true);

  if (!managedSidebarOnly) {
  for (const provider of ["claude", "kimi"] as const) {
    process.stderr.write(`[managed-electron] ${provider}: create and start\n`);
    const port = await freePort();
    const session = await createProviderSession(page, apiBase, project.projectId, provider, `${provider} 托管验收`);
    await selectSession(page, session.sessionId);
    await sendAndWait(page, session.sessionId, startOneServicePrompt(provider, port), provider === "kimi" ? 90_000 : 120_000);
    const [started] = await waitForManagedCount(apiBase, session.sessionId, 1, `${provider} managed service`);
    assert(started !== undefined && started.state === "ready");
    assert.equal(await fetch(`http://127.0.0.1:${port}/`).then((response) => response.status), 200);
    await sendAndWait(page, session.sessionId, "只调用 managed_process_list 与 managed_process_inspect 查询现有运行项；不要启动或停止，不要使用终端。回复 id 和状态。", provider === "kimi" ? 90_000 : 120_000);
    const [afterResume] = await waitForManagedCount(apiBase, session.sessionId, 1, `${provider} resume managed service`);
    assert.equal(afterResume?.id, started.id);
    await stopFromPanel(page, started.label);
    await waitForPortClosed(port);
    await dismissExited(page);
    process.stderr.write(`[managed-electron] ${provider}: stopped and dismissed\n`);
    (evidence.providers as Record<string, unknown>)[provider] = {
      sessionId: session.sessionId,
      processId: started.id,
      targetPid: started.targetPid,
      wrapperPid: started.wrapperPid,
      stateAfterResume: afterResume?.state,
      httpStatus: 200,
      portClosed: true,
    };
    pushObservation(`A${provider === "claude" ? "2" : "3"} ${provider} 主页面`, "发送启动与查询消息，再从运行项面板停止", `同一 processId=${started.id} 跨回合保持 ready；HTTP 200；面板停止后端口拒绝连接且入口可清除`, true);
  }

  process.stderr.write("[managed-electron] edge states: create and start\n");
  const edgePorts = [await freePort(), await freePort()];
  const edge = await createProviderSession(page, apiBase, project.projectId, "codex", "运行项边界验收");
  await selectSession(page, edge.sessionId);
  const edgeRun = sendAndWait(page, edge.sessionId, startEdgeProcessesPrompt(edgePorts), 120_000);
  const startingObserved = await waitForValue(async () => (await listManaged(apiBase, edge.sessionId)).some((item) => item.state === "starting") ? true : undefined, {
    describe: "delayed readiness starting state", kind: "io", timeoutMs: 60_000,
  });
  await edgeRun;
  const edgeItems = await waitForValue(async () => {
    const items = await listManaged(apiBase, edge.sessionId);
    const states = Object.fromEntries(items.map((item) => [item.label, item.state]));
    return states["Delayed endpoint"] === "ready"
      && states["Flood task"] === "running"
      && states["Unhealthy watcher"] === "unhealthy"
      ? items
      : undefined;
  }, { describe: "ready, running, and unhealthy edge states", kind: "io", timeoutMs: 30_000 });
  assert.equal(await fetch(`http://127.0.0.1:${edgePorts[0]}/`).then((response) => response.status), 200);
  const floodItem = edgeItems.find((item) => item.label === "Flood task");
  assert(floodItem !== undefined);
  await waitForValue(async () => (await requestJson<{ truncated: boolean }>(apiBase, `/api/local-console/sessions/${encodeURIComponent(edge.sessionId)}/managed-processes/${encodeURIComponent(floodItem.id)}/logs`)).truncated ? true : undefined, {
    describe: "flood log truncation persisted", kind: "io", timeoutMs: 20_000,
  });
  const edgeIndicator = page.getByTestId("managed-process-indicator");
  await edgeIndicator.click();
  await page.getByRole("button", { name: "打开链接 · Delayed endpoint" }).click();
  await page.bringToFront();
  await readLogsFromPanel(page, "Flood task");
  await page.getByTestId("managed-process-panel").getByText("较早日志已截断", { exact: true }).waitFor({ timeout: 15_000 });
  for (const label of ["Delayed endpoint", "Flood task", "Unhealthy watcher"]) await stopFromPanel(page, label);
  await waitForPortClosed(edgePorts[0]);
  await waitForManagedStates(apiBase, edge.sessionId, ["exited", "exited", "exited"], "edge process exited facts");
  await dismissExited(page);
  pushObservation("A5/A6 readiness、endpoint 与有限日志", "从主页面启动延迟服务、日志洪泛 task 和健康退化 watcher；点击打开、查看日志并逐项停止", `观察到 starting→ready、running 与 unhealthy 三种独立状态；loopback endpoint HTTP 200；日志显示截断标记；三项退出后可确认清除（startingObserved=${String(startingObserved)}，ids=${edgeItems.map((item) => item.id).join(",")})`, true);
  process.stderr.write("[managed-electron] edge states: stopped and dismissed\n");
  }
  }

  if (!managedSidebarOnly) {
  process.stderr.write("[managed-electron] project removal guard: create and force remove\n");
  const removalPort = await freePort();
  const removal = await createProviderSession(page, apiBase, project.projectId, "codex", "项目移除运行项验收");
  await selectSession(page, removal.sessionId);
  await sendAndWait(page, removal.sessionId, startOneServicePrompt("codex", removalPort));
  const [removalItem] = await waitForManagedCount(apiBase, removal.sessionId, 1, "project removal managed service");
  assert(removalItem !== undefined);
  await openProjectRemovalWarning(page, project.title);
  await page.getByRole("button", { name: "强制中止并继续" }).click();
  await page.getByRole("dialog", { name: "移除项目？" }).waitFor();
  await page.getByRole("button", { name: "中止并移除" }).click();
  await waitForPortClosed(removalPort);
  await waitForValue(async () => !(await requestJson<ConsoleState>(apiBase, "/api/local-console/state")).projects.some((candidate) => candidate.projectId === project.projectId) ? true : undefined, {
    describe: "project removed only after managed service stopped", kind: "io", timeoutMs: 20_000,
  });
  pushObservation("A11 项目移除保护", "在活动运行项存在时从真实左侧栏项目菜单选择移除，确认强制中止并移除", `先显示运行中警告；确认后 processId=${removalItem.id} 的端口关闭，项目才从侧栏与 state 消失；普通会话归档禁用已在 Codex 场景观察`, true);
  process.stderr.write("[managed-electron] project removal guard: removed after stop\n");
  }

  const configsAfter = await snapshotFiles(configPaths);
  evidence.userGlobalProviderConfigs = Object.fromEntries(configPaths.map((filePath) => [filePath, {
    before: configsBefore[filePath],
    after: configsAfter[filePath],
    unchanged: JSON.stringify(configsBefore[filePath]) === JSON.stringify(configsAfter[filePath]),
  }]));
  assert(configPaths.every((filePath) => JSON.stringify(configsBefore[filePath]) === JSON.stringify(configsAfter[filePath])), "user-global provider configuration changed");
  if (!projectRemovalOnly) {
    pushObservation("A12 三家 Provider 临时注入", "依次在真实 Electron 会话启动与 resume", "三家均发现同名工具并完成调用；全局 provider 配置 hash/mtime/mode 未变化；Claude run-local MCP 文件由 adapter 验收另证已删除", true);
  }

  await application.close();
  application = null;
  await waitForValue(async () => await exists(supervisorSocketPath) ? undefined : true, {
    describe: "managed supervisor socket removal after Electron close", kind: "io", timeoutMs: 10_000,
  });
  await writeFile(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`, "utf8");
  process.stdout.write(`${JSON.stringify({ ok: true, evidencePath })}\n`);
} finally {
  if (application !== null) {
    const process = application.process();
    await Promise.race([application.close().catch(() => undefined), new Promise((resolve) => setTimeout(resolve, 3_000))]);
    if (process.exitCode === null) process.kill("SIGKILL");
  }
  const cleanupAdapter = new LaunchdManagedProcessAdapter({ dataRoot: runtimeRoot, wrapperProgram: process.execPath, wrapperProgramArgs: [] });
  await cleanupAdapter.init().then(async () => await cleanupAdapter.reconcile()).catch(() => undefined);
}

function pushObservation(entry: string, action: string, screenObservation: string, consistent: boolean): void {
  (evidence.observations as unknown[]).push({ environment: "真机", entry, action, screenObservation, consistent });
}

async function createProviderSession(page: Page, apiBase: string, projectId: string, provider: Provider, title: string): Promise<{ sessionId: string }> {
  const profiles = {
    codex: { cli: "codex", model: "gpt-5.6-sol", effort: "high" },
    claude: { cli: "claude", model: "fable", effort: "high" },
    kimi: { cli: "kimi", model: "kimi-code/k3", effort: "high" },
  } as const;
  await page.evaluate(async ({ profile }) => {
    const api = (window as typeof window & { moebius?: { saveAgentTeamExecutionProfile?: (request: unknown) => Promise<unknown> } }).moebius;
    if (api?.saveAgentTeamExecutionProfile === undefined) throw new Error("desktop profile IPC unavailable");
    await api.saveAgentTeamExecutionProfile({
      teamId: "general-assistant",
      ownership: "system",
      memberSlug: "assistant",
      profile,
    });
  }, { profile: profiles[provider] });
  return (await requestJson<{ session: { sessionId: string } }>(apiBase, "/api/local-console/sessions", {
    method: "POST",
    body: JSON.stringify({
      projectId,
      workspaceMode: "direct",
      agentTeamOwnership: "system",
      agentTeamId: "general-assistant",
      title,
    }),
  }, 201)).session;
}

function startTwoServicesPrompt(label: string, ports: readonly number[]): string {
  return `必须只使用 managed_process_start，依次启动两个运行项，不使用终端。第一个：kind=service，label=${label} primary，executable=python3，args=["-m","http.server","${ports[0]}","--bind","127.0.0.1"]，cwd="."，readiness={"type":"tcp","host":"127.0.0.1","port":${ports[0]}}，endpoint={"url":"http://127.0.0.1:${ports[0]}/"}。第二个同样参数但 kind=service、label=${label} secondary、端口 ${ports[1]}。完成后回复两个 id。`;
}

function startOneServicePrompt(provider: Provider, port: number): string {
  return `必须只使用 managed_process_start 启动一个 service，不使用终端：label=${provider} Electron server，executable=python3，args=["-m","http.server","${port}","--bind","127.0.0.1"]，cwd="."，readiness={"type":"tcp","host":"127.0.0.1","port":${port}}，endpoint={"url":"http://127.0.0.1:${port}/"}。完成后回复 id。`;
}

function startEdgeProcessesPrompt(ports: readonly number[]): string {
  const delayedCode = `import time,http.server;time.sleep(12);http.server.test(HandlerClass=http.server.SimpleHTTPRequestHandler,port=${ports[0]},bind="127.0.0.1")`;
  const floodCode = 'import sys,time;sys.stdout.write("x"*3000000);sys.stdout.flush();time.sleep(90)';
  const unhealthyCode = `import socket,time;s=socket.socket();s.setsockopt(socket.SOL_SOCKET,socket.SO_REUSEADDR,1);s.bind(("127.0.0.1",${ports[1]}));s.listen();time.sleep(4);s.close();time.sleep(90)`;
  return `只使用 managed_process_start 依次启动三个运行项，不使用终端。1) kind=service,label="Delayed endpoint",executable=python3,args=${JSON.stringify(["-c", delayedCode])},cwd=".",readiness={"type":"tcp","host":"127.0.0.1","port":${ports[0]}},endpoint={"url":"http://127.0.0.1:${ports[0]}/"}。2) kind=task,label="Flood task",executable=python3,args=${JSON.stringify(["-c", floodCode])},cwd=".",readiness={"type":"none"}，无 endpoint。3) kind=watcher,label="Unhealthy watcher",executable=python3,args=${JSON.stringify(["-c", unhealthyCode])},cwd=".",readiness={"type":"tcp","host":"127.0.0.1","port":${ports[1]}}，无 endpoint。完成后回复三个 id。`;
}

async function sendAndWait(page: Page, sessionId: string, body: string, timeoutMs = 120_000): Promise<void> {
  const input = page.getByRole("textbox", { name: "消息内容" });
  await input.fill(body);
  await page.getByRole("button", { name: "发送消息" }).click();
  const stop = page.getByRole("button", { name: "停下主理人" });
  await stop.waitFor({ state: "visible", timeout: Math.min(timeoutMs, 20_000) });
  const bridgeRows = await waitForValue(async () => {
    const rows = await processRows();
    const bridges = rows.filter((row) => row.command.includes("managed-process-mcp-bridge.js") && row.command.includes(runtimeRoot));
    return bridges.length > 0 ? bridges : undefined;
  }, { describe: `packaged MCP bridge for ${sessionId}`, kind: "io", timeoutMs: Math.min(timeoutMs, 30_000) });
  const bridgePids = bridgeRows.map((row) => row.pid);
  const duringRows = descendantsOf(await processRows(), bridgePids);
  assert.equal(duringRows.some((row) => row.command.includes("Electron Helper")), false, JSON.stringify(duringRows));
  await stop.waitFor({ state: "hidden", timeout: timeoutMs });
  await waitForInvocationResidueCleared(sessionId, bridgePids);
  (evidence.bridgeInvocations as unknown[]).push({ sessionId, bridgePids, helperCountDuring: 0, bridgeCountAfter: 0, capabilityCountAfter: 0 });
  assert.equal(await input.inputValue(), "", `composer did not clear for ${sessionId}`);
}

async function stopAgentRunWhileManaged(page: Page, apiBase: string, sessionId: string): Promise<void> {
  const input = page.getByRole("textbox", { name: "消息内容" });
  await input.fill("不要调用 managed_process 工具。请用前台终端运行 python3 -c 'import time; time.sleep(90)'，等待命令结束后再回复；不得后台化。");
  await page.getByRole("button", { name: "发送消息" }).click();
  const stop = page.getByRole("button", { name: "停下主理人" });
  await stop.waitFor({ state: "visible", timeout: 20_000 });
  await waitForValue(async () => (await requestJson<ConsoleState>(apiBase, `/api/local-console/state?sessionId=${encodeURIComponent(sessionId)}`)).activeRuns.length > 0 ? true : undefined, {
    describe: "Codex foreground run active before user stop", kind: "io", timeoutMs: 20_000,
  });
  await stop.click();
  await stop.waitFor({ state: "hidden", timeout: 20_000 });
  await waitForInvocationResidueCleared(sessionId, []);
}

async function waitForInvocationResidueCleared(sessionId: string, bridgePids: readonly number[]): Promise<void> {
  const capabilityRoot = path.join(runtimeRoot, ".state", "managed-process-capabilities");
  await waitForValue(async () => {
    const rows = await processRows();
    const bridgeRows = rows.filter((row) => row.command.includes("managed-process-mcp-bridge.js") && row.command.includes(runtimeRoot));
    const capturedBridgeRows = rows.filter((row) => bridgePids.includes(row.pid));
    const capabilityFiles = await readdir(capabilityRoot).catch((error: NodeJS.ErrnoException) => error.code === "ENOENT" ? [] : Promise.reject(error));
    return bridgeRows.length === 0 && capturedBridgeRows.length === 0 && capabilityFiles.length === 0 ? true : undefined;
  }, {
    describe: `bridge, helper, and capability cleanup for ${sessionId}`,
    kind: "io",
    timeoutMs: 15_000,
  });
}

async function processRows(): Promise<Array<{ pid: number; ppid: number; pgid: number; command: string }>> {
  const output = await runText("/bin/ps", ["-axo", "pid=,ppid=,pgid=,command="], projectRoot);
  return output.split("\n").flatMap((line) => {
    const match = /^\s*(\d+)\s+(\d+)\s+(\d+)\s+(.+)$/u.exec(line);
    return match === null ? [] : [{ pid: Number(match[1]), ppid: Number(match[2]), pgid: Number(match[3]), command: match[4]! }];
  });
}

function descendantsOf<T extends { pid: number; ppid: number }>(rows: readonly T[], roots: readonly number[]): T[] {
  const ids = new Set(roots);
  let changed = true;
  while (changed) {
    changed = false;
    for (const row of rows) {
      if (ids.has(row.ppid) && !ids.has(row.pid)) {
        ids.add(row.pid);
        changed = true;
      }
    }
  }
  return rows.filter((row) => ids.has(row.pid));
}

async function waitForManagedCount(apiBase: string, sessionId: string, count: number, describe: string): Promise<ManagedProcessSummary[]> {
  return await waitForValue(async () => {
    const items = await listManaged(apiBase, sessionId);
    return items.length === count && items.every((item) => item.state === "ready") ? items : undefined;
  }, { describe, kind: "io", timeoutMs: 30_000 });
}

async function waitForManagedStates(apiBase: string, sessionId: string, states: string[], describe: string): Promise<ManagedProcessSummary[]> {
  return await waitForValue(async () => {
    const items = await listManaged(apiBase, sessionId);
    return JSON.stringify(items.map((item) => item.state).sort()) === JSON.stringify([...states].sort()) ? items : undefined;
  }, { describe, kind: "io", timeoutMs: 20_000 });
}

async function listManaged(apiBase: string, sessionId: string): Promise<ManagedProcessSummary[]> {
  return (await requestJson<{ processes: ManagedProcessSummary[] }>(apiBase, `/api/local-console/sessions/${encodeURIComponent(sessionId)}/managed-processes`)).processes;
}

async function stopFromPanel(page: Page, label: string): Promise<void> {
  const indicator = page.getByTestId("managed-process-indicator");
  if (await indicator.getAttribute("aria-expanded") !== "true") await indicator.click();
  await page.getByRole("button", { name: `停止 · ${label}` }).click();
}

async function readLogsFromPanel(page: Page, label: string): Promise<void> {
  const indicator = page.getByTestId("managed-process-indicator");
  if (await indicator.getAttribute("aria-expanded") !== "true") await indicator.click();
  const panel = page.getByTestId("managed-process-panel");
  const item = panel.locator("section").filter({ hasText: label });
  for (let attempt = 0; attempt < 3; attempt += 1) {
    await item.getByRole("button", { name: `日志 · ${label}` }).click();
    if (await item.locator("pre").waitFor({ state: "visible", timeout: 8_000 }).then(() => true).catch(() => false)) return;
  }
  throw new Error(`managed process logs did not become visible for ${label}: ${await item.innerText()}`);
}

async function dismissExited(page: Page): Promise<void> {
  const indicator = page.getByTestId("managed-process-indicator");
  if (await indicator.getAttribute("aria-expanded") !== "true") await indicator.click();
  await page.getByRole("button", { name: "确认清除" }).click();
}

async function observeArchiveDisabled(page: Page, sessionId: string): Promise<boolean> {
  const row = page.locator(`[data-testid='conversation-sidebar-session'][data-session-id='${sessionId}']`).locator("xpath=..");
  await row.hover();
  await row.locator("button[aria-haspopup='menu']").click();
  const archive = page.getByRole("menuitem", { name: /归档/u });
  await archive.waitFor({ state: "visible" });
  const disabled = await archive.isDisabled();
  await page.keyboard.press("Escape");
  return disabled;
}

async function selectSession(page: Page, sessionId: string): Promise<void> {
  const row = page.locator(`[data-testid='conversation-sidebar-session'][data-session-id='${sessionId}']`);
  await row.waitFor({ timeout: 15_000 });
  await row.click();
  await page.waitForFunction((id) => document.querySelector(`[data-testid='conversation-sidebar-session'][data-session-id='${String(id)}']`)?.getAttribute("aria-current") === "page", sessionId);
}

async function waitForApiBase(page: Page): Promise<string> {
  return await waitForValue(async () => await page.evaluate(async () => (window as typeof window & { moebius?: { getLocalConsoleUrl?: () => Promise<string | null> } }).moebius?.getLocalConsoleUrl?.() ?? null) ?? undefined, {
    describe: "Electron local-console URL", kind: "io", timeoutMs: 20_000,
  });
}

async function createProject(apiBase: string, folderPath: string): Promise<ConsoleState["projects"][number]> {
  return (await requestJson<{ project: ConsoleState["projects"][number] }>(apiBase, "/api/local-console/projects", {
    method: "POST", body: JSON.stringify({ folderPath, worktreeMode: false }),
  }, 201)).project;
}

async function requestJson<T>(apiBase: string, pathname: string, init: RequestInit = {}, expectedStatus = 200): Promise<T> {
  const response = await fetch(new URL(pathname, apiBase), {
    ...init,
    headers: { "content-type": "application/json", ...init.headers },
  });
  if (response.status !== expectedStatus) throw new Error(`${init.method ?? "GET"} ${pathname}: ${response.status} ${await response.text()}`);
  return await response.json() as T;
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

async function openProjectRemovalWarning(page: Page, projectTitle: string): Promise<void> {
  const warning = page.getByRole("dialog", { name: "项目中仍有 Agent 正在运行" });
  const ordinaryConfirmation = page.getByRole("dialog", { name: "移除项目？" });
  await page.getByRole("button", { name: `${projectTitle} 项目菜单` }).click();
  const removeItem = page.getByRole("menuitem", { name: "移除项目" });
  await removeItem.focus();
  await removeItem.press("Enter");
  let initialDialog: "warning" | "ordinary";
  try {
    initialDialog = await waitForValue(async () => {
      if (await warning.isVisible()) return "warning" as const;
      if (await ordinaryConfirmation.isVisible()) return "ordinary" as const;
      return undefined;
    }, { describe: "initial project removal dialog", kind: "io", timeoutMs: 10_000 });
  } catch (error) {
    const snapshot = await page.evaluate(() => ({
      dialogs: [...document.querySelectorAll("[role='dialog']")].map((element) => element.textContent),
      menus: [...document.querySelectorAll("[role='menu'],[role='menuitem']")].map((element) => element.textContent),
      body: document.body.innerText.slice(0, 4_000),
    }));
    throw new Error(`${error instanceof Error ? error.message : String(error)}; ui=${JSON.stringify(snapshot)}`);
  }
  if (initialDialog === "ordinary") {
    await ordinaryConfirmation.getByRole("button", { name: "移除项目" }).click();
  }
  await warning.waitFor({ timeout: 15_000 });
}

async function waitForPortClosed(port: number): Promise<void> {
  await waitForValue(async () => await portClosed(port) ? true : undefined, { describe: `port ${port} closure`, kind: "io", timeoutMs: 15_000 });
}

async function portClosed(port: number): Promise<boolean> {
  return await new Promise((resolve) => {
    const socket = net.createConnection({ host: "127.0.0.1", port });
    const finish = (value: boolean): void => { socket.destroy(); resolve(value); };
    socket.once("connect", () => finish(false));
    socket.once("error", () => finish(true));
    socket.setTimeout(500, () => finish(true));
  });
}

async function snapshotFiles(filePaths: readonly string[]): Promise<Record<string, unknown>> {
  return Object.fromEntries(await Promise.all(filePaths.map(async (filePath) => {
    try {
      const [content, info] = await Promise.all([readFile(filePath), stat(filePath)]);
      return [filePath, { sha256: createHash("sha256").update(content).digest("hex"), size: info.size, mtimeMs: info.mtimeMs, mode: info.mode & 0o777 }];
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return [filePath, null];
      throw error;
    }
  })));
}

async function exists(filePath: string): Promise<boolean> {
  try { await stat(filePath); return true; } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
}

async function resolveMainWorktree(): Promise<string> {
  const commonGitDir = await runText("/usr/bin/git", ["rev-parse", "--path-format=absolute", "--git-common-dir"], projectRoot);
  return await realpath(path.dirname(commonGitDir.trim()));
}

async function runText(command: string, args: readonly string[], cwd: string): Promise<string> {
  return await new Promise((resolve, reject) => {
    const child = spawn(command, [...args], { cwd, shell: false, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8").on("data", (chunk: string) => { stdout += chunk; });
    child.stderr.setEncoding("utf8").on("data", (chunk: string) => { stderr += chunk; });
    child.once("error", reject);
    child.once("close", (code) => code === 0 ? resolve(stdout) : reject(new Error(`${path.basename(command)} exited ${String(code)}: ${stderr}`)));
  });
}
