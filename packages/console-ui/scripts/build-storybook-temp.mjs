#!/usr/bin/env node

import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outputDirectory = await fs.mkdtemp(
  path.join(os.tmpdir(), "moebius-console-ui-storybook-"),
);
const pnpm = process.platform === "win32" ? "pnpm.cmd" : "pnpm";

const exitCode = await new Promise((resolve, reject) => {
  const child = spawn(
    pnpm,
    ["exec", "storybook", "build", "--output-dir", outputDirectory],
    {
      cwd: packageRoot,
      shell: false,
      stdio: "inherit",
    },
  );
  child.once("error", reject);
  child.once("exit", (code, signal) => {
    if (signal) {
      reject(new Error(`Storybook build terminated by signal ${signal}`));
      return;
    }
    resolve(code ?? 1);
  });
});

if (exitCode !== 0) {
  process.exitCode = exitCode;
} else {
  process.stdout.write(`storybook-output: ${outputDirectory}\n`);
}
