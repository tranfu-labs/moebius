import path from "node:path";
import { describe, expect, it } from "vitest";
import { mergePathValues, resolveShellPath } from "../src/shell-path.js";

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
});
