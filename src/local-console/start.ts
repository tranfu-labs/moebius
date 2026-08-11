import http from "node:http";
import { createHash, randomBytes } from "node:crypto";
import { createRequire } from "node:module";
import { existsSync } from "node:fs";
import { mkdir, readdir, unlink, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import {
  DATA_ROOT,
  LOCAL_CONSOLE_HOST,
  LOCAL_CONSOLE_PORT,
  LOCAL_CONSOLE_SQLITE_BUSY_TIMEOUT_MS,
  LOCAL_CONSOLE_SQLITE_PATH,
  LOCAL_CONSOLE_SESSION_LOG_ROOT,
  LOCAL_CONSOLE_STORE_TIMEOUT_MS,
  LOCAL_RUN_IDLE_TIMEOUT_MS,
  LOCAL_TOOL_IN_FLIGHT_TIMEOUT_MS,
  PROJECT_ROOT,
} from "../config.js";
import { run as runCodex } from "../codex.js";
import { log } from "../log.js";
import {
  LocalAttachmentManager,
  supportsManagedAttachments,
} from "./attachments.js";
import type { LocalRouteJudgment } from "./route-bus.js";
import {
  createLocalConsoleHttpServer,
  listLocalAgentFiles,
  makeLocalConsoleRunDir,
  closeLocalConsoleHttpServer,
  listenWithFallback,
} from "./server.js";
import { createSqliteLocalConsoleStore } from "./store.js";
import type { LocalConsoleStore } from "./types.js";
import {
  LocalConsoleRuntime,
  type LocalConsoleAgentFile,
  type LocalConsoleRuntimeOptions,
} from "./runtime.js";
import { formatLocalError, planRuntimeFallback } from "./runtime-domain.js";
import { LaunchdManagedProcessAdapter } from "./managed-process-launchd-adapter.js";
import { ManagedProcessSupervisor } from "./managed-process-supervisor.js";
import { preflightManagedProcessMcpServer } from "./managed-process-mcp-preflight.js";
import type { ManagedProcessMcpInvocation } from "./execution-driver.js";

export interface LocalConsoleServerOptions {
  host?: string;
  port?: number;
  dataRoot?: string;
  projectRoot?: string;
  workdirRoot?: string;
  store?: LocalConsoleStore;
  sqlitePath?: string;
  sessionLogRoot?: string;
  listAgentFiles?: (sessionId: string) => Promise<LocalConsoleAgentFile[]>;
  loadAgentTeamSnapshot?: LocalConsoleRuntimeOptions["loadAgentTeamSnapshot"];
  resolveAgentTeamHealth?: LocalConsoleRuntimeOptions["resolveAgentTeamHealth"];
  runCodex?: typeof runCodex;
  runExecution?: LocalConsoleRuntimeOptions["runExecution"];
  runPi?: LocalConsoleRuntimeOptions["runPi"];
  makeRunDir?: (count: number, now?: Date) => string;
  storeTimeoutMs?: number;
  sqliteBusyTimeoutMs?: number;
  codexIdleTimeoutMs?: number;
  toolInFlightTimeoutMs?: number;
  codexMaxDurationMs?: number;
  workspaceGitTimeoutMs?: number;
  routeJudgment?: LocalRouteJudgment;
  routeTimeoutMs?: number;
  failureRetryLimit?: number;
  isCodexThreadAvailable?: LocalConsoleRuntimeOptions["isCodexThreadAvailable"];
  attachmentRoot?: string;
  attachmentCapability?: string;
  managedProcessSupervisor?: ManagedProcessSupervisor;
}

export interface StartedLocalConsoleServer {
  server: http.Server;
  runtime: LocalConsoleRuntime;
  managedProcessSupervisor: ManagedProcessSupervisor;
  url: string;
  sqlitePath: string;
  stopRunningTasks(): Promise<void>;
  close(): Promise<void>;
}

export async function startLocalConsoleServer(
  options: LocalConsoleServerOptions = {},
): Promise<StartedLocalConsoleServer> {
  const host = planRuntimeFallback(options.host, LOCAL_CONSOLE_HOST);
  const requestedPort = planRuntimeFallback(options.port, LOCAL_CONSOLE_PORT);
  const projectRoot = planRuntimeFallback(options.projectRoot, PROJECT_ROOT);
  const dataRoot = planRuntimeFallback(
    options.dataRoot,
    options.projectRoot === undefined ? DATA_ROOT : projectRoot,
  );
  const workdirRoot = planRuntimeFallback(options.workdirRoot, path.join(projectRoot, "workdir"));
  const sqlitePath = planRuntimeFallback(
    options.sqlitePath,
    options.projectRoot === undefined
      ? LOCAL_CONSOLE_SQLITE_PATH
      : path.join(projectRoot, ".state", "local-console.sqlite"),
  );
  const store = options.store ?? (await createSqliteLocalConsoleStore({
    sqlitePath,
    sessionLogRoot: planRuntimeFallback(
      options.sessionLogRoot,
      options.projectRoot === undefined ? LOCAL_CONSOLE_SESSION_LOG_ROOT : path.join(projectRoot, "sessions"),
    ),
    busyTimeoutMs: planRuntimeFallback(options.sqliteBusyTimeoutMs, LOCAL_CONSOLE_SQLITE_BUSY_TIMEOUT_MS),
    timeoutMs: planRuntimeFallback(options.storeTimeoutMs, LOCAL_CONSOLE_STORE_TIMEOUT_MS),
  }));
  const attachmentManager = supportsManagedAttachments(store)
    ? new LocalAttachmentManager(
        planRuntimeFallback(options.attachmentRoot, path.join(path.dirname(sqlitePath), "local-console-attachments")),
        store,
      )
    : undefined;
  try {
    await attachmentManager?.init();
  } catch (error) {
    await store.close().catch(() => undefined);
    throw error;
  }
  const attachmentCapability = planRuntimeFallback(
    options.attachmentCapability,
    randomBytes(32).toString("base64url"),
  );
  const managedPrograms = resolveManagedProcessPrograms();
  const managedCapabilityRoot = path.join(dataRoot, ".state", "managed-process-capabilities");
  try {
    await resetManagedProcessCapabilityRoot(managedCapabilityRoot);
  } catch (error) {
    await store.close().catch(() => undefined);
    throw error;
  }
  const managedProcessSupervisor = options.managedProcessSupervisor ?? new ManagedProcessSupervisor({
    adapter: new LaunchdManagedProcessAdapter({
      dataRoot,
      wrapperProgram: managedPrograms.command,
      wrapperProgramArgs: managedPrograms.wrapperArgs,
      wrapperEnvironment: managedPrograms.environment,
    }),
    socketPath: path.join(
      "/tmp",
      `moebius-managed-${createHash("sha256").update(dataRoot).digest("hex").slice(0, 20)}.sock`,
    ),
  });
  try {
    await managedProcessSupervisor.init();
  } catch (error) {
    await store.close().catch(() => undefined);
    throw error;
  }
  for (const blocked of managedProcessSupervisor.getReconciliationBlocked()) {
    log({ event: "managed-process-reconciliation-blocked", processId: blocked.processId, code: blocked.code });
  }
  const runtime = new LocalConsoleRuntime({
    store,
    listAgentFiles: planRuntimeFallback(
      options.listAgentFiles,
      () => listLocalAgentFiles(path.join(projectRoot, "agents")),
    ),
    loadAgentTeamSnapshot: options.loadAgentTeamSnapshot,
    resolveAgentTeamHealth: options.resolveAgentTeamHealth,
    runCodex: planRuntimeFallback(options.runCodex, runCodex),
    runExecution: options.runExecution,
    runPi: options.runPi,
    makeRunDir: planRuntimeFallback(options.makeRunDir, makeLocalConsoleRunDir),
    dataRoot,
    projectRoot,
    workdirRoot,
    storeTimeoutMs: planRuntimeFallback(options.storeTimeoutMs, LOCAL_CONSOLE_STORE_TIMEOUT_MS),
    codexIdleTimeoutMs: planRuntimeFallback(options.codexIdleTimeoutMs, LOCAL_RUN_IDLE_TIMEOUT_MS),
    toolInFlightTimeoutMs: planRuntimeFallback(options.toolInFlightTimeoutMs, LOCAL_TOOL_IN_FLIGHT_TIMEOUT_MS),
    codexMaxDurationMs: options.codexMaxDurationMs,
    workspaceGitTimeoutMs: options.workspaceGitTimeoutMs,
    routeJudgment: options.routeJudgment,
    routeTimeoutMs: options.routeTimeoutMs,
    failureRetryLimit: options.failureRetryLimit,
    isCodexThreadAvailable: options.isCodexThreadAvailable,
    attachmentManager,
    createManagedProcessMcp: options.runCodex !== undefined || options.runExecution !== undefined ? undefined : async ({ sessionId, providerRunId, workspaceRoot }) => {
      const capability = managedProcessSupervisor.createCapability({ sessionId, providerRunId, workspaceRoot });
      const capabilityPath = path.join(managedCapabilityRoot, `${createHash("sha256").update(providerRunId).digest("hex").slice(0, 16)}-${randomBytes(12).toString("hex")}.token`);
      try {
        await writeFile(capabilityPath, capability.token, { encoding: "utf8", mode: 0o600, flag: "wx" });
      } catch (error) {
        managedProcessSupervisor.revokeCapability(capability.token);
        throw error;
      }
      const invocation: Omit<ManagedProcessMcpInvocation, "preflight"> = {
        command: managedPrograms.command,
        args: [...managedPrograms.bridgeArgs, capability.socketPath, capabilityPath],
        env: managedPrograms.environment,
        onToolCompletion: (listener) => managedProcessSupervisor.onToolCompletion(providerRunId, listener),
        close: async () => {
          managedProcessSupervisor.revokeCapability(capability.token);
          await unlink(capabilityPath).catch(() => undefined);
        },
      };
      return {
        ...invocation,
        preflight: async () => preflightManagedProcessMcpServer(invocation),
      };
    },
    getManagedProcessRunningCount: () => managedProcessSupervisor.getRunningCount(),
    beforeStoreClose: () => managedProcessSupervisor.close(),
  });
  let server: http.Server;
  let port: number;
  try {
    await runtime.init();
    server = createLocalConsoleHttpServer(runtime, attachmentManager, attachmentCapability, managedProcessSupervisor);
    ({ port } = await listenWithFallback(server, host, requestedPort));
  } catch (error) {
    await managedProcessSupervisor.close().catch(() => undefined);
    await store.close().catch(() => undefined);
    throw error;
  }
  void runtime.processAllPending().catch((error) => {
    log({ event: "local-console-startup-catch-up-failed", error: formatLocalError(error) });
  });
  const url = `http://${host}:${String(port)}/`;
  log({ event: "local-console-started", url, sqlitePath: store.sqlitePath });
  return {
    server,
    runtime,
    managedProcessSupervisor,
    url,
    sqlitePath: store.sqlitePath,
    stopRunningTasks: () => runtime.stopRunningTasks(),
    async close() {
      await runtime.close();
      await closeLocalConsoleHttpServer(server);
    },
  };
}

async function resetManagedProcessCapabilityRoot(root: string): Promise<void> {
  await mkdir(root, { recursive: true, mode: 0o700 });
  const entries = await readdir(root, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith(".token")) {
      throw new Error("managed process capability directory contains an unexpected entry");
    }
    await unlink(path.join(root, entry.name));
  }
}

function resolveManagedProcessPrograms(): {
  command: string;
  wrapperArgs: string[];
  bridgeArgs: string[];
  environment: Record<string, string>;
} {
  const moduleDir = path.dirname(fileURLToPath(import.meta.url));
  const wrapperJs = path.join(moduleDir, "managed-process-wrapper.js");
  const bridgeJs = path.join(moduleDir, "managed-process-mcp-bridge.js");
  if (existsSync(wrapperJs) && existsSync(bridgeJs)) {
    return {
      command: process.execPath,
      wrapperArgs: [wrapperJs],
      bridgeArgs: [bridgeJs],
      environment: { ELECTRON_RUN_AS_NODE: "1", PATH: process.env.PATH ?? "/usr/bin:/bin" },
    };
  }
  const require = createRequire(import.meta.url);
  const tsxCli = require.resolve("tsx/cli");
  return {
    command: process.execPath,
    wrapperArgs: [tsxCli, path.join(moduleDir, "managed-process-wrapper.ts")],
    bridgeArgs: [tsxCli, path.join(moduleDir, "managed-process-mcp-bridge.ts")],
    environment: { PATH: process.env.PATH ?? "/usr/bin:/bin" },
  };
}
