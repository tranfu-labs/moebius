import fs from "node:fs/promises";
import { spawn } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";

import { startLocalConsoleServer, type StartedLocalConsoleServer } from "../src/local-console/start.js";
import { assertLocalOnlyArguments, start } from "../src/runner.js";
import { waitForCondition } from "../src/testing/wait.js";

describe("local runtime startup", () => {
  it("accepts no arguments and rejects retired or unknown modes before startup", async () => {
    expect(() => assertLocalOnlyArguments([])).not.toThrow();
    expect(() => assertLocalOnlyArguments(["--"])).not.toThrow();
    expect(() => assertLocalOnlyArguments(["--github-mode"])).toThrow(/GitHub runner mode has been removed/);
    expect(() => assertLocalOnlyArguments(["--", "--github-mode"])).toThrow(/GitHub runner mode has been removed/);
    expect(() => assertLocalOnlyArguments(["--unknown"])).toThrow(/Unknown startup arguments: --unknown/);

    const startServer = vi.fn();
    await expect(start({ argv: ["--github-mode"], dependencies: { startLocalConsoleServer: startServer } }))
      .rejects.toThrow(/Run "pnpm start" to start the local console/);
    expect(startServer).not.toHaveBeenCalled();
  });

  it("starts and closes a clean local console without creating GitHub state", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "moebius-local-start-"));
    let startedUrl = "";
    const runtime = await start({
      argv: [],
      dependencies: {
        startLocalConsoleServer: async () => {
          const server: StartedLocalConsoleServer = await startLocalConsoleServer({
            host: "127.0.0.1",
            port: 0,
            projectRoot: root,
            listAgentFiles: async () => [],
          });
          startedUrl = server.url;
          return server;
        },
      },
    });

    try {
      expect(runtime.mode).toBe("local");
      expect(startedUrl).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/$/u);
      await expect(fs.stat(path.join(root, ".state", "local-console.sqlite"))).resolves.toBeDefined();
      await expect(fs.stat(path.join(root, ".state", "github-runner.sqlite"))).rejects.toMatchObject({ code: "ENOENT" });
    } finally {
      await runtime.close();
    }
  });

  it("cold-starts pnpm start and fails closed for the retired GitHub flag", async () => {
    const local = await runStartProcess([]);
    expect(local.output).toContain('"event":"start","mode":"local"');
    expect(local.output).toContain('"event":"local-console-started"');
    expect(local.output).not.toContain('"event":"start-failed"');

    const retired = await runStartProcess(["--github-mode"], true);
    expect(retired.exitCode).not.toBe(0);
    expect(retired.output).toContain("GitHub runner mode has been removed");
    expect(retired.output).toContain('Run \\"pnpm start\\" to start the local console');
    expect(retired.output).not.toContain('"event":"local-console-started"');
  }, 15_000);
});

async function runStartProcess(
  args: readonly string[],
  waitForExit = false,
): Promise<{ exitCode: number | null; output: string }> {
  const dataRoot = await fs.mkdtemp(path.join(os.tmpdir(), "moebius-clean-start-"));
  const pnpm = process.platform === "win32" ? "pnpm.cmd" : "pnpm";
  const child = spawn(pnpm, args.length === 0 ? ["start"] : ["start", "--", ...args], {
    cwd: path.resolve("."),
    env: { ...process.env, MOEBIUS_DATA_ROOT: dataRoot, LOCAL_CONSOLE_PORT: "0" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let output = "";
  child.stdout.on("data", (chunk) => { output += String(chunk); });
  child.stderr.on("data", (chunk) => { output += String(chunk); });
  const exitPromise = new Promise<number | null>((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", resolve);
  });
  const timeout = setTimeout(() => child.kill("SIGKILL"), 8_000);
  try {
    if (!waitForExit) {
      await waitForCondition(
        () => output.includes('"event":"local-console-started"') || output.includes('"event":"start-failed"'),
        { describe: "local runtime start output", kind: "io", timeoutMs: 6_000 },
      );
      child.kill("SIGTERM");
    }
    return { exitCode: await exitPromise, output };
  } finally {
    clearTimeout(timeout);
  }
}
