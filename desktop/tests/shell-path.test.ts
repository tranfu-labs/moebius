import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createShellPathReadinessGate,
  mergePathValues,
  resolveShellPath,
  type ShellPathResult,
} from "../src/shell-path.js";
import { waitForCondition } from "../../src/testing/wait.js";

const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((root) =>
    fs.rm(root, { recursive: true, force: true })));
});

describe("desktop shell path", () => {
  it("does not change PATH outside macOS", async () => {
    await expect(resolveShellPath({ platform: "linux", currentPath: "/usr/bin" })).resolves.toEqual({
      path: "/usr/bin",
      source: "unchanged",
    });
  });

  it("keeps the current PATH before login shell additions on macOS", async () => {
    const runCommand = vi.fn(async () => ({
      exitCode: 0,
      stdout: framedPath(["/opt/homebrew/bin", "/usr/bin"].join(path.delimiter)),
      stderr: "",
    }));
    const result = await resolveShellPath({
      platform: "darwin",
      currentPath: ["/nvm/bin", "/usr/bin", "/bin"].join(path.delimiter),
      shellPath: "/bin/zsh",
      runCommand,
    });

    expect(result).toEqual({
      path: ["/nvm/bin", "/usr/bin", "/bin", "/opt/homebrew/bin"].join(path.delimiter),
      source: "login-shell",
    });
    expect(runCommand).toHaveBeenCalledWith(
      "/bin/zsh",
      ["-ilc", expect.stringContaining("$PATH")],
      expect.objectContaining({ timeoutMs: expect.any(Number) }),
    );
  });

  it("uses and deduplicates the login PATH when the current PATH is undefined", async () => {
    await expect(
      resolveShellPath({
        platform: "darwin",
        currentPath: undefined,
        shellPath: "/bin/zsh",
        runCommand: async () => ({
          exitCode: 0,
          stdout: framedPath(
            ["/opt/homebrew/bin", "", "/usr/bin", "/opt/homebrew/bin"].join(path.delimiter),
          ),
          stderr: "",
        }),
      }),
    ).resolves.toEqual({
      path: ["/opt/homebrew/bin", "/usr/bin"].join(path.delimiter),
      source: "login-shell",
    });
  });

  it("uses and deduplicates the login PATH when the current PATH is empty", async () => {
    await expect(
      resolveShellPath({
        platform: "darwin",
        currentPath: "",
        shellPath: "/bin/zsh",
        runCommand: async () => ({
          exitCode: 0,
          stdout: framedPath(
            ["/usr/local/bin", "/usr/bin", "/usr/local/bin"].join(path.delimiter),
          ),
          stderr: "",
        }),
      }),
    ).resolves.toEqual({
      path: ["/usr/local/bin", "/usr/bin"].join(path.delimiter),
      source: "login-shell",
    });
  });

  it("falls back to the current PATH when the login shell returns an empty PATH", async () => {
    await expect(
      resolveShellPath({
        platform: "darwin",
        currentPath: ["/current/bin", "/usr/bin"].join(path.delimiter),
        shellPath: "/bin/zsh",
        runCommand: async () => ({ exitCode: 0, stdout: framedPath(" "), stderr: "" }),
      }),
    ).resolves.toEqual({
      path: ["/current/bin", "/usr/bin"].join(path.delimiter),
      source: "fallback",
      error: "login-shell-path-empty",
    });
  });

  it("falls back to the current PATH when the login shell exits nonzero", async () => {
    await expect(
      resolveShellPath({
        platform: "darwin",
        currentPath: ["/current/bin", "/usr/bin"].join(path.delimiter),
        shellPath: "/bin/zsh",
        runCommand: async () => ({
          exitCode: 1,
          stdout: framedPath(["/login/bin", "/usr/bin"].join(path.delimiter)),
          stderr: "nope",
        }),
      }),
    ).resolves.toEqual({
      path: ["/current/bin", "/usr/bin"].join(path.delimiter),
      source: "fallback",
      error: "login-shell-exit-1",
    });
  });

  it("falls back to the current PATH when login shell probing throws", async () => {
    await expect(
      resolveShellPath({
        platform: "darwin",
        currentPath: ["/current/bin", "/usr/bin"].join(path.delimiter),
        shellPath: "/bin/zsh",
        runCommand: async () => {
          throw new Error("spawn failed");
        },
      }),
    ).resolves.toEqual({
      path: ["/current/bin", "/usr/bin"].join(path.delimiter),
      source: "fallback",
      error: "login-shell-probe-failed",
    });
  });

  it("does not expose a sensitive shell path when process startup fails", async () => {
    const sensitiveShellPath = path.join(
      os.tmpdir(),
      `private-user-shell-${String(process.pid)}`,
      "missing-zsh",
    );
    const result = await resolveShellPath({
      platform: "darwin",
      currentPath: "/usr/bin:/bin",
      shellPath: sensitiveShellPath,
    });

    expect(result).toEqual({
      path: "/usr/bin:/bin",
      source: "fallback",
      error: "login-shell-probe-failed",
    });
    expect(JSON.stringify(result)).not.toContain(sensitiveShellPath);
    expect(JSON.stringify(result)).not.toContain("ENOENT");
  });

  it("extracts only the framed PATH when interactive profiles print noise", async () => {
    await expect(resolveShellPath({
      platform: "darwin",
      currentPath: "/usr/bin",
      shellPath: "/bin/zsh",
      runCommand: async () => ({
        exitCode: 0,
        stdout: `profile banner\n${framedPath("/manager/bin:/usr/bin")}logout banner\n`,
        stderr: "cannot access tty",
      }),
    })).resolves.toEqual({
      path: "/usr/bin:/manager/bin",
      source: "login-shell",
    });
  });

  it.each([
    ["csh", "/bin/csh"],
    ["tcsh", "/bin/tcsh"],
  ])("loads the terminal PATH from a login-style %s invocation", async (_shellName, shellPath) => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "moebius-csh-path-"));
    temporaryRoots.push(root);
    const managerBin = path.join(root, "manager", "bin");
    await fs.mkdir(managerBin, { recursive: true });
    await fs.writeFile(
      path.join(root, ".tcshrc"),
      `setenv PATH ${shellQuote(`${managerBin}:/usr/bin:/bin`)}\n`,
      "utf8",
    );
    const originalHome = process.env.HOME;
    process.env.HOME = root;
    try {
      const result = await resolveShellPath({
        platform: "darwin",
        currentPath: "/usr/bin:/bin",
        shellPath,
        timeoutMs: 2_000,
      });
      expect(result.source).toBe("login-shell");
      expect(result.path.split(path.delimiter).slice(0, 2)).toEqual(["/usr/bin", "/bin"]);
      expect(result.path.split(path.delimiter)).toContain(managerBin);
    } finally {
      if (originalHome === undefined) delete process.env.HOME;
      else process.env.HOME = originalHome;
    }
  });

  it.each([
    ["npm-global", "/Users/test/.npm-global/bin"],
    ["nvm", "/Users/test/.nvm/versions/node/v22/bin"],
    ["fnm", "/Users/test/.local/share/fnm/node-versions/v22/installation/bin"],
    ["volta", "/Users/test/.volta/bin"],
  ])("adds the terminal-selected %s bin when the GUI PATH omits it", async (_manager, bin) => {
    await expect(resolveShellPath({
      platform: "darwin",
      currentPath: "/usr/bin:/bin",
      runCommand: async () => ({
        exitCode: 0,
        stdout: framedPath(`${bin}:/usr/bin:/bin`),
        stderr: "",
      }),
    })).resolves.toEqual({
      path: `/usr/bin:/bin:${bin}`,
      source: "login-shell",
    });
  });

  it.each([
    "profile banner without a frame",
    `${framedPath("/one/bin")}noise${framedPath("/two/bin")}`,
  ])("falls back safely for an ambiguous framed result", async (stdout) => {
    await expect(resolveShellPath({
      platform: "darwin",
      currentPath: "/current/bin",
      runCommand: async () => ({ exitCode: 0, stdout, stderr: "secret profile output" }),
    })).resolves.toEqual({
      path: "/current/bin",
      source: "fallback",
      error: "login-shell-path-invalid",
    });
  });

  it("bounds interactive profile output and falls back without exposing it", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "moebius-shell-path-output-limit-"));
    temporaryRoots.push(root);
    await fs.writeFile(
      path.join(root, ".zshrc"),
      "repeat 100 { printf 'secret-profile-noise' }\n",
      "utf8",
    );
    const originalZdotdir = process.env.ZDOTDIR;
    process.env.ZDOTDIR = root;
    try {
      await expect(resolveShellPath({
        platform: "darwin",
        currentPath: "/usr/bin:/bin",
        shellPath: "/bin/zsh",
        timeoutMs: 2_000,
        maxOutputBytes: 64,
        terminateGraceMs: 40,
      })).resolves.toEqual({
        path: "/usr/bin:/bin",
        source: "fallback",
        error: "shell-command-output-limit",
      });
    } finally {
      if (originalZdotdir === undefined) delete process.env.ZDOTDIR;
      else process.env.ZDOTDIR = originalZdotdir;
    }
  });

  it("deduplicates PATH entries by first occurrence and ignores empty entries", () => {
    const currentPath = ["", "/nvm/bin", "/shared/bin", "/nvm/bin", " "].join(path.delimiter);
    const loginPath = ["/shared/bin", "/opt/homebrew/bin", "", "/opt/homebrew/bin"].join(
      path.delimiter,
    );

    expect(mergePathValues(currentPath, loginPath)).toBe(
      ["/nvm/bin", "/shared/bin", "/opt/homebrew/bin"].join(path.delimiter),
    );
  });

  it("keeps waiters pending until the lazy shell PATH resolution is started and applied", async () => {
    const deferred = promiseWithResolvers<ShellPathResult>();
    const resolve = vi.fn(() => deferred.promise);
    const apply = vi.fn();
    const gate = createShellPathReadinessGate({ resolve, apply });
    let ready = false;
    void gate.ready.then(() => {
      ready = true;
    });

    await Promise.resolve();
    expect(resolve).not.toHaveBeenCalled();
    expect(ready).toBe(false);

    gate.start();
    await Promise.resolve();
    expect(resolve).toHaveBeenCalledTimes(1);
    expect(ready).toBe(false);

    const result: ShellPathResult = {
      path: "/opt/homebrew/bin:/usr/bin",
      source: "login-shell",
    };
    deferred.resolve(result);
    await gate.ready;
    expect(apply).toHaveBeenCalledWith(result);
    expect(ready).toBe(true);
  });

  it("starts shell PATH resolution once for repeated starts and concurrent waiters", async () => {
    const deferred = promiseWithResolvers<ShellPathResult>();
    const resolve = vi.fn(() => deferred.promise);
    const gate = createShellPathReadinessGate({ resolve, apply: vi.fn() });
    const first = gate.ready;
    const second = gate.ready;

    gate.start();
    gate.start();
    deferred.resolve({ path: "/usr/bin", source: "login-shell" });

    await expect(Promise.all([first, second])).resolves.toEqual([undefined, undefined]);
    expect(resolve).toHaveBeenCalledTimes(1);
  });

  it("runs dependent readiness work only after applying the resolved PATH", async () => {
    const deferred = promiseWithResolvers<ShellPathResult>();
    let activePath = "/usr/bin";
    const probe = vi.fn(async () => activePath);
    const gate = createShellPathReadinessGate({
      resolve: () => deferred.promise,
      apply: (result) => {
        activePath = result.path;
      },
    });

    const profilePath = gate.afterReady(probe);
    await Promise.resolve();
    expect(probe).not.toHaveBeenCalled();

    gate.start();
    deferred.resolve({
      path: "/usr/bin:/opt/homebrew/bin",
      source: "login-shell",
    });

    await expect(profilePath).resolves.toBe("/usr/bin:/opt/homebrew/bin");
    expect(probe).toHaveBeenCalledTimes(1);
  });
});

describe("desktop shell path process cleanup", () => {
  it("escalates after the shell leader closes and kills a descendant that ignores SIGTERM", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "moebius-shell-path-timeout-"));
    temporaryRoots.push(root);
    const parentPidPath = path.join(root, "parent.pid");
    const childPidPath = path.join(root, "child.pid");
    const stubbornChildSource = [
      'const fs = require("node:fs");',
      `fs.writeFileSync(${JSON.stringify(childPidPath)}, String(process.pid));`,
      'process.on("SIGTERM", () => {});',
      "setInterval(() => {}, 1_000);",
    ].join("");
    await fs.writeFile(path.join(root, ".zshrc"), [
      `echo $$ > ${shellQuote(parentPidPath)}`,
      `${shellQuote(process.execPath)} -e ${shellQuote(stubbornChildSource)} &`,
      "child=$!",
      `while [ ! -s ${shellQuote(childPidPath)} ]; do :; done`,
      "wait $child",
      "",
    ].join("\n"), "utf8");

    let appliedResult: ShellPathResult | null = null;
    let localConsoleStarted = false;
    const originalZdotdir = process.env.ZDOTDIR;
    process.env.ZDOTDIR = root;
    try {
      const gate = createShellPathReadinessGate({
        resolve: () => resolveShellPath({
          platform: "darwin",
          currentPath: "/usr/bin:/bin",
          shellPath: "/bin/zsh",
          timeoutMs: 500,
          terminateGraceMs: 80,
        }),
        apply: (result) => {
          appliedResult = result;
        },
      });
      gate.start();
      await gate.afterReady(async () => {
        localConsoleStarted = true;
      });
    } finally {
      if (originalZdotdir === undefined) delete process.env.ZDOTDIR;
      else process.env.ZDOTDIR = originalZdotdir;
    }

    expect(appliedResult).toEqual({
      path: "/usr/bin:/bin",
      source: "fallback",
      error: "shell-command-timed-out",
    });
    expect(localConsoleStarted).toBe(true);
    const parentPid = Number((await fs.readFile(parentPidPath, "utf8")).trim());
    const childPid = Number((await fs.readFile(childPidPath, "utf8")).trim());
    await waitForCondition(
      () => !pidExists(parentPid) && !pidExists(childPid),
      {
        kind: "io",
        timeoutMs: 1_000,
        describe: "the timed-out shell PATH process group to be fully reaped",
        snapshot: () => ({ parentPid, childPid, parentAlive: pidExists(parentPid), childAlive: pidExists(childPid) }),
      },
    );
  });
});

function promiseWithResolvers<T>(): PromiseWithResolvers<T> {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function framedPath(value: string): string {
  return `__MOEBIUS_SHELL_PATH_BEGIN__\n${value}\n__MOEBIUS_SHELL_PATH_END__\n`;
}

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`;
}

function pidExists(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return !(error instanceof Error && "code" in error && error.code === "ESRCH");
  }
}
