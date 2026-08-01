import fs from "node:fs/promises";
import { spawn } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";

import { waitForCondition } from "../src/testing/wait.js";
import { startLocalConsoleServer, type StartedLocalConsoleServer } from "../src/local-console/start.js";
import { resolveRuntimeMode } from "../src/runtime-mode.js";
import { start, type Runner, type StartDependencies } from "../src/runner.js";
import type { GitHubResponseIntakeState } from "../src/github-response-intake.js";

const EMPTY_INTAKE: GitHubResponseIntakeState = { repositories: {}, issues: {} };

describe("runtime mode selection", () => {
  it("defaults to local and accepts only the exact GitHub flag", () => {
    expect(resolveRuntimeMode([])).toBe("local");
    expect(resolveRuntimeMode(["--github-mode"])).toBe("github");
    expect(resolveRuntimeMode(["--", "--github-mode"])).toBe("github");
    expect(() => resolveRuntimeMode(["--githubmode"])).toThrow(/Unknown startup arguments/);
    expect(() => resolveRuntimeMode(["--github-mode=1"])).toThrow(/Unknown startup arguments/);
    expect(() => resolveRuntimeMode(["--github-mode", "--github-mode"])).toThrow(/Unknown startup arguments/);
    expect(() => resolveRuntimeMode(["--unknown"])).toThrow(/Unknown startup arguments/);
  });

  it("starts a clean local console without preparing or creating GitHub runtime", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "moebius-local-start-"));
    const prepareGitHubRunnerState = vi.fn(async () => {
      throw new Error("GitHub state must not load in local mode");
    });
    const createRunner = vi.fn(() => {
      throw new Error("GitHub runner must not start in local mode");
    });
    let startedUrl = "";

    const runtime = await start({
      argv: [],
      dependencies: {
        startLocalConsoleServer: async () => {
          const startedServer: StartedLocalConsoleServer = await startLocalConsoleServer({
            host: "127.0.0.1",
            port: 0,
            projectRoot: root,
            listAgentFiles: async () => [],
          });
          startedUrl = startedServer.url;
          return startedServer;
        },
        prepareGitHubRunnerState,
        createRunner: createRunner as unknown as StartDependencies["createRunner"],
      },
    });

    try {
      expect(runtime.mode).toBe("local");
      expect(startedUrl).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/$/u);
      expect(prepareGitHubRunnerState).not.toHaveBeenCalled();
      expect(createRunner).not.toHaveBeenCalled();
      await expect(fs.stat(path.join(root, ".state", "local-console.sqlite"))).resolves.toBeDefined();
      await expect(fs.stat(path.join(root, ".state", "github-runner.sqlite"))).rejects.toMatchObject({ code: "ENOENT" });
    } finally {
      await runtime.close();
    }
  });

  it("starts only the GitHub runner when GitHub mode is explicit", async () => {
    const heartbeat = vi.fn(async () => {});
    const runner = fakeRunner(heartbeat);
    const startLocal = vi.fn(async () => {
      throw new Error("local console must not start in GitHub mode");
    });
    const prepare = vi.fn(async () => EMPTY_INTAKE);
    const create = vi.fn(() => runner);
    const timer = {} as NodeJS.Timeout;
    const clear = vi.fn();

    const runtime = await start({
      argv: ["--github-mode"],
      dependencies: {
        startLocalConsoleServer: startLocal as unknown as StartDependencies["startLocalConsoleServer"],
        prepareGitHubRunnerState: prepare,
        createRunner: create,
        setInterval: vi.fn(() => timer),
        clearInterval: clear,
      },
    });

    expect(runtime.mode).toBe("github");
    expect(startLocal).not.toHaveBeenCalled();
    expect(prepare).toHaveBeenCalledTimes(1);
    expect(create).toHaveBeenCalledWith({ initialState: EMPTY_INTAKE });
    expect(heartbeat).toHaveBeenCalledTimes(1);
    await runtime.close();
    expect(clear).toHaveBeenCalledWith(timer);
  });

  it("does not create either runtime when startup arguments or migration fail", async () => {
    const startLocal = vi.fn();
    const create = vi.fn();
    await expect(
      start({
        argv: ["--githubmode"],
        dependencies: {
          startLocalConsoleServer: startLocal as unknown as StartDependencies["startLocalConsoleServer"],
          createRunner: create as unknown as StartDependencies["createRunner"],
        },
      }),
    ).rejects.toThrow(/Unknown startup arguments/);
    expect(startLocal).not.toHaveBeenCalled();
    expect(create).not.toHaveBeenCalled();

    const prepare = vi.fn(async () => {
      throw new Error("migration timeout");
    });
    await expect(
      start({
        argv: ["--github-mode"],
        dependencies: {
          startLocalConsoleServer: startLocal as unknown as StartDependencies["startLocalConsoleServer"],
          prepareGitHubRunnerState: prepare,
          createRunner: create as unknown as StartDependencies["createRunner"],
        },
      }),
    ).rejects.toThrow(/migration timeout/);
    expect(create).not.toHaveBeenCalled();
  });

  it("cold-starts pnpm start without repositories or GitHub authentication", async () => {
    const result = await runStartProcess([]);

    expect(result.output).toContain('"event":"start","mode":"local"');
    expect(result.output).toContain('"event":"local-console-started"');
    expect(result.output).not.toContain('"event":"start-failed"');
  }, 10_000);

  it("exits non-zero for a non-exact GitHub flag before starting a runtime", async () => {
    const result = await runStartProcess(["--githubmode"], true);

    expect(result.exitCode).not.toBe(0);
    expect(result.output).toContain("Unknown startup arguments: --githubmode");
    expect(result.output).not.toContain('"event":"local-console-started"');
  }, 10_000);

  it("accepts the documented pnpm GitHub-mode command without starting local console", async () => {
    const result = await runStartProcess(["--github-mode"]);

    expect(result.output).toContain('"event":"start","mode":"github"');
    expect(result.output).not.toContain('"event":"local-console-started"');
    await expect(fs.stat(path.join(result.dataRoot, ".state", "github-runner.sqlite"))).resolves.toBeDefined();
    await expect(fs.stat(path.join(result.dataRoot, ".state", "local-console.sqlite"))).rejects.toMatchObject({ code: "ENOENT" });
  }, 10_000);
});

function fakeRunner(heartbeat: Runner["heartbeat"]): Runner {
  return {
    heartbeat,
    dispatcher: {
      dispatch: () => false,
      busyIssueKeys: () => new Set(),
      idle: async () => {},
    },
    persister: {
      state: () => EMPTY_INTAKE,
      update: () => EMPTY_INTAKE,
      flush: async () => {},
    },
  };
}

async function runStartProcess(
  args: readonly string[],
  waitForExit = false,
): Promise<{ exitCode: number | null; output: string; dataRoot: string }> {
  const dataRoot = await fs.mkdtemp(path.join(os.tmpdir(), "moebius-clean-start-"));
  const pnpm = process.platform === "win32" ? "pnpm.cmd" : "pnpm";
  const child = spawn(pnpm, args.length === 0 ? ["start"] : ["start", "--", ...args], {
    cwd: path.resolve("."),
    env: {
      ...process.env,
      MOEBIUS_DATA_ROOT: dataRoot,
      GH_CONFIG_DIR: path.join(dataRoot, "gh-config"),
      GH_TOKEN: "",
      GITHUB_TOKEN: "",
      LOCAL_CONSOLE_PORT: "0",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let output = "";
  child.stdout.on("data", (chunk) => {
    output += String(chunk);
  });
  child.stderr.on("data", (chunk) => {
    output += String(chunk);
  });
  const exitPromise = new Promise<number | null>((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", (code) => resolve(code));
  });

  const timeout = setTimeout(() => child.kill("SIGKILL"), 8_000);
  try {
    if (!waitForExit) {
      await waitForOutput(async () => {
        if (output.includes('"event":"start-failed"')) {
          return true;
        }
        if (args[0] === "--github-mode") {
          return fileExists(path.join(dataRoot, ".state", "github-runner.sqlite"));
        }
        return output.includes('"event":"local-console-started"');
      });
      child.kill("SIGTERM");
    }
    const exitCode = await exitPromise;
    return { exitCode, output, dataRoot };
  } finally {
    clearTimeout(timeout);
  }
}

async function waitForOutput(predicate: () => boolean | Promise<boolean>): Promise<void> {
  await waitForCondition(predicate, { describe: "runtime start output", kind: "io", timeoutMs: 6_000 });
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch (error) {
    return error instanceof Error && "code" in error && error.code === "ENOENT" ? false : Promise.reject(error);
  }
}
