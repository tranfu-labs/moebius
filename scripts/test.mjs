#!/usr/bin/env node

import { spawnSync } from "node:child_process";

const args = process.argv.slice(2);
const pnpm = process.platform === "win32" ? "pnpm.cmd" : "pnpm";

function run(commandArgs) {
  const result = spawnSync(pnpm, commandArgs, {
    stdio: "inherit",
    shell: false,
  });

  if (result.error) {
    console.error(result.error.message);
    process.exit(1);
  }

  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

if (args.length > 0) {
  run(["exec", "vitest", "run", ...args]);
} else {
  run(["exec", "vitest", "run", "--exclude", "tests/local-console.test.ts"]);
  run([
    "exec",
    "vitest",
    "run",
    "tests/local-console.test.ts",
    "--maxWorkers=1",
    "--no-file-parallelism",
  ]);
  run(["--filter", "@moebius/desktop", "test"]);
  run(["--filter", "@moebius/console-ui", "test"]);
}
