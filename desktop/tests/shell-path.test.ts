import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  createShellPathReadinessGate,
  mergePathValues,
  resolveShellPath,
  type ShellPathResult,
} from "../src/shell-path.js";

describe("desktop shell path", () => {
  it("does not change PATH outside macOS", async () => {
    await expect(resolveShellPath({ platform: "linux", currentPath: "/usr/bin" })).resolves.toEqual({
      path: "/usr/bin",
      source: "unchanged",
    });
  });

  it("keeps the current PATH before login shell additions on macOS", async () => {
    const result = await resolveShellPath({
      platform: "darwin",
      currentPath: ["/nvm/bin", "/usr/bin", "/bin"].join(path.delimiter),
      shellPath: "/bin/zsh",
      runCommand: async () => ({
        exitCode: 0,
        stdout: ["/opt/homebrew/bin", "/usr/bin"].join(path.delimiter),
        stderr: "",
      }),
    });

    expect(result).toEqual({
      path: ["/nvm/bin", "/usr/bin", "/bin", "/opt/homebrew/bin"].join(path.delimiter),
      source: "login-shell",
    });
  });

  it("uses and deduplicates the login PATH when the current PATH is undefined", async () => {
    await expect(
      resolveShellPath({
        platform: "darwin",
        currentPath: undefined,
        shellPath: "/bin/zsh",
        runCommand: async () => ({
          exitCode: 0,
          stdout: ["/opt/homebrew/bin", "", "/usr/bin", "/opt/homebrew/bin"].join(path.delimiter),
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
          stdout: ["/usr/local/bin", "/usr/bin", "/usr/local/bin"].join(path.delimiter),
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
        runCommand: async () => ({ exitCode: 0, stdout: " \n", stderr: "" }),
      }),
    ).resolves.toEqual({
      path: ["/current/bin", "/usr/bin"].join(path.delimiter),
      source: "fallback",
      error: "login shell exited with 0",
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
          stdout: ["/login/bin", "/usr/bin"].join(path.delimiter),
          stderr: "nope",
        }),
      }),
    ).resolves.toEqual({
      path: ["/current/bin", "/usr/bin"].join(path.delimiter),
      source: "fallback",
      error: "nope",
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
      error: "spawn failed",
    });
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

function promiseWithResolvers<T>(): PromiseWithResolvers<T> {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}
