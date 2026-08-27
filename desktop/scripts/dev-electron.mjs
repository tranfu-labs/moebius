#!/usr/bin/env node
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const desktopRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const electronExecutable = path.join(desktopRoot, "node_modules", ".bin", "electron");

await run("pnpm", ["build"], { cwd: desktopRoot, env: process.env });

// The managed-process supervisor reserves ELECTRON_RUN_AS_NODE for its own
// Node-compatible children. Electron must not inherit it, or it starts as
// plain Node and cannot expose Electron's BrowserWindow/app runtime.
const electronEnvironment = { ...process.env };
delete electronEnvironment.ELECTRON_RUN_AS_NODE;

const electron = spawn(electronExecutable, ["."], {
  cwd: desktopRoot,
  env: electronEnvironment,
  stdio: "inherit",
});

let shuttingDown = false;
const shutdown = (signal) => {
  if (shuttingDown) return;
  shuttingDown = true;
  electron.kill(signal);
};

process.once("SIGINT", () => shutdown("SIGINT"));
process.once("SIGTERM", () => shutdown("SIGTERM"));

await new Promise((resolve, reject) => {
  electron.once("error", reject);
  electron.once("exit", (code, signal) => {
    if (signal !== null) {
      resolve(0);
      return;
    }
    resolve(code ?? 0);
  });
}).then((code) => {
  process.exitCode = Number(code);
});

function run(executable, args, options) {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, { ...options, stdio: "inherit" });
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (signal !== null) {
        reject(new Error(`${executable} terminated by ${signal}`));
        return;
      }
      if (code !== 0) {
        reject(new Error(`${executable} exited with code ${String(code)}`));
        return;
      }
      resolve();
    });
  });
}
