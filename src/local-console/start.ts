import http from "node:http";
import { randomBytes } from "node:crypto";
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
}

export interface StartedLocalConsoleServer {
  server: http.Server;
  runtime: LocalConsoleRuntime;
  url: string;
  sqlitePath: string;
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
  await attachmentManager?.init();
  const attachmentCapability = planRuntimeFallback(
    options.attachmentCapability,
    randomBytes(32).toString("base64url"),
  );
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
  });
  await runtime.init();
  const server = createLocalConsoleHttpServer(runtime, attachmentManager, attachmentCapability);
  const { port } = await listenWithFallback(server, host, requestedPort);
  void runtime.processAllPending().catch((error) => {
    log({ event: "local-console-startup-catch-up-failed", error: formatLocalError(error) });
  });
  const url = `http://${host}:${String(port)}/`;
  log({ event: "local-console-started", url, sqlitePath: store.sqlitePath });
  return {
    server,
    runtime,
    url,
    sqlitePath: store.sqlitePath,
    async close() {
      await closeLocalConsoleHttpServer(server);
      await runtime.close();
    },
  };
}
