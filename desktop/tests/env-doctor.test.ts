import { describe, expect, it } from "vitest";
import { checkCodex } from "../src/env-doctor.js";
import type { CommandRunner } from "../src/shell-path.js";

describe("desktop env doctor", () => {
  it("checks only whether Codex can run", async () => {
    const calls: Array<{ command: string; args: readonly string[] }> = [];
    const runCommand: CommandRunner = async (command, args) => {
      calls.push({ command, args });
      if (command === "codex" && args[0] === "--version") {
        return { exitCode: 0, stdout: "codex 0.145.0\n", stderr: "" };
      }
      throw new Error("unexpected command");
    };

    await expect(checkCodex({ runCommand })).resolves.toMatchObject({
      status: "ok",
      message: "已找到",
      detail: "codex 0.145.0",
    });
    expect(calls).toEqual([{ command: "codex", args: ["--version"] }]);
  });

  it("requires Codex 0.145.0 or newer", async () => {
    await expect(checkCodex({
      runCommand: async () => ({
        exitCode: 0,
        stdout: "codex-cli 0.144.1\n",
        stderr: "",
      }),
    })).resolves.toEqual({
      status: "error",
      message: "Codex 需要升级到 0.145.0 或更高版本",
      detail: "codex-cli 0.144.1",
    });
  });

  it.each(["ENOENT", "ENOTDIR"])(
    "classifies %s as missing without leaking the spawn error",
    async (code) => {
      const error = Object.assign(
        new Error(`spawn codex ${code} at /Users/example/bin/codex`),
        { code },
      );

      await expect(checkCodex({
        runCommand: async () => {
          throw error;
        },
      })).resolves.toEqual({
        status: "error",
        message: "Codex 未找到",
      });
    },
  );

  it.each([
    {
      name: "a non-zero exit",
      runCommand: async () => ({
        exitCode: 1,
        stdout: "",
        stderr: "startup failed at /Users/example/.codex",
      }),
    },
    {
      name: "EACCES",
      runCommand: async () => {
        throw Object.assign(new Error("permission denied: /Users/example/bin/codex"), {
          code: "EACCES",
        });
      },
    },
    {
      name: "another spawn error",
      runCommand: async () => {
        throw Object.assign(new Error("spawn failed in /Users/example"), {
          code: "UNKNOWN",
        });
      },
    },
    {
      name: "an empty successful version",
      runCommand: async () => ({ exitCode: 0, stdout: " \n", stderr: "" }),
    },
  ])("classifies $name as unavailable without raw detail", async ({ runCommand }) => {
    await expect(checkCodex({ runCommand })).resolves.toEqual({
      status: "error",
      message: "Codex 不可用",
    });
  });
});
