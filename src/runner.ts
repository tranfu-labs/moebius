import path from "node:path";
import { fileURLToPath } from "node:url";

import { PROJECT_ROOT } from "./config.js";
import { resolveMoebiusSkillProjectionHomeDir } from "./local-console/moebius-skill-registry.js";
import { startLocalConsoleServer, type StartedLocalConsoleServer } from "./local-console/start.js";
import { log } from "./log.js";

const RETIRED_GITHUB_MODE_FLAG = "--github-mode";

export interface StartedRuntime {
  mode: "local";
  close(): Promise<void>;
}

export interface StartDependencies {
  startLocalConsoleServer: (options?: Parameters<typeof startLocalConsoleServer>[0]) => Promise<StartedLocalConsoleServer>;
}

export interface StartOptions {
  argv?: readonly string[];
  dependencies?: Partial<StartDependencies>;
}

export function assertLocalOnlyArguments(argv: readonly string[]): void {
  const runtimeArgs = argv[0] === "--" ? argv.slice(1) : argv;
  if (runtimeArgs.length === 0) {
    return;
  }
  if (runtimeArgs.includes(RETIRED_GITHUB_MODE_FLAG)) {
    throw new Error('GitHub runner mode has been removed. Run "pnpm start" to start the local console.');
  }
  throw new Error(`Unknown startup arguments: ${runtimeArgs.join(" ")}`);
}

export async function start(options: StartOptions = {}): Promise<StartedRuntime> {
  assertLocalOnlyArguments(options.argv ?? process.argv.slice(2));
  const startServer = options.dependencies?.startLocalConsoleServer ?? startLocalConsoleServer;
  log({ event: "start", mode: "local" });
  const server = await startServer({
    skillSourceRoot: path.join(PROJECT_ROOT, ".agents", "skills"),
    skillProjectionHomeDir: resolveMoebiusSkillProjectionHomeDir(),
  });
  return {
    mode: "local",
    close: () => server.close(),
  };
}

export function isDirectRun(modulePath: string, argvPath: string | undefined): boolean {
  return argvPath !== undefined && path.basename(modulePath) === "runner.ts" && path.resolve(argvPath) === modulePath;
}

async function runCli(): Promise<void> {
  const runtime = await start();
  const close = (): void => {
    void runtime.close().catch((error) => {
      log({ event: "shutdown-failed", error: formatError(error) });
      process.exitCode = 1;
    });
  };
  process.once("SIGINT", close);
  process.once("SIGTERM", close);
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.stack ?? error.message : String(error);
}

if (isDirectRun(fileURLToPath(import.meta.url), process.argv[1])) {
  void runCli().catch((error) => {
    log({ event: "start-failed", error: formatError(error) });
    process.exitCode = 1;
  });
}
