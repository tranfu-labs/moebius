#!/usr/bin/env node
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { createHash } from "node:crypto";
import net from "node:net";

const here = dirname(fileURLToPath(import.meta.url));
const desktopRoot = resolve(here, "..");
const repoRoot = resolve(desktopRoot, "..");

const args = parseArgs(process.argv.slice(2));
const worktreeName = typeof args.worktree === "string" ? args.worktree : "main";
const stateDir = typeof args.stateDir === "string" ? args.stateDir : defaultStateDir(worktreeName);
mkdirSync(stateDir, { recursive: true });
const sessionLogRoot = resolve(stateDir, "sessions");
mkdirSync(sessionLogRoot, { recursive: true });
const workdirRoot = resolve(stateDir, "workdir");
mkdirSync(workdirRoot, { recursive: true });
const sqlitePath = resolve(stateDir, "local-console.sqlite");

const derived = derivePorts(worktreeName);
const apiPort = Number.isFinite(Number(args.apiPort)) ? Number(args.apiPort) : await findFreePort(derived.api);
const webPort = Number.isFinite(Number(args.webPort)) ? Number(args.webPort) : await findFreePort(derived.web, apiPort);

if (args.noBuild !== true) {
  console.log(`[web-shell] building console-ui...`);
  await run("pnpm", ["--filter", "@moebius/console-ui", "build"], { cwd: repoRoot });
}

console.log(`[web-shell] worktree=${worktreeName}`);
console.log(`[web-shell] state=${stateDir}`);
console.log(`[web-shell] api=http://127.0.0.1:${apiPort}`);
console.log(`[web-shell] web=http://127.0.0.1:${webPort}`);

const serverProc = spawn(
  "pnpm",
  ["exec", "tsx", resolve(desktopRoot, "scripts/console-server-standalone.ts")],
  {
    cwd: repoRoot,
    env: {
      ...process.env,
      WEB_SHELL_LOCAL_CONSOLE_HOST: "127.0.0.1",
      WEB_SHELL_LOCAL_CONSOLE_PORT: String(apiPort),
      WEB_SHELL_LOCAL_CONSOLE_DATA_ROOT: stateDir,
      WEB_SHELL_LOCAL_CONSOLE_SQLITE: sqlitePath,
      WEB_SHELL_LOCAL_CONSOLE_SESSION_LOG_ROOT: sessionLogRoot,
      WEB_SHELL_LOCAL_CONSOLE_WORKDIR: workdirRoot,
      WEB_SHELL_LOCAL_CONSOLE_PROJECT_ROOT: repoRoot,
    },
    stdio: "inherit",
  },
);

const viteProc = spawn(
  "pnpm",
  [
    "exec", "vite",
    "--config", resolve(desktopRoot, "web-shell/vite.config.ts"),
    "--host", "127.0.0.1",
    "--port", String(webPort),
  ],
  {
    cwd: desktopRoot,
    env: {
      ...process.env,
      VITE_LOCAL_CONSOLE_URL: `http://127.0.0.1:${apiPort}`,
      WEB_SHELL_PORT: String(webPort),
    },
    stdio: "inherit",
  },
);

let shuttingDown = false;
const cleanup = (code) => {
  if (shuttingDown) return;
  shuttingDown = true;
  serverProc.kill();
  viteProc.kill();
  process.exit(code ?? 0);
};

process.on("SIGINT", () => cleanup(0));
process.on("SIGTERM", () => cleanup(0));
serverProc.on("exit", (code) => cleanup(code ?? 0));
viteProc.on("exit", (code) => cleanup(code ?? 0));

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const key = argv[i];
    if (!key.startsWith("--")) continue;
    const raw = key.slice(2);
    const name = raw.replace(/-([a-z])/g, (_, c) => c.toUpperCase());
    const next = argv[i + 1];
    if (next !== undefined && !next.startsWith("--")) {
      out[name] = next;
      i++;
    } else {
      out[name] = true;
    }
  }
  return out;
}

function defaultStateDir(worktree) {
  return resolve(homedir(), "dev-loops", "moebius", "state", worktree);
}

function derivePorts(worktree) {
  if (worktree === "main") return { web: 5180, api: 5181 };
  const hash = parseInt(createHash("sha256").update(worktree).digest("hex").slice(0, 8), 16);
  const slot = hash % 50;
  const api = 5191 + slot * 2;
  const web = api - 1;
  return { web, api };
}

async function findFreePort(preferred, forbidden = null) {
  let port = preferred;
  while (port <= 65535) {
    if (port !== forbidden && (await isFree(port))) return port;
    port += 2;
  }
  throw new Error(`no free port near ${preferred}`);
}

function isFree(port) {
  return new Promise((resolvePromise) => {
    const s = net.createServer();
    s.once("error", () => resolvePromise(false));
    s.once("listening", () => s.close(() => resolvePromise(true)));
    s.listen(port, "127.0.0.1");
  });
}

function run(cmd, cmdArgs, options) {
  return new Promise((resolvePromise, rejectPromise) => {
    const p = spawn(cmd, cmdArgs, { stdio: "inherit", ...options });
    p.on("exit", (code) => (code === 0 ? resolvePromise() : rejectPromise(new Error(`${cmd} exited ${code}`))));
    p.on("error", rejectPromise);
  });
}
