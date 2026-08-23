import { chmod, stat } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";

import { spawn, type IPty } from "node-pty";

import type {
  ClaudeTuiPty,
  ClaudeTuiPtyFactory,
  ClaudeTuiPtySpawnOptions,
  ClaudeTuiTerminalData,
} from "./claude-tui-transport.js";

const require = createRequire(import.meta.url);

export async function createNodePtyFactory(): Promise<ClaudeTuiPtyFactory> {
  await ensureNodePtySpawnHelperExecutable();
  return {
    spawn(options) {
      return wrapNodePty(spawn(options.executable, [...options.args], {
        cwd: options.cwd,
        env: options.env,
        cols: options.columns,
        rows: options.rows,
        name: "xterm-256color",
        encoding: null,
      }));
    },
  };
}

export async function ensureNodePtySpawnHelperExecutable(): Promise<string | null> {
  if (process.platform === "win32") return null;
  const packageRoot = path.dirname(require.resolve("node-pty/package.json"));
  const helperPath = path.join(
    packageRoot,
    "prebuilds",
    `${process.platform}-${process.arch}`,
    "spawn-helper",
  )
    .replace("app.asar", "app.asar.unpacked")
    .replace("node_modules.asar", "node_modules.asar.unpacked");
  const details = await stat(helperPath);
  if (!details.isFile()) {
    throw new Error("node-pty-spawn-helper-not-a-file");
  }
  if ((details.mode & 0o111) === 0) {
    await chmod(helperPath, details.mode | 0o111);
  }
  return helperPath;
}

function wrapNodePty(pty: IPty): ClaudeTuiPty {
  return {
    write(data) {
      pty.write(data);
    },
    resize(columns, rows) {
      pty.resize(columns, rows);
    },
    kill(signal) {
      pty.kill(signal);
    },
    onData(listener) {
      return pty.onData((value) => {
        listener(normalizeTerminalData(value));
      });
    },
    onExit(listener) {
      return pty.onExit(listener);
    },
  };
}

function normalizeTerminalData(value: unknown): ClaudeTuiTerminalData {
  if (typeof value === "string") return value;
  if (value instanceof Uint8Array) return new Uint8Array(value);
  throw new Error("node-pty-returned-unsupported-terminal-data");
}
