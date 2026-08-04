import { createHash, randomBytes } from "node:crypto";
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { mkdir, mkdtemp, readFile, readdir, realpath, stat, unlink, writeFile } from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";

import { createLocalExecutionRunner, type ManagedProcessMcpInvocation } from "../../src/local-console/execution-driver.js";
import { LaunchdManagedProcessAdapter } from "../../src/local-console/managed-process-launchd-adapter.js";
import { preflightManagedProcessMcpServer } from "../../src/local-console/managed-process-mcp-preflight.js";
import { ManagedProcessSupervisor } from "../../src/local-console/managed-process-supervisor.js";
import { MANAGED_PROCESS_RUNTIME_CONTRACT } from "../../src/local-console/prompt.js";
import type { LocalConsoleExecutionProfile } from "../../src/local-console/types.js";
import { waitForValue } from "../../src/testing/wait.js";

const root = await mkdtemp(path.join(os.tmpdir(), "moebius-managed-provider-acceptance-"));
const workspace = await resolveMainWorktree();
const dataRoot = path.join(root, "data");
await mkdir(dataRoot);

const require = createRequire(import.meta.url);
const tsxCli = require.resolve("tsx/cli");
const wrapperPath = path.resolve("src/local-console/managed-process-wrapper.ts");
const bridgePath = path.resolve("src/local-console/managed-process-mcp-bridge.ts");
const supervisor = new ManagedProcessSupervisor({
  adapter: new LaunchdManagedProcessAdapter({
    dataRoot,
    wrapperProgram: process.execPath,
    wrapperProgramArgs: [tsxCli, wrapperPath],
  }),
  socketPath: path.join(root, "managed.sock"),
});
await supervisor.init();

const evidence: Record<string, unknown> = {
  root,
  environment: { platform: process.platform, node: process.version },
  providers: {},
};

const runner = createLocalExecutionRunner({
  dataRoot,
  createManagedProcessMcp: async ({ sessionId, providerRunId, workspaceRoot }): Promise<ManagedProcessMcpInvocation> => {
    const capability = supervisor.createCapability({ sessionId, providerRunId, workspaceRoot });
    const capabilityPath = path.join(root, `${providerRunId}-${randomBytes(8).toString("hex")}.token`);
    await writeFile(capabilityPath, capability.token, { encoding: "utf8", mode: 0o600, flag: "wx" });
    const invocation = {
      command: process.execPath,
      args: [tsxCli, bridgePath, capability.socketPath, capabilityPath],
      env: {},
    };
    return {
      ...invocation,
      preflight: async () => preflightManagedProcessMcpServer(invocation),
      onToolCompletion: (listener) => supervisor.onToolCompletion(providerRunId, listener),
      close: async () => {
        supervisor.revokeCapability(capability.token);
        await unlink(capabilityPath).catch(() => undefined);
      },
    };
  },
});

const providers: Array<{ engine: "codex" | "claude" | "kimi"; profile: LocalConsoleExecutionProfile | null }> = [
  { engine: "codex", profile: null },
  { engine: "claude", profile: { cli: "claude", model: "fable", effort: "high" } },
  { engine: "kimi", profile: { cli: "kimi", model: "kimi-code/k3", effort: "high" } },
];
const providerArgumentIndex = process.argv.indexOf("--provider");
const requestedProvider = providerArgumentIndex < 0 ? undefined : process.argv[providerArgumentIndex + 1];
const selectedProviders = requestedProvider === undefined
  ? providers
  : providers.filter((provider) => provider.engine === requestedProvider);
if (selectedProviders.length === 0) throw new Error(`unknown provider ${String(requestedProvider)}`);
const providerConfigPaths: Record<(typeof providers)[number]["engine"], string[]> = {
  codex: [path.join(os.homedir(), ".codex", "config.toml")],
  claude: [path.join(os.homedir(), ".claude", "settings.json")],
  kimi: [path.join(os.homedir(), ".kimi", "config.toml")],
};
const configPaths = [...new Set(selectedProviders.flatMap((provider) => providerConfigPaths[provider.engine]))];
const beforeConfigs = await snapshotFiles(configPaths);
const beforeClaudeMcpRegistry = selectedProviders.some((provider) => provider.engine === "claude")
  ? await snapshotClaudeMcpRegistry()
  : null;

try {
  for (const provider of selectedProviders) {
    process.stderr.write(`[managed-provider] ${provider.engine}: full\n`);
    const sessionId = `acceptance-${provider.engine}`;
    const port = await freePort();
    const firstRunDir = path.join(root, `run-${provider.engine}-1`);
    await mkdir(firstRunDir);
    const firstStartedAt = Date.now();
    const first = await runner({
      prompt: providerPrompt(provider.engine, port, false),
      runDir: firstRunDir,
      cwd: workspace,
      profile: provider.profile,
      mode: { kind: "full" },
      managedProcess: { sessionId, providerRunId: `${provider.engine}-run-1` },
      idleTimeoutMs: 60_000,
      toolTimeoutMs: 60_000,
      maxDurationMs: 180_000,
    });
    await assertInvocationCleanup(`${provider.engine}-run-1`);
    const firstDurationMs = Date.now() - firstStartedAt;
    const ready = await waitForValue(async () => {
      const item = (await supervisor.list(sessionId)).find((candidate) => candidate.label === `${provider.engine} acceptance server`);
      return item?.state === "ready" ? item : undefined;
    }, { describe: `${provider.engine} managed service readiness`, kind: "io" });
    const httpStatus = await fetch(`http://127.0.0.1:${port}/`).then((response) => response.status);
    const secondRunDir = path.join(root, `run-${provider.engine}-2`);
    await mkdir(secondRunDir);
    process.stderr.write(`[managed-provider] ${provider.engine}: resume\n`);
    const secondStartedAt = Date.now();
    const second = first.threadId === null ? null : await runner({
      prompt: providerPrompt(provider.engine, port, true),
      runDir: secondRunDir,
      cwd: workspace,
      profile: provider.profile,
      mode: { kind: "resume", externalSessionId: first.threadId },
      managedProcess: { sessionId, providerRunId: `${provider.engine}-run-2` },
      idleTimeoutMs: 60_000,
      toolTimeoutMs: 60_000,
      maxDurationMs: 180_000,
    });
    await assertInvocationCleanup(`${provider.engine}-run-2`);
    const secondDurationMs = Date.now() - secondStartedAt;
    const afterResume = (await supervisor.list(sessionId)).find((candidate) => candidate.id === ready.id);
    if (afterResume === undefined || afterResume.targetPid !== ready.targetPid) throw new Error(`${provider.engine} did not retain the same managed item across resume`);
    const stopped = await supervisor.stop(sessionId, ready.id);
    await waitForValue(async () => await portClosed(port) ? true : undefined, { describe: `${provider.engine} managed port closure`, kind: "io" });
    (evidence.providers as Record<string, unknown>)[provider.engine] = {
      first: { ok: first.ok, threadId: first.threadId, reason: first.ok ? null : first.reason, durationMs: firstDurationMs },
      resume: second === null ? null : { ok: second.ok, threadId: second.threadId, reason: second.ok ? null : second.reason, durationMs: secondDurationMs },
      processId: ready.id,
      wrapperPid: ready.wrapperPid,
      targetPid: ready.targetPid,
      stateAfterResume: afterResume.state,
      httpStatus,
      stoppedState: stopped.state,
      portClosed: true,
      temporaryClaudeMcpRemoved: provider.engine !== "claude" || !(await exists(path.join(firstRunDir, "managed-process-mcp.json"))) && !(await exists(path.join(secondRunDir, "managed-process-mcp.json"))),
    };
    await supervisor.acknowledgeExited(sessionId);
    if (provider.engine !== "kimi" && (!first.ok || second?.ok !== true)) {
      throw new Error(`${provider.engine} provider turn did not complete successfully`);
    }
  }
  const afterConfigs = await snapshotFiles(configPaths);
  const afterClaudeMcpRegistry = beforeClaudeMcpRegistry === null ? null : await snapshotClaudeMcpRegistry();
  evidence.claudeUserMcpRegistryUnchanged = beforeClaudeMcpRegistry === afterClaudeMcpRegistry;
  evidence.userGlobalConfigsUnchanged = configPaths.every((filePath) => sameFileContents(beforeConfigs[filePath], afterConfigs[filePath]))
    && beforeClaudeMcpRegistry === afterClaudeMcpRegistry;
  evidence.userGlobalConfigMetadataUnchanged = JSON.stringify(beforeConfigs) === JSON.stringify(afterConfigs);
  evidence.userGlobalConfigFacts = Object.fromEntries(configPaths.map((filePath) => [filePath, {
    contentUnchanged: sameFileContents(beforeConfigs[filePath], afterConfigs[filePath]),
    metadataUnchanged: JSON.stringify(beforeConfigs[filePath]) === JSON.stringify(afterConfigs[filePath]),
    before: beforeConfigs[filePath],
    after: afterConfigs[filePath],
  }]));
  const evidencePath = path.join(root, "evidence.json");
  await writeFile(evidencePath, JSON.stringify(evidence, null, 2), "utf8");
  if (evidence.userGlobalConfigsUnchanged !== true) {
    process.stderr.write(`${JSON.stringify({ evidencePath, userGlobalConfigFacts: evidence.userGlobalConfigFacts })}\n`);
    throw new Error("a user-global provider config changed during acceptance");
  }
  process.stdout.write(`${JSON.stringify({ ok: true, evidencePath, evidence })}\n`);
} finally {
  await supervisor.close().catch(() => undefined);
  if (await exists(path.join(root, "managed.sock"))) throw new Error("managed supervisor socket remained after close");
}

async function assertInvocationCleanup(providerRunId: string): Promise<void> {
  await waitForValue(async () => {
    const tokens = (await readdir(root)).filter((entry) => entry.endsWith(".token"));
    const bridgeProcesses = (await processTable()).filter((entry) =>
      entry.includes("managed-process-mcp-bridge") && entry.includes(root));
    return tokens.length === 0 && bridgeProcesses.length === 0 ? true : undefined;
  }, {
    describe: `${providerRunId} bridge and capability cleanup`,
    kind: "io",
    timeoutMs: 15_000,
  });
}

async function processTable(): Promise<string[]> {
  return await new Promise((resolve, reject) => {
    const child = spawn("/bin/ps", ["-axo", "command="], { shell: false, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8").on("data", (chunk: string) => { stdout += chunk; });
    child.stderr.setEncoding("utf8").on("data", (chunk: string) => { stderr += chunk; });
    child.once("error", reject);
    child.once("close", (code) => code === 0 ? resolve(stdout.split("\n").filter(Boolean)) : reject(new Error(stderr)));
  });
}

function providerPrompt(engine: string, port: number, resume: boolean): string {
  const request = resume
    ? "Call managed_process_list and managed_process_inspect for the existing item. Do not start or stop anything, and do not use a terminal. Then report its id and state."
    : `Call managed_process_start exactly once with kind=service, label=${JSON.stringify(`${engine} acceptance server`)}, executable=python3, args=["-m","http.server","${port}","--bind","127.0.0.1"], cwd=".", readiness={"type":"tcp","host":"127.0.0.1","port":${port}}, endpoint={"url":"http://127.0.0.1:${port}/"}. Do not use a terminal. Then report the returned id.`;
  return `${request}\n\n${MANAGED_PROCESS_RUNTIME_CONTRACT}`;
}

async function snapshotFiles(filePaths: readonly string[]): Promise<Record<string, null | { sha256: string; size: number; mtimeMs: number; mode: number }>> {
  return Object.fromEntries(await Promise.all(filePaths.map(async (filePath) => {
    try {
      const [content, info] = await Promise.all([readFile(filePath), stat(filePath)]);
      return [filePath, { sha256: createHash("sha256").update(content).digest("hex"), size: info.size, mtimeMs: info.mtimeMs, mode: info.mode & 0o777 }] as const;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return [filePath, null] as const;
      throw error;
    }
  })));
}

function sameFileContents(
  before: null | { sha256: string; size: number; mode: number } | undefined,
  after: null | { sha256: string; size: number; mode: number } | undefined,
): boolean {
  if (before === null || before === undefined || after === null || after === undefined) return before === after;
  return before.sha256 === after.sha256 && before.size === after.size && before.mode === after.mode;
}

async function snapshotClaudeMcpRegistry(): Promise<string> {
  const configPath = path.join(os.homedir(), ".claude.json");
  try {
    const parsed = JSON.parse(await readFile(configPath, "utf8")) as unknown;
    const registries: unknown[] = [];
    const visit = (value: unknown): void => {
      if (value === null || typeof value !== "object") return;
      if (Array.isArray(value)) {
        for (const entry of value) visit(entry);
        return;
      }
      for (const [key, entry] of Object.entries(value)) {
        if (key === "mcpServers") registries.push(entry);
        else visit(entry);
      }
    };
    visit(parsed);
    return createHash("sha256").update(JSON.stringify(registries)).digest("hex");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return "absent";
    throw error;
  }
}

async function freePort(): Promise<number> {
  return await new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (address === null || typeof address === "string") { reject(new Error("failed to allocate port")); return; }
      server.close((error) => error === undefined ? resolve(address.port) : reject(error));
    });
  });
}

async function portClosed(port: number): Promise<boolean> {
  return await new Promise((resolve) => {
    const socket = net.createConnection({ host: "127.0.0.1", port });
    const finish = (closed: boolean) => { socket.destroy(); resolve(closed); };
    socket.setTimeout(500, () => finish(true));
    socket.once("connect", () => finish(false));
    socket.once("error", () => finish(true));
  });
}

async function exists(filePath: string): Promise<boolean> {
  try { await stat(filePath); return true; } catch { return false; }
}

async function resolveMainWorktree(): Promise<string> {
  const commonGitDir = await new Promise<string>((resolve, reject) => {
    const child = spawn("/usr/bin/git", ["rev-parse", "--path-format=absolute", "--git-common-dir"], {
      cwd: path.resolve("."),
      shell: false,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8").on("data", (chunk: string) => { stdout += chunk; });
    child.stderr.setEncoding("utf8").on("data", (chunk: string) => { stderr += chunk; });
    child.once("error", reject);
    child.once("close", (code) => code === 0 ? resolve(stdout.trim()) : reject(new Error(`git common dir failed: ${stderr.trim()}`)));
  });
  return await realpath(path.dirname(commonGitDir));
}
